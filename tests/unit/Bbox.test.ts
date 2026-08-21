import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, initAsync, Mesh, Polygon } from '../../src/index';
import { Bbox } from '../../src/Bbox';
import { Vertex } from '../../src/Vertex';
import { SceneNode } from '../../src/SceneNode';

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

describe('Bbox.distance()', () =>
{
    it('returns 0 for overlapping boxes', () =>
    {
        const left = new Bbox([0, 0, 0], [10, 10, 10]);
        const right = new Bbox([5, 5, 5], [15, 15, 15]);
        expect(left.distance(right)).toBe(0);
        expect(right.distance(left)).toBe(0);
    });

    it('returns 0 for touching boxes', () =>
    {
        const left = new Bbox([0, 0, 0], [10, 10, 10]);
        const right = new Bbox([10, 2, 2], [20, 8, 8]);
        expect(left.distance(right)).toBe(0);
    });

    it('returns the gap for boxes separated along one axis', () =>
    {
        const left = new Bbox([0, 0, 0], [10, 10, 10]);
        const right = new Bbox([13, 2, 2], [20, 8, 8]);
        expect(left.distance(right)).toBe(3);
    });

    it('returns Euclidean distance for diagonal separation', () =>
    {
        const left = new Bbox([0, 0, 0], [2, 2, 2]);
        const right = new Bbox([5, 6, 2], [7, 8, 4]);
        expect(left.distance(right)).toBeCloseTo(5);
    });

    it('works for flat 2D boxes embedded in 3D space', () =>
    {
        const left = new Bbox([0, 0, 0], [10, 10, 0]);
        const right = new Bbox([13, 14, 0], [20, 20, 0]);
        expect(left.distance(right)).toBeCloseTo(5);
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
        // Edges run along the free axis in the positive (min → max) direction.
        expect(edge.direction().normalize().toArray().map(c => (c === 0) ? 0 : c)).toEqual([0, 0, 1]);
        expect(edge.start().toArray()).toEqual([0, 0, 0]);
        expect(edge.end().toArray()).toEqual([0, 0, 30]);
    });

    it('edge on a flat (XY) bbox selects an in-plane edge from a single side keyword', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 0]); // flat on XY (height 0)
        // 'front' (min-Y) leaves X free → edge along X at y = 0, z = 0
        const front = bbox.getSidesShapes('front', 'edge').first() as Curve;
        expect(front.start().toArray()).toEqual([0, 0, 0]);
        expect(front.end().toArray()).toEqual([10, 0, 0]);
        // 'left' (min-X) leaves Y free → edge along Y at x = 0, z = 0
        const left = bbox.getSidesShapes('left', 'edge').first() as Curve;
        expect(left.start().toArray()).toEqual([0, 0, 0]);
        expect(left.end().toArray()).toEqual([0, 20, 0]);
    });

    it('edge is greedy: returns all matching edges when underspecified', () =>
    {
        // Both in-plane axes pinned on a flat bbox → no free real axis → no edges
        const flat = new Bbox([0, 0, 0], [10, 20, 0]);
        expect(flat.getSidesShapes('leftfront', 'edge').length).toBe(0);
        // One side keyword on a 3D box → 4 edges of that face
        const box = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(box.getSidesShapes('top', 'edge').length).toBe(4);
    });

    it('vertex||frontleftbottom returns the front-left-bottom corner vertex', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const vertex = bbox.getSidesShapes('frontleftbottom', 'vertex').first() as any as Vertex;
        expect(vertex.position().toArray().map(c => (c === 0) ? 0 : c)).toEqual([0, 0, 0]);
    });

    it('vertex/face are greedy when underspecified', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        // 'top' pins Z only → all 4 corner vertices of the top face
        expect(bbox.getSidesShapes('top', 'vertex').length).toBe(4);
        // 'topleft' pins Z and X → both the top face and the left face
        expect(bbox.getSidesShapes('topleft', 'face').length).toBe(2);
    });
});

