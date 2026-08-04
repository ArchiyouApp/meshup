import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';

/** Exactness guard rails.
 *
 *  meshup's curve layer is backed by hypercurve, an exact planar kernel: a circle is two
 *  rational-conic arcs, an ellipse four, a NURBS a real spline. Historically most operations
 *  round-tripped that exact geometry through a polyline, so a circle that had been mirrored,
 *  offset or joined silently became a 500-segment `Polyline`.
 *
 *  These tests assert INVARIANTS rather than counts — `subtype()`, `hasArcs()`, `degree()` and
 *  analytic length/area/bbox — so they survive representation changes but catch a lost arc.
 *
 *  `it.fails` marks a rail that the kernel does NOT satisfy yet. Each carries the stage of
 *  plans/the-meshup-module-is-distributed-simon.md that fixes it. When that stage lands the
 *  test starts passing, `it.fails` goes red, and you flip it to `it` — the ratchet is the point.
 */

beforeAll(async () => { await initAsync(); });

const R = 50;
const CIRCLE_LEN = 2 * Math.PI * R;
const CIRCLE_AREA = Math.PI * R * R;

const sub = (c: any) => c.subtype();
const arcs = (c: any) => c.inner().hasArcs();
const segs = (c: any) => c.inner().segmentCount();

const circle = () => Curve.Circle(R);
const ellipse = () => Curve.Ellipse(50, 25);
/** Semicircle of radius 10 centred at (10,0): through (0,0), (10,10), (20,0). */
const arc = () => Curve.Arc([0, 0, 0], [10, 10, 0], [20, 0, 0], 'threepoint');
const ARC_LEN = Math.PI * 10;

/** Ramanujan II — relative error below 1e-10 at this eccentricity. */
const ellipsePerimeter = (a: number, b: number): number =>
{
    const h = ((a - b) ** 2) / ((a + b) ** 2);
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
};

