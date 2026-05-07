/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { Curve, initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection  } from '../../src/ShapeCollection';

// from project dir
const OUTPUT_DIR = './tests/outputs/alignments/';

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
        
        await save(OUTPUT_DIR + 'test.alignments.bypoints.gltf',
            await new ShapeCollection(box, line, aligned, alignedScaled).toGLTF()); // OK
    });

});       
