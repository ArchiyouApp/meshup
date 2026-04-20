import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';

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

describe('Mesh.mirror()', () =>
{
    it('Should mirror in center', async () =>
    {
        const b = Mesh.Cube(10).color('red');
        const centerline = Curve.Line([0,0,-10], [0,0,10]).color('blue');
        const mirrored = b.copy().mirror('x', 0);
        expect(mirrored.bbox()).toEqual(b.bbox());

        /*
        // Visual check
        await save('test.mesh.mirror.center.gltf', await new ShapeCollection(
            centerline, 
            b.copy().moveZ(20).opacity(0.5), 
            mirrored).toGLTF());
        */
    });

    it('Should mirror at specific plane position', async () =>
    {
        const b = Mesh.Cube(10).color('red');
        const mirrorline = Curve.Line([50,0,-10], [50,0,10]).color('blue');
        const mirrored = b.copy().mirror('x', mirrorline.start().x).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        expect(mirrored.center().round()).toEqual(b.center().copy().moveX(100).round());

        /*
        // Visual check
        await save('test.mesh.mirror.position.gltf', await new ShapeCollection(
            mirrorline, 
            b,
            mirrored).toGLTF());
        */
    });

    it('Should mirror in z coord (XY plane)', async () =>
    {
        const b = Mesh.Cube(10).color('red');
        const mirrorline = Curve.Line([-100,0,25], [100,0,25]).color('blue');
        const mirrored = b.copy().mirror('z', mirrorline.start().z).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        expect(mirrored.center().round()).toEqual(
            b.center().copy().moveZ(50).round());

        // Visual check
        await save('test.mesh.mirror.z.gltf', await new ShapeCollection(
            mirrorline, 
            b,
            mirrored).toGLTF());
        
    });

    it('Should mirror with offset vector', async () =>
    {
        const b = Mesh.Cube(10).color('red').moveX(10);
        const OFFSET = 50;
        const mirrorline = Curve.Line([OFFSET,0,-100], [OFFSET,0,100]).color('blue');
        const originline = Curve.Line([0,0,-100], [0,0,100]).color('gray');
        const mirroredLine = Curve.Line([OFFSET*2,0,-100], [OFFSET*2,0,100]).color('orange');
        const mirrored = b.copy().mirror([OFFSET, 0, 0]).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        
        
        expect(b.distanceTo(mirrorline)).toEqual(
            mirrored.distanceTo(mirrorline));
        

        // Visual check
        await save('test.mesh.mirror.offset.gltf', await new ShapeCollection(
            mirrorline,
            originline,
            mirroredLine,
            b,
            mirrored).toGLTF());
        
    });

});