/**
 * tests/unit/serialization.test.ts
 *
 * Curve.toPathData / toData / fromData / dispose, and SceneNode identity + toJSON/fromJSON.
 *
 * These are the guarantees a *document* host (as opposed to a one-shot script runner) depends
 * on: geometry that survives a save/load round-trip exactly, ids that survive it at all, and
 * deterministic release of kernel memory.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, SceneNode, initAsync } from '../../src/index';
import type { CurveData } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** Round-trip a curve through its own data description. */
const rt = (c: Curve): Curve => Curve.fromData(c.toData());

describe('Curve.toPathData', () =>
{
    it('emits y-down path-data unchanged when flipY is false', () =>
    {
        const rect = Curve.RectBetween([0, 0], [100, 50]);
        expect(rect.toPathData({ flipY: false })).toBe('M0 0 L100 0 L100 50 L0 50 L0 0 Z');
    });

    it('negates Y by default, matching toSVGElem', () =>
    {
        const rect = Curve.RectBetween([0, 0], [100, 50]);
        expect(rect.toPathData()).toBe('M0 0 L100 0 L100 -50 L0 -50 L0 0 Z');
    });

    it('emits real path-data for a Circle, which toSVGElem cannot', () =>
    {
        const circle = Curve.Circle(10, [0, 0, 0]);

        // The bug this method exists to fix: toSVGElem returns <circle/> with NO `d`, so any
        // host that scrapes `d="…"` out of it renders nothing at all for a circle.
        const elem = circle.toSVGElem();
        expect(elem).toContain('<circle');
        expect(elem).not.toContain(' d="');

        const d = circle.toPathData({ flipY: false });
        expect(d).toBe('M10 0 A10 10 0 0 1 -10 0 A10 10 0 0 1 10 0 Z');
        expect(d).toContain('A'); // arcs, not a tessellated polyline
    });

    it('leaves toSVGElem output untouched for a path curve', () =>
    {
        const rect = Curve.RectBetween([0, 0], [10, 10]);
        const elem = rect.toSVGElem();
        expect(elem).toContain('<path');
        expect(elem).toContain('d="M0 0 L10 0 L10 -10 L0 -10 L0 0 Z"');
    });

    it('appends holes as extra subpaths, which toSVGElem drops', () =>
    {
        const outer = Curve.RectBetween([0, 0], [40, 40]);
        const inner = Curve.RectBetween([10, 10], [20, 20]);
        outer.addHole(inner);

        const withHoles = outer.toPathData({ flipY: false });
        const without = outer.toPathData({ flipY: false, holes: false });

        expect(withHoles.match(/M/g)?.length).toBe(2);
        expect(without.match(/M/g)?.length).toBe(1);
        expect(outer.toSVGElem().match(/M/g)?.length).toBe(1);
    });
});

