import { beforeAll, describe, it, expect, vi } from 'vitest';
import { initAsync, ShapeCollection, SceneNode } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Point } from '../../src/Point';
import { Vertex } from '../../src/Vertex';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { outputDir } from '../helpers/outputs';

const OUTPUT_DIR = outputDir(import.meta.url);

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

describe('Curve.segments()', () =>
{
    // connect() glues the two curves with connector lines and combines the lot; the joints
    // between connector and original come back as separate, zero-length spans. Those are no
    // edges - before they were fed to Curve.Line(), which refuses a zero-length line.
    it('skips the zero-length spans that connect() leaves at the joints', () =>
    {
        const roof = Curve.Line([0, 0, 2000], [4000, 0, 4500]);
        const diagonal = Curve.Line([0, 0, 1800], [4000, 0, 4300]).connect(roof);

        expect(() => diagonal.segments()).not.toThrow();
        expect(diagonal.segments().length).toBe(4);
        expect(diagonal.segments().toArray().every(s => (s.length() as number) > 0)).toBe(true);
    });

    it('selects an edge on a curve carrying zero-length spans', () =>
    {
        const roof = Curve.Line([0, 0, 2000], [4000, 0, 4500]);
        const diagonal = Curve.Line([0, 0, 1800], [4000, 0, 4300]).connect(roof);

        const right = diagonal.select('E||right');
        expect(right).toBeDefined();
        expect((right as any).length()).toBeCloseTo(200, 3);
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

    it('reads a zero count as a flat grid on that axis instead of returning nothing', () =>
    {
        const curves = Curve.Line([0, 0, 0], [10, 0, 0]).grid(4, 3, 0, [100, 100, 0]);
        expect(curves.length).toBe(12);
    });

    it('puts the source Curve itself at cell [0,0,0]', () =>
    {
        const line = Curve.Line([0, 0, 0], [10, 0, 0]);
        const curves = line.grid(3, 2, 1, [100, 100, 0]);
        expect(curves.toArray()).toContain(line);
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

    /*  extendTo() used to measure the gap with the SAMPLED closestPoints(), whose accuracy is
        set by its 30 seed samples spread over a probe far longer than the gap itself, refined
        by an alternating-closest-point loop that converges slowly at shallow crossing angles.
        The error therefore grew with the probe rather than shrinking with the extension, and a
        brace extended to a wall line stopped several mm short of it. */
    it('lands exactly on the target at a shallow crossing angle', () =>
    {
        // A brace meeting a vertical wall line at ~28°, from a real bent model
        const brace = Curve.Line([176.33, 0, 1405.63], [1150.69, 0, 3226.22]);
        const wall  = Curve.Line([0, 0, 0], [0, 0, 2500]);

        brace.extendTo(wall);

        expect(brace.start().x).toBeCloseTo(0, 3);
        expect(brace.start().z).toBeCloseTo(1076.1577, 3);

        // the far end must not have moved
        expect(brace.end().x).toBeCloseTo(1150.69, 6);
        expect(brace.end().z).toBeCloseTo(3226.22, 6);
    });

    it('lands exactly on the target across a range of crossing angles', () =>
    {
        const target = Curve.Line([0, 0, -5000], [0, 0, 5000]);

        [20, 40, 60, 75, 85].forEach( deg =>
        {
            const r = deg * Math.PI / 180;
            const c = Curve.Line(
                [500, 0, 1000],
                [500 + 1000 * Math.cos(r), 0, 1000 + 1000 * Math.sin(r)],
            );
            c.extendTo(target);
            expect(c.start().x, `crossing at ${deg}deg`).toBeCloseTo(0, 3);
        });
    });

    it('prefers a real crossing over a closer near-miss on the other end', () =>
    {
        // start ray (-x from [0,0,0]) genuinely crosses `crossed` 300 away;
        // end ray (+z from [100,0,100]) only passes NEAR `nearMiss`, 4 along the ray.
        const c = Curve.Polyline([[0,0,0],[100,0,0],[100,0,100]]);
        const crossed  = Curve.Line([-300, 0, -50], [-300, 0, 50]);
        const nearMiss = Curve.Line([200, 0, 104], [300, 0, 104]);

        c.extendTo(new ShapeCollection<Curve>(crossed, nearMiss));

        // the crossing end moved and landed on the target
        expect(c.start().x).toBeCloseTo(-300, 3);
        // the near-miss end stayed put
        expect(c.end().z).toBeCloseTo(100, 6);
    });

    it('still falls back to the closest approach when nothing crosses', () =>
    {
        // the ray runs along z = 0 and the target starts at z = 10, so they never meet
        const c = Curve.Line([0, 0, 0], [50, 0, 0]);
        const target = Curve.Line([200, 0, 10], [200, 0, 100]);

        c.extendTo(target);

        expect(c.end().x).toBeCloseTo(200, 3);
        expect(c.end().z).toBeCloseTo(0, 6);
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

    it('sees an arc that crosses a leg, not just the chord through it', () =>
    {
        // The arc bows to y = 10, over the leg at y = 5 that closes the shape; its chord from
        // (0,0) to (20,0) misses that leg entirely. Decided from the arc itself — the answer
        // used to depend on whether a tessellation vertex happened to land past the leg.
        const over = Curve.fromData({ type: 'Path', d: 'M0 0 A10 10 0 0 0 20 0 L20 5 L-5 5 Z' });
        expect(over.inner().hasArcs()).toBe(true);
        expect(over.selfIntersecting()).toBe(true);
    });

    it('leaves an arc that stays clear of its own legs alone', () =>
    {
        const clear = Curve.fromData({ type: 'Path', d: 'M0 0 A10 10 0 0 0 20 0 L20 -5 L-5 -5 Z' });
        expect(clear.inner().hasArcs()).toBe(true);
        expect(clear.selfIntersecting()).toBe(false);
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
        // Explicit budget: 10 iterations x 2 unions, and these circles are tangent to the
        // rect corners — topology hypercurve declines, so each union takes the line-work
        // fallback at roughly 260ms. That fallback is why this case works at all (it used
        // to fail with "declined the topology"); the cost is the price of the safety net,
        // not a regression.
    }, 60_000);
});

describe('Curve.difference() / subtract()', () =>
{
    // 100 x 100 box centred on the origin: -50..50 in x and y, area 10000.
    const box = (): Curve => Curve.Rect(100, 100);
    /** 20 x 20 cutter centred on the box's top-right corner: bites away 10 x 10 */
    const cornerCutter = (x: number, y: number): Curve => Curve.Rect(20, 20, [x, y, 0]);

    it('notches a corner with a single cutter (mutates in place, returns this)', () =>
    {
        const c = box();
        const out = c.subtract(cornerCutter(50, 50));
        expect(out).toBe(c);                        // single region left -> this
        expect(c.area()).toBeCloseTo(9900, 0);
    });

    it('takes several cutters as varargs', () =>
    {
        const c = box();
        c.subtract(cornerCutter(-50, 50), cornerCutter(50, 50));
        expect(c.area()).toBeCloseTo(9800, 0);      // two 10x10 bites
    });

    it('takes a ShapeCollection of cutters', () =>
    {
        const c = box();
        const cutters = new ShapeCollection<Curve>(cornerCutter(-50, -50), cornerCutter(50, -50));
        const out = c.subtract(cutters);
        expect(out).toBe(c);
        expect(c.area()).toBeCloseTo(9800, 0);
    });

    it('skips a cutter that is this very Curve (self-subtraction)', () =>
    {
        const c = box();
        const out = c.subtract(c);
        expect(out).toBe(c);
        expect(c.area()).toBeCloseTo(10000, 0);     // untouched, not wiped out
    });

    // The real-world trap: layer('x').shapes() contains the very shape you are cutting,
    // because it was built while that layer was active.
    it('skips itself when it sits inside the cutter collection', () =>
    {
        const c = box();
        const cutters = new ShapeCollection<Curve>(c, cornerCutter(50, 50));
        const out = c.subtract(cutters);
        expect(out).toBe(c);
        expect(c.area()).toBeCloseTo(9900, 0);      // the other cutter still applied
    });

    it('skips members of a collection that are not Curves', () =>
    {
        const c = box();
        const cutters = new ShapeCollection<any>(new Polygon([[0, 0, 0], [10, 0, 0], [10, 10, 0]]),
                                                 cornerCutter(50, 50));
        c.subtract(cutters as ShapeCollection<Curve>);
        expect(c.area()).toBeCloseTo(9900, 0);
    });

    it('returns a ShapeCollection when a cutter splits the region in two', () =>
    {
        const c = box();
        const res = c.subtract(Curve.Rect(200, 20));    // band straight across the middle
        expect(res).toBeInstanceOf(ShapeCollection);
        expect((res as ShapeCollection<Curve>).count()).toBe(2);
    });

    it('applies later cutters to the pieces of an earlier split', () =>
    {
        const c = box();
        const res = c.subtract(Curve.Rect(200, 20),     // splits into two 100 x 40 halves
                               cornerCutter(50, 50));   // notches the top half only
        expect(res).toBeInstanceOf(ShapeCollection);
        const pieces = res as ShapeCollection<Curve>;
        expect(pieces.count()).toBe(2);
        const total = pieces.toArray().reduce((sum, p) => sum + (p.area() ?? 0), 0);
        expect(total).toBeCloseTo(7900, 0);             // 10000 - 2000 band - 100 notch
    });

    it('leaves the curve unchanged when a cutter misses', () =>
    {
        const c = box();
        const out = c.subtract(cornerCutter(500, 500));
        expect(out).toBe(c);
        expect(c.area()).toBeCloseTo(10000, 0);
    });

    it('returns null when the cutters remove the whole region', () =>
    {
        expect(box().subtract(Curve.Rect(400, 400))).toBeNull();
    });

    it('returns the original Curve when there is nothing valid to cut with', () =>
    {
        const c = box();
        expect(c.subtract(new ShapeCollection<Curve>())).toBe(c);
        expect(c.area()).toBeCloseTo(10000, 0);
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

    /*  Regression: cutting a CLOSED curve by a CLOSED one never compared the two pieces. The
        intersection (the part inside the cutter) was handed back as "the biggest part" and the
        difference as "the smallest", so the pair was inverted whenever the cutter covered less
        than half the shape — which is the normal case. A post cut by the diagonal crossing its
        top corner came back as the small corner overlap instead of the post below it.
        Mesh.cutoffBy(), Polygon.cutoffBy() and brep's Shape.cutoffBy() all keep the largest of
        the pieces they split into; this now does too. */
    it('keeps the bigger of the two parts when the cutter is a closed region', () =>
    {
        const post = () => Curve.RectBetween([0, 0, 0], [100, 0, 2000]);     // area 200000, XZ
        const diagonal = Curve.RectBetween([-50, 0, 1800], [400, 0, 2100]);  // overlaps the top 200

        const kept = post().cutoffBy(diagonal) as Curve;
        expect(kept.area()).toBeCloseTo(180000, 3);     // the post below the diagonal
        expect(kept.bbox()!.maxZ()).toBeCloseTo(1800, 6);

        const cut = post().cutoffBy(diagonal, true) as Curve;
        expect(cut.area()).toBeCloseTo(20000, 3);       // the corner the diagonal covers
        expect(cut.bbox()!.minZ()).toBeCloseTo(1800, 6);

        expect(kept.area()! + cut.area()!).toBeCloseTo(200000, 3);
    });

    /*  Regression: two shapes that SHARE an edge — a post whose top is the roof line the diagonal
        sits on — make the region engine emit a sliver along that edge: a path that runs out and
        back, length 376, area 0.00008. It came back as an extra piece of the cut, and as the FIRST
        one, so `post.cutoffBy(diagonal).first()` handed a script a curve enclosing nothing. */
    it('drops the no-area sliver a boolean leaves along a shared edge', () =>
    {
        // The URBENT knee, from the script it was found in: a post whose top edge IS the roof
        // line, cut by the diagonal built on that same line. The post − diagonal difference came
        // back as TWO regions: the post below the diagonal (area 628446) and a sliver along the
        // shared edge (length 376, area 0.00008) — which, being first, is what `.first()` gave.
        const SPAN = 5436, HEIGHT = 3087, RIDGE = 0.25, WALL_TOP = 2263, BEAM_W = 150;
        const slopeRatio = HEIGHT / ((1 - RIDGE) * SPAN);
        const startHeight = HEIGHT - RIDGE * SPAN * slopeRatio;

        const roofLine = Curve.Polyline(
            [0, 0, startHeight],
            [SPAN * RIDGE, 0, startHeight + RIDGE * SPAN * slopeRatio],
            [SPAN, 0, startHeight + RIDGE * SPAN * slopeRatio - (1 - RIDGE) * SPAN * slopeRatio])
            .translate(0, 0, WALL_TOP);
        const roofLeft = roofLine.edges().first() as Curve;
        const wallLeft = Curve.Line([0, 0, 0], roofLine.start());

        const post = wallLeft.copy().move(BEAM_W).extendTo(roofLeft).connect(wallLeft);
        const diagonal = roofLeft.copy()
            .move(roofLeft.direction().normalize().rotateY(90).scale(BEAM_W))
            .extendTo(wallLeft).connect(roofLeft);

        const cut = post.copy().cutoffBy(diagonal);

        expect(cut).toBeInstanceOf(Curve);                  // ONE piece, not the piece + a sliver
        expect((cut as Curve).area()).toBeCloseTo(628446, 0);
        // and it is a real region, not a fold: a quarter of its perimeter squared is the same
        // order as its area
        expect((cut as Curve).area()! / ((cut as Curve).length() / 4) ** 2).toBeGreaterThan(0.1);
    });

    /*  Regression: a cutter crossing the closed Curve at its SEAM — the vertex it starts and
        ends at — left the Curve uncut. The seam puts one crossing at param d0, so one of the
        two arcs making up the second region spans nothing, and trim() answers an empty window
        with a copy of the whole curve. That region came back as the entire boundary plus the
        corner, measured BIGGER than the region it was cut from, and won "keep the biggest
        part". The URBENT sloped-roof case: the ridge post is built up to roofLine.end(), so
        its top corner is exactly where the cutting roof line stops. */
    it('cuts a closed Curve whose seam vertex is where the cutter ends', () =>
    {
        const SPAN = 4000, HEIGHT = 2000, WALL = 2500, BEAM_W = 200;
        const roofLine = Curve.Line([0, 0, 0], [SPAN, 0, HEIGHT]).translate(0, 0, WALL);
        // The post's top corner IS roofLine.end(), and connect() makes it the seam
        const wallRight = Curve.Line([SPAN, 0, 0], roofLine.end());
        const post = wallRight.copy().move(-BEAM_W).extendTo(roofLine).connect(wallRight);
        expect(post.area()).toBeCloseTo(BEAM_W * (WALL + HEIGHT), 3);   // 900000, uncut

        const cut = post.copy().cutoffBy(roofLine) as Curve;

        expect(cut).toBeInstanceOf(Curve);
        expect(cut.isClosed()).toBe(true);
        // the corner above the roof line (a 200 x 100 triangle) is gone
        expect(cut.area()).toBeCloseTo(900000 - 10000, 3);
        expect(cut.vertices().length).toBe(4);
        // its top now follows the roof line: the inner side stops 100 below the ridge
        expect(cut.bbox()!.maxZ()).toBeCloseTo(WALL + HEIGHT, 6);
        expect((post.copy().cutoffBy(roofLine, true) as Curve).area()).toBeCloseTo(10000, 3);
    });

    it('keeps a thin but REAL overlap', () =>
    {
        // 0.001 thick over 400 long: the degeneracy test is a scale-free area/perimeter ratio,
        // so this survives (ratio 1e-5) where the boolean noise above (ratio 1e-9) does not
        const plate = Curve.RectBetween([0, 0, 0], [400, 0, 200]);
        const overlap = plate.copy().intersection(Curve.RectBetween([0, 0, 199.999], [400, 0, 500])) as Curve;

        expect(overlap).toBeInstanceOf(Curve);
        expect(overlap.area()).toBeCloseTo(0.4, 3);
    });

    it('reports two shapes that only touch along an edge as sharing nothing', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const below = Curve.RectBetween([0, 0, 0], [100, 0, 100]);
        const above = Curve.RectBetween([0, 0, 100], [100, 0, 200]);   // shares the z=100 edge

        expect(below.copy().intersection(above)).toEqual(null);
        warn.mockRestore();
    });

    it('leaves the Curve alone when a closed cutter misses it or covers all of it', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const post = () => Curve.RectBetween([0, 0, 0], [100, 0, 2000]);

        expect((post().cutoffBy(Curve.RectBetween([500, 0, 0], [600, 0, 100])) as Curve).area())
            .toBeCloseTo(200000, 3);                    // misses: was null before
        expect((post().cutoffBy(Curve.RectBetween([-500, 0, -500], [600, 0, 3000])) as Curve).area())
            .toBeCloseTo(200000, 3);                    // swallows it whole
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
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

describe('Curve.extendTo() lands exactly on its target', () =>
{
    /*  Regression: extendTo() measured the reach to the crossing and called extend(length),
        which places the tip at `anchor + direction x length` — always a float residue off the
        target, and up to 1e-6 off because the hit it measured to had been rounded to
        POINT_TOLERANCE (1e-5) first. Since every boolean here is exact, that residue is a GAP:
        a brace extended to a wall and then cut against it left a hair-thin bridge instead of
        separating the piece, and no amount of extra accuracy in the measurement fixed it —
        1e-7, 1e-9 and 1e-12 gaps all pinch identically.

        The extension now runs inside hypercurve: the crossing is found exactly, kept as a
        Point2 with Real coordinates, and the end segment is REBUILT with that point as its
        endpoint (extend_endpoint_to_point). */
    const distanceToLine = (p: Point, a: Point, b: Point): number =>
    {
        const ab = b.toVector().subtract(a.toVector());
        const ap = p.toVector().subtract(a.toVector());
        return ap.cross(ab).length() / ab.length();
    };

    it('reaches an oblique target instead of stopping a millionth short', () =>
    {
        const line = Curve.Line([10, 0, 10], [100, 0, 110]);
        const target = Curve.Line([200, 0, -50], [200, 0, 500]);

        line.extendTo(target);

        // was 5.5e-7 off the target line
        expect(distanceToLine(new Point(line.end()), new Point(target.start()), new Point(target.end())))
            .toBeLessThan(1e-12);
        expect(line.end().x).toBeCloseTo(200, 10);
    });

    it('lands on a crossing that no 1e-5 grid can express', () =>
    {
        const target = Curve.Line([137.70011, 0, -50], [137.70011, 0, 500]);
        const line = Curve.Line([0, 0, 0], [30, 0, 10]);

        line.extendTo(target);

        expect(line.end().x).toEqual(137.70011);        // exactly, not to 6 decimals
    });

    it('extends the near end of an URBENT-shaped brace onto its wall line', () =>
    {
        const wall = Curve.Line([0, 0, 0], [0, 0, 4321]);
        const brace = Curve.Line([56.06, 0, 3170.9], [643.49, 0, 4770.6]);

        brace.extendTo(wall);

        expect(distanceToLine(new Point(brace.start()), new Point(wall.start()), new Point(wall.end())))
            .toBeLessThan(1e-12);                       // was 1.3e-6
    });

    it('keeps the measured extension where nothing crosses, and for an arc end', () =>
    {
        // converging but never meeting: the closest approach is the only answer there is
        const converging = Curve.Line([0, 0, 0], [100, 0, 10]);
        converging.extendTo(Curve.Line([300, 0, 300], [400, 0, 320]));
        expect(converging.length()).toBeGreaterThan(300);

        // an arc end has no straight continuation to intersect, so the exact route declines
        // and the sampled one still extends it
        const arc = Curve.Arc([0, 0, 0], [50, 0, 30], [100, 0, 0]);
        arc.extendTo(Curve.Line([200, 0, -100], [200, 0, 100]));
        expect(arc.end().x).toBeCloseTo(200, 5);
    });

    it('cuts the URBENT post by its brace into ONE clean quad', () =>
    {
        // The shape the whole chain exists for, built the way the script builds it: the brace is
        // offset, trimmed and extended to the wall line the post stands on, so the two share
        // that edge. Before, the extension stopped 6.6e-7 short of the wall line, the two halves
        // of the post stayed joined by a wedge that thin, and the "cut" came back as a single
        // 8-vertex region — `.first()` on it handed the script a shape enclosing a sliver.
        const SPAN = 5436, HEIGHT = 3087, RIDGE = 0.25;
        const WALL_TOP = 2263, WALL_HEIGHT = 2000, BEAM_W = 150, BLOCKING_INSET = 30;
        const slopeRatio = HEIGHT / ((1 - RIDGE) * SPAN);
        const leftSlope = RIDGE * SPAN * slopeRatio;
        const startHeight = HEIGHT - leftSlope;

        const roofLine = Curve.Polyline(
            [0, 0, startHeight],
            [SPAN * RIDGE, 0, startHeight + leftSlope],
            [SPAN, 0, startHeight + leftSlope - (1 - RIDGE) * SPAN * slopeRatio])
            .translate(0, 0, WALL_TOP);
        const roofLeft = roofLine.edges().first() as Curve;
        const wallLeft = Curve.Line([0, 0, 0], roofLine.start());
        const centre = Curve.Line([RIDGE * SPAN, 0, 0], [RIDGE * SPAN, 0, WALL_HEIGHT + HEIGHT + 500]);
        const one = (c: any): Curve => (c instanceof ShapeCollection) ? c.checkSingle() as Curve : c as Curve;

        const post = wallLeft.copy().move(BEAM_W).extendTo(roofLeft).connect(wallLeft);
        const blocking = one(roofLeft.copy()
            .move(roofLeft.direction().normalize().rotateY(90).scale(BLOCKING_INSET))
            .extendTo(wallLeft).cutoffBy(centre));
        // the script's own choice of brace end: the nearer of "1000 along the roof" and "a third
        // of the way up it"
        const byLength = roofLeft.pointAtLength(1000)!;
        const byPerc = roofLeft.pointAtPerc(0.33)!;
        const from = roofLeft.start();
        const braceEnd = (byLength.distance(from) > byPerc.distance(from)) ? byPerc : byLength;
        const braceLine = Curve.Line(roofLeft.start().copy().translate(0, 0, -1000), braceEnd);
        const braceCut = () => one(braceLine.copy().cutoffBy(blocking));
        const brace = (braceCut().offset(BEAM_W) as Curve)
                        .extendTo(blocking).extendTo(wallLeft)
                        .connect(braceCut());

        // the brace now REACHES the wall line (x = 0) instead of stopping 6.6e-7 short of it
        expect(Math.max(...brace.vertices().toArray().map(v => Math.abs(v.x)).filter(x => x < 1)))
            .toBeLessThan(1e-9);

        const cut = post.copy().cutoffBy(brace) as Curve;

        expect(cut).toBeInstanceOf(Curve);
        expect(cut.vertices().length).toEqual(4);
        expect(cut.edges().length).toEqual(4);
        expect(cut.area()).toBeCloseTo(460880.15, 1);
    });
});

describe('Curve.cutoffBy() cuts an open Curve exactly at the cutter', () =>
{
    /*  The open branch used to map each crossing to an arc-length parameter and trim there —
        as accurate as the parameter mapping, which runs on the tessellation. The pieces are now
        trimmed at the crossing POINTS themselves (hypercurve's trim_between_points). */
    it('starts the kept piece exactly on the cutter', () =>
    {
        const line = Curve.Line([0, 0, 0], [300, 0, 100]);
        const cutter = Curve.Line([137.70011, 0, -50], [137.70011, 0, 500]);

        const kept = line.cutoffBy(cutter) as Curve;

        expect(kept.start().x).toEqual(137.70011);      // exactly on the cutter
        expect(kept.end().x).toBeCloseTo(300, 9);       // ... and the far end is untouched
    });
});

describe('Curve crossings / cutoffBy() off the XY plane', () =>
{
    // Regression: curvo's curve intersection runs in the XY plane (ignoring Z), so a
    // planar curve in another coordinate plane (here XZ) previously found no hits and
    // cutoffBy() did nothing. The hit finder now transforms into the curve's local XY
    // frame, flattens residual out-of-plane noise, intersects, and maps back.
    it('finds intersections and cuts an offset line lying in the XZ plane', () =>
    {
        const ln = Curve.Line([0, 0, 0], [100, 0, 100]).moveZ(200);
        const cutter = Curve.Line([0, 0, 0], [150, 0, 50]).moveZ(240);
        const off = ln.copy().offset(-10) as Curve;
        const fullLen = off.length();

        expect(off.intersections(cutter)!.length).toBeGreaterThan(0);

        const res = off.cutoffBy(cutter) as Curve;
        expect(res.length()).toBeLessThan(fullLen);       // an actual cut happened
        expect(Math.abs(res.start().toArray()[1])).toBeLessThan(1e-6); // stays in XZ plane
        expect(Math.abs(res.end().toArray()[1])).toBeLessThan(1e-6);
    });

    /*  hypercurve plane-fits THIS curve to project the other into it, and for a straight line
        that fit is ill-defined: an axis-aligned line comes back empty one way round and throws
        ("open polyline failed (EmptyCurveString)") the other. The hit finder has always tried
        the swapped order for exactly this reason, but a single try/catch around both attempts
        meant a throw on the first order took the working swap down with it. */
    it('finds the crossing when one order of the pair fails outright', () =>
    {
        const alongX   = Curve.Line([0, 0, 0], [-3200, 0, 0]);
        const vertical = Curve.Line([-300, 0, -50], [-300, 0, 50]);

        const hit = alongX.intersection(vertical) as Vertex;
        expect(hit).toBeInstanceOf(Vertex);
        expect(hit.x).toBeCloseTo(-300, 6);
        expect(hit.z).toBeCloseTo(0, 6);

        // and the same the other way round
        expect((vertical.intersection(alongX) as Vertex).x).toBeCloseTo(-300, 6);
    });

    it('reports no crossings when two curves genuinely do not cross', () =>
    {
        const a = Curve.Line([0, 0, 0], [100, 0, 0]);
        const b = Curve.Line([0, 0, 50], [100, 0, 50]);
        expect(a.intersections(b)).toEqual(null);
        // the internal hit finder keeps the distinction the retry logic above needs: an empty
        // list is "they do not cross", null is "neither operand order could answer"
        expect((a as any)._intersectPoints(b)).toEqual([]);
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

describe('Curve.tangent()', () =>
{
    it('returns the normalised direction of a line', () =>
    {
        const t = Curve.Line([0, 0, 0], [100, 0, 0]).tangent()!;
        expect(t.toArray()).toEqual([1, 0, 0]);
        expect(t.length()).toBeCloseTo(1);
    });

    it('normalises a diagonal line', () =>
    {
        const t = Curve.Line([0, 0, 0], [10, 10, 10]).tangent()!;
        const c = 1 / Math.sqrt(3);
        expect(t.x).toBeCloseTo(c);
        expect(t.y).toBeCloseTo(c);
        expect(t.z).toBeCloseTo(c);
    });

    it('follows the direction the line was drawn in', () =>
    {
        const t = Curve.Line([100, 0, 0], [0, 0, 0]).tangent()!;
        expect(t.toArray()).toEqual([-1, 0, 0]);
    });

    it('agrees with tangentAt() everywhere along a line', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 50, 0]);
        const t = c.tangent()!;
        [[0, 0, 0], [50, 25, 0], [100, 50, 0]].forEach(p =>
        {
            const at = c.tangentAt(p)!;
            expect(at.x).toBeCloseTo(t.x);
            expect(at.y).toBeCloseTo(t.y);
            expect(at.z).toBeCloseTo(t.z);
        });
    });

    it('answers for a polyline whose vertices are collinear', () =>
    {
        const t = Curve.Polyline([0, 0, 0], [50, 0, 0], [100, 0, 0]).tangent()!;
        expect(t.toArray()).toEqual([1, 0, 0]);
    });

    it('does not consume the curve — asking twice gives the same answer', () =>
    {
        const c = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect(c.tangent()!.toArray()).toEqual([1, 0, 0]);
        expect(c.tangent()!.toArray()).toEqual([1, 0, 0]);
        expect(c.length()).toBeCloseTo(100);
    });

    it('returns null and points at tangentAt() for anything that curves', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const curved = [
            Curve.Arc([0, 0, 0], [50, 50, 0], [100, 0, 0], 'threepoint'),
            Curve.Circle(50),
            Curve.Rect(100, 50),
            Curve.Polyline([0, 0, 0], [50, 50, 0], [100, 0, 0]),
            Curve.Interpolated([[0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0]]),
        ];

        curved.forEach(c =>
        {
            warn.mockClear();
            expect(c.tangent()).toBeNull();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('tangentAt');
        });

        warn.mockRestore();
    });

    it('leaves tangentAt() as the way to ask a curved shape', () =>
    {
        const c = Curve.Circle(50);
        expect(c.tangentAt([50, 0, 0])).not.toBeNull();
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

describe('Curve.intersection() of an open Curve with a closed one', () =>
{
    /*  Regression: `line.intersection(rect)` always came back null. _intersectionCurve() ran the
        region boolean for every curve pair, guarded by `if(!this.isClosed)` — the METHOD, always
        truthy — so hypercurve was handed an open curve and refused it ("'this' is not a closed
        region"). An open curve meeting a closed one has a perfectly good answer: the piece of it
        inside the region, which is what a brep Edge ∩ Face gives too. */
    it('returns the piece of the line inside the rect', () =>
    {
        const r = Curve.Rect(10, 20);
        const l = Curve.Line([-100, 0, 0], [100, 10, 0]);
        const inside = l.copy().intersection(r) as Curve;

        expect(inside).toBeInstanceOf(Curve);
        // the line spans the 10-wide rect, rising 0.5 over it
        expect(inside.length()).toBeCloseTo(Math.sqrt(10 ** 2 + 0.5 ** 2), 4);
        expect(inside.start().x).toBeCloseTo(-5, 4);
        expect(inside.end().x).toBeCloseTo(5, 4);
        // ... and the original line is untouched
        expect(l.length()).toBeCloseTo(Math.sqrt(200 ** 2 + 10 ** 2), 4);
    });

    it('answers the same either way round', () =>
    {
        const r = Curve.Rect(10, 20);
        const l = Curve.Line([-100, 0, 0], [100, 10, 0]);
        expect((r.copy().intersection(l) as Curve).length())
            .toBeCloseTo((l.copy().intersection(r) as Curve).length(), 6);
    });

    it('gives a copy of the whole curve when it lies entirely inside', () =>
    {
        const inside = Curve.Line([-1, 0, 0], [1, 0, 0]).intersection(Curve.Rect(10, 20)) as Curve;
        expect(inside.length()).toBeCloseTo(2, 6);
    });

    it('returns null when the curve stays outside', () =>
    {
        expect(Curve.Line([-100, -100, 0], [-50, -100, 0]).intersection(Curve.Rect(10, 20))).toEqual(null);
    });

    it('cuts an arc region exactly (a chord of a circle)', () =>
    {
        const through = Curve.Line([-50, 0, 0], [50, 0, 0]).intersection(Curve.Circle(10)) as Curve;
        expect(through.length()).toBeCloseTo(20, 6);
    });

    it('keeps one piece per entry into a concave region', () =>
    {
        // C-shape: at y=15 the region is only the 0..10 back of the C, the notch is outside
        const cShape = Curve.Polyline([0, 0, 0], [30, 0, 0], [30, 10, 0], [10, 10, 0],
                                      [10, 20, 0], [30, 20, 0], [30, 30, 0], [0, 30, 0]).close();
        const pieces = Curve.Line([-10, 15, 0], [40, 15, 0]).intersections(cShape) as ShapeCollection<Curve>;
        expect(pieces.length).toEqual(1);
        expect(pieces.first().length()).toBeCloseTo(10, 4);
    });

    it('leaves out the part running through a hole', () =>
    {
        const holed = Curve.Rect(100, 100).difference(Curve.Rect(20, 20)) as Curve;
        const pieces = Curve.Line([-60, 0, 0], [60, 0, 0]).intersections(holed) as ShapeCollection<Curve>;
        expect(pieces.length).toEqual(2);
        pieces.toArray().forEach(p => expect(p.length()).toBeCloseTo(40, 4));
    });

    it('works off the XY plane', () =>
    {
        const rXZ = Curve.Rect(10, 20).rotateX(90);
        const inside = Curve.Line([-100, 0, 0], [100, 0, 10]).intersection(rXZ) as Curve;
        expect(inside.length()).toBeCloseTo(Math.sqrt(10 ** 2 + 0.5 ** 2), 4);
    });

    it('gives the crossing Vertices for two open Curves — they share no length', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        const b = Curve.Line([5, -5, 0], [5, 5, 0]);
        const hit = a.intersection(b) as Vertex;
        expect(hit).toBeInstanceOf(Vertex);
        expect(hit.x).toBeCloseTo(5, 6);
    });

    it('gives the touch Vertex when a curve only grazes the region', () =>
    {
        // ends exactly on the rect's right edge, coming from outside: nothing is inside it
        const touch = Curve.Line([100, 0, 0], [5, 0, 0]).intersection(Curve.Rect(10, 20)) as Vertex;
        expect(touch).toBeInstanceOf(Vertex);
        expect(touch.x).toBeCloseTo(5, 6);
    });

    it('reads the intersection POINTS off the result with vertices()', () =>
    {
        // the piece inside the rect starts and ends where the line crosses the outline
        const inside = Curve.Line([-100, 0, 0], [100, 10, 0]).intersection(Curve.Rect(10, 20)) as Curve;
        expect(inside.vertices().toArray().map(v => Math.round(v.x))).toEqual([-5, 5]);
    });
});

describe('Curve.intersect() — replacing, like union() and difference()', () =>
{
    it('replaces the line by the piece inside the rect, in place', () =>
    {
        const root = new SceneNode('root');
        const l = Curve.Line([-100, 0, 0], [100, 10, 0]);
        const layer = root.addLayer('shapes', l);

        const result = l.intersect(Curve.Rect(10, 20));

        expect(result).toBe(l);                                     // same Curve, new geometry
        expect(l.length()).toBeCloseTo(Math.sqrt(10 ** 2 + 0.5 ** 2), 4);
        expect(layer.shapes().toArray()).toEqual([l]);              // and it stays in the scene
    });

    it('takes the crossed line out of the scene for the Vertex two open curves share', () =>
    {
        const root = new SceneNode('root');
        const l = Curve.Line([0, 0, 0], [100, 0, 0]);
        const layer = root.addLayer('shapes', l);
        root.setActiveLayer(layer);

        const hit = l.intersect(Curve.Line([50, -50, 0], [50, 50, 0])) as Vertex;

        expect(hit).toBeInstanceOf(Vertex);
        expect(hit.x).toBeCloseTo(50, 6);
        expect(layer.shapes().toArray()).toEqual([hit]);            // the line gave way to it
    });

    it('leaves the Curve alone when the two share nothing', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const l = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect(l.intersect(Curve.Rect(10, 20, [0, 500, 0]))).toEqual(null);
        expect(l.length()).toBeCloseTo(100, 6);
        warn.mockRestore();
    });
});

/** Coordinates rounded to whole numbers, with -0 folded into 0 and toArray()'s optional z
 *  defaulted — for asserting on positions that should land on round values. */
const roundedCoords = (p: { toArray(): [number, number, number?] }): Array<number> =>
    p.toArray().map(v => Math.round(v ?? 0) + 0);

describe('Curve rotation pivots', () =>
{
    /*  Regression: Curve.rotateAround() defaulted its pivot to the WORLD ORIGIN while Mesh and
        Polygon defaulted to the shape's own centre, so the same script line meant one thing for
        a box and another for the circle next to it — `circle(20).move(100,100,10).rotateX(90)`
        swung the circle around the origin instead of standing it up where it was. Pinned as
        divergence #3 in @archiyou/core's kernel-divergences.test.ts, now deleted. */
    it('turns a moved circle about its own centre', () =>
    {
        const c = Curve.Circle(20).move(100, 100, 10);
        const turned = c.copy().rotateX(90);

        expect(roundedCoords(turned.center())).toEqual([100, 100, 10]);
        // ... and it really turned: the circle now stands in the XZ plane
        const n = turned.normal()!;
        expect([Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].map(v => +v.toFixed(6))).toEqual([0, 1, 0]);
    });

    it('honours an explicit pivot, and rotate() stays the origin-based turn', () =>
    {
        const c = () => Curve.Circle(20).move(100, 100, 10);
        expect(roundedCoords(c().rotateZ(90, [0, 0, 0]).center())).toEqual([-100, 100, 10]);
        expect(roundedCoords(c().rotate(90, 'z').center())).toEqual([-100, 100, 10]);
    });

    it('keeps a hole in place relative to its boundary', () =>
    {
        const holed = Curve.Rect(100, 100, [200, 0, 0]).difference(Curve.Rect(20, 20, [230, 0, 0])) as Curve;
        const turned = holed.copy().rotateZ(90);

        // the boundary turns about its own centre, and the hole turns about the SAME pivot —
        // the offset hole ends up a quarter turn round, not left behind at its own centre
        expect(roundedCoords(turned.center())).toEqual([200, 0, 0]);
        expect(roundedCoords(turned.holes()[0].center())).toEqual([200, 30, 0]);
    });
});

describe('Shape.first()', () =>
{
    /*  cutoffBy() / difference() / intersections() answer with one Curve or with a
        ShapeCollection depending on the geometry, and a script cannot know which in advance —
        so `post.cutoffBy(diagonal).first()` has to read either way. */
    it('answers a single Curve with itself', () =>
    {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.first()).toBe(c);
    });

    it('lets one line read a cut that may or may not have split', () =>
    {
        const rect = () => Curve.RectBetween([0, 0, 0], [100, 0, 100]);
        const oneP = rect().cutoffBy(Curve.RectBetween([-10, 0, 80], [110, 0, 200]))!.first() as Curve;
        expect(oneP.area()).toBeCloseTo(8000, 3);
    });
});

describe('Curve holes travel with their boundary', () =>
{
    /*  A hole (from difference()) is a Curve of its own hanging off the boundary. rotate*(),
        mirror() and projectOnto() transformed it, but translate() and scale() did not — so
        `holed.move(500, 0, 0)` left the hole behind at the old spot, and a scaled region kept a
        hole of the original size. Worse, mirror() and the resampling paths ran their update()
        with a Curve, which REPLACES _holes with the (empty) holes of that curve, so the hole was
        not merely left behind but dropped entirely. */
    const holed = () => Curve.Rect(100, 100).difference(Curve.Rect(20, 20, [30, 0, 0])) as Curve;
    const holeAt = (c: Curve) => roundedCoords(c.holes()[0].center());

    it('starts with one hole, off to one side', () =>
    {
        expect(holed().holes().length).toEqual(1);
        expect(holeAt(holed())).toEqual([30, 0, 0]);
        expect(holed().area()).toBeCloseTo(100 * 100 - 20 * 20, 6);
    });

    it('follows a move', () =>
    {
        expect(holeAt(holed().move(500, 0, 0))).toEqual([530, 0, 0]);
        expect(holeAt(holed().moveTo(500, 10, 0))).toEqual([530, 10, 0]);
    });

    it('scales with the boundary, about the same origin', () =>
    {
        const scaled = holed().scale(2);
        expect(holeAt(scaled)).toEqual([60, 0, 0]);
        expect(scaled.holes()[0].bbox()!.width()).toBeCloseTo(40, 6);
        expect(scaled.area()).toBeCloseTo(4 * (100 * 100 - 20 * 20), 4);

        // ... including the non-uniform path, which takes a different route through hypercurve
        const flat = holed().scale([2, 1, 1]);
        expect(holeAt(flat)).toEqual([60, 0, 0]);
        expect(flat.area()).toBeCloseTo(2 * (100 * 100 - 20 * 20), 4);
    });

    it('mirrors with the boundary, across the same plane', () =>
    {
        expect(holed().mirror('x').holes().length).toEqual(1);
        expect(holeAt(holed().mirror('x'))).toEqual([-30, 0, 0]);
        expect(holeAt(holed().mirrorX())).toEqual([-30, 0, 0]);
    });

    it('survives a rigid round trip through layflat()', () =>
    {
        const there = holed().rotateX(45).layflat();
        expect(holeAt(there)).toEqual([30, 0, 0]);
        expect(there.area()).toBeCloseTo(100 * 100 - 20 * 20, 4);
    });

    it('is not transformed twice by the pivot bookkeeping', () =>
    {
        // rotateAround()/scale() shift to the pivot and back on the BOUNDARY only; a hole that
        // was carried along by that shuffle as well would end up displaced by the pivot
        expect(holeAt(holed().move(200, 0, 0).rotateZ(90))).toEqual([200, 30, 0]);
        expect(holeAt(holed().move(200, 0, 0).scale(2))).toEqual([260, 0, 0]);
        expect(holeAt(holed().move(200, 0, 0).rotateAround(90, [0, 0, 1]))).toEqual([200, 30, 0]);
    });
});

describe('Curve.containsPoint()', () =>
{
    it('tells inside from outside for a closed Curve', () =>
    {
        const r = Curve.Rect(10, 20);
        expect(r.containsPoint([0, 0, 0])).toBe(true);
        expect(r.containsPoint([4.9, 9.9, 0])).toBe(true);
        expect(r.containsPoint([5.1, 0, 0])).toBe(false);
        expect(r.containsPoint([0, 0, 5])).toBe(false);      // off the plane
    });

    it('excludes holes', () =>
    {
        const holed = Curve.Rect(100, 100).difference(Curve.Rect(20, 20)) as Curve;
        expect(holed.containsPoint([0, 0, 0])).toBe(false);  // in the hole
        expect(holed.containsPoint([40, 0, 0])).toBe(true);
    });

    it('is false for an open Curve', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(Curve.Line([0, 0, 0], [10, 0, 0]).containsPoint([5, 0, 0])).toBe(false);
        warn.mockRestore();
    });
});

describe('Curve.intersection() / intersections() scene contract', () =>
{
    /*  Regression: the intersection of two closed Curves was built correctly but never entered
        the scene, so a script that ended on `x = a.intersection(b)` simply saw nothing — and
        addToScene() could not rescue it either, because the result carried no scene root. */
    it('adds the result to the active layer and leaves both operands alone', () =>
    {
        const root = new SceneNode('root');
        const a = Curve.Rect(100, 100);
        const b = Curve.Rect(100, 100, [50, 0, 0]);
        const shapes = root.addLayer('shapes', new ShapeCollection<Curve>(a, b));

        const connectors = root.addLayer('connectors', new ShapeCollection<Curve>());
        root.setActiveLayer(connectors);

        const overlap = a.intersection(b) as Curve;
        expect(overlap).toBeInstanceOf(Curve);
        expect(overlap).not.toBe(a);

        // the result is on the ACTIVE layer, not on the operands' own layer
        expect(connectors.shapes().toArray()).toEqual([overlap]);
        expect(shapes.shapes().toArray()).toEqual([a, b]);
    });

    it('keeps the results out of the scene when the source is tmp()', () =>
    {
        const root = new SceneNode('root');
        const a = Curve.Rect(100, 100);
        root.addLayer('shapes', a);
        const layer = root.addLayer('connectors', new ShapeCollection<Curve>());
        root.setActiveLayer(layer);

        a.tmp();
        a.intersection(Curve.Rect(100, 100, [50, 0, 0]));
        expect(layer.shapes().toArray()).toEqual([]);
    });
});
