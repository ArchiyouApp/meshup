import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, getCsgrs, ShapeCollection } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Point } from '../../src/Point';

beforeAll(async () =>
{
    await initAsync();
});

/** Distance from a point to the infinite line through `a` and `b`. */
const distanceToLine = (p: Point, a: Point, b: Point): number =>
{
    const ab = b.toVector().subtract(a.toVector());
    const ap = p.toVector().subtract(a.toVector());
    return ap.cross(ab).length() / ab.length();
};

const single = (c: any): Curve => (c instanceof ShapeCollection) ? c.checkSingle() as Curve : c as Curve;

/**
 *  The URBENT bent from the ur_bent script, built the way the script builds it: a post standing
 *  on the wall line, and a brace that is trimmed, offset and then extended back onto that same
 *  wall line. Cutting the post by the brace is the operation this whole file is about — the two
 *  are MEANT to share the wall line exactly, and everything hinges on whether they do.
 */
function bent(beamWidth: number, braceEnd: 'perc'|'length')
{
    const SPAN = 5436, HEIGHT = 3087, RIDGE = 0.25;
    const WALL_TOP = 2263, WALL_HEIGHT = 2000, BLOCKING_INSET = 30;
    const slopeRatio = HEIGHT / ((1 - RIDGE) * SPAN);
    const leftSlope = RIDGE * SPAN * slopeRatio;
    const startHeight = HEIGHT - leftSlope;

    const roofLine = Curve.Polyline(
        [0, 0, startHeight],
        [SPAN * RIDGE, 0, startHeight + leftSlope],
        [SPAN, 0, startHeight + leftSlope - (1 - RIDGE) * SPAN * slopeRatio])
        .translate(0, 0, WALL_TOP);
    const roofLeft = roofLine.edges().first() as Curve;
    const wallLeft = Curve.Line([0, 0, 0], roofLine.start());
    const centre = Curve.Line([RIDGE * SPAN, 0, 0], [RIDGE * SPAN, 0, WALL_HEIGHT + HEIGHT + 500]);

    const post = wallLeft.copy().move(beamWidth).extendTo(roofLeft).connect(wallLeft);
    const blocking = single(roofLeft.copy()
        .move(roofLeft.direction().normalize().rotateY(90).scale(BLOCKING_INSET))
        .extendTo(wallLeft).cutoffBy(centre));

    const end = (braceEnd === 'perc') ? roofLeft.pointAtPerc(0.33)! : roofLeft.pointAtLength(1000)!;
    const braceLine = Curve.Line(roofLeft.start().copy().translate(0, 0, -1000), end);
    const braceCut = () => single(braceLine.copy().cutoffBy(blocking));
    const brace = (braceCut().offset(beamWidth) as Curve)
                    .extendTo(blocking).extendTo(wallLeft)
                    .connect(braceCut());

    return { post, brace, wallLeft, roofLeft };
}

describe('extendTo() lands on the plane it was aimed at', () =>
{
    /*  Two things had to be true for `post.cutoffBy(brace)` to answer with a cut rather than a
        pinched region: the extension has to land ON the target (hypercurve's
        extend_endpoint_to_point, not extend-by-a-measured-length), and the two curves have to
        agree about the plane they live in. The second is what canonical frames buy: a curve used
        to derive its frame from its own points, so two coplanar curves carried different frames
        and mapping one into the other was an f64 rotation and translation — a rounding of about
        one ULP, on whichever side it happened to land. */
    // built inside the tests: the kernel is not up yet while the file is being read
    const cases: Array<[string, () => Curve, () => Curve]> = [
        ['XY', () => Curve.Line([10, 10, 0], [100, 110, 0]), () => Curve.Line([200, -50, 0], [200, 500, 0])],
        ['XZ', () => Curve.Line([10, 0, 10], [100, 0, 110]), () => Curve.Line([200, 0, -50], [200, 0, 500])],
        ['YZ', () => Curve.Line([0, 10, 10], [0, 100, 110]), () => Curve.Line([0, 200, -50], [0, 200, 500])],
    ];

    cases.forEach(([plane, makeLine, makeTarget]) =>
    {
        it(`reaches a target in the ${plane} plane exactly`, () =>
        {
            const target = makeTarget();
            const extended = makeLine().extendTo(target);
            const miss = distanceToLine(new Point(extended.end()),
                                        new Point(target.start()), new Point(target.end()));
            expect(miss).toEqual(0);        // exactly on it, not 5e-7 short as before
        });
    });

    it('still extends where nothing crosses, and where the end is an arc', () =>
    {
        // no crossing: the closest approach is the only answer there is
        const converging = Curve.Line([0, 0, 0], [100, 0, 10]);
        converging.extendTo(Curve.Line([300, 0, 300], [400, 0, 320]));
        expect(converging.length()).toBeGreaterThan(300);

        // an arc end has no straight continuation to intersect: the measured route still runs
        const arc = Curve.Arc([0, 0, 0], [50, 0, 30], [100, 0, 0]);
        arc.extendTo(Curve.Line([200, 0, -100], [200, 0, 100]));
        expect(arc.end().x).toBeCloseTo(200, 5);
    });
});