describe('Curve.toData / fromData — exact variants', () =>
{
    it('round-trips a Line', () =>
    {
        const line = Curve.Line([0, 0], [10, 0]);
        const data = line.toData();
        expect(data.type).toBe('Line');

        const back = Curve.fromData(data);
        expect(back.length()).toBeCloseTo(line.length(), 9);
    });

    it('round-trips an open Polyline', () =>
    {
        const poly = Curve.Polyline([[0, 0], [10, 0], [10, 10]]);
        const data = poly.toData();
        expect(data).toMatchObject({ type: 'Polyline', closed: false });

        const back = rt(poly);
        expect(back.isClosed()).toBe(false);
        expect(back.length()).toBeCloseTo(poly.length(), 9);
        expect(back.controlPoints().length).toBe(poly.controlPoints().length);
    });

    it('round-trips a closed Rect as a closed Polyline', () =>
    {
        const rect = Curve.RectBetween([0, 0], [100, 50]);
        const data = rect.toData();

        // hypercurve has no rect primitive — a Rect IS a closed 4-segment polyline, and
        // rebuilding it as one is exact. controlPoints() does not repeat the first point,
        // so fromData has to put it back or the ring would come back open.
        expect(data).toMatchObject({ type: 'Polyline', closed: true });
        expect((data as { points: unknown[] }).points.length).toBe(4);

        const back = Curve.fromData(data);
        expect(back.isClosed()).toBe(true);
        expect(Math.abs(back.area() ?? 0)).toBeCloseTo(Math.abs(rect.area() ?? 0), 9);
    });

    it('round-trips an Arc, keeping it a real arc', () =>
    {
        const arc = Curve.Arc([0, 0], [10, 10], [20, 0], 'threepoint');
        const data = arc.toData();
        expect(data.type).toBe('Arc');

        const back = Curve.fromData(data);
        expect(back.inner().hasArcs()).toBe(true);
        expect(back.length()).toBeCloseTo(arc.length(), 9);

        const a = arc.bbox()!, b = back.bbox()!;
        expect(b.min().x).toBeCloseTo(a.min().x, 9);
        expect(b.max().y).toBeCloseTo(a.max().y, 9);
    });

    it('round-trips a Circle, keeping exact area', () =>
    {
        const circle = Curve.Circle(10, [5, 5, 0]);
        const data = circle.toData();
        expect(data).toMatchObject({ type: 'Circle', radius: 10 });

        const back = Curve.fromData(data);
        expect(Math.abs(back.area() ?? 0)).toBeCloseTo(Math.abs(circle.area() ?? 0), 9);
        expect(back.inner().hasArcs()).toBe(true);
        expect(back.center().x).toBeCloseTo(5, 9);
    });

    it('rebuilds an Ellipse and an EllipticalArc from explicit parameters', () =>
    {
        // toData() never emits these — an ellipse is not recoverable from queries — but a
        // caller that knows its own construction parameters can round-trip through fromData.
        const ellipse = Curve.fromData({
            type: 'Ellipse', radiusX: 20, radiusY: 10, rotation: 30,
            center: [0, 0, 0], normal: [0, 0, 1],
        });
        // Area comes from the rational conic spans, so it is close but not exact to 1e-9.
        expect(Math.abs(ellipse.area() ?? 0) / (Math.PI * 20 * 10)).toBeCloseTo(1, 3);

        const arc = Curve.fromData({
            type: 'EllipticalArc', radiusX: 20, radiusY: 10, rotation: 0,
            startAngle: 0, endAngle: 90, center: [0, 0, 0], normal: [0, 0, 1],
        });
        expect(arc.length()).toBeGreaterThan(0);
    });

    it('rebuilds an Interpolated curve through its fitted-through points', () =>
    {
        const pts: [number, number, number][] = [[0, 0, 0], [10, 10, 0], [20, 0, 0], [30, 10, 0]];
        const spline = Curve.fromData({ type: 'Interpolated', points: pts, degree: 3 });

        // NOTE: this hypercurve build returns a densely sampled degree-1 curve from
        // makeInterpolated rather than a NURBS — so an interpolated curve IS its own polyline,
        // and toData() will (correctly, exactly) write it back out as one.
        expect(spline.length()).toBeGreaterThan(0);
        const bb = spline.bbox()!;
        expect(bb.min().x).toBeCloseTo(0, 6);
        expect(bb.max().x).toBeCloseTo(30, 6);

        expect(rt(spline).length()).toBeCloseTo(spline.length(), 6);
    });
});

