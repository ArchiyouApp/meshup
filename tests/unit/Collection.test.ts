import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { ShapeCollection as Collection } from '../../src/ShapeCollection';
import { Point } from '../../src/Point';

let cube1: Mesh;
let cube2: Mesh;
let line: Curve;

beforeAll(async () =>
{
    await initAsync();
    cube1 = Mesh.Cube(10);
    cube2 = Mesh.Cube(5);
    line = Curve.Line([0, 0, 0], [10, 0, 0]);
});

describe('Collection construction', () =>
{
    it('creates an empty collection', () =>
    {
        const c = new Collection();
        expect(c.count()).toBe(0);
        expect(c.length).toBe(0);
    });

    it('constructs with initial Mesh shapes', () =>
    {
        const c = new Collection(cube1, cube2);
        expect(c.count()).toBe(2);
    });

    it('constructs with an array of shapes', () =>
    {
        const c = new Collection([cube1, cube2]);
        expect(c.count()).toBe(2);
    });

    it('constructs from another Collection', () =>
    {
        const src = new Collection(cube1);
        const c = new Collection(src);
        expect(c.count()).toBe(1);
    });
});

describe('Collection.add()', () =>
{
    it('adds a single Mesh', () =>
    {
        const c = new Collection();
        c.add(cube1);
        expect(c.count()).toBe(1);
    });

    it('adds a single Curve', () =>
    {
        const c = new Collection();
        c.add(line);
        expect(c.count()).toBe(1);
    });

    it('adds another Collection', () =>
    {
        const c = new Collection(cube1);
        c.add(new Collection(cube2));
        expect(c.count()).toBe(2);
    });

    it('adds multiple shapes passed as separate arguments', () =>
    {
        const c = new Collection();
        c.add(cube1, cube2);
        expect(c.count()).toBe(2);
    });
});

describe('Collection accessors', () =>
{
    it('shapes() returns underlying array', () =>
    {
        const c = new Collection(cube1, cube2);
        expect(Array.isArray(c.shapes())).toBe(true);
        expect(c.shapes().length).toBe(2);
    });

    it('first() returns the first shape', () =>
    {
        const c = new Collection(cube1, cube2);
        expect(c.first()).toBe(cube1);
    });

    it('last() returns the last shape', () =>
    {
        const c = new Collection(cube1, cube2);
        expect(c.last()).toBe(cube2);
    });

    it('first() throws on empty collection', () =>
    {
        expect(() => new Collection().first()).toThrow();
    });

    it('get(i) returns shape at index', () =>
    {
        const c = new Collection(cube1, cube2);
        expect(c.get(0)).toBe(cube1);
        expect(c.get(1)).toBe(cube2);
    });

    it('meshes() filters to Mesh instances only', () =>
    {
        const c = new Collection(cube1, line);
        const meshes = c.meshes();
        expect(meshes.toArray().every(s => s instanceof Mesh)).toBe(true);
        expect(meshes.length).toBe(1);
    });

    it('curves() filters to Curve instances only', () =>
    {
        const c = new Collection(cube1, line);
        const curves = c.curves();
        expect(curves.toArray().every(s => s instanceof Curve)).toBe(true);
        expect(curves.length).toBe(1);
    });
});

describe('Collection.union() — no argument, merge by type', () =>
{
    it('unions overlapping closed curves into a single outline', () =>
    {
        // Mirrors the user scenario: a rect with two circles overlapping it
        const r  = Curve.Rect(100, 60);
        const ct = Curve.Circle(30).moveY(30);
        const cb = Curve.Circle(30).moveY(-30);
        const result = new Collection(r, ct, cb).union();
        expect(result).toBeInstanceOf(Curve);
    });

    it('unions all meshes into a single Mesh', () =>
    {
        const result = new Collection(cube1.copy(), cube2.copy().moveX(3)).union();
        expect(result).toBeInstanceOf(Mesh);
    });

    it('returns a mixed collection when both meshes and curves are present', () =>
    {
        const result = new Collection(cube1.copy(), Curve.Rect(20, 20), Curve.Circle(8)).union();
        expect(Collection.isShapeCollection(result)).toBe(true);
    });

    it('returns null for an empty collection', () =>
    {
        expect(new Collection().union()).toBeNull();
    });
});

