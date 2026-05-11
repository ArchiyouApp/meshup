import { beforeAll, describe, expect, it } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Polygon } from '../../src/Polygon';
import { PlaneJs } from '../../src/wasm/csgrs';
import { save } from '../../src/utils';

const SAVE_FOLDER = './tests/outputs/specialops/';

beforeAll(async () =>
{
    await initAsync();
});

describe('Mesh.split()', () =>
{
    it('splits a cube in half with a horizontal PlaneJs (XY plane)', async () =>
    {
        const cube = Mesh.Cube(40);
        // XY plane at z=0: normal=(0,0,1), offset=0
        const plane = PlaneJs.fromNormalComponents(0, 0, 1, 0);
        const result = cube.split(plane);

        expect(result.count()).toBe(2);
        result.forEach(m =>
        {
            expect(m.positions().length).toBeGreaterThan(0);
            expect(m.inner().triangleCount()).toBeGreaterThan(0);
        });

        result.first().color('blue');

        await save(`${SAVE_FOLDER}test.specialops.split.plane.gltf`,
            await new ShapeCollection<Mesh>(result).toGLTF());
    });

    it('splits a cube with a Polygon (face defines the cutting plane)', async () =>
    {
        // A square polygon in the XY plane at z=0
        const cuttingPoly = new Polygon([
            [-50, -50, 0], [50, -50, 0], [50, 50, 0], [-50, 50, 0],
        ]);
        const cube = Mesh.Cube(40);
        const result = cube.split(cuttingPoly);

        result.first().color('blue');

        expect(result.count()).toBe(2);
        
        result.forEach(m => expect(m.inner().triangleCount()).toBeGreaterThan(0));
        
        expect(result.first().bbox().height()).toBeCloseTo(40/2, 1);
        expect(result.first().bbox().min().z)
            .not.toBe(result.last().bbox().min().z)

        if( result.first().bbox().min().z < result.last().bbox().min().z )
            expect(result.first().bbox().min().z).toBeCloseTo(-20, 1);
        else
            expect(result.last().bbox().min().z).toBeCloseTo(-20, 1);
        
        expect(result.last().bbox().height()).toBeCloseTo(40/2, 1);

        await save(`${SAVE_FOLDER}test.specialops.split.polygon.gltf`,
            await new ShapeCollection<Mesh>(result).toGLTF());
    });

    it('splits a cube with another Mesh (intersection/difference)', async () =>
    {
        const cube = Mesh.Cube(40);
        const cutter = Mesh.Box(80, 80, 20).moveZ(10); // slab cutting through the top half
        const result = cube.copy().split(cutter);

        expect(result.count()).toBe(2);

        result.first().color('blue');
        
        result.forEach(m => expect(m.inner().triangleCount()).toBeGreaterThan(0));

        await save(`${SAVE_FOLDER}test.specialops.split.mesh.gltf`,
            await new ShapeCollection<Mesh>(
                cube.opacity(0.5), cutter.opacity(0.5), result).toGLTF());
    });

    it('returns one piece when the plane misses the mesh entirely', () =>
    {
        const cube = Mesh.Cube(10);
        // Plane far above the cube (z=100), so entire mesh is on the back side
        const plane = PlaneJs.fromNormalComponents(0, 0, 1, 100);
        const result = cube.split(plane);

        expect(result.count()).toBe(1);
    });
});