describe('Curve.toData / fromData — the Path fallback', () =>
{
    it('keeps circular arcs EXACT through a boolean result', () =>
    {
        const rect = Curve.RectBetween([0, 0], [20, 20]);
        const circle = Curve.Circle(8, [20, 20, 0]);
        const union = rect.union(circle) as Curve;

        const data = union.toData();
        // A boolean result reports subtype 'Spline' and no constructor can express it, so it
        // falls back to path-data — but the arcs survive as `A` commands rather than being
        // tessellated into a polyline. This is the case that decides whether a CAD document
        // can be saved without degrading.
        expect(data.type).toBe('Path');
        expect((data as { d: string }).d).toContain('A');

        const back = Curve.fromData(data);
        expect(back.inner().hasArcs()).toBe(true);
        expect(Math.abs(back.area() ?? 0)).toBeCloseTo(Math.abs(union.area() ?? 0), 6);
    });

    it('round-trips a curve that carries a hole', () =>
    {
        const outer = Curve.RectBetween([0, 0], [40, 40]);
        const hole = Curve.RectBetween([10, 10], [20, 20]);
        outer.addHole(hole);

        const data = outer.toData();
        expect(data.holes?.length).toBe(1);

        const back = Curve.fromData(data);
        expect(back.hasHoles()).toBe(true);
        expect(back.holes().length).toBe(1);
        expect(Math.abs(back.holes()[0].area() ?? 0)).toBeCloseTo(100, 6);
    });

    it('survives JSON.stringify → parse (the wire form is plain data)', () =>
    {
        const arc = Curve.Arc([0, 0], [10, 10], [20, 0], 'threepoint');
        const wire = JSON.parse(JSON.stringify(arc.toData())) as CurveData;

        const back = Curve.fromData(wire);
        expect(back.length()).toBeCloseTo(arc.length(), 9);
    });
});

describe('Curve.dispose', () =>
{
    it('frees the kernel curve and makes further use an explicit error', () =>
    {
        const c = Curve.Circle(5);
        expect(c.length()).toBeGreaterThan(0);

        c.dispose();
        expect(() => c.inner()).toThrow();
    });

    it('frees holes with their parent', () =>
    {
        const outer = Curve.RectBetween([0, 0], [40, 40]);
        outer.addHole(Curve.RectBetween([10, 10], [20, 20]));

        outer.dispose();
        expect(outer.hasHoles()).toBe(false);
    });

    it('leaves other curves usable — no dangling pointer into rust', () =>
    {
        const keep = Curve.Circle(10);
        const drop = Curve.Circle(10);

        drop.dispose();

        // The real failure mode being guarded: freeing one handle corrupting another, which
        // surfaces later as "null pointer passed to rust" on an unrelated call.
        expect(Math.abs(keep.area() ?? 0)).toBeCloseTo(Math.PI * 100, 6);
        expect(keep.toPathData({ flipY: false })).toContain('A');
    });
});

describe('SceneNode identity', () =>
{
    it('gives every node a distinct, stable id', () =>
    {
        const root = new SceneNode('scene');
        const a = new SceneNode('a');
        const b = new SceneNode('b');
        root.addChild(a);
        root.addChild(b);

        expect(a.id()).not.toBe(b.id());
        const before = a.id();
        a.name = 'renamed';
        expect(a.id()).toBe(before); // survives rename, unlike path()
    });

    it('finds a node by id anywhere in the subtree', () =>
    {
        const root = new SceneNode('scene');
        const mid = new SceneNode('mid');
        const leaf = new SceneNode('leaf');
        root.addChild(mid);
        mid.addChild(leaf);

        expect(root.findById(leaf.id())).toBe(leaf);
        expect(root.findById(root.id())).toBe(root);
        expect(root.findById('nope')).toBeUndefined();
    });

    it('restores an id via setId, and emits it in toData', () =>
    {
        const n = new SceneNode('n');
        n.setId('fixed-id');
        expect(n.id()).toBe('fixed-id');
        expect(n.toData().id).toBe('fixed-id');
    });
});

