/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { Curve, initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection as Collection, MeshCollection } from '../../src/ShapeCollection';

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Aligning Shapes', async () => 
{
    it('Can align boxes by points', async () => 
    {
        const box = Mesh.BoxBetween([0,0,0],[50, 20, 30]).color('blue');
        const line = Curve.Line([0, 0, 0], [100, 50, 50]).color('gray');
        const aligned = box.copy()!.alignByPoints([[0, 0, 0], [50,0,0]], [line.start(), line.end()])
                        .color('red');
        const alignedScaled = box.copy()!
                        .alignByPoints([[0, 0, 0], [100,0,0]], [line.start(), line.end()], true)
                        .color('red')
                        .opacity(0.5);
        
        await save('test.alignments.bypoints.gltf',
            await new Collection(box, line, aligned, alignedScaled).toGLTF()); // OK
    });

});       