describe('Bbox.shape()', () =>
{
    it('3D bbox gives a box Mesh of the right size and place', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        const shape = bbox.shape() as Mesh;
        expect(shape).toBeInstanceOf(Mesh);
        expect(shape.bbox().min().toArray()).toEqual([0, 0, 0]);
        expect(shape.bbox().max().toArray()).toEqual([10, 20, 30]);
        expect(shape.volume()!).toBeCloseTo(10 * 20 * 30, 6);
    });

    it('2D bbox gives a closed rectangle Curve in the flat plane', () =>
    {
        const bbox = new Bbox([0, 0, 5], [10, 20, 5]);
        const shape = bbox.shape() as Curve;
        expect(shape).toBeInstanceOf(Curve);
        expect(shape.isClosed()).toBe(true);
        expect(shape.bbox()!.min().toArray()).toEqual([0, 0, 5]);
        expect(shape.bbox()!.max().toArray()).toEqual([10, 20, 5]);
    });

    it('1D bbox gives a line Curve along its one axis', () =>
    {
        const bbox = new Bbox([0, 3, 0], [10, 3, 0]);
        const shape = bbox.shape() as Curve;
        expect(shape).toBeInstanceOf(Curve);
        expect(shape.isClosed()).toBe(false);
        expect(shape.start().toArray()).toEqual([0, 3, 0]);
        expect(shape.end().toArray()).toEqual([10, 3, 0]);
    });

    it('zero-size bbox gives a Vertex at its centre', () =>
    {
        const bbox = new Bbox([2, 3, 4], [2, 3, 4]);
        const shape = bbox.shape() as Vertex;
        expect(shape).toBeInstanceOf(Vertex);
        expect(shape.position().toArray()).toEqual([2, 3, 4]);
    });

    it('the dimensionality accessors refuse a bbox of the wrong dimension', () =>
    {
        const box = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(box.vertex()).toBeNull();
        expect(box.line()).toBeNull();
        expect(box.rect()).toBeNull();
        expect(new Bbox([2, 3, 4], [2, 3, 4]).line()).toBeNull();
    });

    it('toShape() is an alias for shape()', () =>
    {
        const bbox = new Bbox([0, 0, 0], [10, 20, 30]);
        expect(bbox.toShape()).toBeInstanceOf(Mesh);
    });
});

describe('Bbox helper shapes carry the measured shape\'s modeler + scene', () =>
{
    /** The host app is reached through `_modeler`; without it every app-level method on a
     *  derived shape (.dim(), .label(), .material()) silently does nothing. */
    it('side/plane accessors carry _modeler and _scene, without adding to the scene', () =>
    {
        const scene = new SceneNode('root');
        const rect = Curve.Rect(400, 200);
        scene.addShape(rect);
        (rect as any)._modeler = { fake: true };

        const bb = rect.bbox()!;
        const before = scene.shapes().length;

        const side = bb.back() as any;              // 2D bbox → an edge Curve
        expect(side).toBeDefined();
        expect(side._modeler).toBe((rect as any)._modeler);
        expect(side._scene).toBe(scene);
        expect(side.node()).toBe(null);             // a reference, not geometry in the scene
        expect(scene.shapes().length).toBe(before);

        const planes = new Bbox([0, 0, 0], [10, 20, 30])._fromShape(rect).planes();
        expect(planes.length).toBe(6);
        expect(planes.every(p => (p as any)._modeler === (rect as any)._modeler)).toBe(true);
        expect(scene.shapes().length).toBe(before);
    });

    it('rect()/box() still land IN the scene (they are geometry, not references)', () =>
    {
        const scene = new SceneNode('root');
        const rect = Curve.Rect(400, 200);
        scene.addShape(rect);

        const before = scene.shapes().length;
        rect.bbox()!.rect();
        expect(scene.shapes().length).toBe(before + 1);
    });
});
