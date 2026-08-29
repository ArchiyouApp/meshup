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
    CircularArc2, Contour2, Curve2, CurveContext, CurveCornerMode2, CurveCornerSolutions2,
    CurveGeometry2, CurveOutcome, CurvePath2,
    CurveRegion2,
    CurveString2, EllipseMap2,
    LineArcIntersection, LineLineIntersection, LineSeg2,
    NurbsCurve2, Point2, RationalQuadraticBezier2, Real,
    Segment2,
    SegmentIntersection, Similarity2,
    elliptical_arc_path,
};

/// Default chord error used when sampling exact arcs/curves to f64 polylines.
/// Small enough for display/meshing, large enough to keep vertex counts sane.
///
/// Read **relatively** — as a fraction of a span's own size, not as a distance in model
/// units. See [`span_samples`] for why.
pub const DEFAULT_CHORD_ERROR: f64 = 1.0e-3;

/// Default facets per full turn for an exact circular-arc span. A whole circle becomes this
/// many chords, a quarter-circle fillet a quarter of them.
pub const DEFAULT_SEGMENTS_PER_TURN: f64 = 64.0;

/// Least / most samples one curved span is ever subdivided into. The floor keeps a very
/// short arc from collapsing to its chord; the ceiling is the backstop against a
/// pathological tolerance, not an accuracy target.
pub const DEFAULT_MIN_SEGMENTS: usize = 2;
pub const DEFAULT_MAX_SEGMENTS: usize = 512;

/// How finely exact geometry is sampled down to f64 polylines.
///
/// One profile, held globally (see [`quality`] / [`set_quality`]) and overridable per call,
/// so that every route out of the exact kernel — [`tessellate_open`], [`tessellate_closed`],
/// [`tessellate_path`] — agrees on how dense its output is. They did not always: the first
/// two used to run hypercurve's *certified* projection, which reads a chord error as an
/// absolute distance and therefore sampled a circle more finely the bigger it was (r=10 →
/// 226 points, r=1000 → 2224), while the third already sampled relatively. Every mesh built
/// from a curve — `extrude`, `loft`, `toPolygon`, `sweep` — inherited that.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TessQuality
{
    /// Facets per full turn for an exact circular-arc span. The primary angular dial: it
    /// fixes an arc's chord count by how far the arc *turns*, which no radius or unit
    /// choice can inflate.
    pub segments_per_turn: f64,
    /// Chord deviation as a **fraction of the span's own size**. Drives spans that have no
    /// exact turn to read — Bezier, rational conic, spline.
    pub chord_tolerance: f64,
    /// Least samples for one curved span.
    pub min_segments: usize,
    /// Most samples for one curved span.
    pub max_segments: usize,
}

impl Default for TessQuality
{
    fn default() -> Self
    {
        Self {
            segments_per_turn: DEFAULT_SEGMENTS_PER_TURN,
            chord_tolerance: DEFAULT_CHORD_ERROR,
            min_segments: DEFAULT_MIN_SEGMENTS,
            max_segments: DEFAULT_MAX_SEGMENTS,
        }
    }
}

impl TessQuality
{
    /// A profile from a bare chord tolerance, for the callers that still pass one number.
    ///
    /// The tolerance is a *relative* sagitta (deviation ÷ radius), so the equivalent angular
    /// density follows from `dev/R = 1 - cos(θ / 2n)` over a full turn:
    /// `segments_per_turn = π / acos(1 - tol)`. That gives 22 facets per turn at 1e-2, 70 at
    /// 1e-3, 222 at 1e-4 and 702 at 1e-5 — at any radius, in any unit.
    pub fn from_chord_tolerance(tol: f64) -> Self
    {
        let base = quality();
        let tol = if tol.is_finite() && tol > 0.0 && tol < 2.0 { tol } else { base.chord_tolerance };
        // acos() of anything <= -1 is undefined territory; the guard above keeps tol < 2.
        let half = (1.0 - tol).clamp(-1.0, 1.0).acos();
        let per_turn = if half > 0.0 { std::f64::consts::PI / half } else { base.segments_per_turn };
        Self { segments_per_turn: per_turn, chord_tolerance: tol, ..base }
    }

    /// Clamp `n` into this profile's per-span range, never below 1.
    #[inline]
    fn clamp_samples(&self, n: usize) -> usize
    {
        let lo = self.min_segments.max(1);
        let hi = self.max_segments.max(lo);
        n.clamp(lo, hi)
    }

    /// Reject a profile built from nonsense rather than letting it reach a sampling loop:
    /// a non-finite or non-positive dial would otherwise mean an empty polyline or a hang.
    fn sanitised(self) -> Self
    {
        let d = Self::default();
        Self {
            segments_per_turn: if self.segments_per_turn.is_finite() && self.segments_per_turn >= 1.0
                { self.segments_per_turn.min(100_000.0) } else { d.segments_per_turn },
            chord_tolerance: if self.chord_tolerance.is_finite() && self.chord_tolerance > 0.0
                { self.chord_tolerance } else { d.chord_tolerance },
            min_segments: self.min_segments.clamp(1, 4096),
            max_segments: self.max_segments.clamp(1, 4096),
        }
    }
}

thread_local! {
    static QUALITY: std::cell::Cell<TessQuality> = const {
        std::cell::Cell::new(TessQuality {
            segments_per_turn: DEFAULT_SEGMENTS_PER_TURN,
            chord_tolerance: DEFAULT_CHORD_ERROR,
            min_segments: DEFAULT_MIN_SEGMENTS,
            max_segments: DEFAULT_MAX_SEGMENTS,
        })
    };
}

/// The tessellation profile in force. Every default-quality sampling route reads this.
#[inline]
pub fn quality() -> TessQuality
{
    QUALITY.with(|q| q.get())
}

/// Install a new tessellation profile. Sanitised first, so a caller cannot install a dial
/// that would produce an empty polyline or an unbounded loop.
pub fn set_quality(q: TessQuality)
{
    QUALITY.with(|cell| cell.set(q.sanitised()));
}

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

/// The shared operation context. `hypercurve` threads a [`CurveContext`] through every
/// predicate; `STRICT` accepts only exact or certified-refinement decisions.
#[inline]
pub fn policy() -> CurveContext
{
    CurveContext::STRICT
}

