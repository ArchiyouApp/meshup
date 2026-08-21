/** ShapeCollection.toSVG() reads its extents off the geometry, not off a second render.
 *
 *  It used to serialize every curve to a COMPLETE SVG document with Curve.toSVG() purely to
 *  regex the viewBox back out of it — a whole extra pass over the drawing per curve, thrown
 *  away. It also stood in the way of a Shape drawing itself through a collection: that would
 *  have recursed.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

const rect = (w: number, h: number) => Curve.Rect ? Curve.Rect(w, h) : null;

describe('ShapeCollection.toSVG extents', () =>
{
    it('does not render each curve to its own SVG document', () =>
    {
        const col = new ShapeCollection(
            Curve.Line([0, 0, 0], [100, 0, 0]),
            Curve.Line([100, 0, 0], [100, 50, 0]),
        );

        const orig = (Curve.prototype as any).toSVG;
        let perCurveRenders = 0;
        (Curve.prototype as any).toSVG = function (...args: Array<any>) { perCurveRenders++; return orig.apply(this, args) };

        try { col.toSVG() }
        finally { (Curve.prototype as any).toSVG = orig }

        expect(perCurveRenders).toBe(0);
    });

    it('frames the drawing around all of its curves', () =>
    {
        const col = new ShapeCollection(
            Curve.Line([0, 0, 0], [100, 0, 0]),
            Curve.Line([0, 0, 0], [0, 50, 0]),
        );

        const vb = col.toSVG().match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);

        /*  y is flipped for SVG. Each curve is padded by 5% of ITS OWN longest side before
            the union — so the horizontal 100-long curve contributes 5 and the vertical
            50-long one 2.5, and the frame is lopsided. That is the historical behaviour, kept
            here deliberately: padding is a property of the document, and it moves to the
            assembler (where it becomes one number for the whole drawing) in the next step. */
        expect(vb[0]).toBeCloseTo(-5, 4);       // minX: 0 - 5 (from the long curve)
        expect(vb[1]).toBeCloseTo(-52.5, 4);    // minY: -50 - 2.5 (from the short one)
        expect(vb[2]).toBeCloseTo(110, 4);      // -5 … 105
        expect(vb[3]).toBeCloseTo(57.5, 4);     // -52.5 … 5
    });
});