describe('cutting a post by its brace', () =>
{
    /*  The regression this file exists for. `postLeft.cutoffBy(braceLeft)` answered with a single
        8-vertex region: the brace stopped 6.6e-7 short of the wall line the post stands on, so
        the two halves stayed joined by a wedge that thin, and an exact boolean has no tolerance
        with which to call that a cut. Fixing the extension took the gap to ~1e-13 — which pinches
        just as reliably whenever it lands on the inside — so cutoffBy also re-cuts across gaps
        narrower than the coordinates can express. */
    const widths = [100, 120, 150, 175, 200, 225, 250];

    (['perc', 'length'] as const).forEach(braceEnd =>
    {
        widths.forEach(width =>
        {
            it(`cuts cleanly with a ${width} beam and the '${braceEnd}' brace`, () =>
            {
                const { post, brace, wallLeft } = bent(width, braceEnd);

                // the brace reaches the wall line: every corner that should be on it, is
                brace.vertices().toArray()
                    .filter(v => Math.abs(v.x) < 1)
                    .forEach(v => expect(distanceToLine(v.toPoint(),
                        new Point(wallLeft.start()), new Point(wallLeft.end()))).toBeLessThan(1e-9));

                const cut = post.copy().cutoffBy(brace) as Curve;

                expect(cut).toBeInstanceOf(Curve);
                expect(cut.vertices().length).toEqual(4);
                expect(cut.edges().length).toEqual(4);
                expect(cut.area()).toBeGreaterThan(300000);
            });
        });
    });

    it('leaves a cutter that genuinely misses alone', () =>
    {
        // the nudge is only ever allowed to close a gap the coordinates cannot express: a cutter
        // that really does not divide the shape must still be reported as not dividing it
        const post = Curve.RectBetween([0, 0, 0], [100, 0, 2000]);
        const away = Curve.RectBetween([500, 0, 0], [600, 0, 100]);
        expect((post.copy().cutoffBy(away) as Curve).area()).toBeCloseTo(200000, 3);
    });
});

describe('intersection() with a region cuts exactly at its boundary', () =>
{
    /*  The piece of a curve inside a closed one used to be trimmed at the arc-length PARAMETER
        nearest each crossing rather than at the crossing itself, so its ends sat a float residue
        off the boundary they were cut at — which is the geometry a script reads back as
        `intersection(rect).vertices()` and places bolts on. */
    it('ends the piece on the outline', () =>
    {
        const inside = Curve.Line([-100, 0, 0], [100, 0, 10])
                            .intersection(Curve.RectBetween([-5, 0, -10], [5, 0, 10])) as Curve;

        expect(inside.start().x).toEqual(-5);       // exactly, was -5.000000000000004
        expect(inside.end().x).toEqual(5);
    });

    it('ends the pieces on a hole boundary too', () =>
    {
        // A hole is a boundary like any other: the curve leaves the region at it. Cutting a line
        // that runs along X against an XZ region also exercises the frame swap — a straight line
        // is fitted to ONE of the infinitely many planes it lies in (here XY, its z being
        // constant), so the region has to be met in the region's own frame.
        const holed = Curve.RectBetween([-50, 0, -50], [50, 0, 50])
                        .difference(Curve.RectBetween([-10, 0, -10], [10, 0, 10])) as Curve;
        const pieces = Curve.Line([-100, 0, 0], [100, 0, 0]).intersections(holed) as ShapeCollection<Curve>;

        expect(pieces.length).toEqual(2);
        expect(pieces.toArray().flatMap(p => [p.start().x, p.end().x]).sort((a, b) => a - b))
            .toEqual([-50, -10, 10, 50]);
    });
});

describe('a three-point arc keeps the side its mid point is on', () =>
{
    /*  Latent bug, uncovered by canonical frames: for an exact SEMICIRCLE the sweep's sign
        carries no information (`atan2(0, negative)` is +pi whichever way the arc runs), and
        arc_3pt took that +pi without ever consulting `mid`. It went unseen because a curve's
        frame used to be derived from its own points, and in that frame +pi happened to be the
        right answer. */
    it('bulges through the mid point, whichever side of the chord that is', () =>
    {
        const P = (x: number, y: number, z: number) => new (getCsgrs() as any).Point3Js(x, y, z);
        const makeArc = (mx: number, my: number) =>
            (getCsgrs() as any).Curve3DJs.makeArc(P(0, 0, 0), P(mx, my, 0), P(10, 0, 0));

        expect(makeArc(5, 5).pointAt(0.5).y).toBeCloseTo(5, 6);      // was -5
        expect(makeArc(5, -5).pointAt(0.5).y).toBeCloseTo(-5, 6);    // was +5

        // and off the XY plane, where the frame's own axes are not the world's
        const xz = (getCsgrs() as any).Curve3DJs.makeArc(P(0, 0, 0), P(5, 0, 5), P(10, 0, 0));
        expect(xz.pointAt(0.5).z).toBeCloseTo(5, 6);

        // a minor arc, which never depended on the degenerate branch, still bulges its way
        const minor = (getCsgrs() as any).Curve3DJs.makeArc(P(0, 0, 0), P(5, 2, 0), P(10, 0, 0));
        expect(minor.pointAt(0.5).y).toBeCloseTo(2, 6);
    });
});
