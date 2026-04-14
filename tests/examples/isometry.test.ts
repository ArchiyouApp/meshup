/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection as Collection, MeshCollection } from '../../src/ShapeCollection';

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
        expect(boxIso.length).toBe(12); // all edges
        expect(boxIso.group('hidden')?.length).toBe(3);
        expect(boxIso.group('visible')?.length).toBe(9);

        // style
        boxIso.group('hidden')?.color('blue').dashed();
        boxIso.group('visible')?.color('red');

        const col = new Collection(box.move(-200), boxIso!)
        
        await save('test.isometry.box.gltf', await col.toGLTF());
        await save('test.isometry.box.svg', boxIso.toSVG());

    });

    it('can do isometric projection of boxes difference', async () =>
    {
        const bigbox = Mesh.Cube(50);
        const smallbox = Mesh.Cube(20).moveTo(bigbox.bbox().corner('leftfronttop'));
        const diff = bigbox.subtract(smallbox)!;
        const diffIso = diff.isometry();

        expect(diffIso).toBeTruthy();
        //expect(diffIso.group('hidden')?.length).toBe(9);
        //expect(diffIso.group('visible')?.length).toBe(15);

        await save('test.isometry.diff.gltf', await new Collection(
            diff.move(-bigbox.bbox().width()*2), diffIso.group('visible')!).toGLTF()); // OK

    });

    it('can do isometric projection of a Sphere', async () =>
    {
        // A lot of lines because sphere has a lot of faces with low angles between them
        const sphere = Mesh.Sphere(20);
        const sphereIso = sphere.isometry();
        expect(sphereIso).toBeTruthy();
        await save('test.isometry.sphere.gltf', await new Collection(sphere.move(-20*2), sphereIso.group('visible')!).toGLTF());
    });

    it('can do isometric projection of box with a hole', async () =>
    {
        const box = Mesh.Cube(50);
        const hole = Mesh.Cylinder(10, 100);
        const subBox = Mesh.Cube(20).move(-25);
        box.subtract(hole)
                .subtract(subBox);

        await save('test.isometry.hole.gltf',
                await new Collection(
                    box.isometry()?.group('visible')!,
                    box.move(-100)
                    ).toGLTF());

        // NOTE: some wrong edge near rectangular hole
    });


    it('isometry of a lot of boxes', async () =>
    {

        const box = Mesh.Cube(50);
        const boxes = box.grid(10, 10, 10, 60) as MeshCollection;
        
        const t = performance.now();
        const iso = boxes.isometry()?.group('visible')!;
        console.log('Created boxes grid isometry in', performance.now() - t, 'ms');

        await save('test.isometry.boxes.gltf',
                await new Collection(
                    boxes,
                    iso.move(1000),
                    ).toGLTF());

        await save('test.isometry.boxes.svg', 
                iso.toSVG());
    });
});       
