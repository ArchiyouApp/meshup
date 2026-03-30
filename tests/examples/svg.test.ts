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

describe('Example: Curves exported to SVG', () => 
{
    it('Can make a nice drawing and export it as SVG', () => 
    {
        const circ = Curve.Circle(50);
        const rect = Curve.Rect(100, 100);
        const rectb = Curve.RectBetween(rect.bbox()?.max()!, [200,200]);
        const sub = rectb.copy().move(rectb.bbox()?.width()!/2, rectb.bbox()?.depth()!/2, 0);
        const subr = rectb.subtract(sub); // BUG: union returns

        save('test.svg.gltf', new CurveCollection(circ, rect, rectb.moveZ(10), sub!.moveZ(20), subr!).toGLTF());
        save('test.curves.svg.svg', new CurveCollection(circ, rect, rectb, subr!).toSVG());
        
    });
});
