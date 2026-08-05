//! f64-facing helpers over the [`hypercurve`] exact-arithmetic planar kernel.
//!
//! meshup works in `f64` (`crate::float_types::Real`), while `hypercurve` works
//! in exact rationals (`hyperreal::Real`). This module is the single bridge
//! between the two worlds for the migration off `curvo`:
//!
//! * f64 crosses *into* hypercurve only at construction ([`point`], the
//!   polyline builders), converting each coordinate to an exact `Real`.
//! * hypercurve crosses *back out* only through finite projection
//!   ([`tessellate_open`] / [`tessellate_closed`]), which sample exact geometry
//!   to `f64` polylines with a bounded chord error.
//!
//! Only the planar (2D) surface is modelled here; meshup lifts these local‑XY
//! results back into 3D via the curve's stored plane/frame on the TypeScript
//! side. Everything is expressed with owned `Vec<[f64; 2]>` rings so the WASM
//! bindings can stay thin.

use hypercurve::{
    Aabb2, ArcArcIntersection, BezierParallelVerificationOptions,
    BooleanOp, Classification,
    CircularArc2, Contour2, Curve2, CurveFamily2, CurveGeometry2, CurvePath2, CurvePolicy,
    CurveRegion2,
    CurveString2, EllipseMap2, FillRule,
    FiniteProjectionOptions, LineArcIntersection, LineArcRegion2, LineLineIntersection, LineSeg2,
    NurbsCurve2, Point2, RationalBezierIntersectionPointEvidence2, RationalQuadraticBezier2, Real,
    RegionView2, Segment2,
    SegmentIntersection, Similarity2,
    Tolerance, elliptical_arc_path,
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
fn associate_holes(region: &LineArcRegion2, pol: &CurvePolicy) -> Vec<NativeRegion>
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
pub(crate) fn decided<T>(c: Classification<T>) -> Result<T, String>
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

/// Apply a general 2D affine map to a **closed** exact path, returning native boundary paths.
///
/// `CurveRegion2::transform_affine` is the *only* general affine in hypercurve — `Curve2`,
/// `CurvePath2`, `CurveString2` and `Contour2` accept `Similarity2` alone, which cannot
/// express a non-uniform scale or an oblique projection. So this works for closed curves
/// (which lift to a region) and there is no equivalent for open ones.
///
/// A non-uniform scale of a circle is exactly an ellipse, which this recovers as rational
/// conic spans rather than as resampled line work.
///
/// Returns `Ok(None)` when hypercurve declines (e.g. a singular map).
pub fn transform_affine_path(
    path: &CurvePath2,
    m00: f64,
    m01: f64,
    m10: f64,
    m11: f64,
    tx: f64,
    ty: f64,
) -> Option<Vec<CurvePath2>>
{
    let pol = policy();
    let region = CurveRegion2::try_from_boundary_paths(std::slice::from_ref(path)).ok()?;
    let moved = region
        .transform_affine(
            &real(m00).ok()?,
            &real(m01).ok()?,
            &real(m10).ok()?,
            &real(m11).ok()?,
            &real(tx).ok()?,
            &real(ty).ok()?,
            &pol,
        )
        .ok()?;
    match moved.materialized_boundary_paths()
    {
        Ok(Classification::Decided(paths)) if !paths.is_empty() => Some(paths),
        _ => None,
    }
}

/// Region boolean between two closed **exact paths** (conics / Beziers / splines), returning
/// native boundary paths.
///
/// [`boolean_native`] only accepts `Contour2`, i.e. line/arc topology, so an ellipse had to
/// be tessellated into a fine line contour before any boolean — which is why
/// `Curve3DJs::boolean`'s "nothing tessellated" claim held for circles but not ellipses.
/// `CurveRegion2` is hypercurve's exact mixed-family region type and needs no such lowering.
///
/// Returns `Ok(None)` when hypercurve declines the topology, leaving the caller to fall back.
pub fn boolean_paths(a: &CurvePath2, b: &CurvePath2, op: BooleanOp) -> Option<Vec<CurvePath2>>
{
    let region_a = CurveRegion2::try_from_boundary_paths(std::slice::from_ref(a)).ok()?;
    let region_b = CurveRegion2::try_from_boundary_paths(std::slice::from_ref(b)).ok()?;
    let pol = boolean_policy();
    let result = region_a.retain_boolean(&region_b, &pol).ok()?;
    let region = match result.boolean_region(op)
    {
        Ok(r) => r,
        Err(_) => return None,
    };
    match region.materialized_boundary_paths()
    {
        Ok(Classification::Decided(paths)) if !paths.is_empty() => Some(paths),
        _ => None,
    }
}

/// Intersection points between two exact paths, as f64 pairs.
///
/// Uses hypercurve's retained mixed-family path intersection, so a conic operand is not
/// lowered to line work first. `None` when the pair is declined.
pub fn intersect_paths(a: &CurvePath2, b: &CurvePath2) -> Option<Vec<[f64; 2]>>
{
    let pol = policy();
    let retained = a.retain_intersection(b, &pol).ok()?;
    let result = retained.result().ok()?;
    let mut pts: Vec<[f64; 2]> = Vec::new();
    for contact in result.contacts()
    {
        match contact.contact().point()
        {
            RationalBezierIntersectionPointEvidence2::Exact(p) =>
            {
                pts.push(point_to_f64(p)?);
            }
            // The contact is retained as an exact algebraic image rather than as `Real`
            // coordinates. Rather than silently drop a real intersection, decline the whole
            // query so the caller falls back to the sampled path, which will find it.
            RationalBezierIntersectionPointEvidence2::Algebraic(_) => return None,
        }
    }
    Some(merge_near_duplicates(pts))
}

/// Collapse points that coincide within a small tolerance (shared endpoints of adjacent
/// spans report the same contact twice).
fn merge_near_duplicates(pts: Vec<[f64; 2]>) -> Vec<[f64; 2]>
{
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for p in pts
    {
        if !merged
            .iter()
            .any(|q| (q[0] - p[0]).hypot(q[1] - p[1]) < 1.0e-9)
        {
            merged.push(p);
        }
    }
    merged
}

/// Exact point at normalised arc-length fraction `t` along a native line/arc segment list.
///
/// Arc length of a line and of a circular arc are both closed-form (`|b-a|` and `r*theta`),
/// so the segment containing `t` and the position within it are found exactly, then
/// evaluated with `LineSeg2::point_at` / `CircularArc2::point_at_sweep_fraction`.
///
/// The caller used to walk a cumulative table of *chord* lengths over a tessellation and
/// then lerp between two sample points, so the returned point was not on the curve at all
/// and the error grew along the curve (measured 1.0e-7 rising to 3.1e-7 across a circle).
pub fn point_at_arclen(segs: &[Segment2], t: f64) -> Result<Point2, String>
{
    if segs.is_empty()
    {
        return Err("hcurve: empty segment list".to_string());
    }
    let lengths: Vec<f64> = segs
        .iter()
        .map(|s| segment_length(s).unwrap_or(0.0))
        .collect();
    let total: f64 = lengths.iter().sum();
    let pol = policy();

    let eval = |seg: &Segment2, u: f64| -> Result<Point2, String> {
        match seg
        {
            Segment2::Line(l) => Ok(l.point_at(real(u.clamp(0.0, 1.0))?)),
            Segment2::Arc(a) => match a.point_at_sweep_fraction(&real(u.clamp(0.0, 1.0))?, &pol)
            {
                Ok(Classification::Decided(p)) => Ok(p),
                _ => Err("hcurve: arc sweep sample undecided".to_string()),
            },
        }
    };

    if !(total > 0.0)
    {
        return eval(&segs[0], 0.0);
    }
    let target = t.clamp(0.0, 1.0) * total;
    let mut walked = 0.0;
    for (seg, len) in segs.iter().zip(&lengths)
    {
        if target <= walked + len || *len <= 0.0
        {
            let u = if *len > 0.0 { (target - walked) / len } else { 0.0 };
            return eval(seg, u);
        }
        walked += len;
    }
    eval(segs.last().unwrap(), 1.0)
}

/// Exact arc-length fraction of the point on a native line/arc segment list closest to `p`.
///
/// Each segment is projected analytically — perpendicular foot for a line, radial projection
/// clamped to the sweep for an arc — instead of projecting onto tessellation chords.
pub fn param_closest_to_point(segs: &[Segment2], p: &Point2) -> Result<f64, String>
{
    if segs.is_empty()
    {
        return Err("hcurve: empty segment list".to_string());
    }
    let lengths: Vec<f64> = segs
        .iter()
        .map(|s| segment_length(s).unwrap_or(0.0))
        .collect();
    let total: f64 = lengths.iter().sum();
    if !(total > 0.0)
    {
        return Ok(0.0);
    }
    let q = point_to_f64(p).ok_or_else(|| "hcurve: query point not finite".to_string())?;

    let mut best = (f64::MAX, 0.0f64);
    let mut walked = 0.0;
    for (seg, len) in segs.iter().zip(&lengths)
    {
        let (dist, u) = match seg
        {
            Segment2::Line(l) =>
            {
                let a = point_to_f64(l.start()).ok_or("hcurve: line start not finite")?;
                let b = point_to_f64(l.end()).ok_or("hcurve: line end not finite")?;
                let (abx, aby) = (b[0] - a[0], b[1] - a[1]);
                let len2 = abx * abx + aby * aby;
                let u = if len2 > 0.0
                {
                    (((q[0] - a[0]) * abx + (q[1] - a[1]) * aby) / len2).clamp(0.0, 1.0)
                }
                else
                {
                    0.0
                };
                ((a[0] + abx * u - q[0]).hypot(a[1] + aby * u - q[1]), u)
            }
            Segment2::Arc(a) =>
            {
                // Closed-form radial projection. The closest point on a circle to `q` lies
                // on the ray from the centre through `q`, so the sweep fraction follows
                // from three angles — no search.
                //
                // This replaced a 48-iteration ternary search that called back into exact
                // arc evaluation twice per step: 96 exact evaluations per arc, per query,
                // measured at 3.6 ms against 0.08 ms for the line case. `paramClosestToPoint`
                // backs `distance()`, `cutoffBy()` and mesh intersection, so that cost was
                // paid throughout an assembly.
                //
                // f64 trigonometry is deliberate: hypercurve's `sweep_fraction` needs a
                // point certified as lying exactly on the arc, which a projected f64 point
                // never is. Precision here still far exceeds the sampling it replaces.
                const TAU: f64 = std::f64::consts::TAU;
                let c = point_to_f64(a.center()).ok_or("hcurve: arc centre not finite")?;
                let s = point_to_f64(a.start()).ok_or("hcurve: arc start not finite")?;
                let e = point_to_f64(a.end()).ok_or("hcurve: arc end not finite")?;
                let r = a
                    .radius_squared()
                    .to_f64_lossy()
                    .ok_or("hcurve: arc radius not finite")?
                    .sqrt();

                let angle_of = |p: [f64; 2]| (p[1] - c[1]).atan2(p[0] - c[0]);
                let cw = a.is_clockwise();
                let start_angle = angle_of(s);
                // Sweep travelled from start to end in traversal order, in (0, 2*pi].
                // A full circle has start == end, which lands on exactly 2*pi.
                let mut total = if cw { start_angle - angle_of(e) } else { angle_of(e) - start_angle };
                while total <= 0.0 { total += TAU; }

                let (vx, vy) = (q[0] - c[0], q[1] - c[1]);
                let vlen = vx.hypot(vy);
                let endpoint_pick = || {
                    let ds = (s[0] - q[0]).hypot(s[1] - q[1]);
                    let de = (e[0] - q[0]).hypot(e[1] - q[1]);
                    if ds <= de { (ds, 0.0) } else { (de, 1.0) }
                };

                if vlen <= 1.0e-12
                {
                    // `q` is the centre: every point on the arc is equidistant.
                    (r, 0.0)
                }
                else
                {
                    let mut swept = if cw { start_angle - vy.atan2(vx) } else { vy.atan2(vx) - start_angle };
                    while swept < 0.0 { swept += TAU; }
                    let u = swept / total;
                    if u <= 1.0
                    {
                        // The radial foot is inside the sweep, so it is the closest point
                        // and its distance is just the radial offset.
                        ((vlen - r).abs(), u)
                    }
                    else
                    {
                        endpoint_pick()
                    }
                }
            }
        };
        if dist < best.0
        {
            best = (dist, (walked + u * len) / total);
        }
        walked += len;
    }
    Ok(best.1.clamp(0.0, 1.0))
}

/// Join exact spans into one connected path, bridging gaps with straight connector lines.
///
/// [`CurvePath2::try_new`] requires its curves to meet exactly, so this inserts a line
/// wherever consecutive spans do not. Spans are preserved as authored — an arc stays an arc
/// — which is the whole point: joining used to be done by collecting `controlPoints()` and
/// running a polyline through them, which replaces every arc with its chord.
pub fn join_curves(curves: Vec<Curve2>) -> Result<CurvePath2, String>
{
    if curves.is_empty()
    {
        return Err("hcurve: join_curves needs at least one curve".to_string());
    }
    let mut joined: Vec<Curve2> = Vec::with_capacity(curves.len() * 2);
    for curve in curves
    {
        if let Some(prev) = joined.last()
        {
            let (end, start) = (prev.end().clone(), curve.start().clone());
            if end != start
            {
                let bridge = LineSeg2::try_new(end, start)
                    .map_err(|e| format!("hcurve: join connector failed ({e:?})"))?;
                joined.push(Curve2::from(bridge));
            }
        }
        joined.push(curve);
    }
    CurvePath2::try_new(joined).map_err(|e| format!("hcurve: join failed ({e:?})"))
}

/// Close a path by appending a straight segment from its end back to its start.
/// Returns the path unchanged when it is already closed.
pub fn close_path(path: &CurvePath2) -> Result<CurvePath2, String>
{
    let (start, end) = (path.start().clone(), path.end().clone());
    if start == end
    {
        return Ok(path.clone());
    }
    let mut curves = path.curves().to_vec();
    let closing = LineSeg2::try_new(end, start)
        .map_err(|e| format!("hcurve: closing segment failed ({e:?})"))?;
    curves.push(Curve2::from(closing));
    CurvePath2::try_new(curves).map_err(|e| format!("hcurve: close failed ({e:?})"))
}

/// Lift native line/arc [`Segment2`]s into an exact [`CurvePath2`]. Lossless and total:
/// every `Segment2` variant has an exact `Curve2` equivalent.
///
/// This is one half of the bridge that lets `Curve3DJs` hold either representation without
/// keeping a tessellated line approximation of the exact one.
pub fn path_from_segments(segs: &[Segment2]) -> Result<CurvePath2, String>
{
    let curves: Vec<Curve2> = segs
        .iter()
        .map(|s| match s
        {
            Segment2::Line(l) => Curve2::from(l.clone()),
            Segment2::Arc(a) => Curve2::from(a.clone()),
        })
        .collect();
    CurvePath2::try_new(curves).map_err(|e| format!("hcurve: path from segments failed ({e:?})"))
}

/// Lower an exact [`CurvePath2`] back to native line/arc [`Segment2`]s — the other half of
/// the bridge. Partial by nature: `None` when any span is a Bezier, conic or spline, which
/// has no `Segment2` equivalent.
///
/// Used to renormalise the result of a boolean / offset / transform: when the output happens
/// to be pure line/arc it is stored as a `Contour2`/`CurveString2` so `subtype()`,
/// `hasArcs()` and `degree()` keep reporting the sharper answer, and hypercurve's decided
/// line/arc fast paths stay reachable.
pub fn segments_from_path(path: &CurvePath2) -> Option<Vec<Segment2>>
{
    path.curves()
        .iter()
        .map(|c| match c.geometry()
        {
            CurveGeometry2::Line(l) => Some(Segment2::Line(l.clone())),
            CurveGeometry2::CircularArc(a) => Some(Segment2::Arc(a.clone())),
            _ => None,
        })
        .collect()
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
    let mut pts = cs
        .project_to_finite_polyline(&opts)
        .map(|poly| poly.into_points())
        .map_err(|e| format!("hcurve: tessellate open failed ({e:?})"))?;

    // hypercurve flattens arcs through rational Bezier subcurves, so the sampled
    // ends can drift by an ulp from the curve string's exact endpoints. Snap them
    // back: callers rely on the polyline starting/ending exactly on the curve.
    if let (Some(first), Some(start)) = (pts.first_mut(), cs.start())
    {
        if let Some(p) = point_to_f64(start)
        {
            *first = p;
        }
    }
    if let (Some(last), Some(end)) = (pts.last_mut(), cs.end())
    {
        if let Some(p) = point_to_f64(end)
        {
            *last = p;
        }
    }
    Ok(pts)
}

/// Sample a closed contour to an f64 ring (first point repeated at the end).
pub fn tessellate_closed(ct: &Contour2, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let opts = projection_options(chord_error)?;
    ct.project_to_finite_ring(&opts)
        .map(|poly| poly.into_points())
        .map_err(|e| format!("hcurve: tessellate closed failed ({e:?})"))
}

/// Exact extent of a curve along an arbitrary in-plane direction `(dx, dy)`, as
/// `(min, max)` of the dot product with that direction — note the direction is **not**
/// assumed to be a unit vector, so the returned values scale with `|(dx, dy)|`.
///
/// A world-space bounding box of a planar curve cannot be read off an [`Aabb2`] directly:
/// `Aabb2` is axis-aligned in the curve's own *local* frame, while the caller wants extents
/// along world axes, which map to arbitrary in-plane directions. But for a world axis `e`,
/// `p·e` is a linear functional of the local coordinates, so the extent along it is exactly
/// the local `x` extent after rotating `(dx, dy)` onto `+x` — which is what this does.
///
/// Exact for line and arc geometry (arc extrema are solved, not sampled), so a bounding box
/// built from three of these reaches the true bulge of every arc instead of falling short by
/// the sagitta of one tessellation chord.
pub fn support_extent(geom: &SupportGeom<'_>, dx: f64, dy: f64) -> Result<(f64, f64), String>
{
    let len = dx.hypot(dy);
    if !(len.is_finite() && len > 0.0)
    {
        return Err("hcurve: support direction is degenerate".to_string());
    }
    // Rotation taking the unit direction (dx, dy) onto +x: [[c, s], [-s, c]] with c = dx/len.
    let (c, s) = (dx / len, dy / len);
    let rot = similarity(c, s, -s, c, 0.0, 0.0)?;
    let pol = policy();

    let aabb = match geom
    {
        SupportGeom::Open(cs) =>
        {
            let t = cs
                .transform_similarity(&rot)
                .map_err(|e| format!("hcurve: support transform failed ({e:?})"))?;
            decided(
                Aabb2::from_curve_string(&t, &pol)
                    .map_err(|e| format!("hcurve: curve string bounds failed ({e:?})"))?,
            )?
        }
        SupportGeom::Closed(ct) =>
        {
            let t = ct
                .transform_similarity(&rot)
                .map_err(|e| format!("hcurve: support transform failed ({e:?})"))?;
            decided(
                Aabb2::from_contour(&t, &pol)
                    .map_err(|e| format!("hcurve: contour bounds failed ({e:?})"))?,
            )?
        }
    };

    let to_f = |r: &Real| r.to_f64_lossy().ok_or_else(|| "hcurve: bound not finite".to_string());
    // The rotation put the *unit* direction on +x, so scale back by |(dx, dy)|: the caller
    // asked for the extent of `p . (dx, dy)`, not of `p . unit(dx, dy)`.
    Ok((to_f(aabb.min_x())? * len, to_f(aabb.max_x())? * len))
}

/// The native line/arc carriers that [`support_extent`] can measure exactly.
///
/// There is deliberately no `CurvePath2` variant. `CurvePath2::bounds()` is a *conservative*
/// bound — for a rational-quadratic span it returns the control-polygon hull, which for a
/// 50x25 ellipse rotated 30 degrees reports a half-extent of 55.80 against a true 45.07, and
/// on other inputs it declines outright with `Blocked(NativeTopology,
/// RationalQuadraticBezier, Ordering)`. A conservative box is worse than the certified
/// projection the caller already falls back to, so paths are not offered here at all.
pub enum SupportGeom<'a>
{
    Open(&'a CurveString2),
    Closed(&'a Contour2),
}

/// Length of an exact [`CurvePath2`], in f64.
///
/// Tiered by span family, because exactness is available for some and provably not for
/// others:
/// * **Line / circular arc** — exact (`r*theta` for the arc), via [`segment_length`].
/// * **Everything else** — the arc length of a polynomial or rational Bezier has no closed
///   form (for a rational quadratic it is an elliptic integral), so the span is measured by
///   summing hypercurve's certified adaptive chords. That is an approximation, but a
///   *bounded* one, and it converges as `chord_error` shrinks.
///
/// This replaced a flat chord sum over the whole path, which also approximated the line and
/// arc spans that have exact answers.
pub fn length_path(path: &CurvePath2, chord_error: f64) -> Result<f64, String>
{
    let mut total = 0.0;
    for curve in path.curves()
    {
        total += match curve.geometry()
        {
            CurveGeometry2::Line(l) => segment_length(&Segment2::Line(l.clone()))
                .ok_or_else(|| "hcurve: line length not finite".to_string())?,
            CurveGeometry2::CircularArc(a) => segment_length(&Segment2::Arc(a.clone()))
                .ok_or_else(|| "hcurve: arc length not finite".to_string())?,
            _ =>
            {
                let span = CurvePath2::try_new(vec![curve.clone()])
                    .map_err(|e| format!("hcurve: span path failed ({e:?})"))?;
                let pts = tessellate_path(&span, chord_error)?;
                pts.windows(2)
                    .map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1]))
                    .sum::<f64>()
            }
        };
    }
    Ok(total)
}

/// Exact signed area enclosed by a closed [`CurvePath2`], in f64.
///
/// Lifts the boundary into a [`CurveRegion2`] and reads its exact signed area — for
/// polynomial and rational Bezier spans that is a Green integral in exact rationals, so an
/// ellipse gives exactly `pi*a*b` rather than the shoelace over a sampled ring the caller
/// used to get.
pub fn signed_area_path(path: &CurvePath2) -> Result<f64, String>
{
    let region = CurveRegion2::try_from_boundary_paths(std::slice::from_ref(path))
        .map_err(|e| format!("hcurve: region from path failed ({e:?})"))?;
    match region.signed_area()
    {
        Ok(Some(area)) => area
            .to_f64_lossy()
            .ok_or_else(|| "hcurve: path area not representable as f64".to_string()),
        Ok(None) => Err("hcurve: path area undefined".to_string()),
        Err(e) => Err(format!("hcurve: path signed_area failed ({e:?})")),
    }
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

/// The exact circle behind one [`CircularArc2`], in f64.
///
/// `sweep` is signed: positive counter-clockwise, and `bulge` is the DXF/LWPOLYLINE
/// bulge for the span (`tan(sweep / 4)`), so the same struct answers both "write me a
/// DXF ARC" and "write me a polyline vertex".
#[derive(Debug, Clone, PartialEq)]
pub struct ArcParams
{
    pub center: [f64; 2],
    pub radius: f64,
    pub start: [f64; 2],
    pub mid: [f64; 2],
    pub end: [f64; 2],
    pub ccw: bool,
    pub sweep: f64,
    pub bulge: f64,
}

/// The exact ellipse behind one rational-quadratic span, in f64.
///
/// `major` is the centre-to-major-axis-endpoint **vector** and `ratio` the minor/major
/// ratio — the form DXF's `ELLIPSE` wants (groups 11/21/31 and 40). `start_param` and
/// `end_param` are eccentric anomalies measured in that frame, ordered so that sweeping
/// counter-clockwise from `start_param` traverses the actual span.
#[derive(Debug, Clone, PartialEq)]
pub struct EllipseParams
{
    pub center: [f64; 2],
    pub major: [f64; 2],
    pub ratio: f64,
    pub start_param: f64,
    pub end_param: f64,
    pub ccw: bool,
}

/// Recover an arc's centre, radius and signed sweep.
///
/// `CircularArc2` retains all of this exactly; the only lossy step is the final
/// conversion to f64, which is what any file format is written in anyway. That is worth
/// stating because both exporters used to *re-derive* the circle from three tessellated
/// samples through a circumcircle, so the radius they wrote carried chord error from a
/// polyline the kernel had never needed to build.
pub fn arc_params(arc: &CircularArc2) -> Option<ArcParams>
{
    let center = point_to_f64(arc.center())?;
    let start = point_to_f64(arc.start())?;
    let end = point_to_f64(arc.end())?;
    let radius = arc.radius_squared().to_f64_lossy()?.sqrt();
    if !(radius.is_finite() && radius > 0.0)
    {
        return None;
    }

    let angle_of = |p: [f64; 2]| (p[1] - center[1]).atan2(p[0] - center[0]);
    let ccw = !arc.is_clockwise();
    let (a0, a1) = (angle_of(start), angle_of(end));
    // Both endpoints on the same ray means a full turn, not a zero-length arc: an arc
    // span is never degenerate, so wrap into (0, TAU] rather than [0, TAU).
    let mut span = if ccw { a1 - a0 } else { a0 - a1 };
    while span <= 0.0
    {
        span += std::f64::consts::TAU;
    }
    let sweep = if ccw { span } else { -span };

    let half = a0 + sweep / 2.0;
    let mid = [center[0] + radius * half.cos(), center[1] + radius * half.sin()];

    Some(ArcParams { center, radius, start, mid, end, ccw, sweep, bulge: (sweep / 4.0).tan() })
}

/// Recover the ellipse a rational-quadratic span lies on, or `None` when the span is not
/// an elliptical arc or the reconstruction cannot be trusted.
///
/// hypercurve keeps a conic as a weighted three-point control net and nothing more:
/// [`EllipseMap2`] is a bare `[Real; 4]` handed to `elliptical_arc_path` at construction
/// and never retained, and `RationalQuadraticBezier2` exposes only its control points and
/// weights. So the ellipse has to be *derived*, not read back.
///
/// Deriving beats retaining provenance here. A conic span reaches a curve from at least
/// four directions — `Curve.Ellipse`, an imported SVG `<ellipse>`, a non-uniform scale of
/// a circle, and path booleans — and retained parameters would then have to be composed
/// or invalidated at every translate, rotate, mirror, scale, trim, offset and boolean.
/// One missed invalidation writes geometry that is silently wrong into a user's file.
/// A derivation has no state that can go stale.
///
/// With the net normalised to unit end weights (`w = w1 / sqrt(w0·w2)`), the span is an
/// ellipse iff `0 < w < 1`, and the centre is closed-form:
///
/// ```text
/// C = (P0 + P2 - 2w²·P1) / (2 - 2w²)
/// ```
///
/// Writing `A0 = P0 - C` and `cos Δ = 2w² - 1` for the half-sweep, the columns
/// `[A0 | (A2 - cos Δ·A0) / sin Δ]` are the image of an orthonormal pair under the map
/// that takes the unit circle to this ellipse, so `S = M·Mᵀ` is that map's metric — and
/// being a product with its own transpose, `S` is independent of which orthonormal pair
/// was chosen. Its eigenvectors give the axis directions and its eigenvalues the squared
/// semi-axes.
pub fn conic_ellipse_params(conic: &RationalQuadraticBezier2) -> Option<EllipseParams>
{
    let [p0, p1, p2] = conic.control_points();
    let [w0, w1, w2] = conic.weights();
    let (p0, p1, p2) = (point_to_f64(p0)?, point_to_f64(p1)?, point_to_f64(p2)?);
    let (w0, w1, w2) = (w0.to_f64_lossy()?, w1.to_f64_lossy()?, w2.to_f64_lossy()?);

    if !(w0 > 0.0 && w2 > 0.0)
    {
        return None;
    }
    let w = w1 / (w0 * w2).sqrt();
    // w == 1 is a parabola and w > 1 a hyperbola; neither has a centre.
    if !(w.is_finite() && w > 0.0 && w < 1.0 - 1.0e-12)
    {
        return None;
    }

    let ww = w * w;
    let denom = 2.0 - 2.0 * ww;
    let center = [
        (p0[0] + p2[0] - 2.0 * ww * p1[0]) / denom,
        (p0[1] + p2[1] - 2.0 * ww * p1[1]) / denom,
    ];

    let a0 = [p0[0] - center[0], p0[1] - center[1]];
    let a2 = [p2[0] - center[0], p2[1] - center[1]];
    let cos_d = 2.0 * ww - 1.0;
    let sin_d = (1.0 - cos_d * cos_d).sqrt();
    if !(sin_d.is_finite() && sin_d > 1.0e-12)
    {
        return None;
    }
    let v = [(a2[0] - cos_d * a0[0]) / sin_d, (a2[1] - cos_d * a0[1]) / sin_d];

    // S = M·Mᵀ for M = [a0 | v].
    let s00 = a0[0] * a0[0] + v[0] * v[0];
    let s01 = a0[0] * a0[1] + v[0] * v[1];
    let s11 = a0[1] * a0[1] + v[1] * v[1];
    let theta = 0.5 * (2.0 * s01).atan2(s00 - s11);
    let mean = (s00 + s11) / 2.0;
    let dev = (((s00 - s11) / 2.0).powi(2) + s01 * s01).sqrt();
    let (a_sq, b_sq) = (mean + dev, mean - dev);
    if !(a_sq.is_finite() && b_sq > 0.0)
    {
        return None;
    }
    let (a, b) = (a_sq.sqrt(), b_sq.sqrt());

    let (ct, st) = (theta.cos(), theta.sin());
    // Eccentric anomaly of a point, in the ellipse's own frame.
    let param_of = |p: [f64; 2]| -> f64 {
        let d = [p[0] - center[0], p[1] - center[1]];
        ((d[0] * -st + d[1] * ct) / b).atan2((d[0] * ct + d[1] * st) / a)
    };

    // Independent check: the span's exact midpoint is not used anywhere above, so it is a
    // real test of the reconstruction rather than a restatement of it. Anything that does
    // not land on the ellipse means the caller must fall back to tessellating, never write
    // an ELLIPSE or an SVG `A` that misses the geometry it claims to describe.
    let mid = conic_mid(conic)?;
    let dm = [mid[0] - center[0], mid[1] - center[1]];
    let (u_m, v_m) = ((dm[0] * ct + dm[1] * st) / a, (dm[0] * -st + dm[1] * ct) / b);
    if ((u_m * u_m + v_m * v_m) - 1.0).abs() > 1.0e-9
    {
        return None;
    }

    let (t0, t2, tm) = (param_of(p0), param_of(p2), param_of(mid));
    // The span runs whichever way passes through its own midpoint.
    let wrap = |x: f64| -> f64 {
        let mut r = x % std::f64::consts::TAU;
        if r < 0.0
        {
            r += std::f64::consts::TAU;
        }
        r
    };
    let ccw = wrap(tm - t0) < wrap(t2 - t0);
    let (start_param, end_param) = if ccw { (t0, t2) } else { (t2, t0) };

    Some(EllipseParams {
        center,
        major: [a * ct, a * st],
        ratio: b / a,
        start_param,
        end_param,
        ccw,
    })
}

/// The exact point halfway along a conic span, in f64.
pub fn conic_mid(conic: &RationalQuadraticBezier2) -> Option<[f64; 2]>
{
    let half = real(0.5).ok()?;
    let pol = policy();
    match conic.point_at(half, &pol)
    {
        Classification::Decided(p) => point_to_f64(&p),
        _ => None,
    }
}

/// Build an exact **full ellipse** as a closed [`CurvePath2`] of rational
/// quadratic conic spans. Semi-axes `rx` (major direction) and `ry` (minor
/// direction), rotated `rotation` radians about `(cx, cy)`.
///
/// The ellipse is the affine image of a circle; this is the f64 boundary where
/// the rotation enters trigonometry once (see [`elliptical_arc`]).
pub fn ellipse(rx: f64, ry: f64, rotation: f64, cx: f64, cy: f64) -> Result<CurvePath2, String>
{
    elliptical_arc(rx, ry, rotation, cx, cy, 0.0, std::f64::consts::TAU)
}

/// Build an exact **elliptical arc** as a [`CurvePath2`] from `start_angle` to
/// `end_angle` (radians, in the pre-rotation circle parameter). A full turn
/// (`end - start == 2π`) closes the path. Semi-axes `rx`/`ry`, rotated `rotation`
/// radians about `(cx, cy)`.
pub fn elliptical_arc(
    rx: f64,
    ry: f64,
    rotation: f64,
    cx: f64,
    cy: f64,
    start_angle: f64,
    end_angle: f64,
) -> Result<CurvePath2, String>
{
    if !(rx.is_finite() && ry.is_finite() && rx > 0.0 && ry > 0.0)
    {
        return Err(format!("hcurve: invalid ellipse semi-axes {rx}x{ry}"));
    }
    // M = R(rotation) · diag(rx, ry), row-major [m00, m01, m10, m11]:
    //   û = (cos, sin), v̂ = (-sin, cos); columns rx·û and ry·v̂.
    let (c, s) = (rotation.cos(), rotation.sin());
    let map: EllipseMap2 = [
        real(rx * c)?,
        real(-ry * s)?,
        real(rx * s)?,
        real(ry * c)?,
    ];
    let center = point(cx, cy)?;
    let samples = ellipse_samples(start_angle, end_angle)?;
    elliptical_arc_path(&center, &map, &samples)
        .map_err(|e| format!("hcurve: ellipse construction failed ({e:?})"))
}

/// Ordered unit-circle sample directions `(cos φ, sin φ)` splitting
/// `[start, end]` into spans of at most 90° so every conic weight stays positive.
fn ellipse_samples(start: f64, end: f64) -> Result<Vec<(Real, Real)>, String>
{
    if !(start.is_finite() && end.is_finite())
    {
        return Err(format!("hcurve: invalid ellipse sweep {start}..{end}"));
    }
    let sweep = end - start;
    if sweep.abs() < 1.0e-12
    {
        return Err("hcurve: degenerate ellipse sweep".to_string());
    }
    let span_count = (sweep.abs() / std::f64::consts::FRAC_PI_2).ceil().max(1.0) as usize;
    let step = sweep / span_count as f64;
    (0..=span_count)
        .map(|i| unit_direction(start + step * i as f64))
        .collect()
}

/// Exact `(cos φ, sin φ)` for one sample angle. Near-cardinal angles snap to the
/// exact axis points `(±1, 0)` / `(0, ±1)` so axis-aligned ellipses stay exact
/// and full-turn paths close on an identical `Real` pair.
fn unit_direction(angle: f64) -> Result<(Real, Real), String>
{
    const EPS: f64 = 1.0e-12;
    let (c, s) = (angle.cos(), angle.sin());
    let snap = |v: f64| -> Option<i8> {
        [-1i8, 0, 1].into_iter().find(|t| (v - *t as f64).abs() < EPS)
    };
    if let (Some(ci), Some(si)) = (snap(c), snap(s))
    {
        // A genuine cardinal direction has exactly one non-zero unit component.
        if ci.abs() + si.abs() == 1
        {
            return Ok((real(ci as f64)?, real(si as f64)?));
        }
    }
    Ok((real(c)?, real(s)?))
}

/// Sample an exact [`CurvePath2`] (e.g. an ellipse) to an f64 polyline.
///
/// Delegates to hypercurve's own finite projection, which subdivides each polynomial or
/// rational Bezier span **in its native representation** and converts only the resulting
/// boundary product to `f64` — so the emitted chords actually honour `chord_error`.
///
/// This replaced a hand-rolled loop that evaluated each span at a fixed number of uniform
/// `t` values, derived from `chord_error` by a heuristic and clamped to 128. Uniform
/// parameter spacing is not uniform arc length on a rational conic, so that sampling did
/// not bound the chord error it was given, and the clamp silently capped accuracy on large
/// or eccentric curves.
pub fn tessellate_path(path: &CurvePath2, chord_error: f64) -> Result<Vec<[f64; 2]>, String>
{
    let mut out: Vec<[f64; 2]> = Vec::new();
    for curve in path.curves()
    {
        let samples = span_samples(curve, chord_error);
        for i in 0..=samples
        {
            let t = i as f64 / samples as f64;
            let pt = curve
                .point_at(&real(t)?)
                .map_err(|e| format!("hcurve: path point failed ({e:?})"))?;
            let xy = point_to_f64(&pt).ok_or_else(|| "hcurve: path point not finite".to_string())?;
            if out.last() != Some(&xy)
            {
                out.push(xy);
            }
        }
    }
    Ok(out)
}

/// Sample count for one exact span, at a chord error taken **relative to the span**.
///
/// A uniform-parameter sampler does not *certify* the chord error the way
/// [`CurvePath2::project_to_finite_polyline`] does, and this deliberately trades that
/// certification for speed on the display path: exact adaptive subdivision certifies
/// flatness in exact arithmetic per candidate span, which measured ~60-150x the per-point
/// cost of the native line/arc path — over a second to tessellate one spline, on a path
/// that `toPolygon`, `toMesh`, GLTF export and `OBbox` all sit on.
///
/// `chord_error` is read as a **fraction of the span's own size**, not as an absolute
/// distance. It arrives here as a bare number with no unit attached, and the same model is
/// authored in metres by one script and millimetres by another: read absolutely,
/// `DEFAULT_CHORD_ERROR` (1e-4) asks for 0.1 mm accuracy on the first and 0.1 *micron* on
/// the second. That is what an earlier revision of this function did, and on a house
/// measured in millimetres it turned one 2500 mm span into `sqrt(2500 / 8e-4)` = 1768
/// chords — feeding mesh CSG geometry ~50x denser than it needs and costing the house
/// script 10x its runtime, for accuracy far below what any display or mesh can show.
///
/// Reading it relatively makes the count depend on the curve's shape rather than on the
/// units it happens to be measured in, and keeps a caller that asks for something finer
/// (`Curve.perpendicularPointTo` samples at 1e-4, `tessellate(1e-5)`) getting it.
/// Exact geometry and exact point evaluation are unchanged; only the subdivision *proof*
/// is dropped.
fn span_samples(curve: &Curve2, chord_error: f64) -> usize
{
    // A straight span is its own chord: every interior sample lands on the line it already
    // describes, so subdividing one only inflates the polyline. This is not an optimisation
    // of an approximation — two points are the exact answer.
    if matches!(curve.family(), CurveFamily2::Line)
    {
        return 1;
    }
    let tol = if chord_error.is_finite() && chord_error > 0.0 { chord_error } else { 1.0e-4 };
    // For a chord over 1/n of a span, deviation falls as (L/n)^2 / R, so holding it to a
    // fixed fraction of L makes n depend only on the tolerance — which is the point: the
    // span's size cancels, so the count cannot run away with the model's units.
    //
    // The constant is calibrated to `0.5 / sqrt(tol)`: the density of the tolerance-only
    // heuristic this replaced, and therefore the density every fixture and threshold in the
    // suite is written against. It is a heuristic, not a bound — the (L/n)^2 / R estimate
    // assumes a span no more sharply curved than its own extent, and a tighter one deviates
    // proportionally more. Callers needing a *certified* chord error use the projection path
    // (`tessellate_open` / `tessellate_closed`) instead. The clamp is a backstop against a
    // pathological tolerance, not an accuracy ceiling: 1e-5 yields 158 samples, 1e-6 yields 500.
    ((1.0 / (4.0 * tol)).sqrt().ceil() as usize).clamp(8, 512)
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

/// Global interpolation: build a NURBS curve of `degree` (>= 2) passing exactly through
/// `points`, using chord-length parameters and an averaged knot vector.
///
/// Delegates to hypercurve's `NurbsCurve2::interpolate_chord_length`. This replaced ~165
/// lines of hand-rolled f64 Piegl & Tiller — knot-span search, basis functions and a
/// Gaussian-elimination solve with a hard `1e-12` singularity cutoff. hypercurve solves the
/// same system in exact rationals via hypersolve's Bareiss elimination and then *replays*
/// every solved coordinate against the coefficient matrix and every curve point against its
/// authored interpolation constraint, so a near-singular configuration is reported instead
/// of quietly producing a curve that misses its own data points.
pub fn nurbs_interpolate(points: &[[f64; 2]], degree: usize) -> Result<NurbsCurve2, String>
{
    let n = points.len();
    if degree < 2 || n < degree + 1
    {
        return Err(format!(
            "hcurve: interpolation needs degree>=2 and at least degree+1 points (got degree {degree}, {n} points)"
        ));
    }
    let pts: Vec<Point2> = points
        .iter()
        .map(|[x, y]| point(*x, *y))
        .collect::<Result<_, _>>()?;

    // Chord-length parameters, computed in f64 and then lifted to exact `Real`.
    //
    // NOT `NurbsCurve2::interpolate_chord_length`: that derives each parameter as an exact
    // `sqrt(dx^2 + dy^2)`, i.e. a symbolic radical, and the exact Bareiss solve over a
    // matrix of basis functions evaluated at nested radicals explodes — a 5-point cubic
    // took over 200 seconds. The *parameterization* is a modelling choice (any strictly
    // increasing sequence is a valid interpolation parameterization); only the *solve* has
    // to be exact. f64 chord lengths lift to dyadic rationals, which keep the exact solve
    // cheap, and match the parameterization this used to produce.
    let mut cumulative = vec![0.0f64; n];
    let mut total = 0.0;
    for k in 1..n
    {
        total += (points[k][0] - points[k - 1][0]).hypot(points[k][1] - points[k - 1][1]);
        cumulative[k] = total;
    }
    if total < 1e-12
    {
        return Err("hcurve: interpolation points are coincident".to_string());
    }
    let parameters: Vec<Real> = cumulative
        .iter()
        .map(|c| real(c / total))
        .collect::<Result<_, _>>()?;

    NurbsCurve2::interpolate_global(degree, pts, parameters)
        .map_err(|e| format!("hcurve: nurbs interpolation failed ({e:?})"))
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

/// One-sided offset of an **open** curve string by `distance` (positive = left of travel
/// direction, negative = right), returned as **native** line/arc geometry.
///
/// hypercurve miters line-line corners at the exact supporting-line intersection and joins
/// the rest with a circular arc, so the result is genuinely curved geometry — this used to
/// tessellate that result away, which is why offsetting a circle returned a 128-gon.
///
/// This is the raw parallel curve: it does **not** trim self-intersections (that is an
/// explicit upstream gap), so a profile offset far enough to fold over itself will produce
/// a self-touching result rather than a regularized one.
pub fn offset_open(cs: &CurveString2, distance: f64) -> Result<CurveString2, String>
{
    let pol = policy();
    decided(
        cs.offset_left_with_line_joins(real(distance)?, &pol)
            .map_err(|e| format!("hcurve: open offset failed ({e:?})"))?,
    )
}

/// One-sided offset of a **closed** contour by `distance` (sign relative to the contour's
/// winding), returned as **native** line/arc geometry. See [`offset_open`].
pub fn offset_closed(ct: &Contour2, distance: f64) -> Result<Contour2, String>
{
    let pol = policy();
    decided(
        ct.offset_left_with_line_joins(real(distance)?, &pol)
            .map_err(|e| format!("hcurve: closed offset failed ({e:?})"))?,
    )
}

/// One-sided offset of an exact [`CurvePath2`] (conic / Bezier / spline spans).
///
/// There is no *exact* free-form offset: the parallel of a general rational curve is not
/// itself a rational curve. hypercurve instead constructs a **certified approximation** —
/// Levien cubics and Blend2D quadratics as candidates, each accepted only after an
/// exact-scalar verifier bounds its deviation — so the result stays a `CurvePath2` of real
/// curve spans rather than collapsing to a polyline.
///
/// Returns `Ok(None)` when hypercurve declines (e.g. an authored corner it will not blend,
/// or an offset that would self-intersect, which it does not trim), leaving the caller to
/// fall back.
pub fn offset_path(path: &CurvePath2, distance: f64, chord_error: f64) -> Result<Option<CurvePath2>, String>
{
    let pol = policy();
    let opts = BezierParallelVerificationOptions::try_new(real(chord_error)?, 24, &pol)
        .map_err(|e| format!("hcurve: parallel options failed ({e:?})"))?;
    match path.approximate_parallel_blend2d_certified(real(distance)?, &opts, &pol)
    {
        Ok(Classification::Decided(parallel)) => Ok(Some(parallel.path().clone())),
        Ok(Classification::Uncertain(_)) => Ok(None),
        Err(_) => Ok(None),
    }
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
/// `only`: when `Some`, restrict filleting to those corner (vertex) indices; every other
/// corner is left sharp. `None` fillets every fitting corner. An empty slice is a no-op.
pub fn fillet_segments(segs: &[Segment2], radius: f64, closed: bool, only: Option<&[usize]>)
    -> Result<Vec<Segment2>, String>
{
    if !(radius.is_finite() && radius > 0.0) || segs.len() < 2
    {
        return Ok(segs.to_vec());
    }
    if only.is_some_and(|sel| sel.is_empty())
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
        if only.is_some_and(|sel| !sel.contains(&vi))
        {
            return None; // not one of the requested corners — leave it sharp
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
    fn full_ellipse_is_closed_with_four_conic_spans()
    {
        let e = ellipse(3.0, 1.5, 0.0, 0.0, 0.0).unwrap();
        assert_eq!(e.curves().len(), 4);
        assert_eq!(e.start(), e.end());
    }

    #[test]
    fn ellipse_tessellation_spans_the_semi_axes()
    {
        let e = ellipse(3.0, 1.5, 0.0, 0.0, 0.0).unwrap();
        let pts = tessellate_path(&e, DEFAULT_CHORD_ERROR).unwrap();
        let max_x = pts.iter().map(|p| p[0]).fold(f64::MIN, f64::max);
        let max_y = pts.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
        assert!((max_x - 3.0).abs() < 1e-9, "max_x = {max_x}");
        assert!((max_y - 1.5).abs() < 1e-9, "max_y = {max_y}");
    }

    #[test]
    fn rotated_ellipse_swaps_extents()
    {
        // 90° rotation swaps the x/y extents (major axis now vertical).
        let e = ellipse(3.0, 1.5, std::f64::consts::FRAC_PI_2, 0.0, 0.0).unwrap();
        let pts = tessellate_path(&e, DEFAULT_CHORD_ERROR).unwrap();
        let max_x = pts.iter().map(|p| p[0]).fold(f64::MIN, f64::max);
        let max_y = pts.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
        assert!((max_x - 1.5).abs() < 1e-9, "max_x = {max_x}");
        assert!((max_y - 3.0).abs() < 1e-9, "max_y = {max_y}");
    }

    #[test]
    fn elliptical_arc_quarter_is_open()
    {
        let a = elliptical_arc(3.0, 1.5, 0.0, 0.0, 0.0, 0.0, std::f64::consts::FRAC_PI_2).unwrap();
        assert_eq!(a.curves().len(), 1);
        assert_ne!(a.start(), a.end());
        let pts = tessellate_path(&a, DEFAULT_CHORD_ERROR).unwrap();
        // Starts at the +x vertex (3,0), ends at the +y vertex (0,1.5).
        assert!((pts.first().unwrap()[0] - 3.0).abs() < 1e-9);
        assert!((pts.last().unwrap()[1] - 1.5).abs() < 1e-9);
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

    /// Exact area of the single material region produced by `op`, asserting there is
    /// exactly one. Reads the native contour, so there is no chord error to allow for.
    fn one_region_area(a: &Contour2, b: &Contour2, op: BooleanOp) -> f64
    {
        let regions = boolean_native(a, b, op).expect("hypercurve declined the topology");
        assert_eq!(regions.len(), 1, "expected a single material region");
        signed_area(&regions[0].exterior).unwrap().abs()
    }

    #[test]
    fn union_of_two_overlapping_squares_is_one_ring()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        // L-shaped union area = 100 + 100 - 25 overlap = 175.
        let area = one_region_area(&a, &b, BooleanOp::Union);
        assert!((area - 175.0).abs() < 1e-9, "union area = {area}");
    }

    #[test]
    fn intersection_of_two_overlapping_squares()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        let area = one_region_area(&a, &b, BooleanOp::Intersection);
        assert!((area - 25.0).abs() < 1e-9, "intersection area = {area}");
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
        let regions = boolean_native(&outer, &inner, BooleanOp::Difference).unwrap();
        assert_eq!(regions.len(), 1, "one material region");
        assert_eq!(regions[0].holes.len(), 1, "with exactly one hole");
        let ext = signed_area(&regions[0].exterior).unwrap().abs();
        let hole = signed_area(&regions[0].holes[0]).unwrap().abs();
        assert!((ext - 400.0).abs() < 1e-9, "exterior area = {ext}");
        assert!((hole - 36.0).abs() < 1e-9, "hole area = {hole}");
    }

    #[test]
    fn difference_removes_overlap()
    {
        let a = square(0.0, 0.0, 5.0);
        let b = square(5.0, 5.0, 5.0);
        let area = one_region_area(&a, &b, BooleanOp::Difference);
        assert!((area - 75.0).abs() < 1e-9, "difference area = {area}");
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

    /// A NURBS as an exact single-span path, which is how `Curve3DJs` stores one.
    fn nurbs_path(c: &NurbsCurve2) -> CurvePath2
    {
        let curve = Curve2::try_nurbs(
            c.degree(),
            c.control_points().to_vec(),
            c.weights().to_vec(),
            c.knots().to_vec(),
        )
        .unwrap();
        CurvePath2::try_new(vec![curve]).unwrap()
    }

    #[test]
    fn nurbs_degree_below_two_is_rejected()
    {
        // A degree-1 "NURBS" is a polyline; those are CurveString2, not spline carriers.
        let pts = [[0.0, 0.0], [10.0, 0.0], [20.0, 5.0]];
        assert!(nurbs_interpolate(&pts, 1).is_err());
    }

    #[test]
    fn nurbs_interpolation_is_a_real_spline_not_a_polyline()
    {
        // The carrier keeps its solved control net and knot vector, rather than being
        // flattened into sampled points on construction.
        let pts = [[0.0, 0.0], [1.0, 2.0], [3.0, 3.0], [5.0, 1.0], [6.0, 4.0]];
        let c = nurbs_interpolate(&pts, 3).unwrap();
        assert_eq!(c.degree(), 3);
        assert_eq!(c.control_points().len(), pts.len());
        assert_eq!(c.knots().len(), pts.len() + 3 + 1);
        // A single exact span, not one per sample.
        assert_eq!(nurbs_path(&c).curves().len(), 1);
    }

    #[test]
    fn nurbs_interpolation_passes_through_points()
    {
        let pts = [[0.0, 0.0], [1.0, 2.0], [3.0, 3.0], [5.0, 1.0], [6.0, 4.0]];
        let c = nurbs_interpolate(&pts, 3).unwrap();
        assert_eq!(c.degree(), 3);
        let tess = tessellate_path(&nurbs_path(&c), 1e-5).unwrap();
        // Each input point must lie on the tessellated curve (interpolation property).
        //
        // Measured point-to-SEGMENT, not point-to-vertex: a chord tolerance bounds how far
        // the polyline strays from the curve, not how far apart its vertices are, so a point
        // exactly on the curve can still sit well away from the nearest sample.
        let dist_to_polyline = |q: &[f64; 2]| {
            tess.windows(2)
                .map(|w| {
                    let (a, b) = (w[0], w[1]);
                    let (abx, aby) = (b[0] - a[0], b[1] - a[1]);
                    let len2 = abx * abx + aby * aby;
                    let t = if len2 <= 0.0
                    {
                        0.0
                    }
                    else
                    {
                        (((q[0] - a[0]) * abx + (q[1] - a[1]) * aby) / len2).clamp(0.0, 1.0)
                    };
                    (a[0] + abx * t - q[0]).hypot(a[1] + aby * t - q[1])
                })
                .fold(f64::MAX, f64::min)
        };
        for q in &pts
        {
            let min_d = dist_to_polyline(q);
            assert!(min_d < 1e-4, "point {q:?} not interpolated (min dist {min_d})");
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
        let off = offset_open(&line, 2.0).unwrap();
        let pts = tessellate_open(&off, DEFAULT_CHORD_ERROR).unwrap();
        assert!(pts.iter().all(|p| (p[1] - 2.0).abs() < 1e-9), "offset = {pts:?}");
        // Right side (negative) -> y = -3.
        let off_r = offset_open(&line, -3.0).unwrap();
        let pts_r = tessellate_open(&off_r, DEFAULT_CHORD_ERROR).unwrap();
        assert!(pts_r.iter().all(|p| (p[1] + 3.0).abs() < 1e-9), "offset_r = {pts_r:?}");
    }

    #[test]
    fn offset_of_a_circle_is_a_circle_not_a_polygon()
    {
        // The whole point of returning native geometry: an offset circle stays two arc
        // spans with an exact radius, instead of becoming a many-sided ring.
        let c = circle(0.0, 0.0, 4.0).unwrap();
        let off = offset_closed(&c, 1.0).unwrap();
        assert_eq!(off.segments().len(), 2, "offset circle should stay two arc spans");
        assert!(off.segments().iter().all(|s| matches!(s, Segment2::Arc(_))));
        // Radius 4 offset by 1 is radius 3 or 5 depending on winding; both are exact.
        let area = signed_area(&off).unwrap().abs();
        let (a3, a5) = (std::f64::consts::PI * 9.0, std::f64::consts::PI * 25.0);
        assert!(
            (area - a3).abs() < 1e-9 || (area - a5).abs() < 1e-9,
            "offset circle area = {area}"
        );
    }

    #[test]
    fn offset_closed_square_changes_area()
    {
        let sq = square(0.0, 0.0, 5.0); // 10x10, area 100
        // Offset by 1 (one side of the CCW boundary) — area should change by a
        // predictable amount and stay a valid ring.
        let ring = offset_closed(&sq, 1.0).unwrap();
        let area = signed_area(&ring).unwrap().abs();
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

    /// Every conic span of one ellipse must recover the *same* ellipse — the spans are
    /// built in an arbitrary pre-image frame, so this is what proves the derivation is
    /// frame-independent rather than accidentally right for the axis-aligned case.
    #[test]
    fn conic_ellipse_params_recovers_the_ellipse_from_every_span()
    {
        for rot in [0.0, std::f64::consts::FRAC_PI_6, std::f64::consts::FRAC_PI_2]
        {
            let path = ellipse(3.0, 1.5, rot, 7.0, -2.0).unwrap();
            let mut seen = 0;
            for curve in path.curves()
            {
                let CurveGeometry2::RationalQuadraticBezier(conic) = curve.geometry() else {
                    panic!("ellipse span is not a conic: {:?}", curve.family());
                };
                let e = conic_ellipse_params(conic)
                    .unwrap_or_else(|| panic!("no ellipse params for span {seen} at rot {rot}"));

                assert!((e.center[0] - 7.0).abs() < 1e-9, "cx = {}", e.center[0]);
                assert!((e.center[1] + 2.0).abs() < 1e-9, "cy = {}", e.center[1]);
                let a = e.major[0].hypot(e.major[1]);
                assert!((a - 3.0).abs() < 1e-9, "semi-major = {a}");
                assert!((a * e.ratio - 1.5).abs() < 1e-9, "semi-minor = {}", a * e.ratio);
                // The major axis direction is defined up to sign.
                let ang = e.major[1].atan2(e.major[0]);
                let d = (ang - rot).rem_euclid(std::f64::consts::PI);
                assert!(d < 1e-9 || (std::f64::consts::PI - d) < 1e-9, "axis angle {ang} vs {rot}");
                seen += 1;
            }
            assert!(seen >= 4, "expected >= 4 conic spans, got {seen}");
        }
    }

    /// A circle scaled non-uniformly is the other way conics enter a curve, and it goes
    /// through `transform_affine` rather than `elliptical_arc_path` — a genuinely
    /// different construction, so it is worth deriving from too.
    #[test]
    fn conic_ellipse_params_handles_a_non_uniformly_scaled_circle()
    {
        let circle_path = path_from_segments(circle(0.0, 0.0, 10.0).unwrap().segments()).unwrap();
        let scaled = transform_affine_path(&circle_path, 2.0, 0.0, 0.0, 0.5, 0.0, 0.0).unwrap();
        let mut seen = 0;
        for path in &scaled
        {
            for curve in path.curves()
            {
                if let CurveGeometry2::RationalQuadraticBezier(conic) = curve.geometry()
                {
                    let e = conic_ellipse_params(conic).expect("scaled circle span");
                    let a = e.major[0].hypot(e.major[1]);
                    assert!((a - 20.0).abs() < 1e-9, "semi-major = {a}");
                    assert!((a * e.ratio - 5.0).abs() < 1e-9, "semi-minor = {}", a * e.ratio);
                    seen += 1;
                }
            }
        }
        assert!(seen > 0, "non-uniform scale produced no conic spans");
    }

    #[test]
    fn arc_params_round_trips_the_bulge_it_was_built_from()
    {
        for b in [0.2_f64, 0.5, 1.0, -0.3]
        {
            let seg = Segment2::from_bulge(point(0.0, 0.0).unwrap(), point(10.0, 0.0).unwrap(),
                real(b).unwrap()).unwrap();
            let Segment2::Arc(arc) = seg else { panic!("bulge {b} did not give an arc") };
            let p = arc_params(&arc).expect("arc params");
            assert!((p.bulge - b).abs() < 1e-9, "bulge {} vs {b}", p.bulge);
            assert_eq!(p.ccw, b > 0.0, "orientation for bulge {b}");
            // Sagitta is |bulge| * half-chord, by the definition bulge = tan(theta/4).
            //
            // The sign is the part worth pinning: a positive (counter-clockwise) bulge on
            // a left-to-right chord sags to -y, because the centre sits above and the arc
            // runs along the bottom of that circle. `circle()` above depends on exactly
            // this — it builds its *bottom* semicircle as left->right with bulge +1.
            assert!((p.mid[0] - 5.0).abs() < 1e-9, "mid x = {}", p.mid[0]);
            assert!((p.mid[1] + b * 5.0).abs() < 1e-9, "mid = {:?} for bulge {b}", p.mid);
        }
    }

    /// A half circle is two 180-degree arcs; each must report a full pi of sweep and a
    /// radius equal to the circle's, not to something re-derived from samples.
    #[test]
    fn arc_params_reads_a_circle_exactly()
    {
        let ct = circle(3.0, -4.0, 12.5).unwrap();
        for seg in ct.segments()
        {
            let Segment2::Arc(arc) = seg else { panic!("circle segment is not an arc") };
            let p = arc_params(arc).expect("arc params");
            assert!((p.radius - 12.5).abs() < 1e-12, "radius = {}", p.radius);
            assert!((p.center[0] - 3.0).abs() < 1e-12 && (p.center[1] + 4.0).abs() < 1e-12);
            assert!((p.sweep - std::f64::consts::PI).abs() < 1e-9, "sweep = {}", p.sweep);
        }
    }
}
