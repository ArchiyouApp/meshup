//! f64-facing helpers over the [`hypercurve`] exact-arithmetic planar kernel.
//!
//! meshup works in `f64` (`crate::float_types::Real`), while `hypercurve` works
//! in exact rationals (`hyperreal::Real`). This module is the single bridge
//! between the two worlds for the migration off `curvo`:
//!
//! * f64 crosses *into* hypercurve only at construction ([`point`], the
//!   polyline builders), converting each coordinate to an exact `Real`.
//! * hypercurve crosses *back out* only through finite projection
//!   ([`tessellate_open`] / [`tessellate_closed`] / [`boolean_rings`]), which
//!   sample exact geometry to `f64` polylines with a bounded chord error.
//!
//! Only the planar (2D) surface is modelled here; meshup lifts these local‑XY
//! results back into 3D via the curve's stored plane/frame on the TypeScript
//! side. Everything is expressed with owned `Vec<[f64; 2]>` rings so the WASM
//! bindings can stay thin.

use hypercurve::{
    ArcArcIntersection, BezierFlatteningOptions, BezierSubcurve2, BooleanOp, Classification,
    CircularArc2, Contour2, CurvePolicy, CurveString2, FillRule, FiniteProjectionOptions,
    LineArcIntersection, LineLineIntersection, LineSeg2, Point2, RationalBSplineCurve2, Real,
    Region2, RegionView2, Segment2, SegmentIntersection, Similarity2, Tolerance,
};

/// Default chord error used when sampling exact arcs/curves to f64 polylines.
/// Small enough for display/meshing, large enough to keep vertex counts sane.
pub const DEFAULT_CHORD_ERROR: f64 = 1.0e-4;

/// Convert an f64 to an exact [`Real`], rejecting NaN / infinities.
#[inline]
pub fn real(x: f64) -> Result<Real, String>
{
    Real::try_from(x).map_err(|_| format!("hcurve: non-finite coordinate {x}"))
}

/// Build an exact [`Point2`] from an f64 pair.
#[inline]
pub fn point(x: f64, y: f64) -> Result<Point2, String>
{
    Ok(Point2::new(real(x)?, real(y)?))
}

/// The shared operation policy. `hypercurve` threads a [`CurvePolicy`] through
/// every predicate; the default is the standard exact/escalating mode.
#[inline]
pub fn policy() -> CurvePolicy
{
    CurvePolicy::default()
}

/// Policy for region booleans. The strict `certified` default *declines*
/// arc↔line region topology (returning `Uncertain`), so booleans between circles
/// and polygons never resolve. `edge_preview` is hypercurve's tolerance-aware
/// policy for exactly this boundary — it decides arc/line/tangency cases quickly
/// while staying on native geometry (no tessellation).
#[inline]
pub fn boolean_policy() -> CurvePolicy
{
    boolean_policy_with(1.0e-9, 1.0e-12)
}

#[inline]
fn boolean_policy_with(point: f64, area: f64) -> CurvePolicy
{
    CurvePolicy::edge_preview(Tolerance::new(point, area))
}

/// A native boolean-result region: an exact exterior contour plus the exact hole
/// contours it owns — **arcs/lines preserved, nothing tessellated**. Feeding these
/// straight back into further booleans keeps chained ops fast and compact.
pub struct NativeRegion
{
    pub exterior: Contour2,
    pub holes: Vec<Contour2>,
}

/// Region boolean between two filled contours, returning **native** exact
/// contours (no finite projection). Holes are associated to their material
/// exterior by exact containment. Returns `None` when hypercurve declines the
/// topology (caller may fall back to another engine).
pub fn boolean_native(a: &Contour2, b: &Contour2, op: BooleanOp) -> Option<Vec<NativeRegion>>
{
    // First try the exact geometry with an escalating edge tolerance: the tight default
    // declines vertex-coincident / near-tangent topology (e.g. a circle passing exactly
    // through a rectangle corner). A slightly looser tolerance decides most of those.
    boolean_native_once(a, b, op, &[(1.0e-9, 1.0e-12), (1.0e-7, 1.0e-10), (1.0e-5, 1.0e-8)]).or_else(|| {
        // Still declined — the contact is exactly degenerate (an intersection landing on a
        // shared vertex, e.g. a circle through a rectangle corner). Nudge `b` by a small
        // offset to turn the coincidence into a clean crossing (Simulation-of-Simplicity
        // style), then decide at the tight tolerance. The offset must exceed the loosest
        // tolerance above so it reads as a real crossing, yet stays below display
        // resolution — the result is geometrically indistinguishable.
        const EPS: f64 = 1.0e-4;
        let nudges = [(EPS, 0.0), (0.0, EPS), (-EPS, EPS)];
        nudges.iter().find_map(|&(dx, dy)| {
            let moved = transform_contour(b, &similarity(1.0, 0.0, 0.0, 1.0, dx, dy).ok()?).ok()?;
            boolean_native_once(a, &moved, op, &[(1.0e-9, 1.0e-12)])
        })
    })
}

/// One boolean attempt over the exact contours, trying each `(point, area)` edge
/// tolerance in order and returning the first decided result.
fn boolean_native_once(a: &Contour2, b: &Contour2, op: BooleanOp, ladder: &[(f64, f64)]) -> Option<Vec<NativeRegion>>
{
    let a_view = RegionView2::new(std::slice::from_ref(a), &[]);
    let b_view = RegionView2::new(std::slice::from_ref(b), &[]);
    ladder.iter().find_map(|&(pt, ar)| {
        let pol = boolean_policy_with(pt, ar);
        match a_view.boolean_region(&b_view, op, FillRule::NonZero, &pol).ok()?
        {
            Classification::Decided(r) => Some(associate_holes(&r, &pol)),
            Classification::Uncertain(_) => None,
        }
    })
}

/// Group a region's material and hole contours into [`NativeRegion`]s, assigning
/// each hole to the material contour that contains it.
fn associate_holes(region: &Region2, pol: &CurvePolicy) -> Vec<NativeRegion>
{
    let materials = region.material_contours();
    let holes = region.hole_contours();
    let mut out: Vec<NativeRegion> = materials
        .iter()
        .map(|m| NativeRegion { exterior: m.clone(), holes: Vec::new() })
        .collect();

    for hole in holes
    {
        // A representative point of the hole, classified against each material.
        let probe = match hole.segments().first()
        {
            Some(seg) => seg.representative_point(pol),
            None => continue,
        };
        let probe = match probe
        {
            Ok(Classification::Decided(p)) => p,
            _ => continue,
        };
        let idx = out
            .iter()
            .position(|nr| {
                matches!(nr.exterior.winding_number(&probe, pol), Classification::Decided(w) if w != 0)
            })
            .or(if out.is_empty() { None } else { Some(0) });
        if let Some(i) = idx
        {
            out[i].holes.push(hole.clone());
        }
    }
    out
}

