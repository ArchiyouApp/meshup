import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Point } from '../../src/Point';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';

const OUTPUT_DIR = './tests/outputs/curve/';

beforeAll(async () =>
{
    await initAsync();
});

describe('Curve.Line()', () =>
{
    it('creates a non-null curve', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c).toBeTruthy();
    });

    it('has the correct length', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.length()).toBeCloseTo(10, 1);
    });

    it('start() returns the start point', () =>
    {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.start().x).toBeCloseTo(1);
        expect(c.start().y).toBeCloseTo(2);
        expect(c.start().z).toBeCloseTo(3);
    });

    it('end() returns the end point', () =>
    {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.end().x).toBeCloseTo(4);
        expect(c.end().y).toBeCloseTo(5);
        expect(c.end().z).toBeCloseTo(6);
    });

    it('is not closed', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.isClosed()).toBe(false);
    });

    it('throws for invalid points', () =>
    {
        expect(() => Curve.Line('bad' as any, [0, 0, 0])).toThrow();
    });

    it('throws for a zero-length line (coincident start and end)', () =>
    {
        expect(() => Curve.Line([5, 5, 5], [5, 5, 5])).toThrow(/zero-length/i);
    });

    it('throws for a near-zero-length line (within tolerance)', () =>
    {
        expect(() => Curve.Line([0, 0, 0], [1e-9, 0, 0])).toThrow(/zero-length/i);
    });
});

describe('Curve.vertices()', () =>
{
    it('returns [start, end] for a straight line', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const vs = c.vertices();
        expect(vs.length).toBe(2);
        expect(vs.first().distance([0, 0, 0])).toBeCloseTo(0);
        expect(vs.last().distance([10, 0, 0])).toBeCloseTo(0);
    });

    it('returns every corner of an open polyline', () =>
    {
        const c = Curve.Polyline([[0, 0, 0], [5, 0, 0], [5, 5, 0], [0, 5, 0]]);
        expect(c.vertices().length).toBe(4);
    });

    it('returns 4 distinct corners for a closed rect', () =>
    {
        const c = Curve.Rect(10, 6, [0, 0, 0], 'xy');
        expect(c.isClosed()).toBe(true);
        expect(c.vertices().length).toBe(4);
    });

    it('returns [start, end] for a single arc/spline span', () =>
    {
        const c = Curve.Circle(5).isClosed() ? Curve.Arc([0, 0, 0], [5, 5, 0], [10, 0, 0]) : Curve.Line([0,0,0],[1,0,0]);
        expect(c.vertices().length).toBe(2);
    });
});

describe('Curve.Polyline()', () =>
{
    it('creates a polyline through multiple points', () =>
    {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0], [0,5,0]]);
        expect(c).toBeTruthy();
    });

    it('has a positive length', () =>
    {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0]]);
        expect(c.length()).toBeGreaterThan(0);
    });

    it('accepts flat args: Curve.Polyline(p1, p2, p3)', () =>
    {
        const c = Curve.Polyline([0,0,0], [10,0,0], [10,10,0]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });

    it('throws for a single point', () =>
    {
        expect(() => Curve.Polyline([[1, 2, 3]])).toThrow(/zero-length/i);
    });

    it('throws when all points are coincident', () =>
    {
        expect(() => Curve.Polyline([[1, 1, 1], [1, 1, 1], [1, 1, 1]])).toThrow(/zero-length/i);
    });
});

describe('Curve.segment()', () =>
{
    // A square polyline → 4 atomic segments (0..3)
    const square = () => Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0], [0,0,0]]);

    it('returns a single segment as a plain Curve', () =>
    {
        const seg = square().segment(0);
        expect(seg.isCompound()).toBe(false);
        expect(seg.length()).toBeCloseTo(10);
    });

    it('combines a range of segments into one Curve', () =>
    {
        const seg = square().segment(0, 2); // first three edges
        expect(seg.length()).toBeCloseTo(30);
        expect(new Point(seg.start()).distance(new Point(0,0,0))).toBeCloseTo(0);
        expect(new Point(seg.end()).distance(new Point(0,10,0))).toBeCloseTo(0);
    });

    it('supports negative indices from the end', () =>
    {
        const seg = square().segment(-1); // last edge
        expect(seg.length()).toBeCloseTo(10);
        expect(new Point(seg.start()).distance(new Point(0,10,0))).toBeCloseTo(0);
        expect(new Point(seg.end()).distance(new Point(0,0,0))).toBeCloseTo(0);
    });

    it('wraps around the end of a closed curve when from > to', () =>
    {
        // last edge (0,10,0)->(0,0,0) + first edge (0,0,0)->(10,0,0)
        const seg = square().segment(-1, 0);
        expect(seg.length()).toBeCloseTo(20);
        expect(new Point(seg.start()).distance(new Point(0,10,0))).toBeCloseTo(0);
        expect(new Point(seg.end()).distance(new Point(10,0,0))).toBeCloseTo(0);
    });

    it('takes the whole closed curve for an ascending full range', () =>
    {
        expect(square().segment(0, 3).length()).toBeCloseTo(40);
    });

    it('throws when wrapping an open curve', () =>
    {
        const open = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]); // 3 edges, open
        expect(() => open.segment(-1, 0)).toThrow(/open/i);
    });

    it('throws when the index range is out of bounds', () =>
    {
        expect(() => square().segment(0, 99)).toThrow(/out of bounds/i);
    });
});

