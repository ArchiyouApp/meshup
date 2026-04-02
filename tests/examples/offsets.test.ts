/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { Collection, CurveCollection, initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';
import { TOLERANCE } from '../../src/constants';

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Offsets', () => 
{
    it('Can do simple offsets', () => 
    {
        const rect = Curve.Rect(100, 100).color('red');
        const offsets = rect.replicate(5, (c,i) => c.offset(i*10)!.moveZ((i+1)*20).color(255-i*50, 0, 0));
        expect(offsets).toBeTruthy();
        expect(offsets.length).toBe(5);

        // Save as GLTF to view in 3D 
        save('test.offsets.basic.gltf', new CurveCollection(rect, offsets).toGLTF());
    });

    it('Can do advanced offsets', () =>
    {
        const c1 = Curve.Circle(100);
        const c2 = c1.copy().move(100*1.5,0);
        const circles = c1.union(c2) as Curve;
        expect(circles.isCompound()).toBe(true);

        const circlesOffset = circles.offset(20);
    
        save('test.offsets.circles.gltf', new CurveCollection(circles!, 
            /* circles!.copy().offset(20)!.color('yellow')*/).toGLTF());
        //save('test.curves.ops.svg', new CurveCollection(circles, rect, cc, /*un!, unOffsets*/).toSVG());
    });


});       
