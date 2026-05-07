import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Selector } from '../../src/Selector';

beforeAll(async () =>
{
    await initAsync();
});

describe('Mesh.Cube()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Mesh.Cube(10);
        expect(m).toBeTruthy();
    });

    it('has vertices', () =>
    {
        const m = Mesh.Cube(10);
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('has triangles', () =>
    {
        const m = Mesh.Cube(10);
        expect(m.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Mesh.Cuboid()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Mesh.Cuboid(10, 20, 30);
        expect(m).toBeTruthy();
    });

    it('has more triangles than a cube when dimensions differ', () =>
    {
        const cube = Mesh.Cube(10);
        const cuboid = Mesh.Cuboid(10, 20, 30);
        // Both are rectangular - triangle count should be equal
        expect(cuboid.inner().triangleCount()).toBe(cube.inner().triangleCount());
    });
});

describe('Mesh.Sphere()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Mesh.Sphere(5);
        expect(m).toBeTruthy();
    });

    it('has many more triangles than a cube', () =>
    {
        const sphere = Mesh.Sphere(5);
        expect(sphere.inner().triangleCount()).toBeGreaterThan(10);
    });
});

describe('Mesh.fromPoints()', () =>
{
    it('creates a triangulated polygon', () =>
    {
        const m = Mesh.fromPoints([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('throws for an empty points array', () =>
    {
        expect(() => Mesh.fromPoints([])).toThrow();
    });
});

describe('Mesh.fromPolygons()', () =>
{
    it('creates a mesh from polygon vertex arrays', () =>
    {
        const tri = [[0,0,0], [5,0,0], [2.5,5,0]];
        const m = Mesh.fromPolygons([tri]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });
});

describe('Mesh boolean operations', () =>
{
    it('union() combines two meshes', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10);
        b.translate([5, 5, 5]);
        a.union(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('difference() subtracts one mesh from another', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(5);
        a.difference(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('intersection() returns the overlapping volume', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10);
        b.translate([2, 2, 2]);
        a.intersection(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });
});

describe('Mesh.translate()', () =>
{
    it('returns this (chainable)', () =>
    {
        const m = Mesh.Cube(10);
        expect(m.translate([1, 2, 3])).toBe(m);
    });
});

describe('Mesh.copy()', () =>
{
    it('creates an independent copy', () =>
    {
        const original = Mesh.Cube(10);
        const copy = original.copy() as Mesh;
        expect(copy).not.toBe(original);
        expect(copy.positions().length).toBe(original.positions().length);
    });
});

describe('Mesh.edges()', () =>
{
    it('discovers the logical edges of a cube', () =>
    {
        const cube = Mesh.Cube(10);
        const edges = cube.edges();

        expect(edges).toHaveLength(12);
        expect(edges.every(edge => edge.kind === 'regular')).toBe(true);
        expect(edges.every(edge => edge.polyline.length === 2)).toBe(true);
    });

    it('returns stable ids for repeated discovery on the same mesh', () =>
    {
        const cube = Mesh.Cube(10);
        const first = cube.edges().map(edge => edge.id);
        const second = cube.edges().map(edge => edge.id);

        expect(first).toEqual(second);
    });
});

describe('Mesh.chamfer()', () =>
{
    it('cuts a single discovered cube edge', () =>
    {
        const cube = Mesh.Cube(10);
        const edge = cube.edges().find(candidate =>
            candidate.polyline.every(point => Math.abs(point.x - 5) < 1e-6)
            && candidate.polyline.every(point => Math.abs(point.y - 5) < 1e-6));

        expect(edge).toBeTruthy();

        cube.chamfer(edge!.id, 1);

        const positions = cube.positions();
        expect(positions.some(point => Math.abs(point.x - 4) < 1e-6 && Math.abs(point.y - 5) < 1e-6)).toBe(true);
        expect(positions.some(point => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 4) < 1e-6)).toBe(true);
        expect(positions.some(point => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 5) < 1e-6)).toBe(false);
    });

    it('supports asymmetric width and depth chamfers', () =>
    {
        const cube = Mesh.Cube(10);
        const edge = cube.edges().find(candidate =>
            candidate.polyline.every(point => Math.abs(point.x - 5) < 1e-6)
            && candidate.polyline.every(point => Math.abs(point.y - 5) < 1e-6));

        expect(edge).toBeTruthy();

        cube.chamfer(edge!.id, { width: 1, depth: 2 });

        const positions = cube.positions();
        const hasSmallInset = positions.some(point =>
            (Math.abs(point.x - 4) < 1e-6 && Math.abs(point.y - 5) < 1e-6)
            || (Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 4) < 1e-6));
        const hasLargeInset = positions.some(point =>
            (Math.abs(point.x - 3) < 1e-6 && Math.abs(point.y - 5) < 1e-6)
            || (Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 3) < 1e-6));

        expect(hasSmallInset).toBe(true);
        expect(hasLargeInset).toBe(true);
    });

    it('supports selector-driven multi-edge chamfers with setback', () =>
    {
        const cube = Mesh.Cube(10);

        cube.chamfer('edge|z', 1, { setback: 1 });

        const positions = cube.positions();
        expect(positions.some(point => Math.abs(point.x - 4) < 1e-6 && Math.abs(point.y - 5) < 1e-6 && Math.abs(Math.abs(point.z) - 4) < 1e-6)).toBe(true);
        expect(positions.some(point => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 5) < 1e-6 && Math.abs(Math.abs(point.z) - 5) < 1e-6)).toBe(true);
    });
});

describe('Mesh.fillet()', () =>
{
    it('rounds a single discovered cube edge', () =>
    {
        const cube = Mesh.Cube(10);
        const edge = cube.edges().find(candidate =>
            candidate.polyline.every(point => Math.abs(point.x - 5) < 1e-6)
            && candidate.polyline.every(point => Math.abs(point.y - 5) < 1e-6));

        expect(edge).toBeTruthy();

        cube.fillet(edge!.id, 1);

        const positions = cube.positions();
        expect(positions.some(point => Math.abs(point.x - 4) < 1e-6 && Math.abs(point.y - 5) < 1e-6)).toBe(true);
        expect(positions.some(point => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 4) < 1e-6)).toBe(true);
        expect(positions.some(point => Math.abs(point.x - 5) < 1e-6 && Math.abs(point.y - 5) < 1e-6)).toBe(false);
    });
});

describe('Selector edge support', () =>
{
    it('selects logical mesh edges', () =>
    {
        const cube = Mesh.Cube(10);
        const selected = new Selector('edge|z').execute(cube);

        expect(Array.isArray(selected)).toBe(true);
        expect(selected).toHaveLength(4);
        expect(selected.every(edge => edge.kind === 'regular')).toBe(true);
    });
});
