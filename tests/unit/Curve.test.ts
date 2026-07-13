import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Curve } from '../../src/Curve';
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
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const mZ = c.extrude(5, [0, 0, 1]);
        const mY = c.extrude(5, [1, 1, 1]);
        // Both should produce geometry; bboxes should differ in the extruded axis
        expect(mZ!.bbox()!.max().z).toBeGreaterThan(0);
        expect(mY!.bbox()!.max().y).toBeGreaterThan(0);
        
        const a = Curve.Arc([0,0,0],[10,40,0], [20,0,0]);
        const mA = a.extrude(10, [0, 0, 1]).color('blue');
        expect(mA!.bbox()!.max().z).toBeCloseTo(10,1);

        await save('test.curve.extrude.direction.gltf', await new ShapeCollection<Mesh>(mZ, mY, mA).toGLTF());
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
        const bb = c.bbox();
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
        const bb = connected.bbox();
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
            const pl = r.union(ct).union(cb);
            expect(pl).toBeInstanceOf(Curve);
            const c = pl as Curve;
            expect(c.isClosed()).toBe(true);
            const bb = c.bbox();
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
