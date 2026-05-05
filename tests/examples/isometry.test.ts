import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection as Collection, MeshCollection } from '../../src/ShapeCollection';

const SAVE_FOLDER = './tests/outputs/isometry/';

beforeAll(async () =>
{
    await initAsync();
});

describe('Example: Isometric projection with hidden lines', async () =>
{
    it('can do basic isometric projection', async () =>
    {
        const box = Mesh.Cube(100);
        const boxIso = box.isometry();
        expect(boxIso).toBeTruthy();
        expect(boxIso.length).toBe(12);
        expect(boxIso.group('hidden')?.length).toBe(3);
        expect(boxIso.group('visible')?.length).toBe(9);

        boxIso.group('hidden')?.color('blue').dashed();
        boxIso.group('visible')?.color('red');

        const col = new Collection(box.move(-200), boxIso!);

        await save(`${SAVE_FOLDER}test.isometry.box.gltf`, await col.toGLTF());
        await save(`${SAVE_FOLDER}test.isometry.box.svg`, boxIso.toSVG());
    });

    it('can do isometric projection of boxes difference', async () =>
    {
        const bigbox = Mesh.Cube(50);
        const smallbox = Mesh.Cube(20).moveTo(bigbox.bbox().corner('leftfronttop'));
        const diff = bigbox.subtract(smallbox)!;
        const diffIso = diff.isometry();

        expect(diffIso).toBeTruthy();

        await save(`${SAVE_FOLDER}test.isometry.diff.gltf`,
            await new Collection(diff.move(-bigbox.bbox().width()*2), diffIso.group('visible')!).toGLTF());
    });

    it('can do isometric projection of a Sphere', async () =>
    {
        const sphere = Mesh.Sphere(20);
        const sphereIso = sphere.isometry();
        expect(sphereIso).toBeTruthy();
        await save(`${SAVE_FOLDER}test.isometry.sphere.gltf`,
            await new Collection(sphere.move(-20*2), sphereIso.group('visible')!).toGLTF());
    });

    it('can do isometric projection of box with a hole', async () =>
    {
        const box = Mesh.Cube(50);
        const hole = Mesh.Cylinder(10, 100);
        const subBox = Mesh.Cube(20).move(-25);
        box.subtract(hole).subtract(subBox);

        await save(`${SAVE_FOLDER}test.isometry.hole.gltf`,
            await new Collection(
                box.isometry()?.group('visible')!,
                box.move(-100)
            ).toGLTF());
    });

    it('isometry of a lot of boxes', async () =>
    {
        const box = Mesh.Cube(50);
        const boxes = box.grid(10, 10, 10, 60) as MeshCollection;

        const t = performance.now();
        const iso = boxes.isometry()?.group('visible')!;
        console.log('Created boxes grid isometry in', performance.now() - t, 'ms');

        await save(`${SAVE_FOLDER}test.isometry.boxes.gltf`,
            await new Collection(boxes, iso.move(1000)).toGLTF());

        await save(`${SAVE_FOLDER}test.isometry.boxes.svg`, iso.toSVG());
    });
});
