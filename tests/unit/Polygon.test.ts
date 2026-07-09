import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Bbox } from '../../src/Bbox';
import { OBbox } from '../../src/OBbox';
import { Vector } from '../../src/Vector';

beforeAll(async () =>
{
    await initAsync();
});

const SQUARE: Array<[number, number, number]> = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
];

const TRIANGLE: Array<[number, number, number]> = [
    [0, 0, 0],
    [2, 0, 0],
    [1, 2, 0],
];

describe('Polygon construction', () =>
{
    it('creates a polygon from PointLike vertices', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p).toBeTruthy();
        expect(p.inner).toBeTruthy();
    });

    it('throws when fewer than 3 vertices are provided', () =>
    {
        expect(() => new Polygon([[0, 0, 0], [1, 0, 0]])).toThrow();
    });

    it('Polygon.from() wraps a raw PolygonJs', () =>
    {
        const rawPolygons = Mesh.Cube(1).polygons();
        expect(rawPolygons.length).toBeGreaterThan(0);
        const p = rawPolygons[0];
        expect(p).instanceOf(Polygon);
    });
});

describe('Polygon.vertices()', () =>
{
    it('returns the correct number of vertices', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p.vertices().length).toBe(4);
    });

    it('vertex positions match input', () =>
    {
        const p = new Polygon(TRIANGLE);
        const verts = p.vertices();
        expect(verts[0].x).toBeCloseTo(0);
        expect(verts[0].y).toBeCloseTo(0);
        expect(verts[1].x).toBeCloseTo(2);
        expect(verts[2].y).toBeCloseTo(2);
    });
});

describe('Polygon.holeCount() / hasHoles()', () =>
{
    it('has no holes by default', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p.holeCount()).toBe(0);
        expect(p.hasHoles()).toBe(false);
    });
});

describe('Polygon.flip()', () =>
{
    it('returns this for chaining', () =>
    {
        const p = new Polygon(TRIANGLE);
        expect(p.flip()).toBe(p);
    });
});

describe('Polygon.triangulate()', () =>
{
    it('returns triangular polygons', () =>
    {
        const p = new Polygon(SQUARE);
        const tris = p.triangulate();
        expect(tris.length).toBeGreaterThan(0);
        tris.forEach(tri =>
        {
            expect(tri.vertices().length).toBe(3);
        });
    });
});

describe('Polygon.extrude()', () =>
{
    it('returns a Mesh', () =>
    {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m).instanceOf(Mesh);
    });

    it('extruded mesh has vertices', () =>
    {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m.vertices().length).toBeGreaterThan(0);
    });

    it('extruded mesh has triangles', () =>
    {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('respects custom direction', () =>
    {
        const p = new Polygon(SQUARE);
        const m = p.extrude(3, [0, 1, 0]);
        const bbox = m.bbox();
        // extrude along +y should produce depth > 0
        expect(bbox.depth()).toBeGreaterThan(0);
    });

    it('uses the polygon normal when direction is omitted', () =>
    {
        const p = Polygon.planeBetween([0, 0, 0], [2, 0, 3]);
        const extrusionLength = 4;
        const m = p.extrude(extrusionLength);

        const delta = Vector.from(m.center()).subtract(p.center());
        const normal = p.normal().normalize();

        expect(delta.dot(normal)).toBeCloseTo(extrusionLength / 2, 6);
        expect(delta.copy().cross(normal).length()).toBeCloseTo(0, 6);
    });
});

describe('Polygon.planeBetween()', () =>
{
    it('returns a Polygon with 4 corners', () =>
    {
        const p = Polygon.planeBetween([0, 0, 0], [2, 3, 0]);
        expect(p).instanceOf(Polygon);
        expect(p.vertices().length).toBe(4);
    });

    it('spans the bounding box between the two points (XY plane)', () =>
    {
        const p = Polygon.planeBetween([0, 0, 0], [2, 3, 0]);
        const bb = p.bbox();
        expect(bb.width()).toBeCloseTo(2);
        expect(bb.depth()).toBeCloseTo(3);
    });

    it('is planar on the axis with least span (XZ plane)', () =>
    {
        const p = Polygon.planeBetween([0, 0, 0], [2, 0, 3]);
        // all vertices share y = 0
        p.vertices().forEach(v => expect(v.y).toBeCloseTo(0));
    });
});

