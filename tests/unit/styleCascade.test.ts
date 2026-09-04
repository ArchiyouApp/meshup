/** Style cascading: explicitData() must report ONLY what the author actually set.
 *
 *  REGRESSION: `_explicit` used to track whole top-level keys, so explicitData() emitted the
 *  complete `stroke` object as soon as any one of its members was touched. Since that object
 *  is seeded from SHAPE_DEFAULT_STYLE (stroke.color: 'red'), setting a dash pushed the default
 *  red into the cascade as if it had been chosen — and a dashed shape on a blue layer rendered
 *  red. Same trap for `fill` and `point`.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Style } from '../../src/Style';
import { SceneNode } from '../../src/SceneNode';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';

beforeAll(async () =>
{
    await initAsync();
});

/** The cascade Shape._effectiveStyle() performs: parent's explicit style, then the shape's. */
const cascade = (...styles: Style[]): Style =>
{
    const merged = new Style();
    styles.forEach(s => merged.merge(s.explicitData() as any));
    return merged;
};

describe('Style.explicitData() reports only what was set', () =>
{
    it('a dash alone does not claim the default stroke colour', () =>
    {
        const s = new Style();
        s.stroke = { dash: [5, 5] };

        expect(s.explicitData()).toEqual({ stroke: { dash: [5, 5] } });
        expect(s.explicitData().stroke).not.toHaveProperty('color');
        expect(s.explicitData().stroke).not.toHaveProperty('width');
    });

    it('an untouched style is fully empty', () =>
    {
        expect(new Style().explicitData()).toEqual({});
    });

    it('each stroke member is reported on its own', () =>
    {
        const s = new Style();
        s.strokeWidth = 3;
        expect(s.explicitData()).toEqual({ stroke: { width: 3 } });

        s.strokeCap = 'round';
        expect(s.explicitData()).toEqual({ stroke: { width: 3, cap: 'round' } });
    });

    it('fill and point behave the same', () =>
    {
        const f = new Style();
        f.fillOpacity = 0.5;
        expect(f.explicitData()).toEqual({ fill: { opacity: 0.5 } });

        const p = new Style();
        p.pointSize = 9;
        expect(p.explicitData()).toEqual({ point: { size: 9 } });
    });

    it('hands out a copy of the dash array, not the live one', () =>
    {
        const s = new Style();
        s.stroke = { dash: [5, 5] };

        const out = s.explicitData().stroke!.dash!;
        out.push(99);
        expect(s.strokeDash).toEqual([5, 5]);
    });
});

describe('dashed lines keep the colour that cascades onto them', () =>
{
    it('.dashed() on a blue layer stays blue', () =>
    {
        // layer('diagram').color('blue');  →  polyline(...).dashed();
        const layer = new Style();
        layer.color = 'blue';

        const shape = new Style();
        shape.stroke = { dash: [5, 5] };     // what Shape.dashed() does

        const eff = cascade(layer, shape);
        expect(eff.strokeColor).toBe('#0000ff');
        expect(eff.color).toBe('#0000ff');
        expect(eff.strokeDash).toEqual([5, 5]);
    });

    it('.lineWidth() on a blue layer stays blue too', () =>
    {
        const layer = new Style();
        layer.color = 'blue';

        const shape = new Style();
        shape.stroke = { width: 4 };         // what Shape.lineWidth() does

        const eff = cascade(layer, shape);
        expect(eff.strokeColor).toBe('#0000ff');
        expect(eff.strokeWidth).toBe(4);
    });

    it('a stroke colour the shape DID choose still wins over the layer', () =>
    {
        const layer = new Style();
        layer.color = 'blue';

        const shape = new Style();
        shape.stroke = { color: 'green', dash: [2, 2] };

        expect(cascade(layer, shape).strokeColor).toBe('#008000');
    });

    it('a layer stroke width survives a shape that only dashes', () =>
    {
        const layer = new Style();
        layer.strokeWidth = 7;

        const shape = new Style();
        shape.stroke = { dash: [1, 1] };

        const eff = cascade(layer, shape);
        expect(eff.strokeWidth).toBe(7);
        expect(eff.strokeDash).toEqual([1, 1]);
    });

    it('the shorthand .color set after a stroke colour reports the colour that applies', () =>
    {
        const s = new Style();
        s.strokeColor = 'green';
        s.color = 'blue';                    // shorthand overwrites stroke.color

        expect(s.explicitData().stroke!.color).toBe('#0000ff');
        expect(cascade(s).strokeColor).toBe('#0000ff');
    });
});

