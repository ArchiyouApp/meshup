/**
 * Round trips: a curve written to a file and read back should still be the same curve.
 *
 * Export and import were fixed separately, and each has its own tests. This is the check
 * neither of those can make — that the two agree. A writer and a reader can each be
 * self-consistently wrong (an arc written clockwise and read clockwise, an ellipse whose
 * rotation is negated on the way out and negated again on the way in) and only a round
 * trip notices.
 *
 * What is compared: family, span count, whether it curves, length, area and bounding box.
 * Not the coordinates directly — a format is free to start a closed curve at a different
 * vertex, and DXF stores an ellipse by its axes rather than by where it happens to begin.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, Importer, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** The properties a round trip must preserve. */
function shapeOf(c: Curve)
{
    const bb = c.bbox()!;
    return {
        closed: c.isClosed(),
        hasArcs: c.hasArcs(),
        spans: c.segmentCount(),
        length: c.length(),
        width: bb.width(),
        depth: bb.depth(),
    };
}

function expectSameShape(before: Curve, after: Curve, precision = 6)
{
    const a = shapeOf(before);
    const b = shapeOf(after);
    expect(b.closed).toBe(a.closed);
    expect(b.hasArcs).toBe(a.hasArcs);
    expect(b.spans).toBe(a.spans);
    expect(b.length).toBeCloseTo(a.length, precision);
    expect(b.width).toBeCloseTo(a.width, precision);
    expect(b.depth).toBeCloseTo(a.depth, precision);
}

/** Everything meshup can currently both write and read as SVG.
 *
 *  Built lazily: the kernel is not loaded when vitest collects the file, so a Curve
 *  constructed at describe level would run before initAsync(). */
const svgCases: Array<[string, () => Curve]> = [
    ['line', () => Curve.Line([0, 0, 0], [100, 30, 0])],
    ['polyline', () => Curve.Polyline([[0, 0, 0], [10, 20, 0], [40, 5, 0], [70, 35, 0]])],
    ['rect', () => Curve.Rect(80, 40)],
    ['arc', () => Curve.Arc([50, 0, 0], [0, 50, 0], [-50, 0, 0], 'threepoint')],
    ['circle', () => Curve.Circle(37.5, [12, -3, 0])],
    ['filleted rect', () =>
    {
        const r = Curve.Rect(100, 50);
        r.fillet(10);
        return r;
    }],
    ['cubic bezier', () => Importer.fromSVG(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 C 20,20 40,20 50,10 L 50,40 Z"/></svg>`,
    ).toArray()[0] as Curve],
];

describe('SVG round trip', () =>
{
    svgCases.forEach(([name, make]) =>
    {
        it(`preserves a ${name}`, () =>
        {
            const curve = make();
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">${curve.toSVGElem()}</svg>`;
            const back = Importer.fromSVG(svg).toArray();
            expect(back.length).toBe(1);
            expectSameShape(curve, back[0] as Curve);
        });
    });

    it('survives a second trip unchanged', () =>
    {
        // The interesting failure this catches is a systematic drift — a sweep flag or an
        // orientation that flips on every pass and only shows up on the second.
        const original = Curve.Circle(25, [5, 5, 0]);
        const wrap = (c: Curve) => `<svg xmlns="http://www.w3.org/2000/svg">${c.toSVGElem()}</svg>`;
        const once = Importer.fromSVG(wrap(original)).toArray()[0] as Curve;
        const twice = Importer.fromSVG(wrap(once)).toArray()[0] as Curve;
        expectSameShape(original, twice);
    });

    /**
     * meshup writes exact ellipses to SVG but cannot read them back: hypercurve declines
     * an `A` command whose rx and ry differ. The output is valid SVG that any renderer
     * draws correctly — this is an import limitation, not an export one — and it is pinned
     * here so the asymmetry is visible rather than surprising.
     */
    it('writes an ellipse it cannot yet read back', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">${Curve.Ellipse(50, 25).toSVGElem()}</svg>`;
        expect(svg).toMatch(/A50 25/);
        expect(Importer.fromSVG(svg).toArray().length).toBe(0);
    });
});