/// Context for region booleans and corner edits.
///
/// `STRICT` alone *declines* a fair amount of arc↔line region topology — a tangency, or an
/// intersection landing exactly on a shared vertex, comes back `Uncertain` — so booleans
/// between circles and polygons did not resolve. `APPROXIMATE_512` is hypercurve's authorized
/// escape: it permits hyperlimit's terminal 512-bit interpretation for the decisions that
/// strict refinement cannot close.
///
/// It is not a *tolerance*, and it is not lossy geometry: every operation first runs a
/// complete strict pass and only then re-runs under the terminal (see
/// `resolve_certified_operation`), the result is the same exact carrier either way, and the
/// returned [`CurveOutcome::certainty`] records which one answered. This replaces the old
/// `CurvePolicy::edge_preview(Tolerance)` and the escalating tolerance ladder built on it,
/// neither of which exists upstream any more — tolerances are now confined to
/// `CurvePreviewOptions`, which is for rendering and explicitly must not be retained as
/// topology.
#[inline]
pub fn boolean_policy() -> CurveContext
{
    CurveContext::APPROXIMATE_512
}

/// Unwrap a completed operation, discarding the certainty flag.
///
/// Every hypercurve operation now returns [`CurveOutcome`] — the value plus whether any
/// decision consumed the `APPROXIMATE_512` terminal. meshup asks for that terminal
/// deliberately (see [`boolean_policy`]) and has nowhere to report the distinction, so the
/// flag is dropped at this one named place rather than at forty call sites.
#[inline]
pub(crate) fn done<T>(outcome: CurveOutcome<T>) -> T
{
    outcome.into_value()
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
///
/// Both operands are promoted to [`CurveRegion2`], hypercurve's single authoritative region
/// type, which retains the line/arc carrier as a certified fast path — so this is still the
/// native route, not a lowering. `RegionView2`/`LineArcRegion2`, the borrowed line/arc region
/// pair this used to call, are no longer public: there is one region Boolean now, and the
/// native contours come back out through [`CurveRegion2::native_contours_fast_path`].
pub fn boolean_native(a: &Contour2, b: &Contour2, op: BooleanOp) -> Option<Vec<NativeRegion>>
{
    // The exact geometry first. There is no tolerance ladder to climb any more — the old one
    // escalated `edge_preview` tolerances, and the tolerance-carrying policy is gone.
    boolean_native_once(a, b, op).or_else(|| {
        // Declined — the contact is exactly degenerate (an intersection landing on a shared
        // vertex, e.g. a circle through a rectangle corner). Nudge `b` by a small offset to
        // turn the coincidence into a clean crossing (Simulation-of-Simplicity style). The
        // offset stays below display resolution, so the result is geometrically
        // indistinguishable.
        const EPS: f64 = 1.0e-4;
        let nudges = [(EPS, 0.0), (0.0, EPS), (-EPS, EPS)];
        nudges.iter().find_map(|&(dx, dy)| {
            let moved = transform_contour(b, &similarity(1.0, 0.0, 0.0, 1.0, dx, dy).ok()?).ok()?;
            boolean_native_once(a, &moved, op)
        })
    })
}

/// One boolean attempt over the exact contours.
fn boolean_native_once(a: &Contour2, b: &Contour2, op: BooleanOp) -> Option<Vec<NativeRegion>>
{
    let pol = boolean_policy();
    let region_a = done(CurveRegion2::try_from_native_material_contours(vec![a.clone()], &pol).ok()?);
    let region_b = done(CurveRegion2::try_from_native_material_contours(vec![b.clone()], &pol).ok()?);
    let result = done(region_a.boolean_region(&region_b, op, &pol).ok()?);
    // Ask for the line/arc carrier back. A line/arc boolean of line/arc operands stays
    // line/arc, so this is the expected answer; anything else means the result needs the
    // path-based route instead of this one.
    let native = match done(result.native_contours_fast_path(&pol).ok()?)
    {
        Classification::Decided(view) => view,
        Classification::Uncertain(_) => return None,
    };
    Some(associate_holes(native.material_contours(), native.hole_contours(), &pol))
}

/// Group a region's material and hole contours into [`NativeRegion`]s, assigning
/// each hole to the material contour that contains it.
fn associate_holes(materials: &[Contour2], holes: &[Contour2], pol: &CurveContext) -> Vec<NativeRegion>
{
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
    let region = done(CurveRegion2::try_from_boundary_paths(std::slice::from_ref(path), &pol).ok()?);
    let moved = done(
        region
            .transform_affine(
                &real(m00).ok()?,
                &real(m01).ok()?,
                &real(m10).ok()?,
                &real(m11).ok()?,
                &real(tx).ok()?,
                &real(ty).ok()?,
                &pol,
            )
            .ok()?,
    );
    match moved.materialized_boundary_paths(&pol)
    {
        Ok(outcome) => match done(outcome)
        {
            Classification::Decided(paths) if !paths.is_empty() => Some(paths),
            _ => None,
        },
        Err(_) => None,
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
    let pol = boolean_policy();
    let region_a = done(CurveRegion2::try_from_boundary_paths(std::slice::from_ref(a), &pol).ok()?);
    let region_b = done(CurveRegion2::try_from_boundary_paths(std::slice::from_ref(b), &pol).ok()?);
    // One call now: the two-step `retain_boolean` -> `boolean_region(op)` split, which built
    // shared intersection evidence and then read one operation out of it, is folded into
    // `boolean_region`. `boolean_regions` is the surviving batch form, for callers that want
    // all four operations off one arrangement.
    let region = done(region_a.boolean_region(&region_b, op, &pol).ok()?);
    match region.materialized_boundary_paths(&pol)
    {
        Ok(outcome) => match done(outcome)
        {
            Classification::Decided(paths) if !paths.is_empty() => Some(paths),
            _ => None,
        },
        Err(_) => None,
    }
}

/// Intersection points between two exact paths, as f64 pairs.
///
/// Uses hypercurve's retained mixed-family path intersection, so a conic operand is not
/// lowered to line work first. `None` when the pair is declined.
pub fn intersect_paths(a: &CurvePath2, b: &CurvePath2) -> Option<Vec<[f64; 2]>>
{
    let pol = policy();
    let result = done(a.intersect_path(b, &pol).ok()?);
    let mut pts: Vec<[f64; 2]> = Vec::new();
    for contact in result.contacts()
    {
        // `as_exact` is `Some` only when the contact carries `Real` coordinates. Every other
        // form retains the point as an exact algebraic image instead — the enum has grown
        // seven such variants. Rather than silently drop a real intersection, decline the
        // whole query so the caller falls back to the sampled path, which will find it.
        let p = contact.contact().point().as_exact()?;
        pts.push(point_to_f64(p)?);
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
    // NOT the bare `try_new`, which is `STRICT`. The chain arrives from a `Contour2` or a
    // `CurveString2`, both of which hypercurve already validated as connected, so this is
    // re-deciding a question that has an answer — and after a boolean or an offset it is a
    // question STRICT cannot always close: two endpoints that ARE the same point can be
    // carried as different exact expressions, and certifying their difference to zero then
    // needs the authorized terminal. Without it, offsetting a boolean result failed at the
    // lift, before any offsetting happened.
    CurvePath2::try_new_with_policy(curves, &boolean_policy())
        .map(done)
        .map_err(|e| format!("hcurve: path from segments failed ({e:?})"))
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

/// Sample an open curve string to an f64 polyline.
///
/// `CurveString2` is line/arc topology only (see [`segments_from_path`]), so the spans are
/// lifted into an exact [`CurvePath2`] and sampled by [`tessellate_path`] — the one
/// sampler. This used to call hypercurve's *certified* finite projection instead, which
/// bounds the chord error as an absolute distance and therefore made the point count grow
/// with the curve's radius and shrink with the model's unit. Bounding the turn instead
/// costs the certificate and buys a count that is the same at r = 10 and at r = 10 000.
pub fn tessellate_open(cs: &CurveString2, q: &TessQuality) -> Result<Vec<[f64; 2]>, String>
{
    let path = path_from_segments(cs.segments())?;
    let mut pts = tessellate_path(&path, q)?;

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
///
/// Same route as [`tessellate_open`], plus the closing point: [`tessellate_path`] walks a
/// path and stops at its last span's end, while every caller of this reads a ring that
/// returns to its start.
pub fn tessellate_closed(ct: &Contour2, q: &TessQuality) -> Result<Vec<[f64; 2]>, String>
{
    let path = path_from_segments(ct.segments())?;
    let mut pts = tessellate_path(&path, q)?;
    if let (Some(&first), Some(&last)) = (pts.first(), pts.last())
    {
        if first != last
        {
            pts.push(first);
        }
    }
    Ok(pts)
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
///   summing the chords [`tessellate_path`] lays over it. That is an approximation, and it
///   converges as the profile's `chord_tolerance` tightens.
///
/// This replaced a flat chord sum over the whole path, which also approximated the line and
/// arc spans that have exact answers.
pub fn length_path(path: &CurvePath2, q: &TessQuality) -> Result<f64, String>
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
                let pts = tessellate_path(&span, q)?;
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
    let pol = policy();
    let region = done(
        CurveRegion2::try_from_boundary_paths(std::slice::from_ref(path), &pol)
            .map_err(|e| format!("hcurve: region from path failed ({e:?})"))?,
    );
    match region.signed_area(&pol)
    {
        Ok(outcome) => match done(outcome)
        {
            Classification::Decided(Some(area)) => area
                .to_f64_lossy()
                .ok_or_else(|| "hcurve: path area not representable as f64".to_string()),
            Classification::Decided(None) => Err("hcurve: path area undefined".to_string()),
            Classification::Uncertain(reason) =>
            {
                Err(format!("hcurve: path area undecided ({reason:?})"))
            }
        },
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

/// A rectangle with rounded corners, exactly.
///
/// `rx`/`ry` follow the SVG `<rect>` rules: each defaults to the other when only one is
/// given, and both are clamped to half the corresponding side. Equal radii give four
/// circular quarter-turns as a native [`Contour2`] (bulge `tan(45 deg) = sqrt(2) - 1`);
/// unequal radii need elliptical corners, so the result is a mixed-family path.
///
/// Returns `Ok(Err(..))`-shaped output as an enum rather than two functions because the
/// caller wants "the rectangle", not "which carrier it landed in".
pub enum RoundedRect
{
    /// Sharp, or circular corners: native line/arc geometry.
    Native(Contour2),
    /// Elliptical corners: conic spans.
    Path(CurvePath2),
}

pub fn rounded_rect(x: f64, y: f64, w: f64, h: f64, rx: f64, ry: f64)
    -> Result<RoundedRect, String>
{
    if !(w.is_finite() && h.is_finite() && w > 0.0 && h > 0.0)
    {
        return Err(format!("hcurve: invalid rect size {w}x{h}"));
    }
    let rx = rx.clamp(0.0, w / 2.0);
    let ry = ry.clamp(0.0, h / 2.0);

    if rx <= 0.0 || ry <= 0.0
    {
        return closed_contour(&[[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
            .map(RoundedRect::Native);
    }

    // The outline as eight points: each straight run's ends, and each corner's ends.
    // Walking in SVG's y-down space, which is the maths-positive direction.
    //
    //        p0 ──── p1
    //      p7          p2
    //      |            |
    //      p6          p3
    //        p5 ──── p4
    let pts = [
        [x + rx, y],
        [x + w - rx, y],
        [x + w, y + ry],
        [x + w, y + h - ry],
        [x + w - rx, y + h],
        [x + rx, y + h],
        [x, y + h - ry],
        [x, y + ry],
    ];
    // Corner centres, in the order the corners are reached.
    let centres =
        [[x + w - rx, y + ry], [x + w - rx, y + h - ry], [x + rx, y + h - ry], [x + rx, y + ry]];
    // Each corner sweeps a quarter turn counter-clockwise in the ellipse's own parameter.
    let quarter = std::f64::consts::FRAC_PI_2;
    let sweeps = [(-quarter, 0.0), (0.0, quarter), (quarter, 2.0 * quarter),
        (2.0 * quarter, 3.0 * quarter)];

    if (rx - ry).abs() <= 1.0e-12
    {
        // Circular corners: a quarter turn is bulge = tan(90 deg / 4).
        let bulge = real(std::f64::consts::SQRT_2 - 1.0)?;
        let mut segs: Vec<Segment2> = Vec::with_capacity(8);
        for i in 0..4
        {
            // The straight run into corner i, skipped when the radius eats the whole side.
            let (a, b) = (pts[i * 2], pts[i * 2 + 1]);
            if a != b
            {
                segs.push(Segment2::Line(
                    LineSeg2::try_new(point(a[0], a[1])?, point(b[0], b[1])?)
                        .map_err(|e| format!("hcurve: rounded rect edge failed ({e:?})"))?,
                ));
            }
            let c = pts[(i * 2 + 2) % 8];
            segs.push(
                Segment2::from_bulge(point(b[0], b[1])?, point(c[0], c[1])?, bulge.clone())
                    .map_err(|e| format!("hcurve: rounded rect corner failed ({e:?})"))?,
            );
        }
        return Contour2::try_new(segs)
            .map(RoundedRect::Native)
            .map_err(|e| format!("hcurve: rounded rect contour failed ({e:?})"));
    }

    // Elliptical corners: each is a quarter of an axis-aligned rx-by-ry ellipse.
    let mut curves: Vec<Curve2> = Vec::new();
    for i in 0..4
    {
        let (a, b) = (pts[i * 2], pts[i * 2 + 1]);
        if a != b
        {
            let seg = LineSeg2::try_new(point(a[0], a[1])?, point(b[0], b[1])?)
                .map_err(|e| format!("hcurve: rounded rect edge failed ({e:?})"))?;
            curves.push(Curve2::from(seg));
        }
        let (s0, s1) = sweeps[i];
        let arc = elliptical_arc(rx, ry, 0.0, centres[i][0], centres[i][1], s0, s1)?;
        curves.extend(arc.curves().iter().cloned());
    }

    CurvePath2::try_new(curves)
        .map(RoundedRect::Path)
        .map_err(|e| format!("hcurve: rounded rect path failed ({e:?})"))
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

/// Sample an exact [`CurvePath2`] to an f64 polyline. **The one sampler** — every route out
/// of the exact kernel ([`tessellate_open`] and [`tessellate_closed`] included) arrives here.
///
/// Each span is evaluated at a fixed number of uniform parameters, decided per span by
/// [`span_samples`]: exactly by sweep for a circular arc, once for a line, and by a relative
/// chord heuristic for anything else. Uniform parameter spacing is not uniform arc length on
/// a rational conic, so the chord error on those spans is estimated rather than bounded —
/// [`span_samples`] carries the reasoning and the cost measurement behind that trade.
///
/// The doc that stood here described hypercurve's certified finite projection, which this
/// no longer uses: certifying flatness in exact arithmetic per candidate span measured
/// ~60-150x the per-point cost of the native line/arc path, and — read as an absolute
/// distance — made a curve's point count depend on its radius and on the model's unit.
pub fn tessellate_path(path: &CurvePath2, q: &TessQuality) -> Result<Vec<[f64; 2]>, String>
{
    let pol = policy();
    let mut out: Vec<[f64; 2]> = Vec::new();
    for curve in path.curves()
    {
        let samples = span_samples(curve, q);
        // A circular arc is sampled through its own sweep, NOT through `Curve2::point_at`.
        // `point_at` evaluates a span in its rational-quadratic Bezier form, which cannot
        // represent a half turn (the weight at the apex goes to zero): every interior
        // parameter of a 180° arc collapses onto its end point, and the arc tessellates to
        // its chord. Nothing noticed while this function only ever saw a `Geom::Path`,
        // whose arcs arrive pre-split into quarter turns by `elliptical_arc_path`; the
        // contours reaching it now — `hcurve::circle` is two 180° arcs — are not split.
        let arc = match curve.geometry()
        {
            CurveGeometry2::CircularArc(a) => Some(a),
            _ => None,
        };
        for i in 0..=samples
        {
            let t = i as f64 / samples as f64;
            let pt = match arc
            {
                Some(a) => match a.point_at_sweep_fraction(&real(t)?, &pol)
                {
                    Ok(Classification::Decided(p)) => p,
                    _ => return Err("hcurve: arc sweep sample undecided".to_string()),
                },
                None => done(
                    curve
                        .point_at(&real(t)?, &pol)
                        .map_err(|e| format!("hcurve: path point failed ({e:?})"))?,
                ),
            };
            let xy = point_to_f64(&pt).ok_or_else(|| "hcurve: path point not finite".to_string())?;
            if out.last() != Some(&xy)
            {
                out.push(xy);
            }
        }
    }
    Ok(out)
}

/// Sample count for one exact span, under a [`TessQuality`] profile.
///
/// A uniform-parameter sampler does not *certify* the chord error the way
/// [`CurvePath2::project_to_finite_polyline`] does, and this deliberately trades that
/// certification for speed on the display path: exact adaptive subdivision certifies
/// flatness in exact arithmetic per candidate span, which measured ~60-150x the per-point
/// cost of the native line/arc path — over a second to tessellate one spline, on a path
/// that `toPolygon`, `toMesh`, GLTF export and `OBbox` all sit on.
///
/// The rule is per family, finest information first:
///
/// * **Line** — one chord. Every interior sample lands on the line the span already
///   describes, so subdividing one only inflates the polyline. This is not an optimisation
///   of an approximation; two points are the exact answer.
/// * **Circular arc** — the count follows how far the arc *turns*:
///   `segments_per_turn × |sweep| / 2π`. An arc knows its sweep exactly ([`arc_params`]),
///   so this is the real answer rather than an estimate, and it is the reason a circle
///   costs the same at r = 10 and at r = 10 000.
/// * **Everything else** (Bezier, rational conic, spline) — no exact turn to read, so the
///   relative-chord heuristic below.
///
/// `chord_tolerance` is read as a **fraction of the span's own size**, not as an absolute
/// distance. It arrives here as a bare number with no unit attached, and the same model is
/// authored in metres by one script and millimetres by another: read absolutely,
/// `DEFAULT_CHORD_ERROR` asks for 1 mm accuracy on the first and 1 *micron* on the second.
/// That is what an earlier revision of this function did, and on a house measured in
/// millimetres it turned one 2500 mm span into `sqrt(2500 / 8e-4)` = 1768 chords — feeding
/// mesh CSG geometry ~50x denser than it needs and costing the house script 10x its
/// runtime, for accuracy far below what any display or mesh can show.
///
/// Reading it relatively makes the count depend on the curve's shape rather than on the
/// units it happens to be measured in, and keeps a caller that asks for something finer
/// (`Curve.perpendicularPointTo` samples at 1e-6, `tessellate(1e-5)`) getting it.
/// Exact geometry and exact point evaluation are unchanged; only the subdivision *proof*
/// is dropped.
fn span_samples(curve: &Curve2, q: &TessQuality) -> usize
{
    match curve.geometry()
    {
        CurveGeometry2::Line(_) => 1,
        CurveGeometry2::CircularArc(arc) => match arc_params(arc)
        {
            // `sweep` is signed and wrapped into (0, TAU]; only its magnitude matters here.
            Some(p) => q.clamp_samples(
                (q.segments_per_turn * p.sweep.abs() / std::f64::consts::TAU).ceil() as usize),
            // An arc whose centre or radius did not survive the conversion to f64 has no
            // sweep to read. Fall back to the tolerance heuristic rather than to one chord.
            None => q.clamp_samples(heuristic_samples(q.chord_tolerance)),
        },
        _ => q.clamp_samples(heuristic_samples(q.chord_tolerance)),
    }
}

/// Sample count for a span with no exact turn to read, from a relative chord tolerance.
///
/// For a chord over 1/n of a span, deviation falls as (L/n)^2 / R, so holding it to a fixed
/// fraction of L makes n depend only on the tolerance — which is the point: the span's size
/// cancels, so the count cannot run away with the model's units.
///
/// The constant is calibrated to `0.5 / sqrt(tol)`: the density of the tolerance-only
/// heuristic this replaced, and therefore the density every fixture and threshold in the
/// suite is written against. It is a heuristic, not a bound — the (L/n)^2 / R estimate
/// assumes a span no more sharply curved than its own extent, and a tighter one deviates
/// proportionally more.
fn heuristic_samples(tol: f64) -> usize
{
    let tol = if tol.is_finite() && tol > 0.0 { tol } else { DEFAULT_CHORD_ERROR };
    (1.0 / (4.0 * tol)).sqrt().ceil() as usize
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

    NurbsCurve2::interpolate_global(degree, pts, parameters, &policy())
        .map(done)
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

/// How far a mitered corner may run out from the original vertex, as a multiple of the
/// offset distance, before the join falls back to an arc. A very sharp corner mitres to a
/// spike that is longer than the geometry it joins; the arc is the honest answer there.
const MITER_LIMIT: f64 = 4.0;

/// Left-side offsets of a chain of native line/arc segments, joined at the corners.
///
/// **meshup owns this join layer.** hypercurve used to expose it as
/// `CurveString2::offset_left_with_line_joins` / `Contour2::offset_left_with_corner_style`;
/// both were removed when region offsetting became authoritative
/// ([`CurveRegion2::offset`]), and the private join machinery went with them. What survives
/// upstream — and what this is built on — is the primitive
/// [`hypercurve::Segment2::offset_left`]: the exact parallel of one line or one arc.
///
/// The staging is the one those methods used, and the one the profile-offset literature
/// describes: offset each segment independently, then reconnect. A line–line corner is
/// mitered at the exact intersection of the two offset support lines; every other corner —
/// and any miter that would run off into a spike — is joined by a circular arc centred on
/// the original vertex, which both offset endpoints already sit on at exactly `|distance|`.
///
/// Like the code it replaces, this is a raw parallel: it does **not** trim
/// self-intersections. Offset a profile far enough to fold over itself and the result
/// self-touches rather than being regularized. [`CurveRegion2::offset`] is the upstream
/// engine that does regularize, but it works in grow/shrink terms on a filled region, not
/// in "left of travel" terms on one boundary, so it is not a drop-in here.
fn offset_segments_left(segs: &[Segment2], distance: f64, closed: bool) -> Result<Vec<Segment2>, String>
{
    if segs.is_empty()
    {
        return Err("hcurve: offset of an empty segment chain".to_string());
    }
    let pol = policy();
    let d = real(distance)?;

    // 1. Each segment's own exact parallel. A line translates; an arc becomes concentric.
    let offsets: Vec<Segment2> = segs
        .iter()
        .map(|seg| {
            seg.offset_left(d.clone(), &pol)
                .map_err(|e| format!("hcurve: segment offset failed ({e:?})"))
                .and_then(decided)
        })
        .collect::<Result<_, _>>()?;

    // 2. Resolve every corner. Corner `i` sits between offset `i` and offset `i + 1`; a
    //    closed chain has one more of them, wrapping back to offset 0.
    let n = offsets.len();
    let corners = if closed { n } else { n.saturating_sub(1) };
    let mut joins: Vec<Join> = Vec::with_capacity(corners);
    for i in 0..corners
    {
        let j = (i + 1) % n;
        joins.push(corner_join(&segs[i], &offsets[i], &offsets[j], distance));
    }

    // 3. Rebuild. A miter moves the two incident endpoints onto the miter point; a round
    //    join is inserted between them as an extra arc.
    let mut out: Vec<Segment2> = Vec::with_capacity(n + corners);
    for i in 0..n
    {
        // The corner *before* segment i, which may have moved its start point.
        let prev_corner = if i > 0 { Some(i - 1) } else if closed { Some(corners - 1) } else { None };
        let start = prev_corner.and_then(|c| joins.get(c)).and_then(Join::miter_point);
        let end = joins.get(i).and_then(Join::miter_point);
        let adjusted = retarget_segment(&offsets[i], start, end)?;
        let adjusted_end = adjusted.end().clone();
        out.push(adjusted);

        if let Some(Join::Round) = joins.get(i)
        {
            let to = offsets[(i + 1) % n].start().clone();
            if adjusted_end != to
            {
                let centre = segs[i].end().clone();
                out.push(round_join(&adjusted_end, &to, &centre)?);
            }
        }
    }
    Ok(out)
}

/// How one corner of an offset chain is reconnected.
enum Join
{
    /// The two offsets already meet — a tangent-continuous corner, e.g. a fillet arc
    /// running into its line.
    Meet,
    /// Both sides are lines and their offset support lines cross here.
    Miter(Point2),
    /// An arc is involved, the supports are parallel, or the miter would spike.
    Round,
}

impl Join
{
    const fn miter_point(&self) -> Option<&Point2>
    {
        match self
        {
            Self::Miter(p) => Some(p),
            _ => None,
        }
    }
}

/// Decide how to reconnect `prev`'s end to `next`'s start, given the source segment whose
/// end is the original corner vertex.
fn corner_join(source: &Segment2, prev: &Segment2, next: &Segment2, distance: f64) -> Join
{
    if prev.end() == next.start()
    {
        return Join::Meet;
    }
    // Only a line–line corner mitres: an arc's endpoint cannot be moved along a support
    // line without changing the arc.
    let (Segment2::Line(a), Segment2::Line(b)) = (prev, next)
    else
    {
        return Join::Round;
    };
    match line_support_intersection(a, b)
    {
        Some(m) =>
        {
            // Reject the spike. `distance` is the exact radius of the round alternative, so
            // the limit is read against it.
            let v = source.end();
            let (dx, dy) = m.delta_from(v);
            let far = match (dx.to_f64_lossy(), dy.to_f64_lossy())
            {
                (Some(dx), Some(dy)) => dx.hypot(dy) > MITER_LIMIT * distance.abs(),
                _ => true,
            };
            if far { Join::Round } else { Join::Miter(m) }
        }
        None => Join::Round,
    }
}

/// Exact intersection of two line segments' *support lines* (not the segments themselves).
/// `None` when they are parallel, or when the sign of the denominator cannot be read.
///
/// Solves `a.start + t * dA = b.start + s * dB` for `t`. Every coordinate stays an exact
/// `Real`; only the parallel test drops to f64, the way the rest of this module reads a
/// handedness or a bound.
fn line_support_intersection(a: &LineSeg2, b: &LineSeg2) -> Option<Point2>
{
    let (ax, ay) = a.end().delta_from(a.start());
    let (bx, by) = b.end().delta_from(b.start());
    let denom = &ax * &by - &ay * &bx;
    // A parallel pair has no single crossing. The test has to be a *magnitude* test, not an
    // exact-zero one: two supports that are merely near-parallel put the miter point
    // arbitrarily far away, which the caller's spike limit would reject anyway.
    let scale = (ax.to_f64_lossy()?.hypot(ay.to_f64_lossy()?))
        * (bx.to_f64_lossy()?.hypot(by.to_f64_lossy()?));
    if !(denom.to_f64_lossy()?.abs() > 1.0e-12 * scale.max(1.0))
    {
        return None;
    }
    let (rx, ry) = b.start().delta_from(a.start());
    let t = ((&rx * &by - &ry * &bx) / denom).ok()?;
    Some(Point2::new(
        a.start().x() + &(&ax * &t),
        a.start().y() + &(&ay * &t),
    ))
}

/// A circular join from `from` to `to` about `centre`. Both endpoints are already exactly
/// `|distance|` from `centre` — they are the same offset applied to the two segments that
/// meet there — so the arc is exact; only its handedness is read in f64.
fn round_join(from: &Point2, to: &Point2, centre: &Point2) -> Result<Segment2, String>
{
    let (ux, uy) = from.delta_from(centre);
    let (vx, vy) = to.delta_from(centre);
    let cross = &ux * &vy - &uy * &vx;
    let clockwise = cross.to_f64_lossy().is_some_and(|c| c < 0.0);
    CircularArc2::try_from_center(from.clone(), to.clone(), centre.clone(), clockwise)
        .map(Segment2::Arc)
        .map_err(|e| format!("hcurve: offset round join failed ({e:?})"))
}

/// Rebuild a line segment with either endpoint moved to a miter point. Arcs are returned
/// unchanged — a corner touching an arc is never mitered.
fn retarget_segment(seg: &Segment2, start: Option<&Point2>, end: Option<&Point2>) -> Result<Segment2, String>
{
    match seg
    {
        Segment2::Line(l) if start.is_some() || end.is_some() =>
        {
            let s = start.unwrap_or_else(|| l.start()).clone();
            let e = end.unwrap_or_else(|| l.end()).clone();
            LineSeg2::try_new(s, e)
                .map(Segment2::Line)
                .map_err(|e| format!("hcurve: mitered offset segment failed ({e:?})"))
        }
        other => Ok(other.clone()),
    }
}

/// One-sided offset of an **open** curve string by `distance` (positive = left of travel
/// direction, negative = right), returned as **native** line/arc geometry.
///
/// Line–line corners are mitered at the exact supporting-line intersection and the rest are
/// joined with a circular arc, so the result is genuinely curved geometry — this used to
/// tessellate that result away, which is why offsetting a circle returned a 128-gon. See
/// [`offset_segments_left`] for who owns that join layer now, and for the self-intersection
/// caveat.
pub fn offset_open(cs: &CurveString2, distance: f64) -> Result<CurveString2, String>
{
    if distance == 0.0
    {
        return Ok(cs.clone());
    }
    let segs = offset_segments_left(cs.segments(), distance, false)?;
    CurveString2::try_new(segs).map_err(|e| format!("hcurve: open offset failed ({e:?})"))
}

/// One-sided offset of a **closed** contour by `distance` (sign relative to the contour's
/// winding), returned as **native** line/arc geometry. See [`offset_open`].
pub fn offset_closed(ct: &Contour2, distance: f64) -> Result<Contour2, String>
{
    if distance == 0.0
    {
        return Ok(ct.clone());
    }
    let segs = offset_segments_left(ct.segments(), distance, true)?;
    Contour2::try_new(segs).map_err(|e| format!("hcurve: closed offset failed ({e:?})"))
}

/// How deep the certified parallel may bisect before giving up.
///
/// A budget, not an accuracy target — and the number is measured, not chosen for roundness.
/// Offsetting `M 0 0 C 0 40 60 40 60 0` by 5 at a 1e-4 tolerance, native release build:
///
/// | depth | time    | result       |
/// |-------|---------|--------------|
/// | 4     |    9 ms | declines     |
/// | 6     |   19 ms | declines     |
/// | 8     |   38 ms | declines     |
/// | 9     |   56 ms | declines     |
/// | 10    |  242 **s** | 736 spans |
///
/// Up to 9 the cost doubles per level, as bisection should. At 10 it does not: the exact
/// scalar expressions carried through each level stop being cheap to decide and the search
/// runs for minutes — to return 736 spans, which is a tessellation wearing a curve's clothes.
/// This was `24`, which under the previous hypercurve declined quickly enough not to matter;
/// it now means the call never returns, and `Curve3DJs::offset` on any imported Bezier hangs
/// the worker.
///
/// Declining is cheap and already handled: the caller falls back to offsetting a certified
/// projection, which is what happened for these curves anyway.
const PARALLEL_MAX_DEPTH: usize = 9;

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
    let opts = BezierParallelVerificationOptions::try_new(real(chord_error)?, PARALLEL_MAX_DEPTH, &pol)
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
///
/// The arc's sweep comes from [`arc_params`], which reads it from the endpoints and the
/// arc's own orientation flag. An earlier version instead asked for a representative point
/// on the arc and summed the two half-angles either side of it. That needs the midpoint to
/// be *decidable* in exact arithmetic, and for arcs built from ordinary decimal coordinates
/// — an SVG `a` command in an icon, say — it often is not: `representative_point` returned
/// `Uncertain` and the length was reported as non-finite. Every rounded shape imported from
/// a real file then failed `length()`, and with it `trim()` and every arc-length query.
pub fn segment_length(seg: &Segment2) -> Option<f64>
{
    match seg
    {
        Segment2::Line(l) => l.length_squared().to_f64_lossy().map(f64::sqrt),
        Segment2::Arc(a) =>
        {
            let p = arc_params(a)?;
            Some(p.radius * p.sweep.abs())
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

/// Fillet the corners of a native line/arc chain by `radius`, exactly.
///
/// Each corner goes through hypercurve's own [`CurvePath2::fillet_vertex_by_radius`], which
/// solves the tangent circle in exact arithmetic and **rebuilds only the two curves incident
/// to that vertex**. Everything else is retained as authored — which is the whole reason for
/// the round trip through `CurvePath2`.
///
/// The previous implementation computed tangent points and a bulge in f64 and then re-emitted
/// *every* segment as a straight line from those numbers. Two consequences, both visible:
/// filleting one corner of a shape that already had a fillet returned the first arc as its
/// chord (a chamfer, not a fillet — rounding a second corner silently un-rounded the first),
/// and a corner touching an arc could not be filleted at all, because a line-arc corner has no
/// bulge to compute. Neither is a limitation of the kernel; both were the bridge's.
///
/// Corners where no exact solution exists — nearly straight, or a radius that does not fit —
/// are left sharp, as before. Works for closed contours (every vertex, wrapping) and open
/// curve strings (interior vertices only: the two free endpoints are not corners).
/// `only`: when `Some`, restrict filleting to those corner (vertex) indices; every other
/// corner is left sharp. `None` fillets every fitting corner. An empty slice is a no-op.
pub fn fillet_segments(segs: &[Segment2], radius: f64, closed: bool, only: Option<&[usize]>)
    -> Result<Vec<Segment2>, String>
{
    corner_op(segs, radius, closed, only, |path, vi, amount, pol| {
        path.fillet_vertex_by_radius(vi, amount, CurveCornerMode2::TrimOnly, pol)
    })
}

/// Chamfer the corners of a native line/arc chain by `setback`, exactly. The chamfer twin of
/// [`fillet_segments`] — same staging, same corner indexing, same retention of everything it
/// is not editing; each corner cuts `setback` off both incident edges.
pub fn chamfer_segments(segs: &[Segment2], setback: f64, closed: bool, only: Option<&[usize]>)
    -> Result<Vec<Segment2>, String>
{
    corner_op(segs, setback, closed, only, |path, vi, amount, pol| {
        path.chamfer_vertex_by_setbacks(vi, amount.clone(), amount, CurveCornerMode2::TrimOnly, pol)
    })
}

/// The shared body of [`fillet_segments`] and [`chamfer_segments`].
///
/// Corners are edited from the highest index down, so rounding one does not shift the index of
/// a lower one that has not been visited yet. A corner whose solver finds nothing is skipped
/// rather than failing the whole call: "this radius does not fit here" is an ordinary answer,
/// and the other corners still want rounding.
fn corner_op(
    segs: &[Segment2],
    amount: f64,
    closed: bool,
    only: Option<&[usize]>,
    solve: impl Fn(&CurvePath2, usize, Real, &CurveContext)
        -> hypercurve::ExactCurveResult<CurveOutcome<CurveCornerSolutions2<CurvePath2>>>,
) -> Result<Vec<Segment2>, String>
{
    if !(amount.is_finite() && amount > 0.0) || segs.len() < 2
    {
        return Ok(segs.to_vec());
    }
    if only.is_some_and(|sel| sel.is_empty())
    {
        return Ok(segs.to_vec());
    }

    let pol = boolean_policy();
    let value = real(amount)?;
    let mut path = path_from_segments(segs)?;

    // Vertex `vi` is the junction of curve `vi - 1` and curve `vi`; vertex 0 is the wrap-around
    // corner of a closed path, which an open one does not have.
    let first = usize::from(!closed);
    for vi in (first..path.curves().len()).rev()
    {
        if only.is_some_and(|sel| !sel.contains(&vi))
        {
            continue;
        }
        let solutions = match solve(&path, vi, value.clone(), &pol)
        {
            Ok(outcome) => done(outcome),
            // The solver declines this corner (an unsupported carrier, or a predicate it
            // cannot close). Leave it sharp.
            Err(_) => continue,
        };
        path = match solutions
        {
            CurveCornerSolutions2::Unique(p) => p,
            // Several exact candidates. They come back in deterministic order and the first is
            // the one that cuts the authored corner rather than an extension of it.
            CurveCornerSolutions2::Multiple(mut ps) if !ps.is_empty() => ps.swap_remove(0),
            _ => continue, // no solution: radius does not fit, or the corner is straight
        };
    }

    segments_from_path(&path)
        .ok_or_else(|| "hcurve: corner edit left geometry that is not line/arc".to_string())
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
pub fn length_open(cs: &CurveString2, _q: &TessQuality) -> Result<f64, String>
{
    segments_length(cs.segments())
}

/// Exact perimeter of a closed contour.
pub fn length_closed(ct: &Contour2, _q: &TessQuality) -> Result<f64, String>
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
        let pts = tessellate_path(&e, &quality()).unwrap();
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
        let pts = tessellate_path(&e, &quality()).unwrap();
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
        let pts = tessellate_path(&a, &quality()).unwrap();
        // Starts at the +x vertex (3,0), ends at the +y vertex (0,1.5).
        assert!((pts.first().unwrap()[0] - 3.0).abs() < 1e-9);
        assert!((pts.last().unwrap()[1] - 1.5).abs() < 1e-9);
    }

    #[test]
    fn open_polyline_tessellates_to_same_points()
    {
        let cs = open_polyline(&[[0.0, 0.0], [10.0, 0.0], [10.0, 5.0]]).unwrap();
        let pts = tessellate_open(&cs, &quality()).unwrap();
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
        let per = length_closed(&c, &quality()).unwrap();
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
        let ring = tessellate_closed(&moved, &quality()).unwrap();
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
        let pts = tessellate_open(&cs, &TessQuality::from_chord_tolerance(1e-5)).unwrap();
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
        let curve = done(
            Curve2::try_nurbs(
                c.degree(),
                c.control_points().to_vec(),
                c.weights().to_vec(),
                c.knots().to_vec(),
                &policy(),
            )
            .unwrap(),
        );
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
        let tess = tessellate_path(&nurbs_path(&c), &TessQuality::from_chord_tolerance(1e-5)).unwrap();
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
        let pts = tessellate_open(&off, &quality()).unwrap();
        assert!(pts.iter().all(|p| (p[1] - 2.0).abs() < 1e-9), "offset = {pts:?}");
        // Right side (negative) -> y = -3.
        let off_r = offset_open(&line, -3.0).unwrap();
        let pts_r = tessellate_open(&off_r, &quality()).unwrap();
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
        let circ_pts = tessellate_closed(&circle(0.0, 0.0, 4.0).unwrap(), &TessQuality::from_chord_tolerance(1e-6)).unwrap();
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

    #[test]
    fn rounded_rect_has_four_sides_and_four_corners()
    {
        let RoundedRect::Native(ct) = rounded_rect(0.0, 0.0, 100.0, 50.0, 10.0, 10.0).unwrap()
        else {
            panic!("equal radii should stay native line/arc");
        };
        assert_eq!(ct.segments().len(), 8, "4 sides + 4 corners");
        let arcs = ct.segments().iter().filter(|s| matches!(s, Segment2::Arc(_))).count();
        assert_eq!(arcs, 4);
        for seg in ct.segments()
        {
            if let Segment2::Arc(a) = seg
            {
                let p = arc_params(a).expect("corner params");
                assert!((p.radius - 10.0).abs() < 1e-9, "corner radius {}", p.radius);
                assert!((p.sweep.abs() - std::f64::consts::FRAC_PI_2).abs() < 1e-9,
                    "corner sweep {}", p.sweep);
            }
        }
    }

    /// A radius that eats a whole side leaves no straight run there, and the contour must
    /// still close rather than carry a zero-length segment.
    #[test]
    fn rounded_rect_handles_a_radius_of_half_the_side()
    {
        let RoundedRect::Native(ct) = rounded_rect(0.0, 0.0, 20.0, 20.0, 10.0, 10.0).unwrap()
        else {
            panic!("equal radii should stay native");
        };
        assert_eq!(ct.segments().len(), 4, "a circle-cornered square of pure arcs");
    }

    #[test]
    fn rounded_rect_with_unequal_radii_is_a_conic_path()
    {
        let RoundedRect::Path(p) = rounded_rect(0.0, 0.0, 100.0, 50.0, 20.0, 10.0).unwrap()
        else {
            panic!("unequal radii need elliptical corners");
        };
        assert!(p.curves().len() >= 8, "got {} spans", p.curves().len());
    }

    /// A rounded corner as an SVG icon actually writes one: an `a` command between two
    /// decimal endpoints. The arc's midpoint is not decidable in exact arithmetic for
    /// inputs like these, so a length that needed one reported non-finite and took
    /// `length()`, `trim()` and every arc-length query down with it.
    #[test]
    fn segment_length_survives_an_arc_from_ordinary_decimal_coordinates()
    {
        // Straight out of feather's triangle.svg: "a2 2 0 0 0 1.71 3".
        let seg = Segment2::from_bulge(
            point(1.82, 18.0).unwrap(),
            point(3.53, 21.0).unwrap(),
            real((std::f64::consts::FRAC_PI_2 / 4.0).tan()).unwrap(),
        )
        .unwrap();
        let len = segment_length(&seg).expect("arc length must be finite");
        assert!(len.is_finite() && len > 0.0, "len = {len}");

        // A quarter turn, so length = r * pi/2 and the chord is r * sqrt(2).
        let chord = (3.53_f64 - 1.82).hypot(21.0 - 18.0);
        let r = chord / std::f64::consts::SQRT_2;
        assert!((len - r * std::f64::consts::FRAC_PI_2).abs() < 1e-9, "len = {len}");
    }

    /// The length of a full circle is the one arc length whose answer is not in doubt.
    #[test]
    fn segment_length_of_two_half_circles_is_the_circumference()
    {
        let ct = circle(3.0, -4.0, 12.5).unwrap();
        let total: f64 = ct.segments().iter().map(|s| segment_length(s).unwrap()).sum();
        assert!((total - 2.0 * std::f64::consts::PI * 12.5).abs() < 1e-9, "total = {total}");
    }
}