describe('through the scene graph', () =>
{
    it('a dashed curve under a blue layer cascades blue', () =>
    {
        const root  = new SceneNode('root');
        const curve = Curve.Line([0, 0, 0], [100, 0, 0]);
        const layer = root.addLayer('diagram', curve);
        layer.style.color = 'blue';

        curve.style.stroke = { dash: [5, 5] };

        const eff = new Style();
        eff.merge(layer.effectiveStyle().explicitData() as any);
        eff.merge(curve.style.explicitData() as any);

        expect(eff.strokeColor).toBe('#0000ff');
        expect(eff.strokeDash).toEqual([5, 5]);
    });
});

describe('continuous() undoes dashed()', () =>
{
    const line = () => Curve.Line([0, 0, 0], [100, 0, 0]);

    it('clears a dash the shape set on itself', () =>
    {
        const c = line().dashed();
        expect(c.style.strokeDash).toEqual([2, 2]);

        c.continuous();
        expect(c.style.strokeDash).toEqual([]);
    });

    it('is an EXPLICIT choice, so it travels through the cascade', () =>
    {
        expect(line().continuous().style.explicitData()).toEqual({ stroke: { dash: [] } });
    });

    // The reason it exists: opting one shape out of a dashed layer, without touching the layer.
    it('wins over a dashed layer, and leaves the layer colour cascading', () =>
    {
        const root  = new SceneNode('root');
        const curve = line();
        const layer = root.addLayer('diagram', curve);
        layer.color('blue').dashed();

        curve.continuous();

        const eff = new Style();
        eff.merge(layer.effectiveStyle().explicitData() as any);
        eff.merge(curve.style.explicitData() as any);

        expect(eff.strokeDash).toEqual([]);             // solid again
        expect(eff.strokeColor).toBe('#0000ff');        // still the layer's blue
    });

    it('un-dashes a container without disturbing its other styling', () =>
    {
        const layer = new SceneNode('diagram');
        layer.color('blue').strokeWidth(3).dashed().continuous();

        const d = layer.style.explicitData();
        expect(d.stroke!.dash).toEqual([]);
        expect(d.stroke!.width).toBe(3);
        expect(d.color).toBe('#0000ff');
    });

    it('a dashed container can be overridden by a nested continuous one', () =>
    {
        const root  = new SceneNode('root');
        const outer = root.addLayer('diagram', line());
        outer.dashed();
        const inner = outer.addLayer('solids', line());
        inner.continuous();

        expect(inner.effectiveStyle().strokeDash).toEqual([]);
        expect(outer.effectiveStyle().strokeDash).toEqual([5, 5]);
    });

    // Exactly what GLTFBuilder does per shape: node's effective style as the BASE (full data,
    // defaults included), then the shape's explicit properties on top.
    it('survives the export cascade, where the layer style is the full base', () =>
    {
        const root  = new SceneNode('root');
        const curve = line();
        const layer = root.addLayer('diagram', curve);
        layer.dashed([10, 4]);

        curve.continuous();

        const exported = new Style(layer.effectiveStyle().toData());
        exported.merge(curve.style.explicitData() as any);

        expect(exported.strokeDash).toEqual([]);
        expect(exported.toSvgAttrs()).not.toContain('stroke-dasharray');
    });

    it('a ShapeCollection un-dashes every shape in it', () =>
    {
        const col = new ShapeCollection<Curve>(line().dashed(), Curve.Circle(5).dashed());
        col.continuous();
        col.toArray().forEach(c => expect(c.style.strokeDash).toEqual([]));
    });
});
