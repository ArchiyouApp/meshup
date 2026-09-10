import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';

beforeAll(async () =>
{
    await initAsync();
});

/** Count control points that repeat the previous one — the duplicates a boolean can emit
 *  and that `vertices()`/`segments()` both hide. */
function duplicatePairs(c: Curve): number
{
    const cps = c.controlPoints();
    let n = 0;
    for (let i = 1; i < cps.length; i++) { if (cps[i - 1].distance(cps[i]) < 1e-7) { n++; } }
    return n;
}

/** The URBENT connector: the overlap of a roof diagonal and its brace. Reduced from the
 *  ur_bent script, whose intersection() result offset to 6-8 vertices instead of 4 because
 *  the boolean handed back a segment standing for a single point. */
function bentConnector(beamWidth: number): Curve | null
{
    const SPAN = 5436, HEIGHT = 3087, RIDGE = 0.25;
    const WALL_TOP = 2263, WALL_HEIGHT = 2000, BLOCKING_INSET = 30;

    const slopeRatio = HEIGHT / ((1 - RIDGE) * SPAN);
    const leftSlope = RIDGE * SPAN * slopeRatio;
    const rightSlope = (1 - RIDGE) * SPAN * slopeRatio;
    const startHeight = HEIGHT - leftSlope;

    const roofLine = Curve.Polyline(
        [0, 0, startHeight],
        [SPAN * RIDGE, 0, startHeight + leftSlope],
        [SPAN, 0, startHeight + leftSlope - rightSlope]).translate(0, 0, WALL_TOP);

    const roofLeft = roofLine.edges().first() as Curve;
    const wallLeft = Curve.Line([0, 0, 0], roofLine.start());
    const centre = Curve.Line([RIDGE * SPAN, 0, 0], [RIDGE * SPAN, 0, WALL_HEIGHT + HEIGHT + 500]);

    // cutoffBy() is typed Curve | ShapeCollection | null; every cut here splits a line in
    // two and keeps one piece, so a single Curve comes back. `single()` states that, and
    // fails loudly in the test rather than propagating a null.
    const single = (c: Curve | ShapeCollection<Curve> | null, what: string): Curve =>
    {
        const one = (c instanceof ShapeCollection) ? c.checkSingle() : c;
        if (!(one instanceof Curve)) { throw new Error(`bentConnector: ${what} is not a single Curve`); }
        return one;
    };

    const byLength = roofLeft.pointAtLength(1000);
    const byPerc = roofLeft.pointAtPerc(0.33);
    const from = roofLeft.start();
    if (!byLength || !byPerc) { throw new Error('bentConnector: brace end point is null'); }
    const braceEnd = (byLength.distance(from) > byPerc.distance(from)) ? byPerc : byLength;
    const braceLine = Curve.Line(roofLeft.start().copy().translate(0, 0, -1000), braceEnd);

    const diagonal = single(roofLeft.copy()
        .move(roofLeft.direction().normalize().rotateY(90).scale(beamWidth))
        .cutoffBy(centre), 'diagonal').extendTo(wallLeft).connect(roofLeft);

    const blocking = single(roofLeft.copy()
        .move(roofLeft.direction().normalize().rotateY(90).scale(BLOCKING_INSET))
        .extendTo(wallLeft).cutoffBy(centre), 'blocking');

    const braceCut = () => single(braceLine.copy().cutoffBy(blocking), 'braceCut');
    const braceOffset = braceCut().offset(beamWidth);
    if (!braceOffset) { throw new Error('bentConnector: brace offset failed'); }
    const brace = braceOffset
        .extendTo(blocking).extendTo(wallLeft)
        .connect(braceCut());

    const inter = diagonal.intersection(brace);
    const one = (inter instanceof ShapeCollection) ? inter.checkSingle() : inter;
    return (one instanceof Curve) ? one : null;
}

