/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { Collection } from '../../src/Collection';

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Isometric projection with hidden lines', () => 
{
    it('can do basic isometric projection', async () => 
    {
        const box = Mesh.Cube(10);
        const boxIso = box.isometry();
        expect(boxIso).toBeTruthy();
        expect(boxIso.length).toBe(12); // all edges
        expect(boxIso.group('hidden')?.length).toBe(3);
        expect(boxIso.group('visible')?.length).toBe(9);
        
        await save('isometry.box.gltf', new Collection(box.move(-20), boxIso.group('visible')!).toGLTF()); // OK
    });

    it('can do isometric projection of boxes difference', () =>
    {
        const bigbox = Mesh.Cube(50);
        const smallbox = Mesh.Cube(20).moveTo(bigbox.bbox().corner('leftfronttop'));
        const diff = bigbox.subtract(smallbox)!;
        const diffIso = diff.isometry();

        expect(diffIso).toBeTruthy();
        //expect(diffIso.group('hidden')?.length).toBe(9);
        //expect(diffIso.group('visible')?.length).toBe(15);

        await save('isometry.diff.gltf', new Collection(
            diff.move(-bigbox.bbox().width()*2), diffIso.group('visible')!).toGLTF()); // OK

    });

    it('can do isometric projection of a Sphere', async () =>
    {
        // A lot of lines because sphere has a lot of faces with low angles between them
        const sphere = Mesh.Sphere(20);
        const sphereIso = sphere.isometry();
        expect(sphereIso).toBeTruthy();
        await save('isometry.sphere.gltf', new Collection(sphere.move(-20*2), sphereIso.group('visible')!).toGLTF());
    });

    it('can do isometric projection of box with a hole', async () =>
    {
        const box = Mesh.Cube(50);
        const hole = Mesh.Cylinder(10, 100);
        const subBox = Mesh.Cube(20).move(-25);
        box.subtract(hole)
                .subtract(subBox);

        await save('isometry.hole.gltf', 
                new Collection( 
                    box.isometry()?.group('visible')!,
                    box.move(-100)
                    ).toGLTF());

        // NOTE: some wrong edge near rectangular hole
    });


    it('collection of multiple objects', async () =>
    {

        const box = Mesh.Cube(50);

        const boxes = box.grid(10, 10, 10, 60) as MeshCollection;
        const t1 = performance.now();
        const merged = boxes.merge(); // <==== union = SLOW ! 2800ms ==> with merge() = 2 ms
        
        console.log('=== BBOXES GRID ===');
        //console.log(merged.bbox());
        console.log('Created merged boxes grid in', performance.now() - t1, 'ms');
        
        const t = performance.now();
        const iso = merged.isometry()?.group('visible')!;
        console.log('Created boxes grid isometry in', performance.now() - t, 'ms');

        await save('isometry.boxes.gltf', 
                new Collection( 
                    merged,
                    iso.move(1000),
                    ).toGLTF());

        

        // NOTE: some wrong edge near rectangular hole
    });
});       