/// Unwrap a `hypercurve` `Classification`, turning uncertainty into an error.
fn decided<T>(c: Classification<T>) -> Result<T, String>
{
    match c
    {
        Classification::Decided(v) => Ok(v),
        Classification::Uncertain(reason) => Err(format!("hcurve: undecided ({reason:?})")),
    }
}

/// Build a chain of line [`Segment2`]s through the given f64 points.
/// Consecutive coincident points are skipped so degenerate zero-length
/// segments (which `LineSeg2::try_new` rejects) do not abort the whole chain.
fn line_segments(points: &[[f64; 2]]) -> Result<Vec<Segment2>, String>
{
    let pts: Vec<Point2> = points
        .iter()
        .map(|[x, y]| point(*x, *y))
        .collect::<Result<_, _>>()?;

    let mut segs: Vec<Segment2> = Vec::new();
    let mut prev: Option<&Point2> = None;
    for p in &pts
    {
        if let Some(a) = prev
        {
            // Skip coincident points (exact equality) to avoid zero-length segs.
            if a == p
            {
                continue;
            }
            let seg = LineSeg2::try_new(a.clone(), p.clone())
                .map_err(|e| format!("hcurve: line segment failed ({e:?})"))?;
            segs.push(Segment2::Line(seg));
        }
        prev = Some(p);
    }
    Ok(segs)
}

/// Build an **open** polyline curve string from f64 points.
pub fn open_polyline(points: &[[f64; 2]]) -> Result<CurveString2, String>
{
    let segs = line_segments(points)?;
    CurveString2::try_new(segs).map_err(|e| format!("hcurve: open polyline failed ({e:?})"))
}

/// Build a **closed** contour from f64 points. A trailing point coincident with
/// the first is treated as the implicit closing vertex and dropped.
pub fn closed_contour(points: &[[f64; 2]]) -> Result<Contour2, String>
{
    let mut segs = line_segments(points)?;
    // Contour2 is implicitly closed; add the closing segment if the ring's last
    // authored point does not already return to the start.
    if let (Some(first), Some(last)) = (points.first(), points.last())
    {
        let a = point(last[0], last[1])?;
        let b = point(first[0], first[1])?;
        if a != b
        {
            let seg = LineSeg2::try_new(a, b)
                .map_err(|e| format!("hcurve: closing segment failed ({e:?})"))?;
            segs.push(Segment2::Line(seg));
        }
    }
    Contour2::try_new(segs).map_err(|e| format!("hcurve: closed contour failed ({e:?})"))
}

fn projection_options(chord_error: f64) -> Result<FiniteProjectionOptions, String>
{
    FiniteProjectionOptions::try_new(chord_error)
        .map_err(|e| format!("hcurve: projection options failed ({e:?})"))
}

/// Sample an open curve string to an f64 polyline.
pub fn tessellate_open(cs: &CurveString2, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let opts = projection_options(chord_error)?;
    cs.project_to_finite_polyline(&opts)
        .map(|poly| poly.into_points())
        .map_err(|e| format!("hcurve: tessellate open failed ({e:?})"))
}

/// Sample a closed contour to an f64 ring (first point repeated at the end).
pub fn tessellate_closed(ct: &Contour2, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let opts = projection_options(chord_error)?;
    ct.project_to_finite_ring(&opts)
        .map(|poly| poly.into_points())
        .map_err(|e| format!("hcurve: tessellate closed failed ({e:?})"))
}

/// Signed area of a closed contour (positive CCW), in f64.
pub fn signed_area(ct: &Contour2) -> Result<f64, String>
{
    match ct.signed_area()
    {
        Ok(Some(area)) => area
            .to_f64_lossy()
            .ok_or_else(|| "hcurve: area not representable as f64".to_string()),
        Ok(None) => Err("hcurve: area undefined (open/degenerate contour)".to_string()),
        Err(e) => Err(format!("hcurve: signed_area failed ({e:?})")),
    }
}

/// Region boolean between two filled contours, returning the resulting material
/// rings as f64 polylines. `op` selects union / intersection / difference / xor.
pub fn boolean_rings(
    a: &Contour2,
    b: &Contour2,
    op: BooleanOp,
    chord_error: f64,
) -> Result<Vec<Vec<[f64; 2]>>, String>
{
    let pol = policy();
    let a_slice = std::slice::from_ref(a);
    let b_slice = std::slice::from_ref(b);
    let a_view = RegionView2::new(a_slice, &[]);
    let b_view = RegionView2::new(b_slice, &[]);

    let region = decided(
        a_view
            .boolean_region(&b_view, op, FillRule::NonZero, &pol)
            .map_err(|e| format!("hcurve: boolean failed ({e:?})"))?,
    )?;

    let opts = projection_options(chord_error)?;
    let proj = region
        .project_to_finite_region(&opts)
        .map_err(|e| format!("hcurve: boolean projection failed ({e:?})"))?;

    Ok(proj
        .material_rings()
        .iter()
        .map(|ring| ring.points().to_vec())
        .collect())
}

/// Build a closed circle contour centred at `(cx, cy)` with radius `r`, as two
/// semicircular arcs (hypercurve represents arcs exactly, so a circle needs no
/// tessellation until projection). CCW orientation (positive signed area).
pub fn circle(cx: f64, cy: f64, r: f64) -> Result<Contour2, String>
{
    if !(r.is_finite() && r > 0.0)
    {
        return Err(format!("hcurve: invalid circle radius {r}"));
    }
    let right = point(cx + r, cy)?;
    let left = point(cx - r, cy)?;
    let bulge = real(1.0)?; // 180° arc: bulge = tan(90°/2) = 1
    // Top semicircle right→left, bottom semicircle left→right; both CCW.
    let top = Segment2::from_bulge(right.clone(), left.clone(), bulge.clone())
        .map_err(|e| format!("hcurve: circle top arc failed ({e:?})"))?;
    let bottom = Segment2::from_bulge(left, right, bulge)
        .map_err(|e| format!("hcurve: circle bottom arc failed ({e:?})"))?;
    Contour2::try_new(vec![top, bottom]).map_err(|e| format!("hcurve: circle contour failed ({e:?})"))
}

/// Build a planar similarity transform from f64 affine entries
/// (`x' = a·x + b·y + xoff`, `y' = d·x + e·y + yoff`). hypercurve only supports
/// **similarities** (uniform scale + rotation + reflection + translation); a
/// non-uniform scale / shear is rejected as `InvalidSimilarityTransform`.
pub fn similarity(a: f64, b: f64, d: f64, e: f64, xoff: f64, yoff: f64) -> Result<Similarity2, String>
{
    // Tolerance for accepting f64 matrix entries as a similarity.
    Similarity2::try_from_f64_affine(a, b, d, e, xoff, yoff, 1.0e-9)
        .map_err(|err| format!("hcurve: similarity transform rejected ({err:?})"))
}