describe('offset of curves carrying degenerate segments', () =>
{
    it('boolean output carries no duplicate control points', () =>
    {
        for (const beamWidth of [100, 120, 150, 175, 200, 225, 250])
        {
            const connector = bentConnector(beamWidth);
            expect(connector, `beamWidth ${beamWidth}`).toBeTruthy();
            expect(duplicatePairs(connector as Curve), `beamWidth ${beamWidth}`).toBe(0);
        }
    });

    it('offsetting a boolean result preserves the corner count', () =>
    {
        // Every one of these offset to 6, 7 or 8 vertices before the fix.
        for (const beamWidth of [100, 120, 150, 175, 200, 225, 250])
        {
            const connector = bentConnector(beamWidth) as Curve;
            expect(connector.vertices().length, `beamWidth ${beamWidth}`).toBe(4);

            for (const distance of [10, -30])
            {
                const offset = connector.copy().offset(distance);
                expect(offset, `beamWidth ${beamWidth} offset ${distance}`).toBeTruthy();
                expect((offset as Curve).vertices().length,
                    `beamWidth ${beamWidth} offset ${distance}`).toBe(4);
                // and no arcs: a mitred quad stays all-line
                expect((offset as Curve).segments().toArray()
                    .every((s: any) => s.isStraight()),
                    `beamWidth ${beamWidth} offset ${distance} has arc joins`).toBe(true);
            }
        }
    });

    it('a coincident control point never survives construction', () =>
    {
        // Why the offset guard has no TypeScript-level test: the builders drop a repeated
        // point on the way in, so a degenerate segment cannot be authored from here. The
        // boolean was the one source that produced them, and it is normalised now. The guard
        // in offset_segments_left is defence in depth and is covered by the Rust unit tests
        // in hcurve.rs, which can build the segment list directly.
        const withDuplicate = Curve.Polyline(
            [0, 0, 0], [400, 0, 0], [400, 0, 0], [400, 0, 200], [0, 0, 200], [0, 0, 0]);
        expect(duplicatePairs(withDuplicate)).toBe(0);
        expect(withDuplicate.vertices().length).toBe(4);
    });

    it('a full circle is not mistaken for a degenerate segment', () =>
    {
        // A circle's arcs have coincident endpoints; a chord test that ignored segment kind
        // would delete every circle in the library.
        const circle = Curve.Circle(50);
        const grown = circle.copy().offset(10);
        expect(grown).toBeTruthy();
        expect((grown as Curve).isClosed()).toBe(true);
        // radius 50 + 10: circumference 2*pi*60
        expect((grown as Curve).length()).toBeCloseTo(2 * Math.PI * 60, 3);
    });

    it('sharp keeps a sharp corner a point; round and smooth do not', () =>
    {
        // A 20-degree corner: well under the ~29 degree spike limit that used to apply to
        // every offset whatever the caller asked for.
        const a = (20 * Math.PI) / 180;
        const sharpQuad = () => Curve.Polyline(
            [0, 0, 0], [400, 0, 0],
            [400 + 200 * Math.cos(a), 0, 200 * Math.sin(a)],
            [200 * Math.cos(a), 0, 200 * Math.sin(a)], [0, 0, 0]);

        // 'sharp' is the default and now means what it says: four corners in, four out.
        const sharp = sharpQuad().offset(10) as Curve;
        expect(sharp.vertices().length).toBe(4);
        expect(sharp.segments().toArray().every((s: any) => s.isStraight())).toBe(true);

        const explicit = sharpQuad().offset(10, 'sharp') as Curve;
        expect(explicit.vertices().length).toBe(4);

        // 'smooth' is the old behaviour: the two acute corners become arcs.
        const smooth = sharpQuad().offset(10, 'smooth') as Curve;
        expect(smooth.vertices().length).toBe(6);
        expect(smooth.segments().toArray().filter((s: any) => !s.isStraight()).length).toBe(2);

        // 'round' arcs every corner, including the two obtuse ones a miter would handle.
        const round = sharpQuad().offset(10, 'round') as Curve;
        expect(round.vertices().length).toBe(8);
        expect(round.segments().toArray().filter((s: any) => !s.isStraight()).length).toBe(4);
    });

    it('a right-angled rect is unaffected by corner type', () =>
    {
        // No corner here is anywhere near a spike, so sharp and smooth must agree; only
        // 'round' should differ.
        for (const corner of ['sharp', 'smooth'] as const)
        {
            const r = Curve.Rect(400, 200, [0, 0, 0], 'xy').offset(10, corner) as Curve;
            expect(r.vertices().length, corner).toBe(4);
            expect(r.segments().toArray().every((s: any) => s.isStraight()), corner).toBe(true);
        }
        const rounded = Curve.Rect(400, 200, [0, 0, 0], 'xy').offset(10, 'round') as Curve;
        expect(rounded.vertices().length).toBe(8);
    });

    it('the bent connector stays sharp by default', () =>
    {
        // The shape this whole fix exists for: shallow-angle beam overlap, offset inward for
        // a connector plate. Its corners must be points, not fillets.
        const connector = bentConnector(150) as Curve;
        const inset = connector.copy().offset(-30) as Curve;
        expect(inset.vertices().length).toBe(4);
        expect(inset.segments().toArray().every((s: any) => s.isStraight())).toBe(true);
    });
});