describe('Collection.moveTo()', () =>
{
    it('accepts a Point instance as target', () =>
    {
        const c = new Collection(cube1.copy());
        c.moveTo(new Point(10, 20, 30));
        const center = c.bbox()!.center();

        expect(center.x).toBeCloseTo(10);
        expect(center.y).toBeCloseTo(20);
        expect(center.z).toBeCloseTo(30);
    });
});

describe('ShapeCollection<Mesh>', () =>
{
    it('creates a typed mesh collection', () =>
    {
        const mc = new Collection<Mesh>(cube1, cube2);
        expect(mc.count()).toBe(2);
    });
});

describe('ShapeCollection<Curve>', () =>
{
    it('creates a typed curve collection', () =>
    {
        const cc = new Collection<Curve>(line);
        expect(cc.count()).toBe(1);
    });
});

describe('Collection.intersections() / intersection()', () =>
{
    it('aggregates intersections of each shape with another Curve', () =>
    {
        const col = new Collection<Curve>(Curve.Rect(20, 20, [0, 0, 0]));
        const other = Curve.Rect(20, 20, [10, 10, 0]);
        const hits = col.intersections(other);
        expect(hits).toBeInstanceOf(Collection);
        expect(hits.length).toBeGreaterThan(0);
    });

    it('intersection() returns only the first intersection as a single Curve', () =>
    {
        const col = new Collection<Curve>(Curve.Rect(20, 20, [0, 0, 0]));
        const first = col.intersection(Curve.Rect(20, 20, [10, 10, 0]));
        expect(first).toBeInstanceOf(Curve);
    });

    it('returns an empty collection / null when there is no intersection', () =>
    {
        const col = new Collection<Curve>(Curve.Rect(20, 20, [0, 0, 0]));
        const far = Curve.Rect(5, 5, [100, 100, 0]);
        expect(col.intersections(far).length).toBe(0);
        expect(col.intersection(far)).toBeNull();
    });

    it('accepts another ShapeCollection as the other operand', () =>
    {
        const col = new Collection<Curve>(Curve.Rect(20, 20, [0, 0, 0]));
        const others = new Collection<Curve>(
            Curve.Rect(20, 20, [10, 10, 0]),
            Curve.Rect(20, 20, [-10, -10, 0]),
        );
        expect(col.intersections(others).length).toBeGreaterThanOrEqual(2);
    });

    it('intersects Meshes: returns the boolean-intersection volume Mesh', () =>
    {
        const a = Mesh.Cube(40);
        const b = Mesh.Cube(40).move(15, 10, 5);
        const col = new Collection<Mesh>(a);
        const hits = col.intersections(b);
        expect(hits.length).toBe(1);
        expect(hits.first()).toBeInstanceOf(Mesh);
        expect((hits.first() as Mesh).inner().triangleCount()).toBeGreaterThan(0);
        // source mesh must be left intact (Mesh.intersection mutates in place)
        expect(a.inner().triangleCount()).toBeGreaterThan(0);
    });

    it('intersection() returns the first Mesh volume; empty/null when meshes do not overlap', () =>
    {
        const a = Mesh.Cube(20);
        const col = new Collection<Mesh>(a);
        expect(col.intersection(Mesh.Cube(20).move(5, 5, 5))).toBeInstanceOf(Mesh);
        const far = Mesh.Cube(10).move(1000, 0, 0);
        expect(col.intersections(far).length).toBe(0);
        expect(col.intersection(far)).toBeNull();
    });
});
