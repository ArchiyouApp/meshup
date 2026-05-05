import { beforeAll, describe, expect, it } from 'vitest';
import { initAsync, ShapeCollection } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Sketch } from '../../src/Sketch';
import { rad, save } from '../../src/utils';

const SAVE_FOLDER = './tests/outputs/booleans/';

beforeAll(async () =>
{
    await initAsync();
});

describe('Example: Booleans', () =>
{
    it('can union two overlapping cubes', async () =>
    {
        const a = Mesh.Cube(40);
        const b = Mesh.Cube(40).move(15, 10, 5);

        expect(() => a.union(b)).not.toThrow();
        expect(a.positions().length).toBeGreaterThan(0);
        expect(a.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.booleans.union.gltf`, await a.toGLTF());
    });

    it('can intersect a cube and sphere', async () =>
    {
        const a = Mesh.Cube(40).color('blue');
        const b = Mesh.Sphere(18).move(10, 10, 10).color('green');
        const c = a.copy().intersection(b);

        expect(c.positions().length).toBeGreaterThan(0);
        expect(c.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.booleans.intersection.gltf`,
            await (new ShapeCollection<Mesh>([a.opacity(0.5),b.opacity(0.5), c.color('red').moveZ(50)])).toGLTF());
    });

    it('creates a box with cylindrical and rectangular holes', async () =>
    {
        const box = Mesh.Cube(50);
        const hole = Mesh.Cylinder(10, 100);
        const subBox = Mesh.Cube(20).move(-25);

        expect(() => box.subtract(hole).subtract(subBox)).not.toThrow();
        expect(box.positions().length).toBeGreaterThan(0);
        expect(box.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.booleans.holes.gltf`, await box.toGLTF());
    });

    it('subtracts a sphere from a box corner', async () =>
    {
        const box = Mesh.Cube(50);
        const sphere = Mesh.Sphere(20).move(25, 25, 25);

        expect(() => box.subtract(sphere)).not.toThrow();
        expect(box.positions().length).toBeGreaterThan(0);
        expect(box.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.booleans.corner-sphere-subtract.gltf`, await box.toGLTF());
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

        const door = Mesh.Box(100, 50, 200).move(width / 2, 0, 100);

        expect(frontFacade).toBeTruthy();
        expect(() => frontFacade!.subtract(door)).not.toThrow();
        expect(frontFacade!.positions().length).toBeGreaterThan(0);
        expect(frontFacade!.inner().triangleCount()).toBeGreaterThan(0);

        await save(`${SAVE_FOLDER}test.booleans.house-facade.gltf`, await frontFacade!.toGLTF());
    });

    it('separateIsolated: detects disconnected components without boolean op', () =>
    {
        const mesh = Mesh.fromPolygons([
            [[0,0,0],[10,0,0],[5,10,0]],
            [[100,0,0],[110,0,0],[105,10,0]],
        ]);
        const result = mesh.separateIsolated();
        expect(result.count()).toBe(2);
        result.forEach(m => expect(m.inner().triangleCount()).toBeGreaterThan(0));
    });

    it('separateIsolated: subtract boolean produces two separate meshes', async () =>
    {
        const boxW = Mesh.Box(50, 10, 10);
        const boxV = Mesh.Box(10, 100, 10);
        const result = boxW.copy().subtract(boxV).separateIsolated();

        expect(result instanceof ShapeCollection).toBeTruthy();
        expect(result.count()).toBe(2);
        result.forEach(m =>
        {
            expect(m.positions().length).toBeGreaterThan(0);
            expect(m.inner().triangleCount()).toBeGreaterThan(0);
        });

        await save(`${SAVE_FOLDER}test.booleans.isolated.gltf`,
            await new ShapeCollection<Mesh>(result.toArray()).toGLTF());
    });
});