describe('exactness: primitives', () =>
{
    it('a circle is two native arc spans', () =>
    {
        const c = circle();
        expect(sub(c)).toBe('Circle');
        expect(arcs(c)).toBe(true);
        expect(segs(c)).toBe(2);
        expect(c.degree()).toBe(2);
    });

    it('a circle has analytic length and area', () =>
    {
        expect(circle().length()).toBeCloseTo(CIRCLE_LEN, 9);
        expect(circle().area()!).toBeCloseTo(CIRCLE_AREA, 9);
    });

    it('a three-point arc is one native arc span with analytic length', () =>
    {
        expect(sub(arc())).toBe('Arc');
        expect(arcs(arc())).toBe(true);
        expect(segs(arc())).toBe(1);
        expect(arc().length()).toBeCloseTo(ARC_LEN, 9);
    });

    it('a rect / line / polyline stays degree 1', () =>
    {
        expect(sub(Curve.Rect(200, 100))).toBe('Rect');
        expect(Curve.Rect(200, 100).length()).toBeCloseTo(600, 9);
        expect(sub(Curve.Line([0, 0, 0], [10, 0, 0]))).toBe('Line');
    });

    it('an ellipse classifies as Ellipse and is closed', () =>
    {
        expect(sub(ellipse())).toBe('Ellipse');
        expect(ellipse().isClosed()).toBe(true);
    });

    // Fixed in stage 3: PathGeom's cached line approximation is gone, so these read the
    // exact spans instead of ~200 degree-1 segments.
    it('an ellipse exposes its conic spans, not a line approximation', () =>
    {
        expect(ellipse().degree()).toBeGreaterThanOrEqual(2);
        expect(segs(ellipse())).toBeLessThanOrEqual(8);
        expect(ellipse().spans().count()).toBeLessThanOrEqual(8);
    });

    // Fixed in stage 3: exact Green integral over the native conics via CurveRegion2,
    // instead of a shoelace over the tessellation.
    it('an ellipse has analytic area pi*a*b', () =>
    {
        expect(ellipse().area()!).toBeCloseTo(Math.PI * 50 * 25, 6);
    });

    // Elliptic arc length has no closed form (plan: "cannot be de-tessellated" #1). This rail
    // only guards the error budget; today it is ~4e-5 relative.
    it('an ellipse perimeter is within the chord budget', () =>
    {
        const want = ellipsePerimeter(50, 25);
        expect(Math.abs(ellipse().length() - want) / want).toBeLessThan(1e-4);
    });

    // Fixed in stage 5: Curve.Interpolated() stores the exact NURBS instead of computing
    // one and discarding it for a 1e-5 polyline (~2400 degree-1 segments).
    it('an interpolated curve is an exact spline', () =>
    {
        const s = Curve.Interpolated([0, 0, 0], [10, 10, 0], [20, 0, 0], [30, 10, 0]);
        expect(sub(s)).toBe('Spline');
        expect(s.degree()).toBeGreaterThanOrEqual(2);
        expect(segs(s)).toBeLessThan(20);
    });

    it('an interpolated curve exposes its real control net, knots and weights', () =>
    {
        const pts: [number, number, number][] = [[0, 0, 0], [10, 10, 0], [20, 0, 0], [30, 10, 0]];
        const s = Curve.Interpolated(...pts);
        // One control point per interpolated data point; knots = n + degree + 1.
        expect(s.controlPoints().length).toBe(pts.length);
        expect(s.knots().length).toBe(pts.length + s.degree()! + 1);
        // Real weights, not the empty placeholder.
        expect(s.weights().length).toBe(pts.length);
        expect(s.weights().every(w => w > 0)).toBe(true);
    });

    it('an interpolated curve passes through its data points', () =>
    {
        const pts: [number, number, number][] = [[0, 0, 0], [10, 10, 0], [20, 0, 0], [30, 10, 0]];
        const s = Curve.Interpolated(...pts);
        // Measured against the tessellated POLYLINE (point-to-segment), not against the
        // nearest vertex and not via Curve.distance(). A chord tolerance bounds how far the
        // polyline strays from the curve, not its vertex spacing, so nearest-vertex
        // overstates the error; and distance() routes through paramClosestToPoint, which is
        // itself tessellation-based, so it cannot certify better than its own sampling.
        // Point-to-segment on a fine tessellation is pure geometry and converges properly.
        const tess = s.tessellate(1e-5);
        const distToSeg = (q: number[], a: any, b: any): number =>
        {
            const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
            const len2 = abx * abx + aby * aby + abz * abz;
            const t = len2 === 0 ? 0
                : Math.max(0, Math.min(1, ((q[0] - a.x) * abx + (q[1] - a.y) * aby + (q[2] - a.z) * abz) / len2));
            return Math.hypot(a.x + abx * t - q[0], a.y + aby * t - q[1], a.z + abz * t - q[2]);
        };
        for (const q of pts)
        {
            let min = Infinity;
            for (let i = 0; i < tess.length - 1; i++) { min = Math.min(min, distToSeg(q, tess[i], tess[i + 1])); }
            // Bounded by the chord tolerance above. A curve that did NOT interpolate would
            // miss by something on the order of the data spacing (tens of units).
            expect(min).toBeLessThan(1e-3);
        }
    });
});

describe('exactness: transforms preserve representation', () =>
{
    const keepsCircle = (label: string, op: (c: Curve) => Curve | null) =>
        it(`${label} keeps a circle exact`, () =>
        {
            const out = op(circle())!;
            expect(sub(out)).toBe('Circle');
            expect(arcs(out)).toBe(true);
        });

    keepsCircle('translate', c => c.translate(10, 0, 0));
    keepsCircle('rotateZ', c => (c as any).rotateZ(30));
    keepsCircle('uniform scale', c => c.scale(2));
    keepsCircle('copy', c => c.copy());
    keepsCircle('reverse', c => c.reverse());

    it('uniform scale scales length exactly', () =>
    {
        expect(circle().scale(2).length()).toBeCloseTo(2 * CIRCLE_LEN, 9);
    });

    // Fixed in stage 10: a reflection is an isometry of the curve's plane, so only the
    // frame moves and the in-plane geometry is untouched.
    it('mirrorX keeps a circle exact', () =>
    {
        const m = circle().mirrorX();
        expect(sub(m)).toBe('Circle');
        expect(arcs(m)).toBe(true);
        expect(m.length()).toBeCloseTo(CIRCLE_LEN, 9);
    });

    // Fixed in stage 10: projecting onto a parallel plane is a rigid translation along the
    // normal, so the in-plane geometry is untouched.
    it('projectOnto its own plane is a no-op', () =>
    {
        const p = circle().projectOnto('xy');
        expect(sub(p)).toBe('Circle');
        expect(arcs(p)).toBe(true);
    });

    // Fixed in stage 10: the map a per-axis scale induces within the plane is a plain 2D
    // affine, which CurveRegion2::transform_affine applies exactly to a closed curve.
    it('non-uniform scale turns a circle into an exact ellipse', () =>
    {
        const e = circle().scale([2, 1, 1]);
        expect(sub(e)).toBe('Ellipse');
        expect(e.area()!).toBeCloseTo(Math.PI * 100 * 50, 6);
    });
});

