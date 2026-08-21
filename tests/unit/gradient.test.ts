/**
 * gradient.test.ts — Style.gradient and the colorGradient() API.
 *
 * Two things carry most of the weight here:
 *
 *  1. **The argument forms**, because `ColorInput` already accepts `[r,g,b]` tuples, so
 *     `[255,0,0]` and `[0.5,'blue']` are both two-or-three element arrays and only an explicit
 *     rule tells them apart.
 *  2. **Survival through the style pipeline.** `Style.merge`, `explicitData` and `toData` each
 *     enumerate their keys by hand; a gradient missing from any one of them is dropped silently
 *     somewhere far from the mistake — in the cascade, in a `_copy()`, or at glTF export.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';
import { SceneNode } from '../../src/SceneNode';
import { Style } from '../../src/Style';

beforeAll(async () => { await initAsync(); });

const line = () => Curve.Line([0, 0, 0], [10, 0, 0]);
const positions = (s: Style) => s.gradient!.stops.map(x => x.at);
const colors = (s: Style) => s.gradient!.stops.map(x => x.color);

describe('argument forms', () =>
{
    it('takes two colours', () =>
    {
        const c = line().colorGradient('red', 'blue');
        expect(positions(c.style)).toEqual([0, 1]);
        expect(colors(c.style)).toEqual(['#ff0000', '#0000ff']);
    });

    it('spreads three or more colours evenly', () =>
    {
        const c = line().colorGradient('red', 'white', 'blue');
        expect(positions(c.style)).toEqual([0, 0.5, 1]);
    });

    it('takes an array of [position, colour] stops', () =>
    {
        const c = line().colorGradient([[0, 'red'], [0.25, 'orange'], [1, 'blue']]);
        expect(positions(c.style)).toEqual([0, 0.25, 1]);
        expect(colors(c.style)).toEqual(['#ff0000', '#ffa500', '#0000ff']);
    });

    it('takes the same stops as varargs', () =>
    {
        const c = line().colorGradient([0, 'red'], [0.25, 'orange'], [1, 'blue']);
        expect(positions(c.style)).toEqual([0, 0.25, 1]);
    });

    it('takes stops as { at, color } objects', () =>
    {
        const c = line().colorGradient([{ at: 0, color: 'red' }, { at: 1, color: 'blue' }]);
        expect(colors(c.style)).toEqual(['#ff0000', '#0000ff']);
    });

    it('reads [r,g,b] as a COLOUR, not a stop', () =>
    {
        // The whole disambiguation rule in one test: three numbers is a colour, and a
        // two-element array whose second element is not a number is a stop.
        const c = line().colorGradient([255, 0, 0], [0, 0, 255]);
        expect(positions(c.style)).toEqual([0, 1]);
        expect(colors(c.style)).toEqual(['#ff0000', '#0000ff']);
    });

    it('accepts hex, ints and CSS names interchangeably', () =>
    {
        expect(colors(line().colorGradient('#f00', 0x0000ff).style)).toEqual(['#ff0000', '#0000ff']);
    });
});

describe('normalisation', () =>
{
    it('sorts stops by position', () =>
    {
        const c = line().colorGradient([[1, 'blue'], [0, 'red'], [0.5, 'white']]);
        expect(positions(c.style)).toEqual([0, 0.5, 1]);
        expect(colors(c.style)).toEqual(['#ff0000', '#ffffff', '#0000ff']);
    });

    it('clamps positions to 0..1', () =>
    {
        const c = line().colorGradient([[-3, 'red'], [7, 'blue']]);
        expect(positions(c.style)).toEqual([0, 1]);
    });

    it('expands a single stop into a flat two-ended ramp', () =>
    {
        // So every consumer can assume a span without special-casing a one-stop ramp.
        const c = line().colorGradient([[0.4, 'red']]);
        expect(positions(c.style)).toEqual([0, 1]);
        expect(colors(c.style)).toEqual(['#ff0000', '#ff0000']);
    });

    it('keeps coincident stops in written order, so a hard break stays a hard break', () =>
    {
        const c = line().colorGradient([[0, 'red'], [0.5, 'red'], [0.5, 'blue'], [1, 'blue']]);
        expect(colors(c.style)).toEqual(['#ff0000', '#ff0000', '#0000ff', '#0000ff']);
    });

    it('samples the ramp at a position', () =>
    {
        const c = line().colorGradient('#000000', '#ffffff');
        expect(c.style.sampleGradient(0.5)).toBe('#808080');
        expect(c.style.sampleGradient(0)).toBe('#000000');
    });

    it('falls back to the flat stroke colour when there is no gradient', () =>
    {
        expect(line().color('red').style.sampleGradient(0.5)).toBe('#ff0000');
    });
});

describe('refusing rather than guessing', () =>
{
    it('refuses one colour, and points at .color()', () =>
    {
        expect(() => line().colorGradient('red')).toThrow(/not a gradient/);
        expect(() => line().colorGradient('red')).toThrow(/\.color\(\)/);
    });

    it('refuses no arguments', () =>
    {
        expect(() => (line() as any).colorGradient()).toThrow(/at least two colours/);
    });

    it('explains when an array is not readable as stops', () =>
    {
        // [255,0,0] alone is a colour, not a list of stops — say so rather than guessing.
        expect(() => line().colorGradient([255, 0, 0])).toThrow(/not a stop/);
    });

    it('refuses an invalid colour', () =>
    {
        expect(() => line().colorGradient('red', 'nosuchcolour')).toThrow(/unrecognised color/);
    });
});

describe('interaction with .color()', () =>
{
    it('a later .color() clears the gradient', () =>
    {
        // Last call wins. Otherwise the gradient keeps rendering and .color() looks broken.
        const c = line().colorGradient('red', 'blue').color('green');
        expect(c.style.gradient).toBeUndefined();
        expect(c.style.color).toBe('#008000');
    });

    it('a later .colorGradient() overrides an earlier flat colour', () =>
    {
        const c = line().color('green').colorGradient('red', 'blue');
        expect(c.style.gradient).toBeDefined();
    });

    it('setting the gradient to undefined removes it', () =>
    {
        const c = line().colorGradient('red', 'blue');
        c.style.gradient = undefined;
        expect(c.style.gradient).toBeUndefined();
    });
});

describe('survival through the style pipeline', () =>
{
    it('survives merge -> explicitData -> toData', () =>
    {
        const src = new Style();
        src.gradient = [{ at: 0, color: 'red' }, { at: 1, color: 'blue' }];

        expect(src.explicitData().gradient?.stops).toHaveLength(2);
        expect(src.toData().gradient?.stops).toHaveLength(2);

        const dst = new Style(src.toData());
        expect(dst.gradient?.stops.map(s => s.color)).toEqual(['#ff0000', '#0000ff']);
    });

    it('is not reported as explicit when it was never set', () =>
    {
        // Otherwise a shape with no gradient would override a layer that has one.
        expect(new Style().explicitData().gradient).toBeUndefined();
    });

    it('cascades from a SceneNode down to its shapes', () =>
    {
        const node = new SceneNode('layer');
        node.colorGradient('red', 'blue');
        expect(node.effectiveStyle().gradient?.stops.map(s => s.color)).toEqual(['#ff0000', '#0000ff']);
    });

    it("lets a shape's own gradient win over its layer's", () =>
    {
        const node = new SceneNode('layer');
        node.colorGradient('red', 'blue');

        const merged = new Style(node.effectiveStyle().toData());
        const own = new Style();
        own.gradient = [{ at: 0, color: 'green' }, { at: 1, color: 'white' }];
        merged.merge(own.explicitData() as any);

        expect(merged.gradient?.stops.map(s => s.color)).toEqual(['#008000', '#ffffff']);
    });

    it('survives a Curve copy', () =>
    {
        const c = line().colorGradient('red', 'blue');
        expect(c.copy().style.gradient?.stops.map(s => s.color)).toEqual(['#ff0000', '#0000ff']);
    });

    it('cannot be mutated through the returned reference', () =>
    {
        const c = line().colorGradient('red', 'blue');
        const g = c.style.gradient!;
        g.stops[0].color = '#00ff00';
        expect(c.style.gradient!.stops[0].color).toBe('#ff0000');
    });
});

describe('fan-out', () =>
{
    it('gives every curve in a collection its own full ramp', () =>
    {
        const col = new ShapeCollection(
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Line([0, 5, 0], [10, 5, 0]),
        );
        col.colorGradient('red', 'blue');
        col.toArray().forEach((s: any) =>
        {
            expect(s.style.gradient.stops.map((x: any) => x.color)).toEqual(['#ff0000', '#0000ff']);
        });
    });
});

describe('SVG output', () =>
{
    it('flattens a gradient to its midpoint colour', () =>
    {
        // SVG gradients need a <defs><linearGradient>, which the attribute emitter cannot
        // reach. Sampling the middle keeps a printed drawing recognisable rather than showing
        // only the ramp's first stop.
        const c = line().colorGradient('#000000', '#ffffff');
        expect(c.style.toSvgAttrs(false)).toContain('stroke="#808080"');
    });

    it('writes the flattened colour even when defaults are omitted', () =>
    {
        // omitDefaults drops a stroke that equals the default; a gradient's colour never is one.
        const c = line().colorGradient('#000000', '#ffffff');
        expect(c.style.toSvgAttrs(false, { omitDefaults: true })).toContain('stroke="#808080"');
    });

    it('leaves a plain curve\'s SVG untouched', () =>
    {
        const c = line().color('red');
        expect(c.style.toSvgAttrs(false)).toContain('stroke="#ff0000"');
    });
});
