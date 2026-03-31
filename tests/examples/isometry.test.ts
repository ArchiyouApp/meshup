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
    it('can do basic isometric projection', () => 
    {
        const box = Mesh.Cube(10);
        const boxIso = box.isometry();
        expect(boxIso).toBeTruthy();
        expect(boxIso.length).toBe(12); // all edges
        expect(boxIso.group('hidden')?.length).toBe(3);
        expect(boxIso.group('visible')?.length).toBe(9);
        
        save('isometry.box.gltf', new Collection(box.move(-20), boxIso.group('visible')!).toGLTF()); // OK
    });

    it('can do isometric projection of boxes difference', () =>
    {
        const bigbox = Mesh.Cube(50);
        const smallbox = Mesh.Cube(20).moveTo(bigbox.bbox().corner('leftfronttop'));
        const diff = bigbox.subtract(smallbox)!;
        const diffIso = diff.isometry([-1,-1,1]);

        expect(diffIso).toBeTruthy();
        //expect(diffIso.group('hidden')?.length).toBe(9);
        //expect(diffIso.group('visible')?.length).toBe(15);

        save('isometry.diff.gltf', new Collection(
            diff.move(-bigbox.bbox().width()*2), diffIso.group('visible')!).toGLTF()); // OK

    });

});       
