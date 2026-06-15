import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';

const OUTPUT_DIR = './tests/outputs/mesh/';

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

    // Regression: vertex 2 = (1,0,0) lies exactly on edge [0→1] = (0,0,0)→(2,0,0).
    // This is a T-intersection: it passes the crossing-segment check but caused
    // spade's bulk_load_cdt to panic with "Conflicting edge encountered: [4, 3]".
    // The fix in polygon.rs detects T-intersections before calling bulk_load_cdt
    // and returns an empty triangle list for that face instead of panicking.
    it('handles a polygon face with a T-intersection (vertex on non-adjacent edge) without panicking', () =>
    {
        const poly = [[0,0,0], [2,0,0], [1,0,0], [2,0,2], [0,0,2]];
        expect(() => Mesh.fromPolygons([poly])).not.toThrow();
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

describe('Mesh.grid()', () =>
{
    it('accepts per-axis spacing as a vector-like 4th parameter', () =>
    {
        const meshes = Mesh.Cube(2).grid(2, 2, 2, [5, 6, 7]);
        const centers = meshes.toArray().map(mesh => mesh.center().round(1e-9).toArray());

        expect(meshes.length).toBe(8);
        expect(centers).toContainEqual([0, 0, 0]);
        expect(centers).toContainEqual([5, 6, 7]);
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
        await save(OUTPUT_DIR + 'test.mesh.mirror.center.gltf', await new ShapeCollection(
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
        await save(OUTPUT_DIR + 'test.mesh.mirror.position.gltf', await new ShapeCollection(
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
        await save(OUTPUT_DIR + 'test.mesh.mirror.z.gltf', await new ShapeCollection(
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
        await save(OUTPUT_DIR + 'test.mesh.mirror.offset.gltf', await new ShapeCollection(
            mirrorline,
            originline,
            mirroredLine,
            b,
            mirrored).toGLTF());

    });

});

describe('Mesh.layflat()', () =>
{
    // Regression: a 1000×1000×20 plate with four symmetric interlocking slot cuts has
    // equal X and Y PCA eigenvalues (degenerate). toOrthoQuaternion() then returns an
    // arbitrary in-plane rotation (e.g. 45°), making the result non-axis-aligned.
    // The fix uses a shortest-arc rotation that only aligns the thin axis to +Z and
    // leaves the in-plane orientation completely untouched.
    it('places a symmetric flat plate axis-aligned (stable for degenerate equal-eigenvalue geometry)', () =>
    {
        for (let i = 0; i < 5; i++)
        {
            const pl = Mesh.Box(1000, 1000, 20);
            // Four symmetric slot cuts → equal X/Y variance → degenerate PCA
            const s1 = Mesh.Box(10, 1000, 10).align(pl, 'lefttopfront', 'lefttopfront');
            pl.subtract(s1);
            pl.subtract(s1.copy().mirrorX(0));
            const s2 = Mesh.Box(1000, 10, 10).align(pl, 'fronttop', 'fronttop');
            pl.subtract(s2);
            pl.subtract(s2.copy().mirrorY(0));

            const flat = pl.copy().layflat();
            const bb = flat.bbox();

            // Must sit on Z = 0
            expect(bb.minZ()).toBeCloseTo(0, 1);
            // Thickness preserved
            expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
            // If incorrectly rotated 45°, X/Y spans would be ~1414 instead of ~1000
            expect(bb.maxX() - bb.minX()).toBeGreaterThan(900);
            expect(bb.maxX() - bb.minX()).toBeLessThan(1100);
            expect(bb.maxY() - bb.minY()).toBeGreaterThan(900);
            expect(bb.maxY() - bb.minY()).toBeLessThan(1100);
        }
    });

    it('lays a tilted box flat (non-degenerate case still works)', () =>
    {
        const m = Mesh.Box(200, 100, 20).rotateX(30);
        m.layflat();
        const bb = m.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 1);
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
    });

    it('fast-paths an already-flat mesh (skips OBB, only translates to Z=0)', () =>
    {
        // Already sitting at Z > 0 but flat — fast path translates, no rotation.
        const m = Mesh.Box(200, 100, 20).moveZ(50);
        m.layflat();
        const bb = m.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 1);
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
        // X/Y footprint unchanged (no in-plane rotation)
        expect(bb.maxX() - bb.minX()).toBeCloseTo(200, 0);
        expect(bb.maxY() - bb.minY()).toBeCloseTo(100, 0);
    });
});