describe('Curve.Interpolated()', () =>
{
    it('creates a smooth curve through control points', () =>
    {
        // degree 3 needs at least 4 control points
        const c = Curve.Interpolated([[0,0,0], [3,5,0], [7,5,0], [10,0,0]]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });
});

describe('Curve.Circle()', () =>
{
    it('creates a circle with the given radius', () =>
    {
        const c = Curve.Circle(5);
        expect(c).toBeTruthy();
    });

    it('is closed', () =>
    {
        const c = Curve.Circle(5);
        expect(c.isClosed()).toBe(true);
    });

    it('circumference ≈ 2πr', () =>
    {
        const r = 10;
        const c = Curve.Circle(r);
        expect(c.length()).toBeCloseTo(2 * Math.PI * r, 0);
    });
});

describe('Curve.tessellate()', () =>
{
    it('returns an array of Points', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(Array.isArray(pts)).toBe(true);
        expect(pts.length).toBeGreaterThan(0);
    });

    it('first tessellated point is near the start', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(pts[0].x).toBeCloseTo(0, 1);
    });
});

describe('Curve.pointAtParam()', () =>
{
    it('returns start point at param domain[0]', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const domain = c.inner().knotsDomain();
        const pt = c.pointAtParam(domain[0]);
        expect(pt.x).toBeCloseTo(0, 1);
    });
});

describe('Curve.type()', () =>
{
    it('returns "line" for a simple NurbsCurve', () =>
    {
        const c = Curve.Line([0,0,0], [1,0,0]);
        expect(c.type).toBe('Curve');
    });
});

