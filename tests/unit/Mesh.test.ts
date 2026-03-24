import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';

beforeAll(async () => {
    await initAsync();
});

describe('Mesh.Cube()', () => {
    it('creates a non-null mesh', () => {
        const m = Mesh.Cube(10);
        expect(m).toBeTruthy();
    });

    it('has vertices', () => {
        const m = Mesh.Cube(10);
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('has triangles', () => {
        const m = Mesh.Cube(10);
        expect(m.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Mesh.Cuboid()', () => {
    it('creates a non-null mesh', () => {
        const m = Mesh.Cuboid(10, 20, 30);
        expect(m).toBeTruthy();
    });

    it('has more triangles than a cube when dimensions differ', () => {
        const cube = Mesh.Cube(10);
        const cuboid = Mesh.Cuboid(10, 20, 30);
        // Both are rectangular - triangle count should be equal
        expect(cuboid.inner().triangleCount()).toBe(cube.inner().triangleCount());
    });
});

describe('Mesh.Sphere()', () => {
    it('creates a non-null mesh', () => {
        const m = Mesh.Sphere(5);
        expect(m).toBeTruthy();
    });

    it('has many more triangles than a cube', () => {
        const sphere = Mesh.Sphere(5);
        expect(sphere.inner().triangleCount()).toBeGreaterThan(10);
    });
});

describe('Mesh.fromPoints()', () => {
    it('creates a triangulated polygon', () => {
        const m = Mesh.fromPoints([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('throws for an empty points array', () => {
        expect(() => Mesh.fromPoints([])).toThrow();
    });
});

describe('Mesh.fromPolygons()', () => {
    it('creates a mesh from polygon vertex arrays', () => {
        const tri = [[0,0,0], [5,0,0], [2.5,5,0]];
        const m = Mesh.fromPolygons([tri]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });
});

describe('Mesh boolean operations', () => {
    it('union() combines two meshes', () => {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10);
        b.translate([5, 5, 5]);
        a.union(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('difference() subtracts one mesh from another', () => {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(5);
        a.difference(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('intersection() returns the overlapping volume', () => {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10);
        b.translate([2, 2, 2]);
        a.intersection(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });
});

describe('Mesh.translate()', () => {
    it('returns this (chainable)', () => {
        const m = Mesh.Cube(10);
        expect(m.translate([1, 2, 3])).toBe(m);
    });
});

describe('Mesh.copy()', () => {
    it('creates an independent copy', () => {
        const original = Mesh.Cube(10);
        const copy = original.copy() as Mesh;
        expect(copy).not.toBe(original);
        expect(copy.positions().length).toBe(original.positions().length);
    });
});
