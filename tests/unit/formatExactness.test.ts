/**
 * Guard rails for the file-format layer after de-tessellation.
 *
 * meshup's Curve now holds exact geometry — native arcs, rational conics, Béziers and
 * NURBS. The SVG writer and the DXF reader were written when a Curve was always a
 * polyline, and they still read one through APIs that only describe polylines. The result
 * is not "less precise output": it is output that silently loses geometry the kernel is
 * holding exactly.
 *
 * Each `it.fails` below pins one such defect. Flip it to `it` in the stage that fixes it —
 * a passing `it.fails` fails the suite, so none of these can be quietly left behind.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, Importer, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** Path commands in a `d` attribute, e.g. 'M','C','L','Z'. */
function commandsOf(svgElem: string): string[]
{
    const d = /d="([^"]*)"/.exec(svgElem)?.[1] ?? '';
    return (d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []);
}

describe('SVG export preserves exact spans', () =>
{
    // DEFECT A — toSVGElem()'s span switch has no 'Ellipse' case, so a rational-conic
    // span falls into `default:` and is written as tessellated `L` chords. SVG has had a
    // native elliptical-arc command since forever; there is nothing to approximate.
    it('writes an ellipse as an A command, not as chords', () =>
    {
        const svg = Curve.Ellipse(50, 25).toSVGElem();
        const cmds = commandsOf(svg);
        expect(cmds).toContain('A');
        // Four conic spans + the move + the close. A chorded ellipse runs to hundreds.
        expect(cmds.filter(c => c === 'L').length).toBe(0);
    });

    // DEFECT B — the worst of the four: the span emits *nothing at all*.
    //
    // single_spline() (curve_js.rs) matches only CurveGeometry2::Nurbs, so a CubicBezier2
    // span reports controlPoints() = its two endpoints and knots() = [] (which the TS
    // wrapper then rewrites to [0,1]), while degree() still says 3. _bsplineToBezierSegments
    // computes numSegments = (2-1)/3 = 0.333, and `Array.from({ length: 0.333 })` is [] —
    // so the loop that emits the C command runs zero times. No warning, no fallback.
    it('does not silently drop a cubic Bézier span', () =>
    {
        const src = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 C 20,20 40,20 50,10 L 50,40 Z"/></svg>`;
        const curve = Importer.fromSVG(src).toArray()[0] as Curve;
        // Three spans went in: cubic, line, closing line.
        expect((curve.inner() as any).segmentCount()).toBe(3);

        const cmds = commandsOf(curve.toSVGElem());
        expect(cmds).toContain('C');
        // One command per span, plus the opening M and the closing Z. Today the cubic
        // contributes none of its own, so the leg between (10,10) and (50,10) vanishes.
        expect(cmds.length).toBe(3 + 2);
    });

    // The arc writer re-derives the circle from three tessellation samples via a
    // circumcircle, so its radius carries chord error instead of the kernel's exact value.
    it('writes an arc radius exactly, not via a circumcircle of samples', () =>
    {
        const r = 37.5;
        const arc = Curve.EllipticalArc(r, r, 0, 90);
        const rx = /A\s*([0-9.eE+-]+)/.exec(/d="([^"]*)"/.exec(arc.toSVGElem())?.[1] ?? '')?.[1];
        expect(Number(rx)).toBeCloseTo(r, 9);
    });
});

describe('SVG export writes the right arc, not just an arc', () =>
{
    /** The `A` commands of a path element, as parsed argument lists. */
    function arcsOf(svgElem: string): number[][]
    {
        const d = /d="([^"]*)"/.exec(svgElem)?.[1] ?? '';
        return [...d.matchAll(/A\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([01])\s+([01])\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
            .map(m => m.slice(1).map(Number));
    }

    it('writes the semi-axes and rotation of a tilted ellipse', () =>
    {
        // rotation is in DEGREES here, matching Curve.Ellipse's own argument.
        const arcs = arcsOf(Curve.Ellipse(50, 25, [0, 0, 0], 30).toSVGElem());
        expect(arcs.length).toBeGreaterThan(0);
        arcs.forEach(([rx, ry, rot]) =>
        {
            expect(rx).toBeCloseTo(50, 6);
            expect(ry).toBeCloseTo(25, 6);
            // Negated, because SVG's y axis points down and the export mirrors every point
            // on the way out — the axis direction is mirrored with them.
            expect(rot).toBeCloseTo(-30, 6);
        });
    });

    it('splits a full ellipse into two arcs rather than one degenerate one', () =>
    {
        const elem = Curve.Ellipse(50, 25).toSVGElem();
        const arcs = arcsOf(elem);
        // An `A` whose endpoint equals its start point draws nothing at all, so a whole
        // ellipse cannot be one command however tempting the arithmetic looks.
        expect(arcs.length).toBe(2);
        const d = /d="([^"]*)"/.exec(elem)?.[1] ?? '';
        const start = /M(-?[\d.]+) (-?[\d.]+)/.exec(d)!.slice(1).map(Number);
        const firstEnd = arcs[0].slice(5);
        expect(Math.hypot(firstEnd[0] - start[0], firstEnd[1] - start[1])).toBeGreaterThan(1);
        // Both halves agree about a flag that describes the same arc either way at
        // exactly half a turn.
        expect(arcs[0][3]).toBe(arcs[1][3]);
        expect(arcs[0][4]).toBe(arcs[1][4]);
    });

    it('keeps a circle as <circle> but refuses to call a lens one', () =>
    {
        expect(Curve.Circle(37.5).toSVGElem()).toContain('<circle');

        // Two arcs of different centres. subtype() calls this "Circle" — anything closed
        // and made only of arcs gets that name — so the writer has to check the spans.
        const lens = Curve.Circle(50).intersection(Curve.Circle(50, [60, 0, 0])) as Curve;
        expect(lens).toBeInstanceOf(Curve);
        expect(lens.subtype()).toBe('Circle');       // guard the premise
        expect(lens.toSVGElem()).not.toContain('<circle');
    });

    it('takes an arc radius from the kernel, not from a bounding box', () =>
    {
        // A quarter circle's bbox is smaller than its diameter, so a bbox-derived radius
        // would come out wrong here in a way a full circle would hide.
        const [arc] = arcsOf(Curve.EllipticalArc(80, 80, 0, 90).toSVGElem());
        expect(arc[0]).toBeCloseTo(80, 9);
        expect(arc[1]).toBeCloseTo(80, 9);
    });
});

