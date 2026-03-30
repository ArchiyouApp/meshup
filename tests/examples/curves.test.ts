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

describe('Example: Curves', () => 
{
    it('Can create basic curves', () => 
    {
        const line = Curve.Line([0,0], [100,100]);
        const pline = Curve.Polyline(
            [0,0,0], [-50,0,10], [-50,50,20],[0,50,30], [0,0,40]);
        const arc = Curve.Arc([0,0],[100,100],[200,0], 'tangent');
        const curve = Curve.Interpolated([0,0,0], [-50,-50,50], [-100,-100,10], [-150,-200,150]);
        const circle = Curve.Circle(20, [0,0,0], [0,0,1]);

        expect(line).toBeTruthy();
        expect(line.length()).toBeCloseTo(line.end().toVector().length());
        expect(arc).toBeTruthy();
        expect(pline).toBeTruthy();
        expect(curve).toBeTruthy();
        expect(circle).toBeTruthy();

        // Save as GLTF to view in 3D 
        save('test.curves.basic.gltf', new CurveCollection(line, circle, pline, arc, curve).toGLTF());

    });

    it('Can do operations on curves', () =>
    {
        const c = Curve.Circle(10);
        expect(c).toBeTruthy();

        const circles = c.replicate(5, (c,i) => c.offset(i*10)!);
        expect(circles).toBeTruthy();
        expect(circles.length).toBe(5);

        const rect = Curve.RectBetween([150,0], [300,100]).moveY(-50);
        expect(rect).toBeTruthy();
        const cc = c.copy().move(300,0); // center exactly on rect edge — tests degenerate boolean handling
        expect(cc).toBeTruthy();

        
        const sub = cc.copy().subtract(rect)?.moveY(-150);
        expect(sub).toBeTruthy();

        const un = cc.copy().union(rect)?.moveY(-150);
        expect(un).toBeTruthy();

        /*
        // NOT WORKING
        const unOffsets = (un as Curve).replicate(3, (c,i) => c.offset((i+1)*10)?.moveZ(i*10)!);
        expect(unOffsets).toBeTruthy();
        expect(unOffsets.length).toBe(3);
        */

        save('test.curves.ops.gltf', new CurveCollection(circles, rect, cc, un!, sub!.moveZ(10)).toGLTF());
        //save('test.curves.ops.svg', new CurveCollection(circles, rect, cc, /*un!, unOffsets*/).toSVG());
    });


});       
