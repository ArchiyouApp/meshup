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
        const line = Curve.Line([0,0], [100,100]).color('red');
        const pline = Curve.Polyline(
            [0,0,0], [-50,0,10], [-50,50,20],[0,50,30], [0,0,40]).color('blue');
        const arc = Curve.Arc([0,0],[100,100],[200,0], 'tangent').color('green');
        const curve = Curve.Interpolated([0,0,0], [-50,-50,50], [-100,-100,10], [-150,-200,150]).color('yellow');
        const circle = Curve.Circle(20, [0,0,0], [0,0,1]).color('cyan');

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
        const c = Curve.Circle(10).color('red');
        expect(c).toBeTruthy();

        // Offsets
        const circles = c.replicate(5, (c,i) => c.offset((i+1)*2)!.color('purple'));
        expect(circles).toBeTruthy();
        expect(circles.length).toBe(5);
        
        // Boolean 
        const rect = Curve.Rect(40, 40).color('yellow')
                        .move(0,20);

        const union = c.copy().union(rect)?.moveZ(2).color('cyan');

        const unionOffset = union?.copy().offset(5)?.moveZ(5).color('yellow');
    
        const col = new CurveCollection(c, rect, circles, union!, unionOffset!);

        save('test.curves.ops.gltf', col.toGLTF());
        //save('test.curves.ops.svg', col.toSVG());
    });


});       
