/**
 * SVG output — stroke scaling and the single-source-of-truth rule.
 *
 * Both properties pinned here were broken by a one-line change that added
 * `vector-effect="non-scaling-stroke"` unconditionally to Style.toSvgAttrs(). The damage
 * only showed up downstream, in documents: a drawing placed in a page view is scaled from
 * model units to millimetres of paper, and non-scaling-stroke exempts the stroke — and the
 * dash pattern — from exactly that scaling. Lines stopped tracking the drawing and dashes
 * no longer matched the geometry at any zoom.
 *
 * Nothing in meshup's own tests noticed, because meshup never scales its own output.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, initAsync } from '../../src/index';
import { ShapeCollection } from '../../src/ShapeCollection';

beforeAll(async () =>
{
    await initAsync();
});

/** A square of the given size, as a collection ready to serialize. */
function squareCollection(size: number): ShapeCollection<any>
{
    return new ShapeCollection<any>(
        Curve.Line([0, 0, 0], [size, 0, 0]),
        Curve.Line([size, 0, 0], [size, size, 0]),
        Curve.Line([size, size, 0], [0, size, 0]),
        Curve.Line([0, size, 0], [0, 0, 0]),
    );
}

function strokeWidthOf(svg: string): number
{
    return Number(/\.line\{[^}]*stroke-width:([0-9.]+)/.exec(svg)?.[1]);
}

describe('Style.toSvgAttrs — non-scaling-stroke is opt-in', () =>
{
    it('does not emit vector-effect by default', () =>
    {
        // The default must stay scale-tracking: a document scales model units to paper,
        // and a stroke exempted from that scaling is not a line weight any more.
        expect(Curve.Line([0, 0, 0], [10, 0, 0]).toSVGElem()).not.toContain('vector-effect');
    });

    it('emits it when a caller explicitly asks', () =>
    {
        const elem = Curve.Line([0, 0, 0], [10, 0, 0]).toSVGElem(undefined, { nonScalingStroke: true });
        expect(elem).toContain('vector-effect="non-scaling-stroke"');
    });

    it('omits default styling when the caller ships its own stylesheet', () =>
    {
        const line = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(line.toSVGElem('line')).toMatch(/stroke=/);
        // With omitDefaults the stylesheet owns the defaults, so nothing is duplicated.
        expect(line.toSVGElem('line', { omitDefaults: true })).not.toMatch(/stroke=|stroke-width=|fill=/);
    });

    it('still emits a genuine per-shape override', () =>
    {
        const line = Curve.Line([0, 0, 0], [10, 0, 0]);
        line.style.stroke = { color: 'blue' };
        // An author's .color() must survive — that was the point of keeping attributes at all.
        // The setter normalises colour names to hex, so assert on the value, not the spelling.
        const elem = line.toSVGElem('line', { omitDefaults: true });
        expect(elem).toMatch(/stroke="#0000ff"/i);
    });
});

describe('ShapeCollection.toSVG — one source of truth per property', () =>
{
    it('declares stroke styling exactly once, in the stylesheet', () =>
    {
        const svg = squareCollection(100).toSVG();

        // Previously every path carried BOTH stroke-width="1" and a CSS rule of 0.25px —
        // four times apart, with CSS silently winning. Any consumer that dropped the
        // <style> (a sanitizer, an embed, a fragment copy) got 4x thicker lines.
        expect(svg).toMatch(/<style>/);
        for (const path of svg.match(/<path[^>]*\/>/g) ?? [])
        {
            expect(path).not.toMatch(/\sstroke=|\sstroke-width=|\sfill=|\svector-effect=/);
        }
    });

    it('scales the line weight with the drawing, not with the model units', () =>
    {
        // A line weight should be a property of the paper. Once each drawing is fitted to a
        // page the view scale is (page / drawing), so a stroke of (drawing / k) lands at the
        // same fraction of the page for a 10mm bracket and a 30m building alike.
        const small = strokeWidthOf(squareCollection(10).toSVG());
        const large = strokeWidthOf(squareCollection(3000).toSVG());

        expect(small).toBeGreaterThan(0);
        // Not exactly 300: the viewBox is the union of each curve's own 5%-padded box, so
        // the framing carries a small constant term. The property under test is that the
        // weight tracks the drawing's size, which a ratio near 300 demonstrates.
        expect(large / small).toBeGreaterThan(290);
        expect(large / small).toBeLessThan(310);
    });

    it('scales the hidden-line dash with the line weight', () =>
    {
        // Dashes are part of the stroke, so non-scaling-stroke desynchronised them from the
        // geometry too — dashed, but at the wrong rhythm at every zoom.
        const svg = squareCollection(100).toSVG();
        const stroke = strokeWidthOf(svg);
        const dash = /\.hidden\{[^}]*stroke-dasharray:([0-9.]+) ([0-9.]+)/.exec(svg);

        expect(dash).not.toBeNull();
        expect(Number(dash![1]) / stroke).toBeCloseTo(12, 1);
        expect(Number(dash![2]) / stroke).toBeCloseTo(8, 1);
    });

    it('honours an explicit stroke width and an opt-in to non-scaling stroke', () =>
    {
        expect(strokeWidthOf(squareCollection(100).toSVG({ strokeWidth: 2 }))).toBe(2);
        expect(squareCollection(100).toSVG({ nonScalingStroke: true })).toContain('vector-effect');
    });
});