describe('Mesh.cutoffBy()', () =>
{
    it('keeps the largest piece when cut by a PlaneJs (default)', async () =>
    {
        // Tall box, cut at z=25: lower piece (height 75) is larger than upper (height 25)
        const box = Mesh.Box(20, 20, 100).moveZ(50); // z: 0..100, centred-z offset so it sits above origin
        const plane = PlaneJs.fromNormalComponents(0, 0, 1, 25);
        const result = box.copy().cutoffBy(plane);

        expect(result.positions().length).toBeGreaterThan(0);
        expect(result.inner().triangleCount()).toBeGreaterThan(0);
        // Largest piece is the lower part (height ~75)
        expect(result.bbox().height()).toBeGreaterThan(50);

        await save(`${SAVE_FOLDER}test.specialops.cutoff.plane.gltf`, await result.toGLTF());
    });

    it('keeps the smallest piece when keepSmallest=true', () =>
    {
        // Same setup — keepSmallest should return the upper part (height ~25)
        const box = Mesh.Box(20, 20, 100).moveZ(50);
        const plane = PlaneJs.fromNormalComponents(0, 0, 1, 25);
        const largest  = box.copy().cutoffBy(plane, false);
        const smallest = box.copy().cutoffBy(plane, true);

        expect(largest.bbox().height()).toBeGreaterThan(smallest.bbox().height());
    });

    it('cuts by a Mesh cutter and keeps the largest piece', async () =>
    {
        const sphere = Mesh.Sphere(20).opacity(0.5);
        const slab   = Mesh.Box(100, 100, 20).opacity(0.5); // horizontal slab cutting through equator
        const result = sphere.copy().cutoffBy(slab);

        expect(result.positions().length).toBeGreaterThan(0);
        // The two halves are equal for a centred sphere — just check a piece came out
        expect(result.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.specialops.cutoffby.mesh.gltf`, 
            await (new ShapeCollection<Mesh>(sphere, slab, result).toGLTF()));
    });

    it('warns and returns unchanged when cutter does not touch the mesh', () =>
    {
        const cube = Mesh.Cube(10).opacity(0.5); // z: -5..5
        const farBox = Mesh.Box(10, 10, 10).moveX(100).opacity(0.5); // completely separate
        const trisBefore = cube.inner().triangleCount();

        const result = cube.cutoffBy(farBox);

        expect(result.inner().triangleCount()).toBe(trisBefore);
    });
});

describe('Mesh.cutoff()', () =>
{
    it('keeps the positive-x half of a cube (default)', async () =>
    {
        const cube = Mesh.Cube(40).color('blue').opacity(0.5); // x: -20..20
        const result = cube.copy().cutoff('x', 0);

        expect(result.inner().triangleCount()).toBeGreaterThan(0);
        expect(result.bbox().min().x).toBeGreaterThanOrEqual(-0.01);
        expect(result.bbox().max().x).toBeCloseTo(20, 0);

        await save(`${SAVE_FOLDER}test.specialops.cutoff.x.gltf`, 
            await (new ShapeCollection<Mesh>(cube, result).toGLTF()));
    });

    it('keeps the negative-x half when smallest=true', () =>
    {
        const cube = Mesh.Cube(40).opacity(0.5);
        const result = cube.copy().cutoff('x', 0, true);

        expect(result.inner().triangleCount()).toBeGreaterThan(0);
        expect(result.bbox().max().x).toBeLessThanOrEqual(0.01);
        expect(result.bbox().min().x).toBeCloseTo(-20, 0);
    });

    it('keeps the positive-z half (default axis)', async () =>
    {
        const cube = Mesh.Cube(40).opacity(0.5);
        const result = cube.copy().cutoff('z', 0);

        expect(result.bbox().min().z).toBeGreaterThanOrEqual(-0.01);
        expect(result.bbox().max().z).toBeCloseTo(20, 0);

        await save(`${SAVE_FOLDER}test.specialops.cutoff.z.gltf`, 
            await (new ShapeCollection<Mesh>(cube, result).toGLTF()));
    });

    it('cuts off at a non-zero coordinate', () =>
    {
        const cube = Mesh.Cube(40).opacity(0.5); // z: -20..20
        const result = cube.copy().cutoff('z', 10); // keep z > 10

        expect(result.bbox().min().z).toBeCloseTo(-20);
        expect(result.bbox().max().z).toBeCloseTo(10, 0);
        expect(result.bbox().height()).toBeCloseTo(30, 0);
    });

    it('returns unchanged when plane misses the mesh entirely', () =>
    {
        const cube = Mesh.Cube(10).opacity(0.5); // z: -5..5
        const trisBefore = cube.inner().triangleCount();
        const result = cube.copy().cutoff('z', 100); // plane far above

        // plane misses → split returns 1 piece (the whole mesh, back side)
        expect(result.inner().triangleCount()).toBeGreaterThan(0);
        // triangle count unchanged because no cut happened
        expect(result.inner().triangleCount()).toBe(trisBefore);
    });

    it('should cut some beams', async () =>
    {
        const beam = Mesh.Box(10, 100, 5).opacity(0.5).color('blue');

        const beamR = beam.copy().rotateZ(-45).color('red');
        
        beamR.cutoff('x', 30);
        beamR.cutoff('y', -10);

        save(`${SAVE_FOLDER}test.specialops.cutoff.beam.gltf`, 
                await new ShapeCollection<Mesh>(beam, beamR).toGLTF());

        expect(beamR.bbox().min().y).toBeCloseTo(-10, 1);
        expect(beamR.bbox().max().x).toBeCloseTo(30, 1);
    });
        
});