describe('Polygon.offset()', () =>
{
    it('mutates in place and returns this', () =>
    {
        const p = new Polygon(SQUARE);
        const o = p.offset(0.5);
        expect(o).instanceOf(Polygon);
        expect(o).toBe(p); // in-place mutation: same object
    });

    it('outward offset grows the bounding box', () =>
    {
        const p = new Polygon(SQUARE);
        const o = p.offset(0.5)!;
        const bb = o.bbox();
        // unit square (0..1) offset outward by 0.5 → roughly (-0.5..1.5)
        expect(bb.min().x).toBeLessThan(0);
        expect(bb.min().y).toBeLessThan(0);
        expect(bb.max().x).toBeGreaterThan(1);
        expect(bb.max().y).toBeGreaterThan(1);
    });

    it('inward offset shrinks the bounding box', () =>
    {
        const p = new Polygon(SQUARE);
        const o = p.offset(-0.25)!;
        const bb = o.bbox();
        expect(bb.width()).toBeLessThan(1);
        expect(bb.depth()).toBeLessThan(1);
    });

    it('offset result is a closed polygon with at least 3 vertices', () =>
    {
        const p = new Polygon(TRIANGLE);
        const o = p.offset(0.2)!;
        expect(o.vertices().length).toBeGreaterThanOrEqual(3);
    });
});

describe('Mesh.polygons()', () =>
{
    it('returns Polygon instances', () =>
    {
        const m = Mesh.Cube(2);
        const polys = m.polygons();
        expect(polys.length).toBeGreaterThan(0);
        polys.forEach(p =>
        {
            expect(p).instanceOf(Polygon);
        });
    });

    it('each polygon has at least 3 vertices', () =>
    {
        const m = Mesh.Cube(2);
        m.polygons().forEach(p =>
        {
            expect(p.vertices().length).toBeGreaterThanOrEqual(3);
        });
    });
});

describe('Polygon.center()', () =>
{
    it('returns centroid of a unit square at origin', () =>
    {
        const p = new Polygon(SQUARE);
        const c = p.center();
        expect(c.x).toBeCloseTo(0.5);
        expect(c.y).toBeCloseTo(0.5);
        expect(c.z).toBeCloseTo(0);
    });

    it('returns centroid of a triangle', () =>
    {
        const tri: Array<[number, number, number]> = [[0,0,0],[3,0,0],[0,3,0]];
        const p = new Polygon(tri);
        const c = p.center();
        expect(c.x).toBeCloseTo(1);
        expect(c.y).toBeCloseTo(1);
        expect(c.z).toBeCloseTo(0);
    });
});

describe('Polygon.bbox()', () =>
{
    it('returns a Bbox instance', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p.bbox()).toBeInstanceOf(Bbox);
    });

    it('min and max match vertex extents of the unit square', () =>
    {
        const p = new Polygon(SQUARE);
        const bb = p.bbox();
        expect(bb.min().x).toBeCloseTo(0);
        expect(bb.min().y).toBeCloseTo(0);
        expect(bb.max().x).toBeCloseTo(1);
        expect(bb.max().y).toBeCloseTo(1);
    });

    it('width and depth are 1 for the unit square', () =>
    {
        const p = new Polygon(SQUARE);
        const bb = p.bbox();
        expect(bb.width()).toBeCloseTo(1);
        expect(bb.depth()).toBeCloseTo(1);
    });
});

describe('Polygon.obbox()', () =>
{
    it('returns an OBbox instance', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p.obbox()).toBeInstanceOf(OBbox);
    });

    it('OBbox center matches centroid of the unit square', () =>
    {
        const p = new Polygon(SQUARE);
        const ob = p.obbox();
        expect(ob.center().x).toBeCloseTo(0.5);
        expect(ob.center().y).toBeCloseTo(0.5);
    });
});