describe('exactness: offset', () =>
{
    it('offsetting a circle yields a circle', () =>
    {
        const o = circle().offset(10)!;
        expect(sub(o)).toBe('Circle');
        expect(arcs(o)).toBe(true);
        expect(o.length()).toBeCloseTo(2 * Math.PI * 60, 9);
    });

    // Fixed in stage 4: hcurve::offset_open/offset_closed return the native result instead
    // of tessellating away the arc joins hypercurve just constructed.
    it('offsetting an arc-bearing open curve keeps its arcs', () =>
    {
        const o = arc().offset(5)!;
        expect(arcs(o)).toBe(true);
    });

    // UPSTREAM BLOCKER. hypercurve certifies exact equidistance when offsetting an arc, so
    // an arc whose centre came out of an f64 boolean is declined with `RadiusMismatch` —
    // for every sign and every distance. There is no native answer, and lowering to line
    // work first runs the exact offset over thousands of segments (seconds per call), so
    // offset() reports rather than silently paying that.
    //
    // Note this was previously "working" only by accident: subtype() called a two-circle
    // union 'Circle', so offset() took a fast path that rebuilt it as ONE circle of
    // radius+distance — a different shape entirely, which no assertion caught.
    // Explicit workaround for callers: `union.toDegree1().offset(d)`.
    it.fails('offsetting a boolean-derived arc works natively', () =>
    {
        const a = Curve.Circle(100);
        const b = a.copy().translate(150, 0, 0);
        const union = a.union(b) as Curve;
        expect(union.copy().offset(20)).not.toBeNull();
    });

    it('a boolean result can still be offset explicitly via toDegree1()', () =>
    {
        const a = Curve.Circle(100);
        const b = a.copy().translate(150, 0, 0);
        const union = a.union(b) as Curve;
        const grown = union.copy().toDegree1().offset(20);
        expect(grown).not.toBeNull();
        expect(Math.abs(grown!.area()!)).toBeGreaterThan(Math.abs(union.area()!));
    }, 30_000);

    // UPSTREAM BLOCKER, not a pending stage. Stage 4 routes a curved offset through
    // `CurvePath2::approximate_parallel_blend2d_certified`, but its own docs say adjacent
    // primitive parallels not meeting exactly — "the usual case at an authored corner" — is
    // `Unsupported`, and a closed ellipse's four conic spans are exactly that. So it
    // declines and the documented projection fallback runs. Revisit if hypercurve grows the
    // region/string offset layer that would pick a miter/round/bevel join there.
    it.fails('offsetting an ellipse stays an ellipse-family curve', () =>
    {
        const o = ellipse().offset(5)!;
        expect(sub(o)).not.toBe('Polyline');
    });
});

describe('exactness: booleans', () =>
{
    it('circle union rect stays native', () =>
    {
        const u = circle().union(Curve.Rect(20, 20)) as Curve;
        expect(sub(u)).toBe('Circle');
        expect(arcs(u)).toBe(true);
    });

    // Fixed in stage 8: an exact operand goes through CurveRegion2's mixed-family region
    // boolean, instead of being tessellated into a line contour for boolean_native.
    it('ellipse union rect stays a curved region', () =>
    {
        const u = ellipse().union(Curve.Rect(20, 20)) as Curve;
        expect(sub(u)).not.toBe('Polyline');
    });
});

describe('exactness: joins preserve arcs', () =>
{
    // Fixed in stage 9: close() appends a closing span to the exact geometry instead of
    // rebuilding from controlPoints() (span ENDPOINTS), which made a semicircle a chord.
    it('close() keeps an arc', () =>
    {
        const c = arc().close();
        expect(arcs(c)).toBe(true);
        expect(c.length()).toBeCloseTo(ARC_LEN + 20, 6);
    });

    // Fixed in stage 9: extend() appends a straight span along the endpoint tangent.
    it('extend() keeps an arc', () =>
    {
        const e = arc().extend(5);
        expect(arcs(e)).toBe(true);
        expect(e.length()).toBeCloseTo(ARC_LEN + 5, 6);
    });

    // Fixed in stage 9. This was the reason Sketch().lineTo().arcTo().close() lost its
    // arcs — every Sketch.end() funnels through Compound().
    it('Compound() keeps an arc', () =>
    {
        const c = Curve.Compound([arc(), Curve.Line([20, 0, 0], [30, 0, 0])]);
        expect(arcs(c)).toBe(true);
        expect(c.length()).toBeCloseTo(ARC_LEN + 10, 6);
    });
});

