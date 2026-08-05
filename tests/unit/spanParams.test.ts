/**
 * `Curve.spanParams()` / `exportSpans()` — the exact parameters a file format needs.
 *
 * The other accessors answer coarser questions than a writer asks: subtype() names the
 * whole curve and has no name for "lines and arcs mixed", controlPoints() gives span
 * endpoints (an arc's chord), and knots()/weights() are empty unless the whole curve is
 * one NURBS span. These tests pin what spanParams() adds on top.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, Importer, initAsync } from '../../src/index';
import type { SpanParams } from '../../src/types';

beforeAll(async () =>
{
    await initAsync();
});

const kinds = (spans: SpanParams[]) => spans.map(s => s.kind);

describe('spanParams: one entry per exact span', () =>
{
    it('agrees with segmentCount() for every family', () =>
    {
        const cases = [
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Circle(50),
            Curve.Ellipse(50, 25),
            Curve.Rect(10, 20),
            Curve.Interpolated([[0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0]]),
        ];
        cases.forEach(c => expect(c.spanParams().length).toBe(c.segmentCount()));
    });

    it('never reports "unsupported" for ordinary geometry', () =>
    {
        const rect = Curve.Rect(100, 50);
        rect.fillet(10);
        const cases = [
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Arc([50, 0, 0], [0, 50, 0], [-50, 0, 0], 'threepoint'),
            Curve.Circle(50),
            Curve.Ellipse(50, 25),
            Curve.EllipticalArc(50, 25, 0, 90),
            Curve.Interpolated([[0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0]]),
            rect,
        ];
        cases.forEach(c =>
            expect(kinds(c.spanParams())).not.toContain('unsupported'));
    });
});

describe('spanParams: arcs carry their exact circle', () =>
{
    it('reports an arc centre and radius exactly', () =>
    {
        const r = 37.5;
        const c = Curve.Circle(r, [12, -3, 0]);
        for (const s of c.spanParams())
        {
            expect(s.kind).toBe('arc');
            if (s.kind !== 'arc') { continue; }
            // Exact, not re-derived from a circumcircle of tessellation samples.
            expect(s.radius).toBeCloseTo(r, 12);
            expect(s.center[0]).toBeCloseTo(12, 12);
            expect(s.center[1]).toBeCloseTo(-3, 12);
            expect(Math.abs(s.sweep)).toBeCloseTo(Math.PI, 9); // two half-circles
        }
    });

    it('gives a filleted rect alternating line and arc spans with quarter-turn bulges', () =>
    {
        const rect = Curve.Rect(100, 50);
        rect.fillet(10);
        const spans = rect.spanParams();
        expect(spans.length).toBe(8);
        expect(new Set(kinds(spans))).toEqual(new Set(['line', 'arc']));

        const arcs = spans.filter(s => s.kind === 'arc');
        expect(arcs.length).toBe(4);
        // A 90° corner: bulge = tan(90°/4) = sqrt(2) - 1.
        arcs.forEach(a =>
        {
            if (a.kind !== 'arc') { return; }
            expect(Math.abs(a.bulge)).toBeCloseTo(Math.SQRT2 - 1, 9);
            expect(a.radius).toBeCloseTo(10, 9);
            expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI / 2, 9);
        });
    });

    it('places the reported midpoint on the arc', () =>
    {
        const c = Curve.Arc([50, 0, 0], [0, 50, 0], [-50, 0, 0], 'threepoint');
        for (const s of c.spanParams())
        {
            if (s.kind !== 'arc') { continue; }
            const d = Math.hypot(s.mid[0] - s.center[0], s.mid[1] - s.center[1], s.mid[2] - s.center[2]);
            expect(d).toBeCloseTo(s.radius, 9);
        }
    });
});

describe('spanParams: conics carry their exact ellipse', () =>
{
    it('recovers the ellipse from an ellipse curve', () =>
    {
        const spans = Curve.Ellipse(50, 25).spanParams();
        expect(kinds(spans)).toEqual(['conic', 'conic', 'conic', 'conic']);
        for (const s of spans)
        {
            if (s.kind !== 'conic') { continue; }
            expect(s.ellipse).toBeDefined();
            const e = s.ellipse!;
            const a = Math.hypot(e.majorAxis[0], e.majorAxis[1], e.majorAxis[2]);
            expect(a).toBeCloseTo(50, 9);
            expect(a * e.ratio).toBeCloseTo(25, 9);
            expect(e.center[0]).toBeCloseTo(0, 9);
            expect(e.center[1]).toBeCloseTo(0, 9);
        }
    });

    it('recovers the ellipse from a non-uniformly scaled circle', () =>
    {
        // The other route conics enter a curve, through transform_affine rather than
        // elliptical_arc_path.
        const c = Curve.Circle(10);
        c.scale([2, 0.5, 1]);
        const conics = c.spanParams().filter(s => s.kind === 'conic');
        expect(conics.length).toBeGreaterThan(0);
        for (const s of conics)
        {
            if (s.kind !== 'conic') { continue; }
            const e = s.ellipse!;
            expect(e).toBeDefined();
            const a = Math.hypot(e.majorAxis[0], e.majorAxis[1], e.majorAxis[2]);
            expect(a).toBeCloseTo(20, 9);
            expect(a * e.ratio).toBeCloseTo(5, 9);
        }
    });
});

describe('spanParams: splines carry a well-formed knot vector', () =>
{
    it('reports real NURBS data for an interpolated curve', () =>
    {
        const c = Curve.Interpolated([[0, 0, 0], [50, 50, 0], [100, -50, 0], [150, 0, 0]]);
        const [s] = c.spanParams();
        expect(s.kind).toBe('spline');
        if (s.kind !== 'spline') { return; }
        expect(s.degree).toBe(3);
        // The invariant a DXF SPLINE must satisfy, and the one a filleted rect used to
        // violate: a clamped B-spline has exactly n + degree + 1 knots.
        expect(s.knots.length).toBe(s.controlPoints.length + s.degree + 1);
        expect(s.controlPoints.length).toBeGreaterThan(s.degree);
    });

    it('reports an imported cubic Bézier as a degree-3 span with its control points', () =>
    {
        const src = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 C 20,20 40,20 50,10 L 50,40 Z"/></svg>`;
        const curve = Importer.fromSVG(src).toArray()[0] as Curve;
        const spans = curve.spanParams();
        expect(spans.length).toBe(3);

        const cubic = spans.find(s => s.kind === 'cubic');
        expect(cubic).toBeDefined();
        if (cubic?.kind !== 'cubic') { return; }
        // The real control points, which controlPoints() cannot give: it returns span
        // endpoints, so this span would read as the chord (10,10)->(50,10).
        expect(cubic.control1[0]).toBeCloseTo(20, 9);
        expect(cubic.control1[1]).toBeCloseTo(20, 9);
        expect(cubic.control2[0]).toBeCloseTo(40, 9);
        expect(cubic.control2[1]).toBeCloseTo(20, 9);
    });
});

describe('exportSpans: merges the spans of one ellipse', () =>
{
    it('folds a full ellipse into a single conic span', () =>
    {
        const c = Curve.Ellipse(50, 25);
        expect(c.spanParams().length).toBe(4);   // 90°-capped spans, as built
        expect(c.exportSpans().length).toBe(1);  // one shape, as a file wants it
    });

    it('leaves line and arc work alone', () =>
    {
        const rect = Curve.Rect(100, 50);
        rect.fillet(10);
        expect(rect.exportSpans().length).toBe(rect.spanParams().length);
    });
});

describe('spanParams: the curve survives the call', () =>
{
    // wasm-bindgen consumes exported types passed by value; this returns plain data, so
    // nothing is taken from the caller. See tests/unit/wasmOwnership.test.ts.
    it('can be called repeatedly and leaves the curve usable', () =>
    {
        const c = Curve.Circle(50);
        expect(c.spanParams().length).toBe(2);
        expect(c.spanParams().length).toBe(2);
        expect(c.exportSpans().length).toBeGreaterThan(0);
        expect(c.length()).toBeCloseTo(2 * Math.PI * 50, 9);
    });
});
