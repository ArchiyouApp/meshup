import { beforeAll, describe, expect, it } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Solid } from '../../src/Solid';
import { Sketch } from '../../src/Sketch';
import { rad, save } from '../../src/utils';
import { outputDir } from '../helpers/outputs';

const OUTPUT_DIR = outputDir(import.meta.url);

beforeAll(async () =>
{
    await initAsync();
});

describe('Example: Booleans', () =>
{
    it('can union two overlapping cubes', async () =>
    {
        const a = Solid.Cube(40);
        const b = Solid.Cube(40).move(15, 10, 5);

        expect(() => a.union(b)).not.toThrow();
        expect(a.positions().length).toBeGreaterThan(0);
        expect(a.inner().triangleCount()).toBeGreaterThan(0);

        await save(OUTPUT_DIR + 'test.booleans.union.gltf', await a.toGLTF());
    });

    it('can intersect a cube and sphere', async () =>
    {
        const a = Solid.Cube(40).color('blue');
        const b = Solid.Sphere(18).move(10, 10, 10).color('green');
        const c = a.copy().intersection(b);

        expect(c.positions().length).toBeGreaterThan(0);
        expect(c.inner().triangleCount()).toBeGreaterThan(0);

        await save(OUTPUT_DIR + 'test.booleans.intersection.gltf', 
            await (new ShapeCollection<Solid>([a.opacity(0.5),b.opacity(0.5), c.color('red').moveZ(50)])).toGLTF());
    });

    it('creates a box with cylindrical and rectangular holes', async () =>
    {
        const box = Solid.Cube(50);
        const hole = Solid.Cylinder(10, 100);
        const subBox = Solid.Cube(20).move(-25);

        expect(() => box.subtract(hole).subtract(subBox)).not.toThrow();
        expect(box.positions().length).toBeGreaterThan(0);
        expect(box.inner().triangleCount()).toBeGreaterThan(0);

        await save(OUTPUT_DIR + 'test.booleans.holes.gltf', await box.toGLTF());
    });

    it('keeps subtracted holes after a move (hole rings transform too)', async () =>
    {
        // Regression: a face's interior hole rings are stored separately from
        // the outer ring. Solid.transform() must move them too, otherwise the
        // hole geometry is left behind and the hole vanishes after a move.
        const box = Solid.Box(100, 10, 100);
        const hole = Solid.Cylinder(10, 50).rotateX(90);
        box.subtract(hole);

        const volAfterSubtract = box.volume();
        const trisAfterSubtract = box.inner().triangleCount();
        expect(volAfterSubtract).toBeLessThan(100 * 10 * 100); // hole removed material

        box.move(100, 0, 0);

        // A pure translation must not change volume or topology.
        expect(box.volume()).toBeCloseTo(volAfterSubtract!, 1);
        expect(box.inner().triangleCount()).toBe(trisAfterSubtract);

        await save(OUTPUT_DIR + 'test.booleans.hole-after-move.gltf', await box.toGLTF());
    });

    it('subtracts a sphere from a box corner', async () =>
    {
        const box = Solid.Cube(50);
        const sphere = Solid.Sphere(20).move(25, 25, 25);

        expect(() => box.subtract(sphere)).not.toThrow();
        expect(box.positions().length).toBeGreaterThan(0);
        expect(box.inner().triangleCount()).toBeGreaterThan(0);

        await save(OUTPUT_DIR + 'test.booleans.corner-sphere-subtract.gltf', await box.toGLTF());
    });

    it('creates a house facade polyline extrusion', async () =>
    {
        const width = 400;
        const height = 300;
        const roofAngle = 45;
        const thickness = 20;
        const roofLinePoints = [
            [width / 2, height + Math.round(Math.tan(rad(roofAngle)) * width / 2)],
            [width, height],
        ];

        const frontFacade = new Sketch('xz')
            .lineTo(0, height)
            .polyline(roofLinePoints)
            .lineTo(width, 0)
            .close()
            .extrude(-thickness);

        const door = Solid.Box(100, 50, 200).move(width / 2, 0, 100);

        expect(frontFacade).toBeTruthy();
        expect(() => frontFacade!.subtract(door)).not.toThrow();
        expect(frontFacade!.positions().length).toBeGreaterThan(0);
        expect(frontFacade!.inner().triangleCount()).toBeGreaterThan(0);

        await save(OUTPUT_DIR + 'test.booleans.house-facade.gltf', await frontFacade!.toGLTF());
    });

    it('separateIsolated: detects disconnected components without boolean op', () =>
    {
        const mesh = Solid.fromPolygons([
            [[0,0,0],[10,0,0],[5,10,0]],
            [[100,0,0],[110,0,0],[105,10,0]],
        ]);
        const result = mesh.separateIsolated();
        expect(result.count()).toBe(2);
        result.forEach(m => expect(m.inner().triangleCount()).toBeGreaterThan(0));
    });

    it('separateIsolated: subtract boolean produces two separate meshes', async () =>
    {
        const boxW = Solid.Box(50, 10, 10);
        const boxV = Solid.Box(10, 100, 10);
        const result = boxW.copy().subtract(boxV).separateIsolated();

        expect(result instanceof ShapeCollection).toBeTruthy();
        expect(result.count()).toBe(2);
        result.forEach(m =>
        {
            expect(m.positions().length).toBeGreaterThan(0);
            expect(m.inner().triangleCount()).toBeGreaterThan(0);
        });

        await save(`${OUTPUT_DIR}test.booleans.isolated.gltf`,
            await new ShapeCollection<Solid>(result.toArray()).toGLTF());
    });
});
