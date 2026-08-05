/**
 * Guard rails for the file-format layer after de-tessellation.
 *
 * meshup's Curve now holds exact geometry — native arcs, rational conics, Béziers and
 * NURBS. The SVG writer and the DXF reader were written when a Curve was always a
 * polyline, and they still read one through APIs that only describe polylines. The result
 * is not "less precise output": it is output that silently loses geometry the kernel is
 * holding exactly.
 *
 * Every case below started as a failing `it.fails` pinning one such defect, and was flipped
 * as its stage landed. They stay as regression cover for the specific way each one broke.
 */

import { beforeAll, describe, it, expect, vi } from 'vitest';
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
    it('reads LWPOLYLINE bulges as native arcs', () =>
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
    it('reads an ARC entity as one exact arc span', () =>
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
    it('imports an ELLIPSE entity instead of dropping it', () =>
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
    it('imports a CIRCLE at full radius, not as an inscribed polygon', () =>
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

/** A minimal ASCII DXF wrapping the given ENTITIES body. */
function dxfDoc(entities: string, blocks = ''): string
{
    const b = blocks ? `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n` : '';
    return `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n${b}0\nEOF\n`;
}

describe('DXF import: entities that used to be dropped', () =>
{
    it('reads a SPLINE as a real NURBS', () =>
    {
        // Degree 3, 4 control points, 8 knots — a single clamped Bézier-like span.
        const dxf = dxfDoc(
            `0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n8\n73\n4\n74\n0\n`
            + `40\n0.0\n40\n0.0\n40\n0.0\n40\n0.0\n40\n1.0\n40\n1.0\n40\n1.0\n40\n1.0\n`
            + `10\n0.0\n20\n0.0\n30\n0.0\n`
            + `10\n10.0\n20\n20.0\n30\n0.0\n`
            + `10\n30.0\n20\n-20.0\n30\n0.0\n`
            + `10\n40.0\n20\n0.0\n30\n0.0\n`);
        const curve = Importer.load(dxf).toArray()[0] as Curve;
        expect(curve).toBeInstanceOf(Curve);
        expect(curve.degree()).toBe(3);
        expect(curve.segmentCount()).toBe(1);
        const [s] = curve.spanParams();
        expect(s.kind).toBe('spline');
    });

    it('refuses a SPLINE whose knots and control points disagree', () =>
    {
        // 3 knots for 4 control points at degree 3, where 8 are required.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try
        {
            const dxf = dxfDoc(
                `0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n3\n73\n4\n74\n0\n`
                + `40\n0.0\n40\n0.5\n40\n1.0\n`
                + `10\n0.0\n20\n0.0\n30\n0.0\n10\n10.0\n20\n20.0\n30\n0.0\n`
                + `10\n30.0\n20\n-20.0\n30\n0.0\n10\n40.0\n20\n0.0\n30\n0.0\n`);
            expect(Importer.load(dxf).toArray().length).toBe(0);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SPLINE|knots/i));
        }
        finally { warn.mockRestore(); }
    });

    it('resolves an INSERT against the block table, including its array', () =>
    {
        // One block holding a 2x2 square, inserted as a 2x3 array at 100 apart.
        const block = `0\nBLOCK\n8\n0\n2\nSQ\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\nSQ\n1\n\n`
            + `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n`
            + `10\n0.0\n20\n0.0\n10\n2.0\n20\n0.0\n10\n2.0\n20\n2.0\n10\n0.0\n20\n2.0\n`
            + `0\nENDBLK\n8\n0\n`;
        const dxf = dxfDoc(
            `0\nINSERT\n8\n0\n2\nSQ\n10\n10.0\n20\n5.0\n30\n0.0\n`
            + `70\n2\n71\n3\n44\n100.0\n45\n50.0\n`,
            block);

        const curves = Importer.load(dxf).toArray() as Curve[];
        expect(curves.length).toBe(6);            // 2 columns x 3 rows
        // Placed at the insert point, not left at the block origin.
        const xs = curves.map(c => c.bbox()!.min().x).sort((a, b) => a - b);
        expect(xs[0]).toBeCloseTo(10, 6);
        expect(xs[xs.length - 1]).toBeCloseTo(110, 6);
        curves.forEach(c => expect(c.bbox()!.width()).toBeCloseTo(2, 6));
    });

    it('counts what it skipped instead of dropping it in silence', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try
        {
            const dxf = dxfDoc(`0\nTEXT\n8\n0\n10\n0.0\n20\n0.0\n30\n0.0\n40\n2.5\n1\nhi\n`);
            Importer.load(dxf);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped.*TEXT/i));
        }
        finally { warn.mockRestore(); }
    });
});

describe('SVG import: placement and partial recovery', () =>
{
    it('applies a group transform to its contents', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">`
            + `<g transform="translate(10,20)"><rect x="0" y="0" width="30" height="40"/></g></svg>`;
        const bb = (Importer.fromSVG(svg).toArray()[0] as Curve).bbox()!;
        expect(bb.min().x).toBeCloseTo(10, 9);
        expect(bb.min().y).toBeCloseTo(20, 9);
        expect(bb.width()).toBeCloseTo(30, 9);
    });

    it('composes nested group transforms with an element transform', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">`
            + `<g transform="translate(100,0)"><g transform="translate(0,50)">`
            + `<rect x="0" y="0" width="10" height="10" transform="translate(1,2)"/>`
            + `</g></g></svg>`;
        const bb = (Importer.fromSVG(svg).toArray()[0] as Curve).bbox()!;
        expect(bb.min().x).toBeCloseTo(101, 9);
        expect(bb.min().y).toBeCloseTo(52, 9);
    });

    it('rotates about a point', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">`
            + `<line x1="0" y1="0" x2="10" y2="0" transform="rotate(90 0 0)"/></svg>`;
        const bb = (Importer.fromSVG(svg).toArray()[0] as Curve).bbox()!;
        expect(bb.width()).toBeCloseTo(0, 9);
        expect(bb.depth()).toBeCloseTo(10, 9);
    });

    it('rounds a rect with rx/ry instead of squaring the corners', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">`
            + `<rect x="0" y="0" width="100" height="50" rx="10"/></svg>`;
        const c = Importer.fromSVG(svg).toArray()[0] as Curve;
        expect(c.hasArcs()).toBe(true);
        expect(c.segmentCount()).toBe(8);        // 4 sides + 4 corners
        expect(c.isClosed()).toBe(true);
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(100, 9);
        expect(bb.depth()).toBeCloseTo(50, 9);
        // Quarter-turn corners.
        c.spanParams().filter(s => s.kind === 'arc').forEach(s =>
        {
            if (s.kind !== 'arc') { return; }
            expect(s.radius).toBeCloseTo(10, 9);
        });
    });

    it('keeps the good subpaths when one of them cannot be parsed', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try
        {
            // The second subpath has an elliptical arc, which hypercurve declines. The
            // whole element used to be discarded on account of it.
            const svg = `<svg xmlns="http://www.w3.org/2000/svg">`
                + `<path d="M0,0 L10,0 L10,10 Z M50,50 A30,15 0 0 1 90,50"/></svg>`;
            const curves = Importer.fromSVG(svg).toArray() as Curve[];
            expect(curves.length).toBe(1);
            expect(curves[0].bbox()!.width()).toBeCloseTo(10, 9);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/subpath/i));
        }
        finally { warn.mockRestore(); }
    });
});