/// Apply a similarity to a closed contour.
pub fn transform_contour(ct: &Contour2, s: &Similarity2) -> Result<Contour2, String>
{
    ct.transform_similarity(s)
        .map_err(|e| format!("hcurve: contour transform failed ({e:?})"))
}

/// Apply a similarity to an open curve string.
pub fn transform_open(cs: &CurveString2, s: &Similarity2) -> Result<CurveString2, String>
{
    cs.transform_similarity(s)
        .map_err(|e| format!("hcurve: curve string transform failed ({e:?})"))
}

/// Convert an exact [`Point2`] back to an f64 pair (lossy).
fn point_to_f64(p: &Point2) -> Option<[f64; 2]>
{
    Some([p.x().to_f64_lossy()?, p.y().to_f64_lossy()?])
}

/// Build a rational B-spline / NURBS curve from f64 control points, weights and
/// knots. `degree` must be >= 2 (degree-1 "NURBS" are polylines — use
/// [`open_polyline`]). Weights must be nonzero; the knot vector must be
/// nondecreasing, clamped, and of length `control_points.len() + degree + 1`.
pub fn nurbs(
    degree: usize,
    control_points: &[[f64; 2]],
    weights: &[f64],
    knots: &[f64],
) -> Result<RationalBSplineCurve2, String>
{
    let pol = policy();
    let cps: Vec<Point2> = control_points
        .iter()
        .map(|[x, y]| point(*x, *y))
        .collect::<Result<_, _>>()?;
    let w: Vec<Real> = weights.iter().map(|v| real(*v)).collect::<Result<_, _>>()?;
    let k: Vec<Real> = knots.iter().map(|v| real(*v)).collect::<Result<_, _>>()?;
    decided(
        RationalBSplineCurve2::try_new(degree, cps, w, k, &pol)
            .map_err(|e| format!("hcurve: nurbs construction failed ({e:?})"))?,
    )
}

/// Find the knot span index containing parameter `u` (Piegl & Tiller A2.1).
fn find_span(n: usize, degree: usize, u: f64, knots: &[f64]) -> usize
{
    if u >= knots[n + 1]
    {
        return n;
    }
    if u <= knots[degree]
    {
        return degree;
    }
    let (mut low, mut high) = (degree, n + 1);
    let mut mid = (low + high) / 2;
    while u < knots[mid] || u >= knots[mid + 1]
    {
        if u < knots[mid]
        {
            high = mid;
        }
        else
        {
            low = mid;
        }
        mid = (low + high) / 2;
    }
    mid
}