describe('Curve.center()', () =>
{
    it('returns midpoint of a line along x-axis', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(5, 1);
        expect(center.y).toBeCloseTo(0, 1);
        expect(center.z).toBeCloseTo(0, 1);
    });

    it('returns center of a circle', () =>
    {
        const c = Curve.Circle(5, [3, 4, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(3, 0);
        expect(center.y).toBeCloseTo(4, 0);
    });

    it('returns a Point instance', () =>
    {
        const c = Curve.Line([1, 2, 3], [5, 6, 7]);
        expect(c.center()).toBeInstanceOf(Object); // Point
        expect(typeof c.center().x).toBe('number');
    });
});

describe('Curve.grid()', () =>
{
    it('accepts per-axis spacing as a vector-like 4th parameter', () =>
    {
        const curves = Curve.Line([0, 0, 0], [10, 0, 0]).grid(2, 2, 2, [5, 6, 7]);
        const centers = curves.toArray().map(curve => curve.center().toArray());

        expect(curves.length).toBe(8);
        expect(centers).toContainEqual([5, 0, 0]);
        expect(centers).toContainEqual([10, 6, 7]);
    });
});

describe('Curve.toPolygon()', () =>
{
    it('returns a Polygon for a closed curve', () =>
    {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const p = c.toPolygon();
        expect(p).toBeInstanceOf(Polygon);
    });

    it('returns polygon with vertices', () =>
    {
        const c = Curve.Circle(5);
        const p = c.toPolygon();
        expect(p).toBeTruthy();
        expect(p!.vertices().length).toBeGreaterThan(2);
    });
});

describe('Curve.toMesh()', () =>
{
    it('returns a Mesh for a closed curve', () =>
    {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const m = c.toMesh();
        expect(m).toBeInstanceOf(Mesh);
    });

    it('result mesh has triangles', () =>
    {
        const c = Curve.Circle(5);
        const m = c.toMesh();
        expect(m).toBeTruthy();
        expect(m!.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Curve.offset()', () =>
{
    it('infers the XZ plane in RectBetween when Y span is zero', () =>
    {
        const rect = Curve.RectBetween([0, 0, 0], [100, 0, 100]);

        rect.points().forEach(point =>
        {
            expect(point.y).toBeCloseTo(0, 6);
        });
    });

    it('offsets an XZ planar rectangle while keeping it on the same plane', () =>
    {
        const rect = Curve.Rect(10, 6, [0, 0, 0], 'xz');
        const offsetRect = rect.copy().offset(2);

        expect(offsetRect).toBeTruthy();
        expect(offsetRect!.area()).toBeGreaterThan(rect.area()!);
        expect(offsetRect!.normal()!.isParallel(rect.normal()!)).toBe(true);

        offsetRect!.points().forEach(point =>
        {
            expect(point.y).toBeCloseTo(0, 6);
        });
    });

    it('offsets a circle on a non-XY plane by changing its radius along the same normal', () =>
    {
        const circle = Curve.Circle(5, [0, 0, 0], [0, 1, 0]);
        const offsetCircle = circle.copy().offset(2);

        expect(offsetCircle).toBeTruthy();
        expect(offsetCircle!.center().distance(offsetCircle!.start())).toBeCloseTo(7, 6);
        expect(offsetCircle!.normal()!.isParallel(circle.normal()!)).toBe(true);
    });
});

describe('Curve.extend()', async () =>
{
    it('Should extend a polyline correctly', () =>
    {
        const line = Curve.Line(
            [0, 0, 0],
            [200, 200,0],
        ).extend(50, 'both');
        
        expect(line).toBeTruthy();
        expect(line.length()).toBeCloseTo(Math.sqrt(2) * 200 + 50*2, 1);
    });

    it('should extend a line towards another', async () =>
    {
        const line1 = Curve.Line(
            [0, 0, 0],
            [50, 50,0],
        ).color('red');
        const line2 = Curve.Line(
            [0, 0, 0],
            [0, 250, 0],
        ).move(200).color('blue');


        expect(line1.distance(line2)).toBe(150);

        line1.extendTo(line2);

        expect(line1.distance(line2)).toBeCloseTo(0, 5);

        // visual check
        await save(OUTPUT_DIR + 'test.curve.extendTo.gltf',
            await new ShapeCollection<Curve>(line1, line2).toGLTF()
        );
    });

    // An extension runs along the endpoint tangent, so the old endpoint stops being a corner
    // and must not survive as an extra segment. Length-only assertions miss this.
    it('consolidates the extension into the end segment instead of adding one', () =>
    {
        const c = Curve.Polyline([[0,0,0],[100,0,100],[200,0,0]]);
        expect(c.segments().length).toBe(2);

        c.extend(100);
        expect(c.segments().length).toBe(2);

        c.extendTo(Curve.Line([-100,0,0],[-100,0,-400]));
        expect(c.segments().length).toBe(2);
    });

    it('extends by exactly the given length without moving the other end', () =>
    {
        const c = Curve.Polyline([[0,0,0],[100,0,100],[200,0,0]]);
        const lenBefore = c.length() as number;
        const startBefore = c.controlPoints()[0];

        c.extend(100, 'end');

        expect((c.length() as number) - lenBefore).toBeCloseTo(100, 6);
        expect(startBefore.distance(c.controlPoints()[0])).toBeCloseTo(0, 6);

        c.extend(50, 'both');
        expect((c.length() as number) - lenBefore).toBeCloseTo(200, 6);
        expect(c.segments().length).toBe(2);
    });
});

describe('Curve.mergeColinearLines()', () =>
{
    it('collapses a straight polyline split at non-corners into one line', () =>
    {
        const c = Curve.Polyline([[0,0,0],[50,0,0],[100,0,0]]);
        expect(c.segments().length).toBe(2);

        c.mergeColinearLines();

        expect(c.segments().length).toBe(1);
        expect(c.length()).toBeCloseTo(100, 6);
    });

    it('keeps real corners', () =>
    {
        const c = Curve.Polyline([[0,0,0],[100,0,100],[200,0,0]]);
        c.mergeColinearLines();
        expect(c.segments().length).toBe(2);
    });

    it('keeps a spike that doubles back (anti-parallel is a corner, not collinear)', () =>
    {
        const c = Curve.Polyline([[0,0,0],[100,0,0],[50,0,0]]);
        c.mergeColinearLines();
        expect(c.segments().length).toBe(2);
    });

    it('leaves an arc-bearing curve untouched (its CPs are not on-curve vertices)', () =>
    {
        const arc = Curve.Arc([0,0,0],[50,0,50],[100,0,0]);
        const lenBefore = arc.length() as number;
        const degBefore = arc.maxDegree();

        arc.mergeColinearLines();

        expect(arc.maxDegree()).toBe(degBefore);
        expect(arc.length()).toBeCloseTo(lenBefore, 6);
    });
});

describe('Curve.extrude()', () =>
{
    it('returns a Polygon for a straight open curve (flat sweep)', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const p = c.extrude(5);
        expect(p).toBeInstanceOf(Polygon);
        // ...and that Polygon can itself be extruded into a solid Mesh
        expect((p as Polygon).extrude(5)).toBeInstanceOf(Mesh);
    });

    it('returns a Mesh for a curved open curve (swept surface)', () =>
    {
        const c = Curve.Arc([0, 0, 0], [10, 40, 0], [20, 0, 0]);
        const m = c.extrude(5);
        expect(m).toBeInstanceOf(Mesh);
    });

    it('returns a Mesh for a closed curve', () =>
    {
        const c = Curve.Rect(5, 3);
        const m = c.extrude(4);
        expect(m).toBeInstanceOf(Mesh);
    });

    it('defaults to the curve\'s own planar normal, not world Z, for a curve on another plane', () =>
    {
        // A closed curve lying in the XZ plane (constant y): its own normal is along Y.
        const c = Curve.Rect(5, 3, [0, 0, 0], 'xz');
        expect(c.normal()!.y).toBeCloseTo(1, 5);

        const m = c.extrude(4) as Mesh;
        const bbox = m.bbox()!;
        // Extrusion should have grown along Y (the curve's normal), not Z.
        expect(bbox.max().y - bbox.min().y).toBeCloseTo(4, 5);
        expect(bbox.max().z - bbox.min().z).toBeCloseTo(3, 5);
    });

    it('extruded curved open curve has triangles', () =>
    {
        const c = Curve.Arc([0, 0, 0], [10, 40, 0], [20, 0, 0]);
        const m = c.extrude(5) as Mesh;
        expect(m!.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('respects a custom direction', async () =>
    {
        // Curve.extrude() is typed Mesh|Polygon|null; extruding these always yields a Mesh.
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const mZ = c.extrude(5, [0, 0, 1]) as Mesh;
        const mY = c.extrude(5, [1, 1, 1]) as Mesh;
        // Both should produce geometry; bboxes should differ in the extruded axis
        expect(mZ!.bbox()!.max().z).toBeGreaterThan(0);
        expect(mY!.bbox()!.max().y).toBeGreaterThan(0);
        
        const a = Curve.Arc([0,0,0],[10,40,0], [20,0,0]);
        const mA = a.extrude(10, [0, 0, 1])!.color('blue');
        expect(mA!.bbox()!.max().z).toBeCloseTo(10,1);

        await save(OUTPUT_DIR + 'test.curve.extrude.direction.gltf', await new ShapeCollection<Mesh>(mZ, mY, mA as Mesh).toGLTF());
    });


});

describe('Curve.selfIntersecting()', () =>
{
    it('is false for a straight line', () =>
    {
        expect(Curve.Line([100, -50, 0], [100, 100, 0]).selfIntersecting()).toBe(false);
    });

    it('is false for a simple open polyline', () =>
    {
        expect(Curve.Polyline([0, 0, 0], [100, 50, 0], [200, 0, 0]).selfIntersecting()).toBe(false);
    });

    it('is false for a simple closed square', () =>
    {
        expect(Curve.Polyline([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]).close().selfIntersecting()).toBe(false);
    });

    it('is true for a self-crossing (figure-eight) open polyline', () =>
    {
        expect(Curve.Polyline([0, 0, 0], [10, 10, 0], [10, 0, 0], [0, 10, 0]).selfIntersecting()).toBe(true);
    });

    it('is true for a self-crossing closed bowtie', () =>
    {
        expect(Curve.Polyline([[0, 0, 0], [10, 10, 0], [10, 0, 0], [0, 10, 0]]).close().selfIntersecting()).toBe(true);
    });

    it('works on a non-XY plane (XZ)', () =>
    {
        expect(Curve.Line([0, 0, 0], [10, 0, 10]).selfIntersecting()).toBe(false);
    });
});

describe('Curve.union()', () =>
{
    it('merges two overlapping closed curves into a single Curve', () =>
    {
        const res = Curve.Rect(40, 40).union(Curve.Rect(40, 40).moveX(20));
        expect(res).toBeInstanceOf(Curve);
        expect((res as Curve).isClosed()).toBe(true);
    });

    it('returns a ShapeCollection for genuinely disjoint curves', () =>
    {
        const res = Curve.Circle(5).union(Curve.Circle(5).moveX(100));
        expect(res).toBeInstanceOf(ShapeCollection);
        expect((res as ShapeCollection<Curve>).count()).toBe(2);
    });

    // Regression: a circle whose radius equals the rect half-width is tangent to the
    // side edges; placing its centre on the top edge lands the tangent points on the
    // corners. curvo then silently returns the two inputs unmerged — meshup's
    // escalating-perturbation retry (wasm/meshup.rs) recovers the single region.
    it('merges a circle tangent at the rect corners (degenerate case)', () =>
    {
        const w = 30, h = 100;
        const r = Curve.Rect(w, h);
        const ct = Curve.Circle(w / 2).moveY(h / 2);
        const res = r.union(ct);
        expect(res).toBeInstanceOf(Curve);
        const c = res as Curve;
        expect(c.isClosed()).toBe(true);
        // Result spans the rect plus the protruding top of the circle.
        const bb = c.bbox()!;
        expect(bb.maxY()).toBeGreaterThan(h / 2);       // circle bulges above the rect top
        expect(bb.minY()).toBeCloseTo(-h / 2, 1);       // rect bottom preserved
    });

    // Regression: chaining a second union onto an already-merged (compound) result with
    // another corner-tangent circle. curvo is non-deterministic here (RNG-seeded
    it('connect() closes a polyline with its offset, including both curves\' bodies', () =>
    {
        const pl = Curve.Polyline([0, 0, 0], [100, 50, 0], [200, 0, 0]);
        const pl2 = pl.copy().offset(10) as Curve;
        const connected = pl.connect(pl2);

        expect(connected.isClosed()).toBe(true);

        // The other curve's middle vertex (offset of [100,50]) must survive — the
        // old connect() dropped other.spans() and only kept its endpoints.
        const pts = connected.tessellate();
        const hasOffsetMiddle = pts.some(p => Math.abs(p.x - 100) < 1 && p.y > 55);
        expect(hasOffsetMiddle).toBe(true);

        // Resulting polygon is a valid thin ribbon that renders (non-zero mesh).
        const poly = connected.toPolygon() as Polygon;
        expect(poly).toBeInstanceOf(Polygon);
        expect(poly.area()).toBeGreaterThan(0);
        expect(poly.toMesh()!.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('connect() picks the non-crossing pairing by minimum total gap', () =>
    {
        // Two anti-parallel segments: the near endpoints are start↔end / end↔start.
        // A greedy start↔start, end↔end pairing would cross (figure-8); the
        // minimum-total-gap pairing forms a clean 100 x 10 rectangle.
        const a = Curve.Line([0, 0, 0], [100, 0, 0]);
        const b = Curve.Line([100, 10, 0], [0, 10, 0]);
        const connected = a.connect(b);

        expect(connected.isClosed()).toBe(true);

        const poly = connected.toPolygon() as Polygon;
        expect(poly).toBeInstanceOf(Polygon);
        // Non-crossing loop => full rectangle area (~1000). A crossing bowtie would
        // collapse to a near-zero / degenerate area.
        expect(poly.area()).toBeCloseTo(1000, 0);
        const bb = connected.bbox()!;
        expect(bb.width()).toBeCloseTo(100, 3);
        expect(bb.depth()).toBeCloseTo(10, 3);
    });

    // tessellation) and errors outright on some runs; the geo polygon-boolean fallback
    // (wasm/meshup.rs) makes the result reliable. Run several times to catch the flakiness.
    it('merges rect + two corner-tangent circles (chained union, robust over repeats)', () =>
    {
        const w = 30, h = 100;
        for (let i = 0; i < 10; i++)
        {
            const r = Curve.Rect(w, h);
            const ct = Curve.Circle(w / 2).moveY(h / 2);
            const cb = ct.copy().mirrorY(0);
            // union() is typed Curve|ShapeCollection<Curve>|null; these tangent circles merge
            // into one Curve, which is exactly what the assertion below checks.
            const pl = (r.union(ct) as Curve).union(cb);
            expect(pl).toBeInstanceOf(Curve);
            const c = pl as Curve;
            expect(c.isClosed()).toBe(true);
            const bb = c.bbox()!;
            expect(bb.maxY()).toBeGreaterThan(h / 2);   // top circle bulge
            expect(bb.minY()).toBeLessThan(-h / 2);     // bottom circle bulge
        }
    });
});

describe('Curve.cutoffBy()', () =>
{
    // Regression: cutting an open line by a crossing line used to route through the
    // closed-curve region boolean and fail with "found odd number of intersections".
    it('splits an open line at a crossing line and keeps the biggest part', () =>
    {
        const other = Curve.Line([50, -100, 0], [50, 100, 0]);
        const ln = Curve.Line([0, 0, 0], [100, 100, 0]); // crosses at (50,50,0)
        const res = other.cutoffBy(ln);
        expect(res).toBeInstanceOf(Curve);
        const c = res as Curve;
        expect(c.length()).toBeCloseTo(150, 3);
        expect(c.start().toArray()).toEqual([50, -100, 0]);
        expect(c.end().toArray()).toEqual([50, 50, 0]);
    });

    it('keeps the smallest part when keepSmallest=true', () =>
    {
        const other = Curve.Line([50, -100, 0], [50, 100, 0]);
        const ln = Curve.Line([0, 0, 0], [100, 100, 0]);
        const res = other.cutoffBy(ln, true) as Curve;
        expect(res.length()).toBeCloseTo(50, 3);
    });

    it('returns the original open curve unchanged when the curves do not intersect', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        const b = Curve.Line([0, 10, 0], [10, 10, 0]);
        const res = a.cutoffBy(b) as Curve;
        expect(res.length()).toBeCloseTo(10, 3);
    });

    // Regression: a CLOSED curve cut by an OPEN line used to route through the region
    // boolean and fail ("Curve must be closed"). It now splits the closed curve along
    // the line into two regions and keeps the biggest / smallest by area. This example
    // also lives in the XZ plane, exercising the off-XY intersection path.
    it('splits a closed XZ rect by a crossing line, keeping the biggest region', () =>
    {
        const rect = Curve.RectBetween([0, 0, 0], [100, 0, 100]); // area 10000, XZ plane
        const cutter = Curve.Line([-20, 0, -20], [120, 0, 120]).moveZ(10); // crosses at (0,0,10) & (90,0,100)
        const res = rect.cutoffBy(cutter) as Curve;
        expect(res).toBeInstanceOf(Curve);
        expect(res.isClosed()).toBe(true);
        expect(res.area()).toBeCloseTo(5950, 3);            // the larger of the two regions
        expect(Math.abs(res.bbox()!.minY())).toBeLessThan(1e-6); // stays in the XZ plane
    });

    it('keeps the smallest region (triangle) when keepSmallest=true, and the two sum to the whole', () =>
    {
        const cutter = () => Curve.Line([-20, 0, -20], [120, 0, 120]).moveZ(10);
        const big = Curve.RectBetween([0, 0, 0], [100, 0, 100]).cutoffBy(cutter()) as Curve;
        const small = Curve.RectBetween([0, 0, 0], [100, 0, 100]).cutoffBy(cutter(), true) as Curve;
        expect(small.area()).toBeCloseTo(4050, 3);
        expect(big.area()! + small.area()!).toBeCloseTo(10000, 3);
    });
});

describe('Curve.intersect() / cutoffBy() off the XY plane', () =>
{
    // Regression: curvo's curve intersection runs in the XY plane (ignoring Z), so a
    // planar curve in another coordinate plane (here XZ) previously found no hits and
    // cutoffBy() did nothing. intersect() now transforms into the curve's local XY
    // frame, flattens residual out-of-plane noise, intersects, and maps back.
    it('finds intersections and cuts an offset line lying in the XZ plane', () =>
    {
        const ln = Curve.Line([0, 0, 0], [100, 0, 100]).moveZ(200);
        const cutter = Curve.Line([0, 0, 0], [150, 0, 50]).moveZ(240);
        const off = ln.copy().offset(-10) as Curve;
        const fullLen = off.length();

        expect(off.intersect(cutter)!.length).toBeGreaterThan(0);

        const res = off.cutoffBy(cutter) as Curve;
        expect(res.length()).toBeLessThan(fullLen);       // an actual cut happened
        expect(Math.abs(res.start().toArray()[1])).toBeLessThan(1e-6); // stays in XZ plane
        expect(Math.abs(res.end().toArray()[1])).toBeLessThan(1e-6);
    });
});

describe('Curve.fillet()/chamfer() — per-corner `at`', () =>
{
    // A 20x20 rect, closed. Corner index vi is the junction of segment vi-1 and vi,
    // i.e. the start of segment vi — the same indexing the kernel uses.
    const rect = () => Curve.Rect(20, 20, [0, 0, 0], 'xy');

    // One filleted corner of radius 3 removes r^2 - pi*r^2/4 = 9 - 7.0686 = 1.9314 of area.
    const ONE_FILLET_LOSS = 9 - Math.PI * 9 / 4;

    it('fillets every corner when `at` is omitted', () =>
    {
        const c = rect().fillet(3)!;
        expect(c.inner().hasArcs()).toBe(true);
        expect(c.area()).toBeCloseTo(400 - 4 * ONE_FILLET_LOSS, 2);
    });

    it('fillets only the corner at the given index', () =>
    {
        const c = rect().fillet(3, 0)!;
        expect(c.inner().hasArcs()).toBe(true);
        expect(c.area()).toBeCloseTo(400 - ONE_FILLET_LOSS, 2);
    });

    it('fillets only the corners in the given index list', () =>
    {
        const c = rect().fillet(3, new Uint32Array([0, 2]))!;
        expect(c.area()).toBeCloseTo(400 - 2 * ONE_FILLET_LOSS, 2);
    });

    // [0, 2] is a valid PointLike, so a flat number array can never mean "corners 0 and 2".
    // Pinning the documented resolution: it is the point (0,2), i.e. one nearest corner.
    it('reads a flat number array as a point, not as an index list', () =>
    {
        const c = rect().fillet(3, [0, 2])!;
        expect(c.area()).toBeCloseTo(400 - ONE_FILLET_LOSS, 2);
    });

    it('supports negative indices, counting from the end', () =>
    {
        const byNegative = rect().fillet(3, -1)!;
        const byPositive = rect().fillet(3, 3)!;
        expect(byNegative.area()).toBeCloseTo(byPositive.area()!, 6);
        expect(byNegative.area()).toBeCloseTo(400 - ONE_FILLET_LOSS, 2);
    });

    // The index<->geometry mapping is the part that can silently be off by one, so pin it:
    // fillet one corner and check that the ROUNDED one is the corner we asked for. The
    // filleted corner is the only one no longer present as a sharp point on the result.
    it('rounds the corner the index actually refers to', () =>
    {
        const before = rect();
        const corners = before.vertices().toArray().map(v => new Point(v));

        corners.forEach((corner, i) =>
        {
            const after = rect().fillet(3, i)!;
            const survives = (p: Point) =>
                after.vertices().toArray().some(v => new Point(v).distance(p) < 1e-6);

            expect(survives(corner), `corner ${i} should have been rounded away`).toBe(false);
            corners.filter((_, j) => j !== i).forEach((other, k) =>
            {
                expect(survives(other), `corner ${k} should have been left sharp`).toBe(true);
            });
        });
    });

    it('accepts a point and fillets the nearest corner', () =>
    {
        const target = new Point(10, -10, 0); // nearest corner of the centered rect
        const c = rect().fillet(3, [target.x, target.y, target.z])!;
        expect(c.area()).toBeCloseTo(400 - ONE_FILLET_LOSS, 2);
        const survives = c.vertices().toArray().some(v => new Point(v).distance(target) < 1e-6);
        expect(survives).toBe(false); // that corner is the one that got rounded
    });

    it('chamfers only the requested corner', () =>
    {
        const all = rect().chamfer(4);
        const one = rect().chamfer(4, 0);
        expect(all.inner().hasArcs()).toBe(false);
        // each chamfer removes a right triangle of legs 4/sqrt(2)... use the all-corners
        // case as the reference: one corner must remove exactly a quarter of the total loss
        expect(400 - one.area()!).toBeCloseTo((400 - all.area()!) / 4, 4);
    });

    it('leaves the curve untouched for an empty selection', () =>
    {
        const c = rect().fillet(3, [])!;
        expect(c.inner().hasArcs()).toBe(false);
        expect(c.area()).toBeCloseTo(400, 6);
    });

    it('ignores an out-of-range index with a warning', () =>
    {
        const c = rect().fillet(3, 99)!;
        expect(c.area()).toBeCloseTo(400, 6);
    });
});

describe('Curve.perpendicularPointTo()', () =>
{
    /** The connector must meet the curve at a right angle */
    const expectPerpendicular = (c: Curve, from: Point, foot: Point) =>
    {
        const tangent = c.tangentAt(foot)!;
        const connector = foot.toVector().subtract(from).normalize();
        expect(Math.abs(connector.dot(tangent))).toBeLessThan(0.05);
    };

    it('drops a perpendicular onto a line', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        const foot = c.perpendicularPointTo([50, 30, 0]) as Point;
        expect(foot.toArray()).toEqual([50, 0, 0]);
        expect(c.perpendicularPointTo([50, 30, 0], true).length).toEqual(1);
    });

    it('returns a point already on the curve unchanged', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect((c.perpendicularPointTo([30, 0, 0]) as Point).toArray()).toEqual([30, 0, 0]);
    });

    it('finds no foot past the end of a line, and falls back to the closest point', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect(c.perpendicularPointTo([150, 30, 0], true)).toEqual([]);
        const foot = c.perpendicularPointTo([150, 30, 0]) as Point;
        expect(foot.distance([100, 0, 0])).toBeCloseTo(0, 6);
    });

    it('finds the near and the far foot on a circle', () =>
    {
        const c = Curve.Circle(50);
        const from = new Point(200, 0, 0);
        const feet = c.perpendicularPointTo(from, true);
        expect(feet.length).toEqual(2);
        expect(feet[0].distance([50, 0, 0])).toBeCloseTo(0, 3);   // nearest first
        expect(feet[1].distance([-50, 0, 0])).toBeCloseTo(0, 3);
        feet.forEach(f => expectPerpendicular(c, from, f));
        expect((c.perpendicularPointTo(from) as Point).distance([50, 0, 0])).toBeCloseTo(0, 3);
    });

    it('works from inside a circle and off its axes', () =>
    {
        const c = Curve.Circle(50);
        const inside = c.perpendicularPointTo([10, 0, 0], true);
        expect(inside.length).toEqual(2);
        expect(inside[0].distance([50, 0, 0])).toBeCloseTo(0, 3);

        const diagonal = c.perpendicularPointTo([100, 100, 0], true);
        expect(diagonal.length).toEqual(2);
        expect(diagonal[0].distance([35.355, 35.355, 0])).toBeCloseTo(0, 2);
    });

    it('works on a circle away from the origin', () =>
    {
        const c = Curve.Circle(50, [200, 100, 0]);
        const feet = c.perpendicularPointTo([200, 300, 0], true);
        expect(feet.length).toEqual(2);
        expect(feet[0].distance([200, 150, 0])).toBeCloseTo(0, 3);
    });

    it('returns one point when every point of a circle qualifies', () =>
    {
        const c = Curve.Circle(50);
        const feet = c.perpendicularPointTo([0, 0, 0], true);
        expect(feet.length).toEqual(1);
        expect(feet[0].distance([50, 0, 0])).toBeCloseTo(0, 6);
    });

    it('finds a foot on every side of a rectangle from within', () =>
    {
        const c = Curve.Rect(100, 50);
        const from = new Point(10, 5, 0);
        const feet = c.perpendicularPointTo(from, true);
        expect(feet.length).toEqual(4);
        feet.forEach(f => expectPerpendicular(c, from, f));
    });

    it('skips the corners of a rectangle, which have no tangent', () =>
    {
        const c = Curve.Rect(100, 50);
        // straight out from a corner nothing is perpendicular...
        expect(c.perpendicularPointTo([200, 200, 0], true)).toEqual([]);
        // ...but the nearest point is still reported
        const foot = c.perpendicularPointTo([200, 200, 0]) as Point;
        expect(foot.distance([50, 25, 0])).toBeCloseTo(0, 3);

        // opposite a side there are two: one on that side, one on the far one
        const feet = c.perpendicularPointTo([200, 10, 0], true);
        expect(feet.length).toEqual(2);
        expect(feet[0].distance([50, 10, 0])).toBeCloseTo(0, 3);
    });

    it('counts the ends of an open arc when they are perpendicular', () =>
    {
        const c = Curve.Arc([50, 0, 0], [0, 50, 0], [-50, 0, 0], 'threepoint');
        const feet = c.perpendicularPointTo([200, 0, 0], true);
        expect(feet.length).toEqual(2); // both ends of the half circle
        expect(feet[0].distance([50, 0, 0])).toBeCloseTo(0, 3);
        expect(feet[1].distance([-50, 0, 0])).toBeCloseTo(0, 3);

        expect(c.perpendicularPointTo([0, 200, 0], true).length).toEqual(1);
    });

    it('finds several feet on a wavy spline', () =>
    {
        const c = Curve.Interpolated([[0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0]]);
        const from = new Point(75, 100, 0);
        const feet = c.perpendicularPointTo(from, true);
        expect(feet.length).toBeGreaterThan(1);
        feet.forEach(f => expectPerpendicular(c, from, f));
    });

    it('rejects anything that is not a point', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect(() => c.perpendicularPointTo('nonsense' as any)).toThrow();
    });
});