describe('Polygon.distance()', () =>
{
    it('measures distance to a point above the polygon plane', () =>
    {
        const p = new Polygon(SQUARE);
        expect(p.distance([0.5, 0.5, 3])).toBeCloseTo(3, 6);
    });

    it('measures distance to a parallel curve', () =>
    {
        const p = new Polygon(SQUARE);
        const line = Curve.Line([0.5, 0.5, 2], [1.5, 0.5, 2]);
        expect(p.distance(line)).toBeCloseTo(2, 6);
    });

    it('measures distance to a separated mesh', () =>
    {
        const p = new Polygon(SQUARE);
        const cube = Mesh.Cube(1).move(0.5, 0.5, 5.5);
        expect(p.distance(cube)).toBeCloseTo(5, 6);
    });
});

describe('Polygon.split()', () =>
{
    // The user's motivating example: a thin crescent split by a vertical line.
    const crescent = (): Polygon =>
    {
        const pl = Curve.Polyline([0, 0, 0], [100, 50, 0], [200, 0, 0]);
        const pl2 = pl.copy().offset(10)!;
        return pl.copy().connect(pl2).toPolygon()!;
    };

    it('splits a polygon into two polygons with a crossing line', () =>
    {
        const poly = crescent();
        const result = poly.split(Curve.Line([100, -50, 0], [100, 100, 0]));

        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
        result!.toArray().forEach(p => expect(p).toBeInstanceOf(Polygon));
        // An exact split (default gap 0): the pieces tile the original area.
        const sum = result!.toArray().reduce((s, p) => s + p.area(), 0);
        expect(sum).toBeCloseTo(poly.area(), 1);
    });

    it('splits an axis-aligned box (edges parallel to the cut) reliably', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        const result = box.split(Curve.Line([0, -80, 0], [0, 80, 0]));
        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
        result!.toArray().forEach(p => expect(p.area()).toBeCloseTo(10000, 0));
    });

    it('extends the cut so a line ending inside the polygon still splits it', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        // Endpoints are inside the box; the cut is extended to pass all the way through.
        const result = box.split(Curve.Line([0, -10, 0], [0, 10, 0]));
        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
    });

    it('splits a polygon lying on a non-XY (XZ) plane', () =>
    {
        const box = Curve.Rect(200, 100, [0, 0, 0], 'xz').toPolygon()!;
        const result = box.split(Curve.Line([0, 0, -80], [0, 0, 80]));
        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
    });

    it('leaves a seam when a positive gap is given', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        const result = box.split(Curve.Line([0, -80, 0], [0, 80, 0]), 10);
        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
        // A 10-wide seam over the 100-tall cut removes ~1000 of the 20000 area.
        const sum = result!.toArray().reduce((s, p) => s + p.area(), 0);
        expect(sum).toBeLessThan(box.area());
        expect(sum).toBeCloseTo(19000, -2);
    });

    it('splits with a closed Polygon band that spans the shape', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        const band = Curve.Rect(10, 300).toPolygon()!;
        const result = box.split(band);
        expect(result).not.toBeNull();
        expect(result!.count()).toBe(2);
    });

    it('returns null (with warning) when the cutter misses the polygon', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        const result = box.split(Curve.Line([300, -50, 0], [300, 100, 0]));
        expect(result).toBeNull();
    });

    it('returns null (with warning) for a self-intersecting cutter', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        const bowtie = Curve.Polyline([0, -50, 0], [200, 100, 0], [200, -50, 0], [0, 100, 0]);
        expect(bowtie.selfIntersecting()).toBe(true);
        expect(box.split(bowtie)).toBeNull();
    });

    it('returns null for an invalid gap', () =>
    {
        const box = Curve.Rect(200, 100).toPolygon()!;
        expect(box.split(Curve.Line([0, -80, 0], [0, 80, 0]), -5)).toBeNull();
    });
});