describe('exactness: metrics', () =>
{
    it('an axis-aligned circle bbox spans exactly +-r', () =>
    {
        const bb = circle().bbox()!;
        expect(bb.min().x).toBeCloseTo(-R, 9);
        expect(bb.max().x).toBeCloseTo(R, 9);
        expect(bb.min().y).toBeCloseTo(-R, 9);
        expect(bb.max().y).toBeCloseTo(R, 9);
    });

    // UPSTREAM BLOCKER, not a pending stage. bbox() is now solved exactly for line and
    // circular-arc carriers, but `CurvePath2::bounds()` on a conic returns
    // `Blocked(NativeTopology, RationalQuadraticBezier, Ordering)` — hypercurve cannot
    // decide bounds for a rational-quadratic span. An ellipse therefore still falls back to
    // min/max over a certified projection and under-reports a rotated extent by ~4e-3.
    // Revisit if hypercurve gains exact conic bounds.
    it.fails('a rotated ellipse bbox reaches its true extent', () =>
    {
        const a = 50, b = 25, t = Math.PI / 6;
        const want = Math.sqrt(a * a * Math.cos(t) ** 2 + b * b * Math.sin(t) ** 2);
        expect(Curve.Ellipse(a, b, [0, 0, 0], 30).bbox()!.max().x).toBeCloseTo(want, 6);
    });

    // Line/arc bounds ARE solved exactly (arc extrema are computed, not sampled), so the
    // apex is hit to full precision rather than to within a chord sagitta.
    it('a semicircular arc bbox reaches its apex exactly', () =>
    {
        expect(arc().bbox()!.max().y).toBeCloseTo(10, 9);
    });

    // Regression guard. The exact box is a support query per world axis, and a world axis
    // maps to an in-plane direction that is NOT a unit vector unless the curve's plane
    // happens to be axis-aligned. Forgetting to scale by its length inflates the box only
    // on a tilted plane — every axis-aligned case still looks perfect. This line's plane is
    // tilted, so it catches that.
    it('bbox is correct on a plane tilted to the world axes', () =>
    {
        const bb = Curve.Line([1, 2, 3], [4, 5, 6]).bbox()!;
        expect(bb.min().x).toBeCloseTo(1, 9);
        expect(bb.max().x).toBeCloseTo(4, 9);
        expect(bb.min().y).toBeCloseTo(2, 9);
        expect(bb.max().y).toBeCloseTo(5, 9);
        expect(bb.min().z).toBeCloseTo(3, 9);
        expect(bb.max().z).toBeCloseTo(6, 9);
    });

    // A circle in the YZ plane: zero extent along X, exact +-r on the other two.
    it('bbox is exact for a circle in a non-XY plane', () =>
    {
        const bb = Curve.Circle(4, [0, 0, 10], [1, 0, 0]).bbox()!;
        expect(bb.min().x).toBeCloseTo(0, 9);
        expect(bb.max().x).toBeCloseTo(0, 9);
        expect(bb.min().y).toBeCloseTo(-4, 9);
        expect(bb.max().y).toBeCloseTo(4, 9);
        expect(bb.min().z).toBeCloseTo(6, 9);
        expect(bb.max().z).toBeCloseTo(14, 9);
    });

    // Fixed in stage 6: arc length is closed-form for lines and arcs, so the containing
    // segment and the position within it are solved exactly and evaluated natively —
    // rather than lerping between two tessellation samples, which landed off-curve.
    it('pointAtPerc lands exactly on a circle', () =>
    {
        for (const t of [0.25, 0.5, 0.75])
        {
            const p = circle().pointAtPerc(t)!;
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(R, 9);
        }
    });

    it('pointAtPerc stays within the chord budget on a circle', () =>
    {
        for (const t of [0.25, 0.5, 0.75])
        {
            const p = circle().pointAtPerc(t)!;
            expect(Math.hypot(p.x, p.y)).toBeCloseTo(R, 5);
        }
    });

    it('intersecting a circle with a diameter line hits both poles', () =>
    {
        const hits = circle().intersect(Curve.Line([-100, 0, 0], [100, 0, 0]))!;
        expect(hits.length).toBe(2);
        for (const h of hits) { expect(Math.abs(h.x)).toBeCloseTo(R, 9); }
    });
});
