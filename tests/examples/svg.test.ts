/**
 * tests/examples/curves.test.ts
 *
 */
import { beforeAll, describe, it, expect, should } from 'vitest';
import { CurveCollection, initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';
import { TOLERANCE } from '../../src/constants';

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Curves exported to SVG', () => 
{
    it('Can make a nice drawing and export it as SVG', async () =>
    {
        const circ = Curve.Circle(50).color('yellow');
        const circ2 = circ.copy().offset(20)!.color('cyan');
        const rect = Curve.Rect(50, 50).color('blue');
        const rectb = Curve.RectBetween(rect.bbox()?.max()!, [100,100])
                        .color('green');
        rectb.subtract(Curve.Circle(50, rectb.bbox()?.max()));

        const curv = Curve.Interpolated(
                rect.points()[3],
                rect.points()[3].copy().move(20,50),
                rect.points()[3].copy().move(20,80),
                rectb.bbox()!.corner('leftback')
            ).color('orange');

        const ln = Curve.Line(
                        rect.bbox()!.corner('rightfront'),
                        rectb.bbox()!.corner('rightfront'))
                        .color('red');
        
        // Export both in 3D GLTF and 2D SVG
        save('test.svg.gltf', await new CurveCollection(circ, circ2, rect, rectb, curv, ln).toGLTF());

        // NOTE: svg does fill the closed curves, but the Curves stay unfilled in 3D (not turned into polygons)
        save('test.svg.svg', new CurveCollection(circ, circ2, rect, rectb, curv, ln).toSVG());
        
    });
});