describe('DXF import preserves exact geometry', () =>
{
    // DEFECT D — io/dxf.rs is still the pre-hypercurve `geo` importer. Every entity is
    // reduced to a point list before meshup sees it, so arc-ness is destroyed at the
    // boundary — the same defect the SVG importer was migrated away from.

    // A LWPOLYLINE vertex carries a `bulge` (group 42): the tangent of a quarter of the
    // arc's included angle. It maps 1:1 onto Segment2::from_bulge, which hypercurve
    // already exposes and hcurve::circle already uses. Today it is simply never read.
    it.fails('reads LWPOLYLINE bulges as native arcs', () =>
    {
        // A 20x20 square whose first edge bulges into a half circle (bulge 1 = 180°).
        const dxf = `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
0
90
4
70
1
10
0.0
20
0.0
42
1.0
10
20.0
20
0.0
10
20.0
20
20.0
10
0.0
20
20.0
0
ENDSEC
0
EOF
`;
        const curve = Importer.load(dxf).toArray()[0] as Curve;
        expect((curve.inner() as any).hasArcs()).toBe(true);
        expect((curve.inner() as any).segmentCount()).toBe(4);
    });

    // ARC/CIRCLE are sampled at a fixed 48 chords regardless of radius or sweep, so a
    // 1° arc gets 48 segments and a 3-metre circle also gets 48.
    it.fails('reads an ARC entity as one exact arc span', () =>
    {
        const dxf = `0
SECTION
2
ENTITIES
0
ARC
8
0
10
0.0
20
0.0
30
0.0
40
10.0
50
0.0
51
90.0
0
ENDSEC
0
EOF
`;
        const curve = Importer.load(dxf).toArray()[0] as Curve;
        expect((curve.inner() as any).segmentCount()).toBe(1);
        expect(curve.subtype()).toBe('Arc');
        // Quarter of a circle of radius 10.
        expect(curve.length()).toBeCloseTo(Math.PI * 10 / 2, 9);
    });

    // ELLIPSE and SPLINE hit a catch-all `_ => {}` arm: dropped, with no warning at all.
    it.fails('imports an ELLIPSE entity instead of dropping it', () =>
    {
        const dxf = `0
SECTION
2
ENTITIES
0
ELLIPSE
8
0
10
0.0
20
0.0
30
0.0
11
20.0
21
0.0
31
0.0
40
0.5
41
0.0
42
6.283185307179586
0
ENDSEC
0
EOF
`;
        const curves = Importer.load(dxf).toArray();
        expect(curves.length).toBe(1);
        const bb = (curves[0] as Curve).bbox()!;
        expect(bb.width()).toBeCloseTo(40, 6);   // 2 * major
        expect(bb.depth()).toBeCloseTo(20, 6);   // 2 * major * ratio
    });

    // The exact circle is two half-arcs, so its bbox is the true diameter rather than the
    // inscribed 48-gon's. The existing DXF circle test uses toBeCloseTo(10, 1) precisely
    // because of that shortfall.
    it.fails('imports a CIRCLE at full radius, not as an inscribed polygon', () =>
    {
        const dxf = `0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
0.0
20
0.0
30
0.0
40
5.0
0
ENDSEC
0
EOF
`;
        const curve = Importer.load(dxf).toArray()[0] as Curve;
        expect((curve.inner() as any).hasArcs()).toBe(true);
        expect(curve.bbox()!.width()).toBeCloseTo(10, 6);
    });
});
