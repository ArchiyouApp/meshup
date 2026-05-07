import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, initAsync, Polygon } from '../../src/index';
import { Bbox } from '../../src/Bbox';
import { Vertex } from '../../src/Vertex';

beforeAll(async () =>
{
    await initAsync();
});

describe('Bbox construction', () =>
{
    it('constructs from two PointLike arguments', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(bbox.min().x).toBe(0);
        expect(bbox.max().x).toBe(10);
    });

    it('constructs from a two-element array of PointLike', () =>
    {
        const bbox = new Bbox([[0, 0, 0], [5, 5, 5]]);
        expect(bbox.min().x).toBe(0);
        expect(bbox.max().z).toBe(5);
    });

    it('throws for invalid arguments', () =>
    {
        expect(() => new Bbox(42 as any)).toThrow();
    });
});

describe('Bbox.min() / max()', () =>
{
    it('returns the correct min point', () =>
    {
        const bbox = new Bbox([1, 2, 3], [4, 5, 6]);
        expect(bbox.min().x).toBe(1);
        expect(bbox.min().y).toBe(2);
        expect(bbox.min().z).toBe(3);
    });

    it('returns the correct max point', () =>
    {
        const bbox = new Bbox([1, 2, 3], [4, 5, 6]);
        expect(bbox.max().x).toBe(4);
        expect(bbox.max().y).toBe(5);
        expect(bbox.max().z).toBe(6);
    });
});

describe('Bbox.center()', () =>
{
    it('computes the center of a symmetric bbox', () =>
    {
        const bbox = new Bbox([-5, -5, -5], [5, 5, 5]);
        const c = bbox.center();
        expect(c.x).toBeCloseTo(0);
        expect(c.y).toBeCloseTo(0);
        expect(c.z).toBeCloseTo(0);
    });

    it('computes the center of an asymmetric bbox', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const c = bbox.center();
        expect(c.x).toBeCloseTo(5);
        expect(c.y).toBeCloseTo(10);
        expect(c.z).toBeCloseTo(15);
    });
});

describe('Bbox dimensions', () =>
{
    it('width() returns x extent', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(bbox.width()).toBe(10);
    });

    it('depth() returns y extent', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(bbox.depth()).toBe(20);
    });

    it('height() returns z extent', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(bbox.height()).toBe(30);
    });
});

describe('Bbox classification', () =>
{
    it('is3D() for a 3D bbox', () =>
    {
        const bbox = new Bbox([0, 0, 0], [1, 1, 1]);
        expect(bbox.is3D()).toBe(true);
    });

    it('is2D() for a flat bbox', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 10, 0]);
        expect(bbox.is2D()).toBe(true);
    });

    it('is1D() for a line bbox', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 0, 0]);
        expect(bbox.is1D()).toBe(true);
    });
});

describe('Bbox shape generation', () =>
{
    it('face||top returns a face on the top side of the bbox', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const plane = bbox.getSidesShapes('top', 'face').first() as Polygon;
        expect(plane.normal().toArray().map(c => (c === 0) ? 0 : c)).toEqual([0, 0, 1]);
    });

    it('edge||leftfront', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const edge = bbox.getSidesShapes('leftfront', 'edge').first() as Curve;
        // +0 -0 problems
        expect(edge.direction().normalize().toArray().map(c => (c === 0) ? 0 : c)).toEqual([0, 0, -1]); // TODO: force edges to be positive
        expect(edge.end().toArray()).toEqual([0, 0, 0]); // -0
        expect(edge.start().toArray()).toEqual([0, 0, 30]);
    });

    it('vertex||frontleftbottom returns the front-left-bottom corner vertex', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const vertex = bbox.getSidesShapes('frontleftbottom', 'vertex').first() as any as Vertex;
        expect(vertex.position().toArray().map(c => (c === 0) ? 0 : c)).toEqual([0, 0, 0]);
    });

    it('throws if the number of sides does not match the type', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(() => bbox.getSidesShapes('top', 'vertex')).toThrow();
        expect(() => bbox.getSidesShapes('topleft', 'face')).toThrow();
    });
});
