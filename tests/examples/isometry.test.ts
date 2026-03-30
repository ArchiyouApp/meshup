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
        const c1 = Mesh.Cube(10);

        const boxIso = c1.isometry();
        expect(boxIso).toBeTruthy();
        expect(boxIso.length).toBe(9);
        //expect(boxIso.hidden.length).toBe(3);
        
        
        save('isometry.box.gltf', c1.isometry().toGLTF()); // OK

        
        const c2 = Mesh.Box(2)!.move(-5,-5,5);
        const sub = c1.subtract(c2);
        expect(sub).toBeTruthy();

        const iso = sub!.isometry([-1,-1,1]);

        expect(iso.length).toBe(18);

        save('isometry.sub.gltf', new Collection(
            sub.move(-20), iso).toGLTF()); // 
        

    });

});       
