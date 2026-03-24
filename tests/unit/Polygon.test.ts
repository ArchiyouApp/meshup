import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { Bbox } from '../../src/Bbox';
import { OBbox } from '../../src/OBbox';

beforeAll(async () => {
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

describe('Polygon construction', () => {
    it('creates a polygon from PointLike vertices', () => {
        const p = new Polygon(SQUARE);
        expect(p).toBeTruthy();
        expect(p.inner).toBeTruthy();
    });

    it('throws when fewer than 3 vertices are provided', () => {
        expect(() => new Polygon([[0, 0, 0], [1, 0, 0]])).toThrow();
    });

    it('Polygon.from() wraps a raw PolygonJs', () => {
        const rawPolygons = Mesh.Cube(1).polygons();
        expect(rawPolygons.length).toBeGreaterThan(0);
        const p = rawPolygons[0];
        expect(p).instanceOf(Polygon);
    });
});

describe('Polygon.vertices()', () => {
    it('returns the correct number of vertices', () => {
        const p = new Polygon(SQUARE);
        expect(p.vertices().length).toBe(4);
    });

    it('vertex positions match input', () => {
        const p = new Polygon(TRIANGLE);
        const verts = p.vertices();
        expect(verts[0].x).toBeCloseTo(0);
        expect(verts[0].y).toBeCloseTo(0);
        expect(verts[1].x).toBeCloseTo(2);
        expect(verts[2].y).toBeCloseTo(2);
    });
});

describe('Polygon.holeCount() / hasHoles()', () => {
    it('has no holes by default', () => {
        const p = new Polygon(SQUARE);
        expect(p.holeCount()).toBe(0);
        expect(p.hasHoles()).toBe(false);
    });
});

describe('Polygon.flip()', () => {
    it('returns this for chaining', () => {
        const p = new Polygon(TRIANGLE);
        expect(p.flip()).toBe(p);
    });
});

describe('Polygon.triangulate()', () => {
    it('returns triangular polygons', () => {
        const p = new Polygon(SQUARE);
        const tris = p.triangulate();
        expect(tris.length).toBeGreaterThan(0);
        for (const tri of tris)
        {
            expect(tri.vertices().length).toBe(3);
        }
    });
});

describe('Polygon.extrude()', () => {
    it('returns a Mesh', () => {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m).instanceOf(Mesh);
    });

    it('extruded mesh has vertices', () => {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m.vertices().length).toBeGreaterThan(0);
    });

    it('extruded mesh has triangles', () => {
        const p = new Polygon(SQUARE);
        const m = p.extrude(2);
        expect(m.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('respects custom direction', () => {
        const p = new Polygon(SQUARE);
        const m = p.extrude(3, [0, 1, 0]);
        const bbox = m.bbox();
        // extrude along +y should produce depth > 0
        expect(bbox.depth()).toBeGreaterThan(0);
    });
});

describe('Mesh.polygons()', () => {
    it('returns Polygon instances', () => {
        const m = Mesh.Cube(2);
        const polys = m.polygons();
        expect(polys.length).toBeGreaterThan(0);
        for (const p of polys)
        {
            expect(p).instanceOf(Polygon);
        }
    });

    it('each polygon has at least 3 vertices', () => {
        const m = Mesh.Cube(2);
        for (const p of m.polygons())
        {
            expect(p.vertices().length).toBeGreaterThanOrEqual(3);
        }
    });
});

describe('Polygon.center()', () => {
    it('returns centroid of a unit square at origin', () => {
        const p = new Polygon(SQUARE);
        const c = p.center();
        expect(c.x).toBeCloseTo(0.5);
        expect(c.y).toBeCloseTo(0.5);
        expect(c.z).toBeCloseTo(0);
    });

    it('returns centroid of a triangle', () => {
        const tri: Array<[number, number, number]> = [[0,0,0],[3,0,0],[0,3,0]];
        const p = new Polygon(tri);
        const c = p.center();
        expect(c.x).toBeCloseTo(1);
        expect(c.y).toBeCloseTo(1);
        expect(c.z).toBeCloseTo(0);
    });
});

describe('Polygon.bbox()', () => {
    it('returns a Bbox instance', () => {
        const p = new Polygon(SQUARE);
        expect(p.bbox()).toBeInstanceOf(Bbox);
    });

    it('min and max match vertex extents of the unit square', () => {
        const p = new Polygon(SQUARE);
        const bb = p.bbox();
        expect(bb.min().x).toBeCloseTo(0);
        expect(bb.min().y).toBeCloseTo(0);
        expect(bb.max().x).toBeCloseTo(1);
        expect(bb.max().y).toBeCloseTo(1);
    });

    it('width and depth are 1 for the unit square', () => {
        const p = new Polygon(SQUARE);
        const bb = p.bbox();
        expect(bb.width()).toBeCloseTo(1);
        expect(bb.depth()).toBeCloseTo(1);
    });
});

describe('Polygon.obbox()', () => {
    it('returns an OBbox instance', () => {
        const p = new Polygon(SQUARE);
        expect(p.obbox()).toBeInstanceOf(OBbox);
    });

    it('OBbox center matches centroid of the unit square', () => {
        const p = new Polygon(SQUARE);
        const ob = p.obbox();
        expect(ob.center().x).toBeCloseTo(0.5);
        expect(ob.center().y).toBeCloseTo(0.5);
    });
});