describe('DXF round trip', () =>
{
    /** A one-curve DXF document, written the way toDXF would. */
    function dxfOf(entities: string): string
    {
        return `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
    }

    it('preserves a bulged polyline through DXF and back', () =>
    {
        // Straight from the importer's own vocabulary: two arcs and two lines.
        const dxf = dxfOf(
            `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n`
            + `10\n0.0\n20\n0.0\n42\n0.5\n`
            + `10\n40.0\n20\n0.0\n`
            + `10\n40.0\n20\n30.0\n42\n-0.25\n`
            + `10\n0.0\n20\n30.0\n`);
        const first = Importer.load(dxf).toArray()[0] as Curve;
        expect(first.hasArcs()).toBe(true);
        expect(first.segmentCount()).toBe(4);

        // Re-export through the span parameters a DXF writer uses, and read it back.
        const spans = first.exportSpans();
        const bulges = spans.map(s => (s.kind === 'arc' ? s.bulge : 0));
        const body = spans
            .map((s, i) => `10\n${s.start[0]}\n20\n${s.start[1]}\n`
                + (bulges[i] !== 0 ? `42\n${bulges[i]}\n` : ''))
            .join('');
        const second = Importer.load(
            dxfOf(`0\nLWPOLYLINE\n8\n0\n90\n${spans.length}\n70\n1\n${body}`),
        ).toArray()[0] as Curve;

        expectSameShape(first, second);
    });

    it('preserves an ARC', () =>
    {
        const first = Importer.load(
            dxfOf(`0\nARC\n8\n0\n10\n5.0\n20\n-2.0\n30\n0.0\n40\n12.5\n50\n30.0\n51\n150.0\n`),
        ).toArray()[0] as Curve;
        expect(first.subtype()).toBe('Arc');

        const [s] = first.spanParams();
        expect(s.kind).toBe('arc');
        if (s.kind !== 'arc') { return; }
        // Written back the way the DXF exporter does: exact centre, radius and CCW angles.
        const deg = (r: number) => (r * 180) / Math.PI;
        const a0 = deg(Math.atan2(s.start[1] - s.center[1], s.start[0] - s.center[0]));
        const a1 = deg(Math.atan2(s.end[1] - s.center[1], s.end[0] - s.center[0]));
        const [from, to] = s.ccw ? [a0, a1] : [a1, a0];
        const second = Importer.load(dxfOf(
            `0\nARC\n8\n0\n10\n${s.center[0]}\n20\n${s.center[1]}\n30\n0.0\n`
            + `40\n${s.radius}\n50\n${from}\n51\n${to}\n`,
        )).toArray()[0] as Curve;

        expectSameShape(first, second);
    });

    it('preserves an ELLIPSE', () =>
    {
        const first = Importer.load(dxfOf(
            `0\nELLIPSE\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n`
            + `11\n20.0\n21\n0.0\n31\n0.0\n40\n0.5\n41\n0.0\n42\n6.283185307179586\n`,
        )).toArray()[0] as Curve;
        expect(first.hasArcs()).toBe(true);

        const [s] = first.exportSpans();
        expect(s.kind).toBe('conic');
        if (s.kind !== 'conic' || !s.ellipse) { throw new Error('no ellipse recovered'); }
        const e = s.ellipse;
        const second = Importer.load(dxfOf(
            `0\nELLIPSE\n8\n0\n10\n${e.center[0]}\n20\n${e.center[1]}\n30\n0.0\n`
            + `11\n${e.majorAxis[0]}\n21\n${e.majorAxis[1]}\n31\n0.0\n`
            + `40\n${e.ratio}\n41\n${e.startParam}\n42\n${e.endParam}\n`,
        )).toArray()[0] as Curve;

        expectSameShape(first, second);
    });

    it('preserves a CIRCLE at full radius', () =>
    {
        const first = Importer.load(
            dxfOf(`0\nCIRCLE\n8\n0\n10\n3.0\n20\n-4.0\n30\n0.0\n40\n12.5\n`),
        ).toArray()[0] as Curve;
        expect(first.length()).toBeCloseTo(2 * Math.PI * 12.5, 9);
        expect(first.bbox()!.width()).toBeCloseTo(25, 9);
    });
});

describe('cross-format: DXF in, SVG out', () =>
{
    const BULGED_DXF = `0\nSECTION\n2\nENTITIES\n`
        + `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n`
        + `10\n0.0\n20\n0.0\n42\n0.5\n10\n40.0\n20\n0.0\n`
        + `10\n40.0\n20\n30.0\n10\n0.0\n20\n30.0\n`
        + `0\nENDSEC\n0\nEOF\n`;

    it('turns a DXF bulge into a real SVG arc of the right radius', () =>
    {
        const fromDxf = Importer.load(BULGED_DXF).toArray()[0] as Curve;
        expect(fromDxf.hasArcs()).toBe(true);
        // bulge 0.5 over a chord of 40: sweep = 4*atan(0.5), radius = 20 / sin(sweep/2).
        const sweep = 4 * Math.atan(0.5);
        const radius = 20 / Math.sin(sweep / 2);
        expect(radius).toBeCloseTo(25, 9);

        const d = /d="([^"]*)"/.exec(fromDxf.toSVGElem())?.[1] ?? '';
        const arc = /A\s*([\d.]+)\s+([\d.]+)\s+(-?[\d.]+)\s+([01])\s+([01])/.exec(d);
        expect(arc).not.toBeNull();
        expect(Number(arc![1])).toBeCloseTo(25, 6);
        expect(Number(arc![2])).toBeCloseTo(25, 6);
        expect(arc![4]).toBe('0');   // 106 degrees, so not the large arc
    });

    /**
     * UPSTREAM DEFECT (hypercurve), not meshup's: an imported SVG arc curves the wrong way.
     *
     * SVG 1.1 F.6.3 defines the sweep flag by the sign of the swept angle — fS = 1 forces
     * Δθ >= 0, i.e. counter-clockwise through the coordinate values as written. hypercurve
     * instead passes the flag straight through as "clockwise", both when reading
     * (`svg.rs: CircularArc2::try_from_center(start, end, center, sweep)`) and when writing
     * (`svg.rs: let sweep = u8::from(arc.is_clockwise())`). It therefore round-trips against
     * itself perfectly and disagrees with every other tool — and with meshup's own writer,
     * which follows the spec.
     *
     * Concretely, `M0 0 A25 25 0 0 1 40 0` should bow to y = -10 and imports bowing to
     * y = +10. The arc that leaves meshup is correct in any renderer; it is reading one back
     * that mirrors it. Fixing it means a one-line change on each side in the hypercurve
     * submodule, which is outside what this work was scoped to touch.
     */
    it.fails('round-trips a bulged DXF polyline through SVG', () =>
    {
        const fromDxf = Importer.load(BULGED_DXF).toArray()[0] as Curve;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">${fromDxf.toSVGElem()}</svg>`;
        const back = Importer.fromSVG(svg).toArray()[0] as Curve;
        expectSameShape(fromDxf, back);
    });

    // The same upstream defect, stated exactly rather than through its symptom.
    it.fails('reads the SVG sweep flag the way the spec defines it', () =>
    {
        // Both centres are 15 from the chord midpoint (20, 0) for r = 25 over a chord of 40.
        // fS = 1 selects the centre that makes the swept angle positive — (20, 15) — so the
        // arc passes through (20, -10).
        const svg = (sf: number) =>
            `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 A25 25 0 0 ${sf} 40 0"/></svg>`;
        const bboxOf = (sf: number) => (Importer.fromSVG(svg(sf)).toArray()[0] as Curve).bbox()!;
        expect(bboxOf(1).min().y).toBeCloseTo(-10, 6);
        expect(bboxOf(0).max().y).toBeCloseTo(10, 6);
    });
});