/// Non-vanishing B-spline basis functions at `u` in `span` (Piegl & Tiller A2.2).
fn basis_functions(span: usize, u: f64, degree: usize, knots: &[f64]) -> Vec<f64>
{
    let mut n = vec![0.0f64; degree + 1];
    let mut left = vec![0.0f64; degree + 1];
    let mut right = vec![0.0f64; degree + 1];
    n[0] = 1.0;
    for j in 1..=degree
    {
        left[j] = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        let mut saved = 0.0;
        for r in 0..j
        {
            let temp = n[r] / (right[r + 1] + left[j - r]);
            n[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        n[j] = saved;
    }
    n
}

/// Solve `A x = b` in place via Gaussian elimination with partial pivoting.
/// `a` is row-major `m x m`; `b` has `m` right-hand-side columns solved together.
fn solve_linear(mut a: Vec<Vec<f64>>, mut b: Vec<Vec<f64>>) -> Result<Vec<Vec<f64>>, String>
{
    let m = a.len();
    for col in 0..m
    {
        // Partial pivot.
        let mut pivot = col;
        for r in (col + 1)..m
        {
            if a[r][col].abs() > a[pivot][col].abs()
            {
                pivot = r;
            }
        }
        if a[pivot][col].abs() < 1e-12
        {
            return Err("hcurve: singular interpolation matrix".to_string());
        }
        a.swap(col, pivot);
        b.swap(col, pivot);
        // Eliminate.
        for r in 0..m
        {
            if r == col
            {
                continue;
            }
            let f = a[r][col] / a[col][col];
            for k in col..m
            {
                a[r][k] -= f * a[col][k];
            }
            for k in 0..b[0].len()
            {
                b[r][k] -= f * b[col][k];
            }
        }
    }
    for r in 0..m
    {
        let d = a[r][r];
        for k in 0..b[0].len()
        {
            b[r][k] /= d;
        }
    }
    Ok(b)
}

/// Global interpolation: build a NURBS curve of `degree` (>= 2) passing exactly
/// through `points`, using chord-length parameters and an averaged knot vector
/// (Piegl & Tiller, *The NURBS Book*, §9.2.1). Weights are all 1.
pub fn nurbs_interpolate(points: &[[f64; 2]], degree: usize) -> Result<RationalBSplineCurve2, String>
{
    let n = points.len();
    if degree < 2 || n < degree + 1
    {
        return Err(format!(
            "hcurve: interpolation needs degree>=2 and at least degree+1 points (got degree {degree}, {n} points)"
        ));
    }

    // Chord-length parameters in [0, 1].
    let mut chord = vec![0.0f64; n];
    let mut total = 0.0;
    for k in 1..n
    {
        let d = ((points[k][0] - points[k - 1][0]).powi(2)
            + (points[k][1] - points[k - 1][1]).powi(2))
        .sqrt();
        total += d;
        chord[k] = total;
    }
    if total < 1e-12
    {
        return Err("hcurve: interpolation points are coincident".to_string());
    }
    let u: Vec<f64> = chord.iter().map(|c| c / total).collect();

    // Averaged knot vector: length n + degree + 1, clamped at both ends.
    let m = n + degree + 1;
    let mut knots = vec![0.0f64; m];
    for i in (m - degree - 1)..m
    {
        knots[i] = 1.0;
    }
    for j in 1..=(n - degree - 1)
    {
        let mut s = 0.0;
        for i in j..(j + degree)
        {
            s += u[i];
        }
        knots[j + degree] = s / degree as f64;
    }

    // Coefficient matrix A[k][i] = N_{i,degree}(u_k); solve A P = Q for x and y.
    let mut a = vec![vec![0.0f64; n]; n];
    for k in 0..n
    {
        let span = find_span(n - 1, degree, u[k], &knots);
        let bf = basis_functions(span, u[k], degree, &knots);
        for (r, &val) in bf.iter().enumerate()
        {
            a[k][span - degree + r] = val;
        }
    }
    let rhs: Vec<Vec<f64>> = points.iter().map(|p| vec![p[0], p[1]]).collect();
    let ctrl = solve_linear(a, rhs)?;

    let control_points: Vec<[f64; 2]> = ctrl.iter().map(|c| [c[0], c[1]]).collect();
    let weights = vec![1.0f64; n];
    nurbs(degree, &control_points, &weights, &knots)
}

/// Degree of a NURBS curve.
pub fn nurbs_degree(c: &RationalBSplineCurve2) -> usize
{
    c.degree()
}

/// Control points of a NURBS curve as f64 pairs.
pub fn nurbs_control_points(c: &RationalBSplineCurve2) -> Vec<[f64; 2]>
{
    c.control_points().iter().filter_map(point_to_f64).collect()
}

/// Weights of a NURBS curve as f64 values.
pub fn nurbs_weights(c: &RationalBSplineCurve2) -> Vec<f64>
{
    c.weights().iter().filter_map(|r| r.to_f64_lossy()).collect()
}

/// Knot vector of a NURBS curve as f64 values.
pub fn nurbs_knots(c: &RationalBSplineCurve2) -> Vec<f64>
{
    c.knots().iter().filter_map(|r| r.to_f64_lossy()).collect()
}

/// Append `pts` onto `out`, dropping a leading point coincident with `out`'s
/// current last vertex (adjacent bezier spans share an endpoint).
fn append_dedup(out: &mut Vec<[f64; 2]>, pts: &[[f64; 2]])
{
    for p in pts
    {
        if out.last() != Some(p)
        {
            out.push(*p);
        }
    }
}

/// Tessellate a NURBS curve to an f64 polyline. Extracts exact Bezier spans and
/// flattens each: polynomial (quadratic/cubic) spans use hypercurve's certified
/// adaptive flattening; rational-quadratic spans are sampled by parameter.
pub fn tessellate_nurbs(c: &RationalBSplineCurve2, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let pol = policy();
    let extraction = decided(
        c.extract_bezier_spans(&pol)
            .map_err(|e| format!("hcurve: bezier extraction failed ({e:?})"))?,
    )?;
    let subcurves = decided(
        extraction
            .native_subcurves(&pol)
            .map_err(|e| format!("hcurve: native subcurves failed ({e:?})"))?,
    )?;
    let opts = BezierFlatteningOptions::try_new(real(chord_error)?, 24, &pol)
        .map_err(|e| format!("hcurve: flattening options failed ({e:?})"))?;

    let mut out: Vec<[f64; 2]> = Vec::new();
    for sub in &subcurves
    {
        let span_pts: Vec<[f64; 2]> = match sub
        {
            BezierSubcurve2::Quadratic(q) =>
            {
                let poly = decided(q.flatten_certified(&opts, &pol))?;
                poly.points().iter().filter_map(point_to_f64).collect()
            }
            BezierSubcurve2::Cubic(cu) =>
            {
                let poly = decided(cu.flatten_certified(&opts, &pol))?;
                poly.points().iter().filter_map(point_to_f64).collect()
            }
            BezierSubcurve2::RationalQuadratic(rq) =>
            {
                // No certified flattening for conic spans; sample by parameter.
                const SAMPLES: usize = 24;
                (0..=SAMPLES)
                    .map(|i| i as f64 / SAMPLES as f64)
                    .map(|t| -> Result<[f64; 2], String> {
                        let pt = decided(rq.point_at(real(t)?, &pol))?;
                        point_to_f64(&pt).ok_or_else(|| "hcurve: rational point not finite".to_string())
                    })
                    .collect::<Result<_, _>>()?
            }
            other @ BezierSubcurve2::Rational(_) =>
            {
                // General rational bezier: sample via the subcurve's own evaluator.
                const SAMPLES: usize = 24;
                (0..=SAMPLES)
                    .map(|i| i as f64 / SAMPLES as f64)
                    .map(|t| -> Result<[f64; 2], String> {
                        let pt = decided(other.point_at(&real(t)?, &pol))?;
                        point_to_f64(&pt).ok_or_else(|| "hcurve: rational point not finite".to_string())
                    })
                    .collect::<Result<_, _>>()?
            }
        };
        append_dedup(&mut out, &span_pts);
    }
    Ok(out)
}

/// Build an **open** single-arc curve string through three f64 points
/// (`start`, `mid`, `end`). The circle is the circumcircle of the three points;
/// the sweep direction is chosen so the arc passes through `mid`. Returns an
/// error if the points are collinear (no finite circumcircle).
pub fn arc_3pt(start: [f64; 2], mid: [f64; 2], end: [f64; 2]) -> Result<CurveString2, String>
{
    let (ax, ay) = (start[0], start[1]);
    let (bx, by) = (mid[0], mid[1]);
    let (cx, cy) = (end[0], end[1]);

    // Circumcenter via the standard determinant formula.
    let d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if d.abs() < 1.0e-12
    {
        return Err("hcurve: arc_3pt points are collinear".to_string());
    }
    let a2 = ax * ax + ay * ay;
    let b2 = bx * bx + by * by;
    let c2 = cx * cx + cy * cy;
    let ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    let uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;

    // Build via CAD "bulge" (tan(sweep/4)) rather than try_from_center: the exact
    // engine rejects a center whose start/end radii differ (our f64 circumcenter is
    // only approximately equidistant), whereas from_bulge derives a consistent center.
    let vs = (ax - ux, ay - uy);
    let vm = (bx - ux, by - uy);
    let ve = (cx - ux, cy - uy);
    let cross = |p: (f64, f64), q: (f64, f64)| p.0 * q.1 - p.1 * q.0;
    let dot = |p: (f64, f64), q: (f64, f64)| p.0 * q.0 + p.1 * q.1;
    let mut sweep = cross(vs, ve).atan2(dot(vs, ve)); // signed, in (-pi, pi]
    // If `mid` is not on the direct (minor) arc, take the reflex arc instead.
    let se = cross(vs, ve);
    let on_direct = se == 0.0
        || (cross(vs, vm).signum() == se.signum() && cross(vm, ve).signum() == se.signum());
    if !on_direct
    {
        sweep -= sweep.signum() * 2.0 * std::f64::consts::PI;
    }
    let bulge = (sweep / 4.0).tan();

    let arc = Segment2::from_bulge(point(ax, ay)?, point(cx, cy)?, real(bulge)?)
        .map_err(|e| format!("hcurve: arc_3pt from_bulge failed ({e:?})"))?;
    CurveString2::try_new(vec![arc])
        .map_err(|e| format!("hcurve: arc_3pt curve string failed ({e:?})"))
}

/// One-sided offset of an **open** curve string by `distance` (positive = left
/// of travel direction, negative = right), returning the offset as an f64
/// polyline. This is hypercurve's raw miter/arc-join offset — it does **not**
/// trim self-intersections, so meshup keeps the geo-buf straight-skeleton path
/// as a robust fallback for general profiles.
pub fn offset_open(cs: &CurveString2, distance: f64, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let pol = policy();
    let offset = decided(
        cs.offset_left_with_line_joins(real(distance)?, &pol)
            .map_err(|e| format!("hcurve: open offset failed ({e:?})"))?,
    )?;
    tessellate_open(&offset, chord_error)
}

/// One-sided offset of a **closed** contour by `distance` (sign relative to the
/// contour's winding), returning the offset ring as an f64 polyline.
pub fn offset_closed(ct: &Contour2, distance: f64, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let pol = policy();
    let offset = decided(
        ct.offset_left_with_line_joins(real(distance)?, &pol)
            .map_err(|e| format!("hcurve: closed offset failed ({e:?})"))?,
    )?;
    tessellate_closed(&offset, chord_error)
}

/// A boolean-result region: an exterior ring plus the hole rings it owns, all as
/// f64 polylines. Hole ownership is decided by hypercurve's exact region topology.
pub struct BooleanRegion
{
    pub exterior: Vec<[f64; 2]>,
    pub holes: Vec<Vec<[f64; 2]>>,
}

/// Region boolean between two filled contours, returning one [`BooleanRegion`]
/// per output material region **with its holes correctly associated**.
pub fn boolean_regions(
    a: &Contour2,
    b: &Contour2,
    op: BooleanOp,
    chord_error: f64,
) -> Result<Vec<BooleanRegion>, String>
{
    let pol = policy();
    let a_slice = std::slice::from_ref(a);
    let b_slice = std::slice::from_ref(b);
    let a_view = RegionView2::new(a_slice, &[]);
    let b_view = RegionView2::new(b_slice, &[]);

    let region = decided(
        a_view
            .boolean_region(&b_view, op, FillRule::NonZero, &pol)
            .map_err(|e| format!("hcurve: boolean failed ({e:?})"))?,
    )?;

    let opts = projection_options(chord_error)?;
    let profiles = decided(
        region
            .project_to_finite_profiles(&opts, &pol)
            .map_err(|e| format!("hcurve: region profile projection failed ({e:?})"))?,
    )?;

    Ok(profiles
        .iter()
        .map(|p| BooleanRegion {
            exterior: p.material().points().to_vec(),
            holes: p.holes().iter().map(|h| h.points().to_vec()).collect(),
        })
        .collect())
}

/// Collect the intersection point(s) carried by a single segment-pair relation.
fn segment_intersection_points(rel: &SegmentIntersection, out: &mut Vec<[f64; 2]>)
{
    let mut push = |p: &Point2| {
        if let Some(xy) = point_to_f64(p)
        {
            out.push(xy);
        }
    };
    match rel
    {
        SegmentIntersection::LineLine(LineLineIntersection::Point { point, .. }) => push(point),
        SegmentIntersection::LineArc { result, .. } => match result
        {
            LineArcIntersection::Point(hit) => push(&hit.point),
            LineArcIntersection::TwoPoints { first, second } =>
            {
                push(&first.point);
                push(&second.point);
            }
            _ =>
            {}
        },
        SegmentIntersection::ArcArc(arc) => match arc
        {
            ArcArcIntersection::Point(hit) => push(&hit.point),
            ArcArcIntersection::TwoPoints { first, second } =>
            {
                push(&first.point);
                push(&second.point);
            }
            _ =>
            {}
        },
        // None / Overlap / Uncertain carry no isolated crossing point.
        _ =>
        {}
    }
}

/// Intersection points between two open curve strings, as f64 pairs.
/// Near-duplicate hits (shared segment endpoints) are merged.
pub fn intersect_open(a: &CurveString2, b: &CurveString2) -> Result<Vec<[f64; 2]>, String>
{
    let pol = policy();
    let relations = a
        .intersect_curve_string(b, &pol)
        .map_err(|e| format!("hcurve: curve intersection failed ({e:?})"))?;

    let mut pts: Vec<[f64; 2]> = Vec::new();
    for rel in &relations
    {
        segment_intersection_points(&rel.relation, &mut pts);
    }

    // Merge points that coincide within a small tolerance.
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for p in pts
    {
        if !merged
            .iter()
            .any(|q| (q[0] - p[0]).abs() < 1e-9 && (q[1] - p[1]).abs() < 1e-9)
        {
            merged.push(p);
        }
    }
    Ok(merged)
}

/// Exact length of a single native segment: a straight segment via its exact
/// squared length, a circular arc via `radius · swept-angle`. `None` if a scalar
/// is not finitely representable.
pub fn segment_length(seg: &Segment2) -> Option<f64>
{
    match seg
    {
        Segment2::Line(l) => l.length_squared().to_f64_lossy().map(f64::sqrt),
        Segment2::Arc(a) =>
        {
            let pol = policy();
            let r2 = a.radius_squared().to_f64_lossy()?;
            if r2 <= 0.0
            {
                return Some(0.0);
            }
            let mid = match a.representative_point(&pol).ok()?
            {
                Classification::Decided(p) => p,
                Classification::Uncertain(_) => return None,
            };
            let c = a.center();
            let (cx, cy) = (c.x().to_f64_lossy()?, c.y().to_f64_lossy()?);
            let vec = |p: &Point2| -> Option<(f64, f64)> {
                Some((p.x().to_f64_lossy()? - cx, p.y().to_f64_lossy()? - cy))
            };
            let u = vec(a.start())?;
            let m = (mid.x().to_f64_lossy()? - cx, mid.y().to_f64_lossy()? - cy);
            let w = vec(a.end())?;
            // Sweep = angle(start,mid) + angle(mid,end); each half <= pi, so the
            // unsigned acos is exact for the swept portion (mid is the arc midpoint).
            let ang = |a: (f64, f64), b: (f64, f64)| ((a.0 * b.0 + a.1 * b.1) / r2).clamp(-1.0, 1.0).acos();
            Some(r2.sqrt() * (ang(u, m) + ang(m, w)))
        }
    }
}

/// A sub-segment of `seg` spanning normalized arc-length fractions `[u0, u1]`
/// (both in `[0, 1]`), preserving the native line/arc type. For arcs the
/// fraction is a directed sweep fraction (== arc-length fraction at constant
/// radius), so no tessellation is introduced.
fn subsegment(seg: &Segment2, u0: f64, u1: f64) -> Result<Segment2, String>
{
    if u0 <= 0.0 && u1 >= 1.0
    {
        return Ok(seg.clone());
    }
    match seg
    {
        Segment2::Line(l) =>
        {
            let a = l.point_at(real(u0.max(0.0))?);
            let b = l.point_at(real(u1.min(1.0))?);
            LineSeg2::try_new(a, b)
                .map(Segment2::Line)
                .map_err(|e| format!("hcurve: sub-line failed ({e:?})"))
        }
        Segment2::Arc(a) =>
        {
            let pol = policy();
            let at = |u: f64| -> Result<Point2, String> {
                match a.point_at_sweep_fraction(&real(u.clamp(0.0, 1.0))?, &pol)
                {
                    Ok(Classification::Decided(p)) => Ok(p),
                    _ => Err("hcurve: arc sweep sample undecided".into()),
                }
            };
            let p0 = at(u0)?;
            let p1 = at(u1)?;
            CircularArc2::try_from_center(p0, p1, a.center().clone(), a.is_clockwise())
                .map(Segment2::Arc)
                .map_err(|e| format!("hcurve: sub-arc failed ({e:?})"))
        }
    }
}

/// Fillet every interior line–line corner of a segment chain by `radius`.
///
/// Each rounding arc is built with [`Segment2::from_bulge`] (two tangent points +
/// a bulge) rather than hypercurve's `fillet_vertex_by_points`, which requires an
/// exactly-equidistant arc center — impossible to supply from f64 for a general
/// corner (it rejects with `RadiusMismatch`). `from_bulge` derives a consistent
/// arc from the two tangent points, so any corner rounds robustly. Corners that
/// involve an arc, are nearly straight, or where the radius does not fit are left
/// sharp. Works for closed contours (every vertex, wrapping) and open curve
/// strings (interior vertices only — the two free endpoints are not corners).
pub fn fillet_segments(segs: &[Segment2], radius: f64, closed: bool) -> Result<Vec<Segment2>, String>
{
    if !(radius.is_finite() && radius > 0.0) || segs.len() < 2
    {
        return Ok(segs.to_vec());
    }
    let n = segs.len();
    let sl = |p: &Point2| -> (f64, f64) {
        (p.x().to_f64_lossy().unwrap_or(0.0), p.y().to_f64_lossy().unwrap_or(0.0))
    };
    let norm = |a: (f64, f64)| -> (f64, f64) {
        let m = (a.0 * a.0 + a.1 * a.1).sqrt();
        if m > 1e-12 { (a.0 / m, a.1 / m) } else { (0.0, 0.0) }
    };
    let dist = |a: (f64, f64), b: (f64, f64)| ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt();

    // The rounding of one vertex: tangent point on the previous segment, tangent
    // point on the next segment, and the connecting arc's bulge (tan of a quarter
    // of the signed turn angle).
    struct Corner
    {
        tp: (f64, f64),
        tn: (f64, f64),
        bulge: f64,
    }
    let corner_at = |vi: usize| -> Option<Corner> {
        if !closed && (vi == 0 || vi >= n)
        {
            return None; // open endpoints are not corners
        }
        let prev = if closed { (vi + n - 1) % n } else { vi - 1 };
        let cur = vi % n;
        let (ps, cs) = (&segs[prev], &segs[cur]);
        if !matches!(ps, Segment2::Line(_)) || !matches!(cs, Segment2::Line(_))
        {
            return None; // only line–line corners
        }
        let v = sl(cs.start());
        let p = sl(ps.start());
        let q = sl(cs.end());
        let u = norm((p.0 - v.0, p.1 - v.1)); // toward previous vertex
        let w = norm((q.0 - v.0, q.1 - v.1)); // toward next vertex
        let half = (u.0 * w.0 + u.1 * w.1).clamp(-1.0, 1.0).acos() / 2.0; // half interior angle
        if half < 1.0e-3 || half > std::f64::consts::FRAC_PI_2 - 1.0e-6
        {
            return None; // straight / degenerate
        }
        let d = radius / half.tan(); // setback along each edge
        if d > dist(p, v) - 1e-9 || d > dist(v, q) - 1e-9
        {
            return None; // radius does not fit
        }
        let tp = (v.0 + u.0 * d, v.1 + u.1 * d);
        let tn = (v.0 + w.0 * d, v.1 + w.1 * d);
        // Signed turn from the incoming travel direction (−u) to the outgoing (w).
        let cross = u.0 * w.1 - u.1 * w.0;
        let dotp = u.0 * w.0 + u.1 * w.1;
        let sweep = (-cross).atan2(-dotp);
        Some(Corner { tp, tn, bulge: (sweep / 4.0).tan() })
    };

    let mk_line = |a: (f64, f64), b: (f64, f64)| -> Result<Option<Segment2>, String> {
        if dist(a, b) < 1e-9
        {
            return Ok(None); // corner consumed the whole edge — drop the degenerate line
        }
        Ok(Some(Segment2::Line(
            LineSeg2::try_new(point(a.0, a.1)?, point(b.0, b.1)?)
                .map_err(|e| format!("hcurve: fillet line failed ({e:?})"))?,
        )))
    };
    let mk_arc = |c: &Corner| -> Result<Segment2, String> {
        Segment2::from_bulge(point(c.tp.0, c.tp.1)?, point(c.tn.0, c.tn.1)?, real(c.bulge)?)
            .map_err(|e| format!("hcurve: fillet arc failed ({e:?})"))
    };

    // Rebuild the chain: the arc for vertex `i` precedes segment `i`; segment `i`
    // starts at that vertex's `tn` and ends at the next vertex's `tp` when filleted.
    let mut out: Vec<Segment2> = Vec::new();
    for i in 0..n
    {
        let ci = corner_at(i);
        if let Some(c) = &ci
        {
            out.push(mk_arc(c)?);
        }
        let start = ci.as_ref().map(|c| c.tn).unwrap_or_else(|| sl(segs[i].start()));
        let next_vi = if closed { (i + 1) % n } else { i + 1 };
        let end = corner_at(next_vi).map(|c| c.tp).unwrap_or_else(|| sl(segs[i].end()));
        if let Some(line) = mk_line(start, end)?
        {
            out.push(line);
        }
    }
    Ok(out)
}

/// Extract the native sub-curve spanning normalized arc-length fractions
/// `[t0, t1]` of a segment chain, preserving line/arc geometry exactly:
/// interior segments are kept whole, only the two boundary segments are split.
/// This is the native (non-tessellating) replacement for point-sampled trimming.
pub fn trim_segments(segs: &[Segment2], t0: f64, t1: f64) -> Result<Vec<Segment2>, String>
{
    let (a, b) = if t0 <= t1 { (t0, t1) } else { (t1, t0) };
    let (a, b) = (a.clamp(0.0, 1.0), b.clamp(0.0, 1.0));
    let lens: Vec<f64> = segs
        .iter()
        .map(|s| segment_length(s).ok_or_else(|| "hcurve: non-finite segment length".to_string()))
        .collect::<Result<_, _>>()?;
    let total: f64 = lens.iter().sum();
    if total <= 0.0
    {
        return Err("hcurve: zero-length curve".into());
    }
    let l0 = a * total;
    let l1 = b * total;
    let eps = total * 1e-9;
    let out = segs
        .iter()
        .zip(lens.iter())
        .scan(0.0f64, |acc, (s, &len)| {
            let seg_start = *acc;
            *acc += len;
            Some((s, seg_start, len))
        })
        .filter_map(|(s, seg_start, len)| {
            if len <= 0.0
            {
                return None;
            }
            let lo = l0.max(seg_start);
            let hi = l1.min(seg_start + len);
            if hi - lo <= eps
            {
                return None;
            }
            Some(subsegment(s, (lo - seg_start) / len, (hi - seg_start) / len))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if out.is_empty()
    {
        return Err("hcurve: trim produced no segments".into());
    }
    Ok(out)
}

/// Sum the exact lengths of a native segment list.
fn segments_length(segs: &[Segment2]) -> Result<f64, String>
{
    segs.iter()
        .map(|s| segment_length(s).ok_or_else(|| "hcurve: non-finite segment length".to_string()))
        .sum()
}

/// Exact length of an open curve string.
pub fn length_open(cs: &CurveString2, _chord_error: f64) -> Result<f64, String>
{
    segments_length(cs.segments())
}

/// Exact perimeter of a closed contour.
pub fn length_closed(ct: &Contour2, _chord_error: f64) -> Result<f64, String>
{
    segments_length(ct.segments())
}

#[cfg(test)]
mod tests
{
    use super::*;

    fn square(cx: f64, cy: f64, half: f64) -> Contour2
    {
        closed_contour(&[
            [cx - half, cy - half],
            [cx + half, cy - half],
            [cx + half, cy + half],
            [cx - half, cy + half],
        ])
        .expect("square contour")
    }

    #[test]
    fn f64_roundtrip_through_real()
    {
        let r = real(1.5).unwrap();
        assert_eq!(r.to_f64_lossy(), Some(1.5));
    }

    #[test]
    fn open_polyline_tessellates_to_same_points()
    {
        let cs = open_polyline(&[[0.0, 0.0], [10.0, 0.0], [10.0, 5.0]]).unwrap();
        let pts = tessellate_open(&cs, DEFAULT_CHORD_ERROR).unwrap();
        assert_eq!(pts.first(), Some(&[0.0, 0.0]));
        assert_eq!(pts.last(), Some(&[10.0, 5.0]));
    }

    #[test]
    fn square_area_is_positive_and_correct()
    {
        let sq = square(0.0, 0.0, 5.0); // 10 x 10
        let area = signed_area(&sq).unwrap();
        assert!((area.abs() - 100.0).abs() < 1e-9, "area = {area}");
    }

    #[test]
    fn union_of_two_overlapping_squares_is_one_ring()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        let rings = boolean_rings(&a, &b, BooleanOp::Union, DEFAULT_CHORD_ERROR).unwrap();
        assert_eq!(rings.len(), 1, "overlapping union should be a single ring");
        // L-shaped union area = 100 + 100 - 25 overlap = 175.
        let ring_area = hypercurve::finite_ring_signed_area(&rings[0]).abs();
        assert!((ring_area - 175.0).abs() < 1e-6, "union area = {ring_area}");
    }

    #[test]
    fn intersection_of_two_overlapping_squares()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        let rings = boolean_rings(&a, &b, BooleanOp::Intersection, DEFAULT_CHORD_ERROR).unwrap();
        assert_eq!(rings.len(), 1);
        let ring_area = hypercurve::finite_ring_signed_area(&rings[0]).abs();
        assert!((ring_area - 25.0).abs() < 1e-6, "intersection area = {ring_area}");
    }

    #[test]
    fn circle_area_and_perimeter_are_correct()
    {
        let c = circle(0.0, 0.0, 4.0).unwrap();
        // Exact signed area of a circle contour is pi r^2 (arcs are exact).
        let area = signed_area(&c).unwrap();
        assert!(
            (area.abs() - std::f64::consts::PI * 16.0).abs() < 1e-6,
            "circle area = {area}"
        );
        // Exact arc-length perimeter is 2 pi r (independent of chord error).
        let per = length_closed(&c, 1.0).unwrap();
        assert!(
            (per - 2.0 * std::f64::consts::PI * 4.0).abs() < 1e-9,
            "circle perimeter = {per}"
        );
    }

    #[test]
    fn difference_of_enclosed_square_makes_a_hole()
    {
        let outer = square(0.0, 0.0, 10.0); // 20x20, area 400
        let inner = square(0.0, 0.0, 3.0); //  6x6,  area 36, fully inside
        let regions = boolean_regions(&outer, &inner, BooleanOp::Difference, DEFAULT_CHORD_ERROR).unwrap();
        assert_eq!(regions.len(), 1, "one material region");
        assert_eq!(regions[0].holes.len(), 1, "with exactly one hole");
        let ext = hypercurve::finite_ring_signed_area(&regions[0].exterior).abs();
        let hole = hypercurve::finite_ring_signed_area(&regions[0].holes[0]).abs();
        assert!((ext - 400.0).abs() < 1e-6, "exterior area = {ext}");
        assert!((hole - 36.0).abs() < 1e-6, "hole area = {hole}");
    }

    #[test]
    fn difference_removes_overlap()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        let rings = boolean_rings(&a, &b, BooleanOp::Difference, DEFAULT_CHORD_ERROR).unwrap();
        assert_eq!(rings.len(), 1);
        let ring_area = hypercurve::finite_ring_signed_area(&rings[0]).abs();
        assert!((ring_area - 75.0).abs() < 1e-6, "difference area = {ring_area}");
    }

    #[test]
    fn similarity_translate_and_scale_uniform()
    {
        // Translate a unit-ish square by (10, 20) with 2x uniform scale.
        let sq = square(0.0, 0.0, 1.0); // 2x2, area 4
        let s = similarity(2.0, 0.0, 0.0, 2.0, 10.0, 20.0).unwrap();
        let moved = transform_contour(&sq, &s).unwrap();
        let area = signed_area(&moved).unwrap().abs();
        assert!((area - 16.0).abs() < 1e-9, "scaled area = {area}"); // 4 * 2^2
        let ring = tessellate_closed(&moved, DEFAULT_CHORD_ERROR).unwrap();
        // Bounding-box midpoint should now be near (10, 20).
        let (mut minx, mut maxx, mut miny, mut maxy) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in &ring
        {
            minx = minx.min(p[0]);
            maxx = maxx.max(p[0]);
            miny = miny.min(p[1]);
            maxy = maxy.max(p[1]);
        }
        let (cx, cy) = ((minx + maxx) / 2.0, (miny + maxy) / 2.0);
        assert!((cx - 10.0).abs() < 1e-6 && (cy - 20.0).abs() < 1e-6, "centre = ({cx},{cy})");
    }

    #[test]
    fn non_uniform_scale_is_rejected()
    {
        // hypercurve supports only similarities; sx != sy must be rejected.
        assert!(similarity(2.0, 0.0, 0.0, 3.0, 0.0, 0.0).is_err());
    }

    #[test]
    fn arc_through_three_points_passes_through_mid()
    {
        // Semicircle over center (5,0), r=5: (0,0) -> (5,5) -> (10,0).
        let cs = arc_3pt([0.0, 0.0], [5.0, 5.0], [10.0, 0.0]).unwrap();
        let pts = tessellate_open(&cs, 1e-5).unwrap();
        assert_eq!(pts.first(), Some(&[0.0, 0.0]));
        assert_eq!(pts.last(), Some(&[10.0, 0.0]));
        // Apex of the arc should reach ~ (5, 5).
        let max_y = pts.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
        assert!((max_y - 5.0).abs() < 1e-2, "arc apex y = {max_y}");
        // Every sampled point lies on the circle of radius 5 about (5,0).
        for p in &pts
        {
            let r = ((p[0] - 5.0).powi(2) + p[1].powi(2)).sqrt();
            assert!((r - 5.0).abs() < 1e-3, "point {p:?} off-circle r={r}");
        }
    }

    #[test]
    fn arc_collinear_points_error()
    {
        assert!(arc_3pt([0.0, 0.0], [5.0, 0.0], [10.0, 0.0]).is_err());
    }

    #[test]
    fn nurbs_quadratic_bezier_construct_and_tessellate()
    {
        // Clamped quadratic (degree 2, 3 CPs): a symmetric arch.
        let cps = [[0.0, 0.0], [5.0, 10.0], [10.0, 0.0]];
        let weights = [1.0, 1.0, 1.0];
        let knots = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let c = nurbs(2, &cps, &weights, &knots).unwrap();

        assert_eq!(nurbs_degree(&c), 2);
        assert_eq!(nurbs_control_points(&c), vec![[0.0, 0.0], [5.0, 10.0], [10.0, 0.0]]);
        assert_eq!(nurbs_weights(&c), vec![1.0, 1.0, 1.0]);
        assert_eq!(nurbs_knots(&c), vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]);

        let pts = tessellate_nurbs(&c, 1e-4).unwrap();
        assert!(pts.len() >= 3, "too few tessellation points: {}", pts.len());
        assert_eq!(pts.first(), Some(&[0.0, 0.0]));
        assert_eq!(pts.last(), Some(&[10.0, 0.0]));
        // Bezier apex at t=0.5 is 0.25*P0 + 0.5*P1 + 0.25*P2 = (5, 5).
        let max_y = pts.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
        assert!((max_y - 5.0).abs() < 0.05, "apex y = {max_y}");
        // Symmetry: apex x near 5.
        let apex = pts.iter().cloned().fold([0.0, f64::MIN], |a, p| if p[1] > a[1] { p } else { a });
        assert!((apex[0] - 5.0).abs() < 0.1, "apex x = {}", apex[0]);
    }

    #[test]
    fn nurbs_degree_one_rejected()
    {
        // degree 1 must be rejected (polylines are CurveString2, not NURBS).
        let cps = [[0.0, 0.0], [10.0, 0.0]];
        let weights = [1.0, 1.0];
        let knots = [0.0, 0.0, 1.0, 1.0];
        assert!(nurbs(1, &cps, &weights, &knots).is_err());
    }

    #[test]
    fn nurbs_interpolation_passes_through_points()
    {
        let pts = [[0.0, 0.0], [1.0, 2.0], [3.0, 3.0], [5.0, 1.0], [6.0, 4.0]];
        let c = nurbs_interpolate(&pts, 3).unwrap();
        assert_eq!(nurbs_degree(&c), 3);
        let tess = tessellate_nurbs(&c, 1e-5).unwrap();
        // Each input point must lie on the tessellated curve (interpolation property).
        for q in &pts
        {
            let min_d = tess
                .iter()
                .map(|p| ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt())
                .fold(f64::MAX, f64::min);
            assert!(min_d < 1e-2, "point {q:?} not interpolated (min dist {min_d})");
        }
        // Endpoints are interpolated exactly (clamped).
        assert!((tess.first().unwrap()[0] - 0.0).abs() < 1e-6);
        assert!((tess.last().unwrap()[0] - 6.0).abs() < 1e-6);
    }

    #[test]
    fn crossing_lines_intersect_at_one_point()
    {
        // Two open polylines crossing at (5,5): a diagonal and a horizontal.
        let a = open_polyline(&[[0.0, 0.0], [10.0, 10.0]]).unwrap();
        let b = open_polyline(&[[0.0, 5.0], [10.0, 5.0]]).unwrap();
        let hits = intersect_open(&a, &b).unwrap();
        assert_eq!(hits.len(), 1, "hits = {hits:?}");
        assert!((hits[0][0] - 5.0).abs() < 1e-9 && (hits[0][1] - 5.0).abs() < 1e-9);
    }

    #[test]
    fn parallel_lines_do_not_intersect()
    {
        let a = open_polyline(&[[0.0, 0.0], [10.0, 0.0]]).unwrap();
        let b = open_polyline(&[[0.0, 3.0], [10.0, 3.0]]).unwrap();
        assert_eq!(intersect_open(&a, &b).unwrap().len(), 0);
    }

    #[test]
    fn offset_open_line_moves_to_the_left()
    {
        // Segment along +x; left (+distance) is +y.
        let line = open_polyline(&[[0.0, 0.0], [10.0, 0.0]]).unwrap();
        let off = offset_open(&line, 2.0, DEFAULT_CHORD_ERROR).unwrap();
        assert!(off.iter().all(|p| (p[1] - 2.0).abs() < 1e-9), "offset = {off:?}");
        // Right side (negative) -> y = -3.
        let off_r = offset_open(&line, -3.0, DEFAULT_CHORD_ERROR).unwrap();
        assert!(off_r.iter().all(|p| (p[1] + 3.0).abs() < 1e-9), "offset_r = {off_r:?}");
    }

    #[test]
    fn offset_closed_square_changes_area()
    {
        let sq = square(0.0, 0.0, 5.0); // 10x10, area 100
        // Offset by 1 (one side of the CCW boundary) — area should change by a
        // predictable amount and stay a valid ring.
        let ring = offset_closed(&sq, 1.0, DEFAULT_CHORD_ERROR).unwrap();
        let area = hypercurve::finite_ring_signed_area(&ring).abs();
        // A ±1 offset of a 10x10 square gives an 8x8 (64) or 12x12 (144) square.
        assert!(
            (area - 64.0).abs() < 1e-6 || (area - 144.0).abs() < 1e-6,
            "offset square area = {area}"
        );
    }

    #[test]
    fn line_through_circle_hits_twice()
    {
        // Horizontal line y=0 through a circle centred at origin, r=4 -> (-4,0),(4,0).
        let circ_pts = tessellate_closed(&circle(0.0, 0.0, 4.0).unwrap(), 1e-6).unwrap();
        // Build the circle as an arc-based OPEN curve string (two semicircles) so
        // intersection uses exact arc geometry rather than the tessellation.
        let c = circle(0.0, 0.0, 4.0).unwrap();
        let as_open = CurveString2::try_new(c.segments().to_vec()).unwrap();
        let line = open_polyline(&[[-10.0, 0.0], [10.0, 0.0]]).unwrap();
        let hits = intersect_open(&as_open, &line).unwrap();
        assert_eq!(hits.len(), 2, "hits = {hits:?}");
        let xs: Vec<f64> = { let mut v: Vec<f64> = hits.iter().map(|p| p[0]).collect(); v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v };
        assert!((xs[0] + 4.0).abs() < 1e-9 && (xs[1] - 4.0).abs() < 1e-9, "xs = {xs:?}");
        let _ = circ_pts;
    }
}