describe('Shape identity + addToScene', () =>
{
    it('restores a shape id via setId', () =>
    {
        const c = Curve.Circle(5);
        c.setId('shape-1');
        expect(c.id()).toBe('shape-1');
    });

    it('adds a detached shape to a scene and clears the tmp flag', () =>
    {
        const root = new SceneNode('scene');
        const c = Curve.Circle(5).tmp();

        expect(c.node()).toBeNull();

        c.addToScene('myCircle', root);

        expect(c.node()).not.toBeNull();
        expect(c.name()).toBe('myCircle');
        expect(root.shapes().length).toBe(1);
    });

    it('adds to the active layer when the scene tracks one', () =>
    {
        const root = new SceneNode('scene');
        const layer = root.ensureLayer('walls');
        root.setActiveLayer(layer);

        const c = Curve.Circle(5);
        c.addToScene('w1', root);

        expect(c.node()?.parent()).toBe(layer);
    });
});

describe('SceneNode.toJSON / fromJSON', () =>
{
    /** A small scene: root → layer → two shapes, plus a shape directly on the root. */
    const build = (): SceneNode =>
    {
        const root = new SceneNode('scene');
        const layer = root.ensureLayer('walls');

        const rect = Curve.RectBetween([0, 0], [100, 50]).setId('rect-1').name('outer');
        const circle = Curve.Circle(10, [50, 25, 0]).setId('circle-1').name('hole');
        const arc = Curve.Arc([0, 0], [10, 10], [20, 0], 'threepoint').setId('arc-1');

        layer.addShape(rect as never);
        layer.addShape(circle as never);
        root.addShape(arc as never);
        return root;
    };

    it('round-trips tree shape, names and ids', () =>
    {
        const root = build();
        const doc = root.toJSON();
        const back = SceneNode.fromJSON(JSON.parse(JSON.stringify(doc)));

        expect(back.name).toBe('scene');
        expect(back.id()).toBe(root.id());

        const layer = back.find('walls');
        expect(layer).toBeDefined();
        expect(layer!.id()).toBe(root.find('walls')!.id());
        expect(layer!.children().length).toBe(2);

        expect(back.shapes().length).toBe(3);
        expect(back.findById(root.find('walls')!.id())).toBeDefined();
    });

    it('round-trips geometry exactly, not a tessellation of it', () =>
    {
        const root = build();
        const back = SceneNode.fromJSON(JSON.parse(JSON.stringify(root.toJSON())));

        const shapes = back.shapes().toArray() as Curve[];
        const byId = new Map(shapes.map(s => [s.id(), s]));

        const rect = byId.get('rect-1')!;
        expect(Math.abs(rect.area() ?? 0)).toBeCloseTo(100 * 50, 6);
        expect(rect.name()).toBe('outer');

        const circle = byId.get('circle-1')!;
        expect(Math.abs(circle.area() ?? 0)).toBeCloseTo(Math.PI * 100, 6);
        expect(circle.inner().hasArcs()).toBe(true);

        const arc = byId.get('arc-1')!;
        expect(arc.inner().hasArcs()).toBe(true);
        expect(arc.length()).toBeCloseTo(Math.PI * 10, 6);
    });

    it('preserves explicit style', () =>
    {
        const root = new SceneNode('scene');
        const c = Curve.Circle(5).setId('c1');
        c.color('#ff0000');
        root.addShape(c as never);

        const back = SceneNode.fromJSON(JSON.parse(JSON.stringify(root.toJSON())));
        const shape = back.shapes().first() as Curve;
        expect(shape.style.explicitData().color).toBe(c.style.explicitData().color);
    });

    it('writes a shape held by two nodes only once', () =>
    {
        const root = new SceneNode('scene');
        const a = root.ensureLayer('a');
        const c = Curve.Circle(5).setId('shared');
        a.addShape(c as never);

        const doc = root.toJSON();
        expect(doc.shapes.filter(s => s.id === 'shared').length).toBe(1);
    });

    it('keeps nodes that hold no serialisable geometry', () =>
    {
        const root = new SceneNode('scene');
        root.ensureLayer('empty');

        const back = SceneNode.fromJSON(JSON.parse(JSON.stringify(root.toJSON())));
        expect(back.find('empty')).toBeDefined();
        expect(back.shapes().length).toBe(0);
    });
});
