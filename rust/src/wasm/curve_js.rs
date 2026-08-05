//! `Curve3DJs` — a **planar** 3D curve backed by the [`crate::hcurve`] hypercurve
//! engine (replacing `curvo`). A curve is a 3D plane/frame plus a 2D hypercurve
//! expressed in that frame's local XY coordinates. 3D points are projected into
//! local XY for exact planar operations, and results are lifted back to 3D.
//!
//! This is being built **alongside** the curvo-backed `NurbsCurve3DJs` while the
//! TypeScript `Curve` layer is migrated method-by-method.

use crate::float_types::Real;
use crate::hcurve;
use crate::wasm::point_js::Point3Js;
use crate::wasm::vector_js::Vector3Js;
use hypercurve::{
    BooleanOp, Contour2, Curve2, CurveFamily2, CurveGeometry2, CurvePath2, CurvePolicy,
    CurveString2, LineSeg2, Point2, Segment2, Similarity2,
};
use nalgebra::{Point3, Vector3};
use wasm_bindgen::prelude::*;

const DEFAULT_CHORD: f64 = hcurve::DEFAULT_CHORD_ERROR;

/// Chord error for the polylines that back **parameter inversion** on a [`Geom::Path`]
/// (`pointAt`, `paramAtLength`, `paramClosestToPoint`, and everything layered on them —
/// `tangentAt`, `Curve.distance`, `Curve.closestPoints`, `Curve.perpendicularPointTo`).
///
/// Deliberately far finer than [`DEFAULT_CHORD`]. That one sizes a polyline meant to be
/// *looked at*, where a chord under a pixel is indistinguishable from the curve and extra
/// vertices cost triangles in every downstream mesh. Inversion is the opposite trade: the
/// table is transient, nothing downstream carries its vertex count, and its spacing sets
/// how far the answer can be from the true parameter — a coarse table hands back a point
/// and a tangent from the wrong place on the curve. Only [`Geom::Path`] pays it at all;
/// line/arc geometry inverts in closed form and never builds a table.
const INVERSION_CHORD: f64 = 1.0e-6;

/// An orthonormal planar frame in 3D: `world = origin + x·u + y·v`.
#[derive(Clone, Debug)]
struct Frame
{
    origin: Point3<Real>,
    x: Vector3<Real>,
    y: Vector3<Real>,
    /// Plane normal — retained for future `getOnPlane`/`normal` bindings.
    #[allow(dead_code)]
    n: Vector3<Real>,
}

impl Frame
{
    /// Build a frame from a centre and a plane normal (x = any perpendicular).
    fn from_center_normal(origin: Point3<Real>, normal: Vector3<Real>) -> Self
    {
        let n = normalize_or(normal, Vector3::z());
        let x = perpendicular_to(n);
        let y = n.cross(&x).normalize();
        Self { origin, x, y, n }
    }

    /// Fit a frame to a set of (near-)coplanar points via Newell's method.
    fn from_points(pts: &[Point3<Real>]) -> Result<Self, String>
    {
        if pts.len() < 2
        {
            return Err("Curve3DJs: need at least 2 points".into());
        }
        // Newell's method for a robust average normal (well-conditioned for rings and
        // any polyline enclosing area).
        let mut n = Vector3::zeros();
        for i in 0..pts.len()
        {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            n.x += (a.y - b.y) * (a.z + b.z);
            n.y += (a.z - b.z) * (a.x + b.x);
            n.z += (a.x - b.x) * (a.y + b.y);
        }
        // Newell's sum grows with the SQUARE of the coordinates, so an ABSOLUTE floor asks
        // "is this normal trustworthy?" and gets a different answer for the same shape
        // drawn in millimetres versus metres. For a loop enclosing no real area the sum is
        // pure cancellation noise of order eps * extent^2 — above a few thousand units that
        // noise clears 1e-9, so a garbage normal was trusted and the curve was rebuilt on a
        // plane unrelated to its points. That is what put lines nowhere near the XY plane
        // into isometric drawings of building-scale models.
        //
        // Scale the floor the same way the sum scales, so the decision is about the shape
        // rather than about its units. A loop with genuine area clears this easily; a
        // degenerate one falls through to the robust path below, as it always should have.
        let extent = pts
            .iter()
            .map(|p| (p - pts[0]).norm())
            .fold(0.0f64, |m, d| m.max(d));
        let newell_floor = (extent * extent * 1e-9).max(1e-9);
        let n = if n.norm() > newell_floor
        {
            n.normalize()
        }
        else
        {
            // Newell is unreliable for an (almost) straight *open* polyline — it returns a
            // tiny, noisy normal so the plane may not contain the far endpoint, which then
            // gets flattened. Recover the true plane from the vertex of maximum
            // perpendicular deviation off the overall span: for a coplanar set every such
            // cross product is parallel to the plane normal, and the largest is the most
            // reliable. Every point (both endpoints) then round-trips exactly.
            let origin = pts[0];
            let span = pts[pts.len() - 1] - origin;
            let best = pts
                .iter()
                .map(|p| span.cross(&(p - origin)))
                .max_by(|a, b| a.norm().partial_cmp(&b.norm()).unwrap_or(std::cmp::Ordering::Equal));
            // Same relative reasoning as the Newell floor above: this cross product scales
            // as span x offset, i.e. with the SQUARE of the extent, so for a collinear set
            // it is cancellation noise of order eps * extent^2. An absolute 1e-9 sits right
            // on that noise at a few thousand units — which is why a handful of edges per
            // drawing (5 of 424 on a building-scale frame) picked up a normal made of pure
            // noise while the rest were fine.
            let cross_floor = (extent * extent * 1e-9).max(1e-9);
            match best
            {
                Some(cross) if cross.norm() > cross_floor => cross.normalize(),
                // Truly collinear: any perpendicular plane contains the line. Prefer a
                // cardinal plane the points actually lie in (curves are usually drawn in
                // XY / XZ / YZ), else any perpendicular to the span.
                _ =>
                {
                    // "Constant" must also be judged relative to the geometry: a coordinate
                    // held genuinely fixed still wobbles by ~eps * extent through the
                    // projection arithmetic, which clears an absolute 1e-9 well before the
                    // model is large enough to notice.
                    let constant_tol = (extent * 1e-9).max(1e-9);
                    let constant = |sel: fn(&Point3<Real>) -> Real| -> bool {
                        let v0 = sel(&pts[0]);
                        pts.iter().all(|p| (sel(p) - v0).abs() < constant_tol)
                    };
                    if constant(|p| p.z) { Vector3::z() }
                    else if constant(|p| p.y) { Vector3::y() }
                    else if constant(|p| p.x) { Vector3::x() }
                    else { perpendicular_to((pts[1] - pts[0]).normalize()) }
                }
            }
        };
        let origin = pts[0];
        // x along the first edge, projected into the plane; fall back if degenerate.
        let raw_x = pts[1] - pts[0];
        let x = {
            let projected = raw_x - n * raw_x.dot(&n);
            normalize_or(projected, perpendicular_to(n))
        };
        let y = n.cross(&x).normalize();
        Ok(Self { origin, x, y, n })
    }

    fn to_local(&self, p: &Point3<Real>) -> [f64; 2]
    {
        let d = p - self.origin;
        [d.dot(&self.x) as f64, d.dot(&self.y) as f64]
    }

    fn to_world(&self, xy: [f64; 2]) -> Point3<Real>
    {
        self.origin + self.x * (xy[0] as Real) + self.y * (xy[1] as Real)
    }

    /// The exact planar similarity mapping `source`'s local XY into this frame's
    /// local XY. Valid only when the two frames are coplanar (same plane) — a
    /// differing normal yields a non-similarity 2×2 which `Similarity2` rejects,
    /// so non-coplanar curves return `None` (and the boolean falls back).
    fn similarity_from(&self, source: &Frame) -> Option<Similarity2>
    {
        let d0 = source.origin - self.origin;
        let a = source.x.dot(&self.x);
        let b = source.y.dot(&self.x);
        let xoff = d0.dot(&self.x);
        let d = source.x.dot(&self.y);
        let e = source.y.dot(&self.y);
        let yoff = d0.dot(&self.y);
        Similarity2::try_from_f64_affine(
            a as f64, b as f64, d as f64, e as f64, xoff as f64, yoff as f64, 1.0e-6,
        )
        .ok()
    }
}

fn normalize_or(v: Vector3<Real>, fallback: Vector3<Real>) -> Vector3<Real>
{
    if v.norm() > 1e-12
    {
        v.normalize()
    }
    else
    {
        fallback
    }
}

/// A unit vector perpendicular to `n`.
fn perpendicular_to(n: Vector3<Real>) -> Vector3<Real>
{
    let a = if n.x.abs() < 0.9 { Vector3::x() } else { Vector3::y() };
    let p = a - n * a.dot(&n);
    normalize_or(p, Vector3::x())
}

/// The 2D geometry of a planar curve, in the frame's local coordinates.
#[derive(Clone)]
enum Geom
{
    Open(CurveString2),
    Closed(Contour2),
    /// An exact mixed-family path (e.g. an ellipse of rational conic spans, or a NURBS)
    /// that `CurveString2`/`Contour2` cannot hold. Every operation reads the exact spans;
    /// nothing is lowered to lines behind the caller's back.
    Path(PathGeom),
}

/// An exact [`CurvePath2`] and whether its ends meet.
///
/// This used to carry `lines: OnceCell<Vec<Segment2>>`, a fine line approximation built by
/// tessellating the path — and *every* segment-oriented operation (`controlPoints`, `spans`,
/// `segmentCount`, `degree`, `hasArcs`, `subtype`, `trim`) silently read it instead of the
/// exact geometry. That is why an ellipse reported 200 degree-1 segments and `hasArcs()`
/// false. The cache is gone; each operation now answers from `path.curves()`.
#[derive(Clone)]
struct PathGeom
{
    path: CurvePath2,
    closed: bool,
}

impl PathGeom
{
    const fn new(path: CurvePath2, closed: bool) -> Self
    {
        Self { path, closed }
    }
}

/// Whether a path's ends meet within tolerance, i.e. it forms a ring.
///
/// Deliberately NOT exact `Point2` equality. These endpoints are f64-derived — an offset, a
/// connector line — so a loop closes to within an ulp or two rather than exactly. The
/// polyline constructor applies the same tolerance rule, which is why joining curves used
/// to yield a closed ring; an exact comparison silently produced an open one.
fn path_is_looped(path: &CurvePath2) -> bool
{
    let (s, e) = (path.start(), path.end());
    match (
        s.x().to_f64_lossy(),
        s.y().to_f64_lossy(),
        e.x().to_f64_lossy(),
        e.y().to_f64_lossy(),
    )
    {
        (Some(sx), Some(sy), Some(ex), Some(ey)) => (sx - ex).hypot(sy - ey) < 1.0e-7,
        _ => s == e,
    }
}

/// Degree of a single exact span, by curve family.
fn family_degree(family: CurveFamily2) -> usize
{
    match family
    {
        CurveFamily2::Line => 1,
        CurveFamily2::CircularArc | CurveFamily2::QuadraticBezier | CurveFamily2::RationalQuadraticBezier => 2,
        CurveFamily2::CubicBezier => 3,
        // Arbitrary-degree families: reported by the carrier itself where available.
        _ => 3,
    }
}

/// A planar 3D curve: a frame plus its local 2D hypercurve geometry.
#[wasm_bindgen]
pub struct Curve3DJs
{
    frame: Frame,
    geom: Geom,
    /// Original 3D vertices for a polyline built from points that are *not*
    /// coplanar. The planar `frame`/`geom` pair projects such input onto a
    /// best-fit plane (losing the out-of-plane excursion), so this retains the
    /// true 3D polyline for metric queries (length). `None` for planar geometry
    /// and any curve derived from a boolean/offset/transform.
    world_pts: Option<Vec<Point3<Real>>>,
}

impl Curve3DJs
{
    /// Local-XY tessellation of the geometry.
    fn local_points(&self, chord: f64) -> Result<Vec<[f64; 2]>, String>
    {
        match &self.geom
        {
            Geom::Open(cs) => hcurve::tessellate_open(cs, chord),
            Geom::Closed(ct) => hcurve::tessellate_closed(ct, chord),
            Geom::Path(pg) => hcurve::tessellate_path(&pg.path, chord),
        }
    }

    /// Build a closed curve from a frame and a local contour.
    fn from_closed(frame: Frame, ct: Contour2) -> Self
    {
        Self { frame, geom: Geom::Closed(ct), world_pts: None }
    }

    /// Build an open curve from a frame and a local curve string.
    fn from_open(frame: Frame, cs: CurveString2) -> Self
    {
        Self { frame, geom: Geom::Open(cs), world_pts: None }
    }

    /// Build a curve from a frame and an exact mixed-family path (e.g. an ellipse).
    fn from_path(frame: Frame, path: CurvePath2, closed: bool) -> Self
    {
        Self { frame, geom: Geom::Path(PathGeom::new(path, closed)), world_pts: None }
    }

    /// The native line/arc segment list, when the geometry *is* line/arc.
    ///
    /// `None` for an exact [`Geom::Path`] whose spans are conics/Beziers/splines — those
    /// have no `Segment2` equivalent and must be handled from `path.curves()` instead of
    /// being silently lowered to chords.
    fn native_segments(&self) -> Option<&[hypercurve::Segment2]>
    {
        match &self.geom
        {
            Geom::Open(cs) => Some(cs.segments()),
            Geom::Closed(ct) => Some(ct.segments()),
            Geom::Path(_) => None,
        }
    }

    /// The exact spans of this curve, whatever the representation: one entry per native
    /// line/arc segment, or one per [`CurvePath2`] span. This is the exact answer that the
    /// old cached line approximation was standing in for.
    fn exact_spans(&self) -> Result<Vec<Curve2>, String>
    {
        match &self.geom
        {
            Geom::Open(cs) => hcurve::path_from_segments(cs.segments()).map(|p| p.curves().to_vec()),
            Geom::Closed(ct) => hcurve::path_from_segments(ct.segments()).map(|p| p.curves().to_vec()),
            Geom::Path(pg) => Ok(pg.path.curves().to_vec()),
        }
    }

    /// A local 2D point lifted into world space.
    fn w3(&self, xy: [f64; 2]) -> [f64; 3]
    {
        let p = self.frame.to_world(xy);
        [p.x as f64, p.y as f64, p.z as f64]
    }

    /// A `Point2` lifted straight into world space.
    fn w3p(&self, p: &Point2) -> [f64; 3]
    {
        self.w3(seg_local(p))
    }

    /// Describe one exact span for a format writer. See [`Self::span_params`].
    fn span_params_of(&self, curve: &Curve2) -> SpanParamsJs
    {
        self.span_params_raw(curve).validated()
    }

    fn span_params_raw(&self, curve: &Curve2) -> SpanParamsJs
    {
        let (start, end) = (self.w3p(curve.start()), self.w3p(curve.end()));
        let pts = |ps: &[Point2]| -> Vec<[f64; 3]> { ps.iter().map(|p| self.w3p(p)).collect() };
        let reals = |rs: &[hypercurve::Real]| -> Vec<f64> {
            rs.iter().map(|r| r.to_f64_lossy().unwrap_or(0.0)).collect()
        };
        let unsupported = |reason: &str| SpanParamsJs::Unsupported {
            reason: reason.to_string(),
            start,
            end,
        };

        match curve.geometry()
        {
            CurveGeometry2::Line(_) => SpanParamsJs::Line { start, end },

            CurveGeometry2::CircularArc(arc) => match hcurve::arc_params(arc)
            {
                Some(a) => SpanParamsJs::Arc {
                    start: self.w3(a.start),
                    mid: self.w3(a.mid),
                    end: self.w3(a.end),
                    center: self.w3(a.center),
                    radius: a.radius,
                    ccw: a.ccw,
                    sweep: a.sweep,
                    bulge: a.bulge,
                },
                None => unsupported("arc parameters are not finite"),
            },

            CurveGeometry2::QuadraticBezier(q) =>
            {
                let [_, c, _] = q.control_points();
                SpanParamsJs::Quadratic { start, control: self.w3p(c), end }
            }

            CurveGeometry2::CubicBezier(c) =>
            {
                let [_, c1, c2, _] = c.control_points();
                SpanParamsJs::Cubic {
                    start,
                    control1: self.w3p(c1),
                    control2: self.w3p(c2),
                    end,
                }
            }

            CurveGeometry2::RationalQuadraticBezier(conic) =>
            {
                let [_, ctrl, _] = conic.control_points();
                let [w0, w1, w2] = conic.weights();
                // Normalised so the reported weight is the shape invariant (< 1 ellipse,
                // 1 parabola, > 1 hyperbola) rather than an artefact of how the net was
                // scaled when it was built.
                let weight = match (
                    w0.to_f64_lossy(),
                    w1.to_f64_lossy(),
                    w2.to_f64_lossy(),
                )
                {
                    (Some(a), Some(b), Some(c)) if a > 0.0 && c > 0.0 => b / (a * c).sqrt(),
                    _ => f64::NAN,
                };
                let mid = hcurve::conic_mid(conic)
                    .map_or([f64::NAN; 3], |m| self.w3(m));
                let ellipse = hcurve::conic_ellipse_params(conic).map(|e| EllipseParamsJs {
                    center: self.w3(e.center),
                    // A direction, so it is lifted through the frame's axes without the
                    // origin — `w3` would translate it into a position.
                    major_axis: {
                        let v = self.frame.x * (e.major[0] as Real)
                            + self.frame.y * (e.major[1] as Real);
                        [v.x as f64, v.y as f64, v.z as f64]
                    },
                    ratio: e.ratio,
                    start_param: e.start_param,
                    end_param: e.end_param,
                    ccw: e.ccw,
                });
                SpanParamsJs::Conic { start, mid, end, control: self.w3p(ctrl), weight, ellipse }
            }

            CurveGeometry2::Nurbs(n) => SpanParamsJs::Spline {
                degree: n.degree(),
                control_points: pts(n.control_points()),
                knots: reals(n.knots()),
                weights: reals(n.weights()),
                rational: n.weights().iter().any(|w| {
                    w.to_f64_lossy().is_none_or(|v| (v - 1.0).abs() > 1.0e-12)
                }),
                start,
                end,
            },

            CurveGeometry2::PolynomialBSpline(s) => SpanParamsJs::Spline {
                degree: s.degree(),
                control_points: pts(s.control_points()),
                knots: reals(s.knots()),
                weights: vec![1.0; s.control_points().len()],
                rational: false,
                start,
                end,
            },

            // A Bezier is a spline whose knot vector is entirely at its ends; spelling
            // that out lets one `spline` case in the caller cover both.
            CurveGeometry2::RationalBezier(b) =>
            {
                let d = b.degree();
                let mut knots = vec![0.0; d + 1];
                knots.extend(std::iter::repeat_n(1.0, d + 1));
                SpanParamsJs::Spline {
                    degree: d,
                    control_points: pts(b.control_points()),
                    knots,
                    weights: reals(b.weights()),
                    rational: b.weights().iter().any(|w| {
                        w.to_f64_lossy().is_none_or(|v| (v - 1.0).abs() > 1.0e-12)
                    }),
                    start,
                    end,
                }
            }
        }
    }

    /// This curve's boundary as an exact closed path, or `None` if it is not closed.
    fn closed_path(&self) -> Option<CurvePath2>
    {
        if !self.closed()
        {
            return None;
        }
        match &self.geom
        {
            Geom::Path(pg) => Some(pg.path.clone()),
            _ => hcurve::path_from_segments(self.native_segments()?).ok(),
        }
    }

    /// This curve's boundary as an exact closed path in `target`'s frame.
    fn closed_path_in_frame(&self, target: &Frame) -> Option<CurvePath2>
    {
        let path = self.closed_path()?;
        let sim = target.similarity_from(&self.frame)?;
        path.transform_similarity(&sim).ok()
    }

    /// This curve's exact spans, expressed in `target`'s local coordinates.
    /// `None` when the two planes are not related by an exact similarity (non-coplanar).
    fn spans_in_frame(&self, target: &Frame) -> Option<Vec<Curve2>>
    {
        let spans = self.exact_spans().ok()?;
        let path = hcurve::join_curves(spans).ok()?;
        let sim = target.similarity_from(&self.frame)?;
        path.transform_similarity(&sim).ok().map(|p| p.curves().to_vec())
    }

    /// This curve's NURBS carrier, when it is exactly one spline span.
    fn single_spline(&self) -> Option<&hypercurve::NurbsCurve2>
    {
        let Geom::Path(pg) = &self.geom
        else
        {
            return None;
        };
        match pg.path.curves()
        {
            [only] => match only.geometry()
            {
                CurveGeometry2::Nurbs(n) => Some(n),
                _ => None,
            },
            _ => None,
        }
    }

    /// Store an exact path, dropping back to native line/arc geometry when every span is a
    /// line or arc. Keeps `subtype()`/`hasArcs()`/`degree()` reporting the sharper answer
    /// and keeps hypercurve's decided line/arc fast paths reachable after an operation.
    fn from_path_normalized(frame: Frame, path: CurvePath2, closed: bool) -> Self
    {
        if let Some(segs) = hcurve::segments_from_path(&path)
        {
            if closed
            {
                if let Ok(ct) = Contour2::try_new(segs.clone())
                {
                    return Curve3DJs::from_closed(frame, ct);
                }
            }
            else if let Ok(cs) = CurveString2::try_new(segs)
            {
                return Curve3DJs::from_open(frame, cs);
            }
        }
        Curve3DJs::from_path(frame, path, closed)
    }

    /// A clone of this curve lowered to line-only geometry, whatever it started as.
    ///
    /// Unlike [`Self::to_line_curve`] this also flattens native *arcs*, so it is guaranteed
    /// to make progress and cannot recurse. Used as the offset fallback: hypercurve
    /// certifies exact equidistance when offsetting an arc, which an arc whose centre came
    /// from an f64 boolean cannot satisfy (`RadiusMismatch`), and line work sidesteps that.
    fn to_polyline_curve(&self, chord: f64) -> Result<Curve3DJs, JsValue>
    {
        let pts = self.local_points(chord).map_err(err)?;
        let geom = if self.closed()
        {
            Geom::Closed(hcurve::closed_contour(&pts).map_err(err)?)
        }
        else
        {
            Geom::Open(hcurve::open_polyline(&pts).map_err(err)?)
        };
        Ok(Curve3DJs { frame: self.frame.clone(), geom, world_pts: None })
    }

    /// A clone of this curve with an exact path lowered to a fine line approximation.
    ///
    /// The last remaining lowering, kept only for `fillet`/`chamfer` on a `Geom::Path`:
    /// hypercurve's `CurvePath2::fillet_vertex_by_parameters` certifies radius and tangency
    /// in exact `Real`, which an f64-authored corner generally cannot satisfy — the same
    /// `RadiusMismatch` problem that made `hcurve::fillet_segments` build arcs by bulge.
    fn to_line_curve(&self) -> Result<Curve3DJs, JsValue>
    {
        let geom = match &self.geom
        {
            Geom::Open(cs) => Geom::Open(cs.clone()),
            Geom::Closed(ct) => Geom::Closed(ct.clone()),
            Geom::Path(pg) =>
            {
                let pts = hcurve::tessellate_path(&pg.path, DEFAULT_CHORD).map_err(err)?;
                if pg.closed
                {
                    Geom::Closed(hcurve::closed_contour(&pts).map_err(err)?)
                }
                else
                {
                    Geom::Open(hcurve::open_polyline(&pts).map_err(err)?)
                }
            }
        };
        Ok(Curve3DJs { frame: self.frame.clone(), geom, world_pts: None })
    }

    /// 3D tessellation (local points lifted into world via the frame). A
    /// non-coplanar polyline uses its retained true 3D vertices directly so
    /// metric queries reflect the real path rather than its planar projection.
    fn world_points(&self, chord: f64) -> Result<Vec<Point3<Real>>, String>
    {
        if let Some(pts) = &self.world_pts
        {
            return Ok(pts.clone());
        }
        Ok(self.local_points(chord)?.iter().map(|xy| self.frame.to_world(*xy)).collect())
    }

    /// Cumulative arc length at each tessellation vertex, plus the points.
    fn arc_length_table(&self, chord: f64) -> Result<(Vec<Point3<Real>>, Vec<f64>), String>
    {
        let pts = self.world_points(chord)?;
        let mut cum = vec![0.0f64; pts.len()];
        for i in 1..pts.len()
        {
            cum[i] = cum[i - 1] + (pts[i] - pts[i - 1]).norm() as f64;
        }
        Ok((pts, cum))
    }

    /// World point at normalised arc-length fraction `t` in `[0, 1]`.
    fn point_at_arclen_frac(&self, t: f64) -> Result<Point3<Real>, JsValue>
    {
        // Native line/arc geometry has closed-form arc length, so the point is solved
        // exactly and lies ON the curve. The tessellated path below interpolates BETWEEN
        // two samples, so its result is off-curve by up to a chord sagitta.
        // `world_pts` (a non-coplanar polyline) keeps the tessellated walk: its true 3D
        // path is not the planar geometry.
        if self.world_pts.is_none()
        {
            if let Some(segs) = self.native_segments()
            {
                let local = hcurve::point_at_arclen(segs, t).map_err(err)?;
                return Ok(self.frame.to_world(seg_local(&local)));
            }
        }
        let (pts, cum) = self.arc_length_table(INVERSION_CHORD).map_err(err)?;
        if pts.is_empty()
        {
            return Err(JsValue::from_str("Curve3DJs: empty curve"));
        }
        let total = *cum.last().unwrap();
        if total <= 0.0
        {
            return Ok(pts[0]);
        }
        let target = t.clamp(0.0, 1.0) * total;
        for i in 0..pts.len() - 1
        {
            if target <= cum[i + 1]
            {
                let seg = cum[i + 1] - cum[i];
                let f = if seg > 1e-12 { (target - cum[i]) / seg } else { 0.0 };
                return Ok(pts[i] + (pts[i + 1] - pts[i]) * (f as Real));
            }
        }
        Ok(*pts.last().unwrap())
    }
}

/// A native segment endpoint (`Point2`) as an f64 local pair.
fn seg_local(p: &hypercurve::Point2) -> [f64; 2]
{
    [p.x().to_f64_lossy().unwrap_or(0.0), p.y().to_f64_lossy().unwrap_or(0.0)]
}

/// The ellipse an exact conic span lies on, in world space. See [`hcurve::EllipseParams`].
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EllipseParamsJs
{
    center: [f64; 3],
    /// Centre-to-major-axis-endpoint **vector**, not a length: DXF's `ELLIPSE` groups
    /// 11/21/31 want it this way, and it carries the rotation for SVG's `A` at the same time.
    major_axis: [f64; 3],
    ratio: f64,
    start_param: f64,
    end_param: f64,
    ccw: bool,
}

/// One exact span, described for a format writer. See [`Curve3DJs::span_params`].
///
/// `RationalBezier` and `PolynomialBSpline` fold into `Spline` (a Bezier's clamped knot
/// vector is synthesised), so the eight `CurveGeometry2` families reach TypeScript as six
/// kinds plus `Unsupported`, which exists so a writer always has something safe to do.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum SpanParamsJs
{
    Line
    {
        start: [f64; 3], end: [f64; 3]
    },
    Arc
    {
        start: [f64; 3],
        /// The exact on-curve midpoint. A frame's normal can point at -Z
        /// (`Frame::from_points` picks whatever the input plane gives), so `ccw` is
        /// measured in the curve's own plane and is not always world CCW. Three exact
        /// points settle the world orientation without re-deriving the circle.
        mid: [f64; 3],
        end: [f64; 3],
        center: [f64; 3],
        radius: f64,
        ccw: bool,
        /// Signed, radians; positive counter-clockwise in the curve's plane.
        sweep: f64,
        /// `tan(sweep / 4)` — a DXF LWPOLYLINE vertex bulge, ready to write.
        bulge: f64,
    },
    Quadratic
    {
        start: [f64; 3], control: [f64; 3], end: [f64; 3]
    },
    Cubic
    {
        start: [f64; 3],
        control1: [f64; 3],
        control2: [f64; 3],
        end: [f64; 3],
    },
    Conic
    {
        start: [f64; 3],
        mid: [f64; 3],
        end: [f64; 3],
        control: [f64; 3],
        weight: f64,
        /// `None` when the span is a parabola or hyperbola, or when the reconstruction
        /// failed its own accuracy check — write it as a rational quadratic or tessellate
        /// it, but never as an ellipse.
        ellipse: Option<EllipseParamsJs>,
    },
    Spline
    {
        degree: usize,
        control_points: Vec<[f64; 3]>,
        knots: Vec<f64>,
        weights: Vec<f64>,
        rational: bool,
        start: [f64; 3],
        end: [f64; 3],
    },
    Unsupported
    {
        reason: String, start: [f64; 3], end: [f64; 3]
    },
}

impl SpanParamsJs
{
    /// Reject a spline whose knot vector does not match its control net.
    ///
    /// A clamped B-spline of degree `d` over `n` control points has exactly `n + d + 1`
    /// knots. Emitting one that does not is precisely how a filleted rectangle used to
    /// leave meshup as DXF — `71=2, 72=2, 73=8`, two knots where eleven were required —
    /// so the invariant is enforced at the source rather than in each writer. A span that
    /// fails it degrades to `Unsupported`, which every writer already tessellates.
    fn validated(self) -> Self
    {
        if let Self::Spline { ref control_points, degree, ref knots, ref start, ref end, .. } = self
        {
            let expected = control_points.len() + degree + 1;
            if knots.len() != expected || control_points.len() <= degree
            {
                return Self::Unsupported {
                    reason: format!(
                        "spline has {} knots for {} control points at degree {degree} (expected {expected})",
                        knots.len(),
                        control_points.len()
                    ),
                    start: *start,
                    end: *end,
                };
            }
        }
        self
    }
}

#[wasm_bindgen]
impl Curve3DJs
{
    /// Construct a polyline (open or closed) through 3D control points.
    #[wasm_bindgen(js_name = makePolyline)]
    pub fn make_polyline(points: Vec<Point3Js>, closed: bool) -> Result<Curve3DJs, JsValue>
    {
        let pts3: Vec<Point3<Real>> = points.iter().map(|p| p.inner).collect();
        let frame = Frame::from_points(&pts3).map_err(err)?;
        let local: Vec<[f64; 2]> = pts3.iter().map(|p| frame.to_local(p)).collect();
        let geom = if closed
        {
            Geom::Closed(hcurve::closed_contour(&local).map_err(err)?)
        }
        else
        {
            Geom::Open(hcurve::open_polyline(&local).map_err(err)?)
        };
        // Retain the true 3D vertices when the input is not coplanar, so length()
        // reflects the real path rather than its planar projection.
        let max_dev = pts3
            .iter()
            .map(|p| (frame.to_world(frame.to_local(p)) - p).norm())
            .fold(0.0f64, |m, d| m.max(d));
        let world_pts = if max_dev > 1e-6 { Some(pts3) } else { None };
        Ok(Curve3DJs { frame, geom, world_pts })
    }

    /// Construct a smooth NURBS curve of `degree` (>= 2) interpolating the given 3D points.
    ///
    /// Stored as the **exact** spline. This used to compute the NURBS and then immediately
    /// discard it for a 1e-5-chord polyline, so a spline arrived in meshup as ~2400
    /// degree-1 segments: `degree()` reported 1, `controlPoints()` returned thousands of
    /// sampled points rather than the solved control net, and every downstream operation
    /// worked on line work.
    #[wasm_bindgen(js_name = makeInterpolated)]
    pub fn make_interpolated(points: Vec<Point3Js>, degree: usize) -> Result<Curve3DJs, JsValue>
    {
        let pts3: Vec<Point3<Real>> = points.iter().map(|p| p.inner).collect();
        let frame = Frame::from_points(&pts3).map_err(err)?;
        let local: Vec<[f64; 2]> = pts3.iter().map(|p| frame.to_local(p)).collect();
        let nurbs = hcurve::nurbs_interpolate(&local, degree).map_err(err)?;
        let curve = Curve2::try_nurbs(
            nurbs.degree(),
            nurbs.control_points().to_vec(),
            nurbs.weights().to_vec(),
            nurbs.knots().to_vec(),
        )
        .map_err(|e| err(format!("makeInterpolated: {e:?}")))?;
        let path = CurvePath2::try_new(vec![curve])
            .map_err(|e| err(format!("makeInterpolated: {e:?}")))?;
        Ok(Curve3DJs::from_path(frame, path, false))
    }

    /// Construct a circle of `radius` centred at `center`, in the plane whose
    /// normal is `normal`.
    #[wasm_bindgen(js_name = makeCircle)]
    pub fn make_circle(radius: f64, center: &Point3Js, normal: &Vector3Js) -> Result<Curve3DJs, JsValue>
    {
        let frame = Frame::from_center_normal(center.inner, normal.inner);
        let ct = hcurve::circle(0.0, 0.0, radius).map_err(err)?;
        Ok(Curve3DJs::from_closed(frame, ct))
    }

    /// Construct a full **ellipse** (closed) with semi-axes `radius_x`/`radius_y`,
    /// its major axis rotated `rotation` radians in-plane, centred at `center`, in
    /// the plane whose normal is `normal`. Backed by exact rational conic spans.
    #[wasm_bindgen(js_name = makeEllipse)]
    pub fn make_ellipse(
        radius_x: f64,
        radius_y: f64,
        rotation: f64,
        center: &Point3Js,
        normal: &Vector3Js,
    ) -> Result<Curve3DJs, JsValue>
    {
        let frame = Frame::from_center_normal(center.inner, normal.inner);
        let path = hcurve::ellipse(radius_x, radius_y, rotation, 0.0, 0.0).map_err(err)?;
        Ok(Curve3DJs::from_path(frame, path, true))
    }

    /// Construct an **elliptical arc** from `start_angle` to `end_angle` (radians,
    /// in the pre-rotation circle parameter). A full turn yields a closed ellipse.
    /// Semi-axes `radius_x`/`radius_y`, rotated `rotation` radians in-plane, centred
    /// at `center`, in the plane whose normal is `normal`.
    #[wasm_bindgen(js_name = makeEllipticalArc)]
    pub fn make_elliptical_arc(
        radius_x: f64,
        radius_y: f64,
        rotation: f64,
        start_angle: f64,
        end_angle: f64,
        center: &Point3Js,
        normal: &Vector3Js,
    ) -> Result<Curve3DJs, JsValue>
    {
        let frame = Frame::from_center_normal(center.inner, normal.inner);
        let closed = (end_angle - start_angle).abs() >= std::f64::consts::TAU - 1.0e-9;
        let path = hcurve::elliptical_arc(radius_x, radius_y, rotation, 0.0, 0.0, start_angle, end_angle)
            .map_err(err)?;
        Ok(Curve3DJs::from_path(frame, path, closed))
    }

    /// Whether the curve is closed.
    #[wasm_bindgen(js_name = closed)]
    pub fn closed(&self) -> bool
    {
        match &self.geom
        {
            Geom::Closed(_) => true,
            Geom::Path(pg) => pg.closed,
            Geom::Open(_) => false,
        }
    }

    /// Tessellate to 3D points.
    #[wasm_bindgen(js_name = tessellate)]
    pub fn tessellate(&self, tol: Option<f64>) -> Result<Vec<Point3Js>, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let local = self.local_points(chord).map_err(err)?;
        Ok(local
            .iter()
            .map(|xy| {
                let w = self.frame.to_world(*xy);
                Point3Js::new(w.x as f64, w.y as f64, w.z as f64)
            })
            .collect())
    }

    /// Approximate length / perimeter.
    #[wasm_bindgen(js_name = length)]
    pub fn length(&self, tol: Option<f64>) -> Result<f64, JsValue>
    {
        // A non-coplanar polyline measures its true 3D path, not the projection.
        if let Some(pts) = &self.world_pts
        {
            return Ok(pts.windows(2).map(|w| (w[1] - w[0]).norm()).sum());
        }
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        match &self.geom
        {
            Geom::Open(cs) => hcurve::length_open(cs, chord).map_err(err),
            Geom::Closed(ct) => hcurve::length_closed(ct, chord).map_err(err),
            // Exact for line/arc spans, certified-chord for conic/Bezier/spline spans (their
            // arc length has no closed form). The frame is orthonormal, so local distances
            // equal world distances.
            Geom::Path(pg) => hcurve::length_path(&pg.path, chord).map_err(err),
        }
    }

    /// Signed area (closed curves only); `None`/error for open curves.
    #[wasm_bindgen(js_name = area)]
    pub fn area(&self) -> Result<f64, JsValue>
    {
        match &self.geom
        {
            Geom::Closed(ct) => hcurve::signed_area(ct).map_err(err),
            // Exact Green integral over the native conic/Bezier boundary — no sampling.
            // Falls back to the shoelace over a certified projection only if hypercurve
            // cannot decide the region (e.g. a self-touching boundary).
            Geom::Path(pg) if pg.closed => match hcurve::signed_area_path(&pg.path)
            {
                Ok(a) => Ok(a),
                Err(_) =>
                {
                    let pts = hcurve::tessellate_path(&pg.path, DEFAULT_CHORD).map_err(err)?;
                    let ct = hcurve::closed_contour(&pts).map_err(err)?;
                    hcurve::signed_area(&ct).map_err(err)
                }
            },
            Geom::Open(_) | Geom::Path(_) =>
            {
                Err(JsValue::from_str("Curve3DJs::area(): curve is not closed"))
            }
        }
    }

    /// Translate the curve by a world-space vector (moves the frame origin).
    #[wasm_bindgen(js_name = translate)]
    pub fn translate(&self, offset: &Vector3Js) -> Curve3DJs
    {
        let mut frame = self.frame.clone();
        frame.origin += offset.inner;
        let world_pts = self.world_pts.as_ref().map(|ps| ps.iter().map(|p| p + offset.inner).collect());
        Curve3DJs { frame, geom: self.geom.clone(), world_pts }
    }

    /// One-sided offset by `distance`, returning a new curve in the same frame.
    ///
    /// Line/arc geometry is offset natively: hypercurve miters line-line corners and joins
    /// the rest with circular arcs, so `Circle(50).offset(10)` comes back as a circle of
    /// radius 60 — two arc spans — rather than the 128-gon this used to produce by
    /// tessellating the native result away.
    ///
    /// An exact path (conic / Bezier / spline) has no exact parallel — the offset of a
    /// general rational curve is not itself rational — so it uses hypercurve's *certified*
    /// Blend2D parallel, which stays a curve and carries a proven error bound. When
    /// hypercurve declines (an authored corner it will not blend, or a self-intersecting
    /// offset, which it does not trim), this falls back to offsetting a certified
    /// projection, i.e. the previous behaviour.
    #[wasm_bindgen(js_name = offset)]
    pub fn offset(&self, distance: f64, tol: Option<f64>) -> Result<Curve3DJs, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let native = match &self.geom
        {
            Geom::Open(cs) => hcurve::offset_open(cs, distance)
                .map(|off| Curve3DJs::from_open(self.frame.clone(), off)),
            Geom::Closed(ct) => hcurve::offset_closed(ct, distance)
                .map(|off| Curve3DJs::from_closed(self.frame.clone(), off)),
            Geom::Path(pg) => match hcurve::offset_path(&pg.path, distance, chord)
            {
                Ok(Some(parallel)) => Ok(Curve3DJs::from_path_normalized(
                    self.frame.clone(),
                    parallel,
                    pg.closed,
                )),
                Ok(None) => Err("hcurve: certified parallel declined".to_string()),
                Err(e) => Err(e),
            },
        };
        match native
        {
            Ok(c) => Ok(c),
            // A curved path that hypercurve declined (an authored corner the certified
            // parallel will not blend, or an offset that would self-intersect, which the raw
            // parallel does not trim) falls back to offsetting its line projection.
            Err(_) if matches!(self.geom, Geom::Path(_)) =>
            {
                self.to_polyline_curve(chord)?.offset(distance, tol)
            }
            // Native line/arc geometry gets no such fallback, deliberately. hypercurve
            // certifies exact equidistance when offsetting an arc, so an arc whose centre
            // came from an f64 boolean is declined with `RadiusMismatch` — and lowering that
            // to line work first means running the exact offset over thousands of segments,
            // which costs seconds. Callers who want that trade can ask for it explicitly by
            // offsetting `toDegree1()`.
            Err(e) => Err(err(e)),
        }
    }

    /// Intersection points with another curve (both projected into this frame),
    /// returned as 3D points.
    #[wasm_bindgen(js_name = intersect)]
    pub fn intersect(&self, other: &Curve3DJs, tol: Option<f64>) -> Result<Vec<Point3Js>, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);

        // Exact mixed-family path intersection when either side is a conic/spline, so an
        // ellipse is not lowered to line work first. Declines (an algebraic contact with no
        // `Real` coordinates) fall through to the sampled path below.
        if matches!(self.geom, Geom::Path(_)) || matches!(other.geom, Geom::Path(_))
        {
            if let (Ok(pa), Some(pb)) = (
                self.exact_spans().and_then(hcurve::join_curves),
                other.spans_in_frame(&self.frame).and_then(|s| hcurve::join_curves(s).ok()),
            )
            {
                if let Some(hits) = hcurve::intersect_paths(&pa, &pb)
                {
                    return Ok(hits
                        .iter()
                        .map(|xy| {
                            let w = self.frame.to_world(*xy);
                            Point3Js::new(w.x as f64, w.y as f64, w.z as f64)
                        })
                        .collect());
                }
            }
        }

        let a = self.as_curve_string(chord).map_err(err)?;
        // Project other's tessellation into this frame as an open polyline.
        let other_local: Vec<[f64; 2]> = other
            .local_points(chord)
            .map_err(err)?
            .iter()
            .map(|xy| self.frame.to_local(&other.frame.to_world(*xy)))
            .collect();
        let b = hcurve::open_polyline(&other_local).map_err(err)?;

        let hits = hcurve::intersect_open(&a, &b).map_err(err)?;
        Ok(hits
            .iter()
            .map(|xy| {
                let w = self.frame.to_world(*xy);
                Point3Js::new(w.x as f64, w.y as f64, w.z as f64)
            })
            .collect())
    }

    /// World axis-aligned bounding box as `[minx,miny,minz, maxx,maxy,maxz]`.
    ///
    /// Solved exactly from the native geometry rather than min/maxed over a tessellation,
    /// which always fell short on an arc bulge that was not a sample point (a 30°-rotated
    /// 50x25 ellipse under-reported its x extent by ~4e-3).
    ///
    /// For each world axis `e`, `p·e = origin·e + u*(x·e) + v*(y·e)` is a linear functional
    /// of the local coordinates, so its extent is an exact support query in the in-plane
    /// direction `(x·e, y·e)` — see [`hcurve::support_extent`]. A degenerate direction
    /// (world axis perpendicular to the plane) contributes only the origin term.
    ///
    /// A non-coplanar polyline keeps its retained true 3D vertices, so it is measured
    /// directly from those.
    #[wasm_bindgen(js_name = bbox)]
    pub fn bbox(&self, tol: Option<f64>) -> Result<Vec<f64>, JsValue>
    {
        if let Some(pts) = &self.world_pts
        {
            if pts.is_empty()
            {
                return Err(JsValue::from_str("Curve3DJs::bbox(): empty curve"));
            }
            let (mut mn, mut mx) = ([f64::MAX; 3], [f64::MIN; 3]);
            for p in pts
            {
                for (i, c) in [p.x as f64, p.y as f64, p.z as f64].iter().enumerate()
                {
                    mn[i] = mn[i].min(*c);
                    mx[i] = mx[i].max(*c);
                }
            }
            return Ok(vec![mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]]);
        }

        if let Some(exact) = self.bbox_exact()
        {
            return Ok(exact);
        }
        // hypercurve declines exact bounds for some families (a rational-quadratic span
        // blocks with `NativeTopology / Ordering`), so an ellipse has no exact box today.
        // Fall back to min/max over a certified projection — the previous behaviour.
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let pts = self.tessellate(Some(chord))?;
        if pts.is_empty()
        {
            return Err(JsValue::from_str("Curve3DJs::bbox(): empty curve"));
        }
        let (mut mn, mut mx) = ([f64::MAX; 3], [f64::MIN; 3]);
        for p in &pts
        {
            for (i, c) in [p.x(), p.y(), p.z()].iter().enumerate()
            {
                mn[i] = mn[i].min(*c);
                mx[i] = mx[i].max(*c);
            }
        }
        Ok(vec![mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]])
    }

    /// The exact world box, or `None` when hypercurve cannot decide bounds for this
    /// geometry. Line and circular-arc carriers always succeed, so an arc's bulge is
    /// measured rather than sampled.
    fn bbox_exact(&self) -> Option<Vec<f64>>
    {
        // Only line/arc carriers get an exact box — see `hcurve::SupportGeom`.
        let geom = match &self.geom
        {
            Geom::Open(cs) => hcurve::SupportGeom::Open(cs),
            Geom::Closed(ct) => hcurve::SupportGeom::Closed(ct),
            Geom::Path(_) => return None,
        };
        let o = self.frame.origin;
        let (fx, fy) = (self.frame.x, self.frame.y);
        let axis_world = [
            (o.x as f64, fx.x as f64, fy.x as f64),
            (o.y as f64, fx.y as f64, fy.y as f64),
            (o.z as f64, fx.z as f64, fy.z as f64),
        ];

        let (mut mn, mut mx) = ([0.0f64; 3], [0.0f64; 3]);
        for (i, (origin_c, dx, dy)) in axis_world.iter().enumerate()
        {
            if dx.hypot(*dy) <= 1.0e-15
            {
                // This world axis is normal to the curve's plane: the curve has no extent
                // along it beyond the plane's own offset.
                mn[i] = *origin_c;
                mx[i] = *origin_c;
                continue;
            }
            let (lo, hi) = hcurve::support_extent(&geom, *dx, *dy).ok()?;
            mn[i] = origin_c + lo;
            mx[i] = origin_c + hi;
        }
        Some(vec![mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]])
    }

    /// Construct a straight line between two 3D points (open).
    #[wasm_bindgen(js_name = makeLine)]
    pub fn make_line(a: &Point3Js, b: &Point3Js) -> Result<Curve3DJs, JsValue>
    {
        Curve3DJs::make_polyline(vec![Point3Js { inner: a.inner }, Point3Js { inner: b.inner }], false)
    }

    /// Construct a circular arc through three 3D points (open).
    #[wasm_bindgen(js_name = makeArc)]
    pub fn make_arc(start: &Point3Js, mid: &Point3Js, end: &Point3Js) -> Result<Curve3DJs, JsValue>
    {
        let pts3 = [start.inner, mid.inner, end.inner];
        let frame = Frame::from_points(&pts3).map_err(err)?;
        let s = frame.to_local(&start.inner);
        let m = frame.to_local(&mid.inner);
        let e = frame.to_local(&end.inner);
        let cs = hcurve::arc_3pt(s, m, e).map_err(err)?;
        Ok(Curve3DJs::from_open(frame, cs))
    }

    /// Reverse the curve's direction.
    #[wasm_bindgen(js_name = reverse)]
    pub fn reverse(&self) -> Result<Curve3DJs, JsValue>
    {
        // Exact reversal for a mixed-family path.
        if let Geom::Path(pg) = &self.geom
        {
            let rev = pg.path.reversed().map_err(|e| err(format!("reverse: {e:?}")))?;
            return Ok(Curve3DJs::from_path(self.frame.clone(), rev, pg.closed));
        }
        let segs: Vec<Segment2> = self
            .native_segments()
            .unwrap_or_default()
            .iter()
            .rev()
            .map(|s| s.reversed())
            .collect();
        let geom = match &self.geom
        {
            Geom::Open(_) => Geom::Open(
                CurveString2::try_new(segs).map_err(|e| err(format!("reverse: {e:?}")))?,
            ),
            Geom::Closed(_) => Geom::Closed(
                Contour2::try_new(segs).map_err(|e| err(format!("reverse: {e:?}")))?,
            ),
            Geom::Path(_) => unreachable!("Path handled above"),
        };
        Ok(Curve3DJs { frame: self.frame.clone(), geom, world_pts: None })
    }

    /// Point at normalised arc-length parameter `t` in `[0, 1]`.
    #[wasm_bindgen(js_name = pointAt)]
    pub fn point_at(&self, t: f64) -> Result<Point3Js, JsValue>
    {
        let p = self.point_at_arclen_frac(t)?;
        Ok(Point3Js::new(p.x as f64, p.y as f64, p.z as f64))
    }

    /// Unit tangent at normalised arc-length parameter `t` in `[0, 1]`.
    #[wasm_bindgen(js_name = tangentAt)]
    pub fn tangent_at(&self, t: f64) -> Result<Vector3Js, JsValue>
    {
        let eps = 1.0e-4;
        let a = self.point_at_arclen_frac((t - eps).max(0.0))?;
        let b = self.point_at_arclen_frac((t + eps).min(1.0))?;
        let d = b - a;
        let n = d.norm();
        let u = if n > 1e-12 { d / n } else { Vector3::x() };
        Ok(Vector3Js::new(u.x as f64, u.y as f64, u.z as f64))
    }

    /// The arc-length parameter (in `[0, 1]`) at absolute length `len`.
    #[wasm_bindgen(js_name = paramAtLength)]
    pub fn param_at_length(&self, len: f64) -> Result<f64, JsValue>
    {
        let (_, cum) = self.arc_length_table(INVERSION_CHORD).map_err(err)?;
        let total = cum.last().copied().unwrap_or(0.0);
        if total <= 0.0
        {
            return Ok(0.0);
        }
        Ok((len / total).clamp(0.0, 1.0))
    }

    /// Native sub-curve between arc-length fractions `t0`, `t1` in `[0, 1]`,
    /// preserving line/arc segments exactly (no tessellation). Always open.
    ///
    /// An exact [`Geom::Path`] still goes through a line approximation: the cut points are
    /// given as *arc-length* fractions, and inverting arc length on a rational conic has no
    /// closed form (hypercurve exposes `inverse_length_parameter_region` for polynomial
    /// Bezier spans only). Trimming a conic exactly needs that inversion, not just
    /// `Curve2::subcurve`, which takes a curve parameter.
    #[wasm_bindgen(js_name = trim)]
    pub fn trim(&self, t0: f64, t1: f64) -> Result<Curve3DJs, JsValue>
    {
        let Some(native) = self.native_segments()
        else
        {
            return self.to_line_curve()?.trim(t0, t1);
        };
        let segs = hcurve::trim_segments(native, t0, t1).map_err(err)?;
        let cs = CurveString2::try_new(segs).map_err(|e| err(format!("Curve3DJs::trim: {e:?}")))?;
        Ok(Curve3DJs::from_open(self.frame.clone(), cs))
    }

    /// The arc-length parameter (in `[0, 1]`) of the tessellation vertex closest
    /// to the given 3D point.
    #[wasm_bindgen(js_name = paramClosestToPoint)]
    pub fn param_closest_to_point(&self, p: &Point3Js) -> Result<f64, JsValue>
    {
        // Analytic per-segment projection for native line/arc geometry — a perpendicular
        // foot on a line, a radial projection on an arc — rather than projecting onto
        // tessellation chords. hypercurve has no point-inversion API, so a Geom::Path still
        // falls back to the sampled walk below.
        if self.world_pts.is_none()
        {
            if let Some(segs) = self.native_segments()
            {
                let local = self.frame.to_local(&p.inner);
                let q = hcurve::point(local[0], local[1]).map_err(err)?;
                return hcurve::param_closest_to_point(segs, &q).map_err(err);
            }
        }
        let (pts, cum) = self.arc_length_table(INVERSION_CHORD).map_err(err)?;
        let total = cum.last().copied().unwrap_or(0.0);
        if pts.len() < 2 || total <= 0.0
        {
            return Ok(0.0);
        }
        // Project `p` onto each polyline segment (not just the sampled vertices) so
        // interior points of a straight span map to the correct arc-length fraction.
        let best = (0..pts.len() - 1).fold((f64::MAX, 0.0f64), |best, i| {
            let a = pts[i];
            let b = pts[i + 1];
            let ab = b - a;
            let len2 = ab.norm_squared() as f64;
            let u = if len2 <= 0.0 { 0.0 } else { ((p.inner - a).dot(&ab) as f64 / len2).clamp(0.0, 1.0) };
            let proj = a + ab * (u as Real);
            let d = (proj - p.inner).norm() as f64;
            if d < best.0
            {
                (d, cum[i] + u * (cum[i + 1] - cum[i]))
            }
            else
            {
                best
            }
        });
        Ok((best.1 / total).clamp(0.0, 1.0))
    }

    /// Defining vertices (span endpoints) as 3D points.
    ///
    /// One point per exact span, plus the final endpoint on an open curve — so an ellipse
    /// yields its four conic span joints, not several hundred sampled points.
    #[wasm_bindgen(js_name = controlPoints)]
    pub fn control_points(&self) -> Vec<Point3Js>
    {
        let lift = |p: &hypercurve::Point2| {
            let w = self.frame.to_world(seg_local(p));
            Point3Js::new(w.x as f64, w.y as f64, w.z as f64)
        };
        // A spline's control points are its control NET, not its two span endpoints. For
        // line/arc geometry the two notions coincide (a polyline's vertices are its control
        // points), which is why this used to be span-endpoints only.
        if let Some(nurbs) = self.single_spline()
        {
            return nurbs.control_points().iter().map(lift).collect();
        }
        let Ok(spans) = self.exact_spans()
        else
        {
            return Vec::new();
        };
        let mut out: Vec<Point3Js> = spans.iter().map(|c| lift(c.start())).collect();
        if !self.closed()
        {
            if let Some(last) = spans.last()
            {
                out.push(lift(last.end()));
            }
        }
        out
    }

    /// Classify the curve by its exact span families:
    /// `Line` | `Arc` | `Circle` | `Rect` | `Polyline` | `Ellipse` | `Spline`.
    #[wasm_bindgen(js_name = subtype)]
    pub fn subtype(&self) -> String
    {
        // An exact path is classified by what its spans actually are. This used to return
        // "Ellipse" for *any* Geom::Path, which mislabelled an interpolated NURBS.
        if let Geom::Path(pg) = &self.geom
        {
            let families: Vec<CurveFamily2> = pg.path.curves().iter().map(|c| c.family()).collect();
            let conic = families
                .iter()
                .any(|f| matches!(f, CurveFamily2::RationalQuadraticBezier));
            let spline = families.iter().any(|f| {
                matches!(f, CurveFamily2::Nurbs | CurveFamily2::PolynomialBSpline | CurveFamily2::CubicBezier | CurveFamily2::QuadraticBezier)
            });
            return if spline
            {
                "Spline".to_string()
            }
            else if conic
            {
                "Ellipse".to_string()
            }
            else
            {
                "Polyline".to_string()
            };
        }
        let segs = self.native_segments().unwrap_or_default();
        let closed = matches!(self.geom, Geom::Closed(_));
        let n = segs.len();
        let arcs = segs.iter().filter(|s| matches!(s, Segment2::Arc(_))).count();
        let lines = n - arcs;
        let kind = if closed && arcs > 0 && lines == 0
        {
            "Circle"
        }
        else if !closed && n == 1 && arcs == 1
        {
            "Arc"
        }
        else if !closed && n == 1 && arcs == 0
        {
            "Line"
        }
        else if closed && arcs == 0 && n == 4
        {
            "Rect"
        }
        else if arcs == 0
        {
            "Polyline"
        }
        else
        {
            "Spline"
        };
        kind.to_string()
    }

    /// One `Curve3DJs` per exact span (each an open single-span curve). A conic or spline
    /// span comes back as an exact single-span path, not as a chord.
    #[wasm_bindgen(js_name = spans)]
    pub fn spans(&self) -> Result<Vec<Curve3DJs>, JsValue>
    {
        self.exact_spans()
            .map_err(err)?
            .into_iter()
            .map(|c| {
                CurvePath2::try_new(vec![c])
                    .map(|p| Curve3DJs::from_path_normalized(self.frame.clone(), p, false))
                    .map_err(|e| err(format!("spans: {e:?}")))
            })
            .collect()
    }

    /// Number of exact spans.
    #[wasm_bindgen(js_name = segmentCount)]
    pub fn segment_count(&self) -> usize
    {
        match &self.geom
        {
            Geom::Open(cs) => cs.segments().len(),
            Geom::Closed(ct) => ct.segments().len(),
            Geom::Path(pg) => pg.path.curves().len(),
        }
    }

    /// Every exact span, described by the parameters a file format needs to write it.
    ///
    /// One entry per span, in order, matching [`Self::segment_count`]. Each is a plain JS
    /// object tagged by `kind`, carrying world-space 3D points and — for arcs and conics —
    /// the centre, radius, sweep and axes that define the underlying circle or ellipse.
    ///
    /// This exists because the other accessors answer questions a *writer* cannot use.
    /// `subtype()` names the whole curve, not a span, and has no name for "lines and arcs
    /// mixed"; `controlPoints()` returns span endpoints, which is an arc's chord; `knots()`
    /// and `weights()` are empty unless the curve is one single NURBS span. Given only
    /// those, an exporter has to guess — and both of meshup's exporters guessed wrong, one
    /// re-deriving an arc's circle from three tessellated samples and the other writing a
    /// malformed SPLINE for any curve with a fillet in it.
    ///
    /// Deliberately plain data rather than a list of exported objects: a `Vec` of
    /// `#[wasm_bindgen]` structs would hand back N handles for the caller to `free()` on
    /// every export, and this crate has already been bitten by wasm-bindgen ownership
    /// (see `Curve3DJs::concat`, which must take its operand by reference, and
    /// `tests/unit/wasmOwnership.test.ts`). Plain objects own nothing.
    #[wasm_bindgen(js_name = spanParams)]
    pub fn span_params(&self) -> Result<JsValue, JsValue>
    {
        let spans = self.exact_spans().map_err(err)?;
        let out: Vec<SpanParamsJs> = spans.iter().map(|c| self.span_params_of(c)).collect();
        serde_wasm_bindgen::to_value(&out)
            .map_err(|e| JsValue::from_str(&format!("Curve3DJs::spanParams(): {e}")))
    }

    /// Effective polynomial degree: the max over exact spans (line = 1, arc/conic/quadratic
    /// = 2, cubic and above = 3+). A native re-architecture of curvo's single-NURBS
    /// `degree()`. An ellipse is degree 2 and an interpolated NURBS reports its real degree,
    /// where both used to report 1 from the line approximation.
    #[wasm_bindgen(js_name = degree)]
    pub fn degree(&self) -> usize
    {
        match &self.geom
        {
            Geom::Open(_) | Geom::Closed(_) => self
                .native_segments()
                .unwrap_or_default()
                .iter()
                .map(|s| match s
                {
                    Segment2::Line(_) => 1usize,
                    Segment2::Arc(_) => 2usize,
                })
                .max()
                .unwrap_or(1),
            Geom::Path(pg) => pg
                .path
                .curves()
                .iter()
                .map(|c| match c.geometry()
                {
                    CurveGeometry2::PolynomialBSpline(s) => s.degree(),
                    CurveGeometry2::Nurbs(n) => n.degree(),
                    other => family_degree(other.family()),
                })
                .max()
                .unwrap_or(1),
        }
    }

    /// Parameter domain. Curves are re-parameterised by normalised arc length,
    /// so the domain is always `[0, 1]`.
    #[wasm_bindgen(js_name = knotsDomain)]
    pub fn knots_domain(&self) -> Vec<f64>
    {
        vec![0.0, 1.0]
    }

    /// The knot vector, when this curve is carried by a single spline span.
    ///
    /// Empty for line/arc geometry and for multi-span paths, which have no single knot
    /// vector. Line/arc curves are re-parameterised by arc length instead.
    #[wasm_bindgen(js_name = knots)]
    pub fn knots(&self) -> Vec<f64>
    {
        self.single_spline().map_or_else(Vec::new, |n| {
            n.knots().iter().filter_map(|r| r.to_f64_lossy()).collect()
        })
    }

    /// The per-control-point weights, when this curve is carried by a single spline span.
    /// Empty otherwise — a native arc is exact, not a weighted rational control net.
    #[wasm_bindgen(js_name = weights)]
    pub fn weights(&self) -> Vec<f64>
    {
        self.single_spline().map_or_else(Vec::new, |n| {
            n.weights().iter().filter_map(|r| r.to_f64_lossy()).collect()
        })
    }

    /// Fillet (round) interior corners with an arc of the given `radius`.
    /// Corners where the radius does not fit are left sharp. Works on both closed
    /// contours (every vertex) and open curve strings (interior vertices only —
    /// the two free endpoints are not corners).
    ///
    /// `at`: optional corner (vertex) indices to fillet. Omit for every corner. Vertex `vi`
    /// is the junction of segment `vi-1` and segment `vi`; closed curves start at 0, open
    /// curves at 1. Indices are resolved on the TS side (see Curve.fillet) so the tolerance
    /// policy for point matching stays out of the kernel.
    #[wasm_bindgen(js_name = fillet)]
    pub fn fillet(&self, radius: f64, at: Option<Vec<usize>>) -> Result<Curve3DJs, JsValue>
    {
        let only = at.as_deref();
        match &self.geom
        {
            Geom::Closed(ct) =>
            {
                let segs = hcurve::fillet_segments(ct.segments(), radius, true, only).map_err(err)?;
                let c = Contour2::try_new(segs).map_err(|e| err(format!("Curve3DJs::fillet: {e:?}")))?;
                Ok(Curve3DJs::from_closed(self.frame.clone(), c))
            }
            Geom::Open(cs) =>
            {
                let segs = hcurve::fillet_segments(cs.segments(), radius, false, only).map_err(err)?;
                let c = CurveString2::try_new(segs).map_err(|e| err(format!("Curve3DJs::fillet: {e:?}")))?;
                Ok(Curve3DJs::from_open(self.frame.clone(), c))
            }
            // Fillet the line approximation of an exact conic path.
            Geom::Path(_) => self.to_line_curve()?.fillet(radius, at),
        }
    }

    /// Chamfer (bevel) interior corners, cutting back `setback` along each edge.
    /// Works on both closed contours and open curve strings (interior vertices only).
    ///
    /// `at`: optional corner (vertex) indices to chamfer. Omit for every corner. Indexing
    /// matches [`Curve3DJs::fillet`].
    #[wasm_bindgen(js_name = chamfer)]
    pub fn chamfer(&self, setback: f64, at: Option<Vec<usize>>) -> Result<Curve3DJs, JsValue>
    {
        let only = at.as_deref();
        match &self.geom
        {
            Geom::Closed(ct) =>
            {
                let chamfered = chamfer_op(ct, setback, only).map_err(err)?;
                Ok(Curve3DJs::from_closed(self.frame.clone(), chamfered))
            }
            Geom::Open(cs) =>
            {
                let chamfered = chamfer_op(cs, setback, only).map_err(err)?;
                Ok(Curve3DJs::from_open(self.frame.clone(), chamfered))
            }
            // Chamfer the line approximation of an exact conic path.
            Geom::Path(_) => self.to_line_curve()?.chamfer(setback, at),
        }
    }

    /// Join this curve with `others`, in order, into one connected curve.
    ///
    /// Every span is carried across exactly and gaps are bridged with straight connectors,
    /// so joining an arc to a line keeps the arc. The TypeScript layer used to do this by
    /// concatenating `controlPoints()` and running a polyline through them — and since
    /// `controlPoints()` yields only span *endpoints*, a semicircle became its chord. That
    /// is why `Sketch().lineTo().arcTo().close()` lost its arcs: every `Sketch.end()`
    /// funnels through that join.
    ///
    /// `others` are mapped into this curve's plane by an exact similarity; a non-coplanar
    /// operand is an error.
    /// NOTE: takes `other` by REFERENCE, one curve at a time, and callers fold.
    ///
    /// It originally took `Vec<Curve3DJs>`, which looks natural but is a trap: wasm-bindgen
    /// unwraps each element by *destroying it into a raw pointer*, so every operand's JS
    /// wrapper was freed on the way in. Callers that reused an input afterwards — and
    /// `Curve.Compound()` sits under every `Sketch.end()` and `ShapeCollection.combine()` —
    /// then hit "null pointer passed to rust". A borrowed argument cannot do that.
    #[wasm_bindgen(js_name = concat)]
    pub fn concat(&self, other: &Curve3DJs) -> Result<Curve3DJs, JsValue>
    {
        let mut spans = self.exact_spans().map_err(err)?;
        {
            spans.extend(other.spans_in_frame(&self.frame).ok_or_else(|| {
                JsValue::from_str("Curve3DJs::concat(): operand is not coplanar with this curve")
            })?);
        }
        let path = hcurve::join_curves(spans).map_err(err)?;
        // Decide closure BEFORE normalizing: normalizing to a CurveString2/Contour2 fixes
        // the open/closed choice, so the test has to happen on the path itself.
        let closed = path_is_looped(&path);
        Ok(Curve3DJs::from_path_normalized(self.frame.clone(), path, closed))
    }

    /// Close the curve by appending a straight segment from its end back to its start,
    /// preserving every existing span. Returns an equivalent curve when already closed.
    #[wasm_bindgen(js_name = closePath)]
    pub fn close_path(&self) -> Result<Curve3DJs, JsValue>
    {
        if self.closed()
        {
            return Ok(self.clone_js());
        }
        let path = hcurve::path_from_segments(self.native_segments().unwrap_or_default())
            .or_else(|_| Err("Curve3DJs::closePath(): empty curve".to_string()))
            .or_else(|_: String| self.exact_spans().and_then(hcurve::join_curves))
            .map_err(err)?;
        let closed = hcurve::close_path(&path).map_err(err)?;
        Ok(Curve3DJs::from_path_normalized(self.frame.clone(), closed, true))
    }

    /// Extend the curve by `length` along its endpoint tangent(s).
    ///
    /// `side` is `"start"`, `"end"` or `"both"`. The extension is a straight span appended
    /// to the exact geometry, so the original spans survive — this used to rebuild the whole
    /// curve as a polyline through `controlPoints()`, collapsing any arc to a chord.
    #[wasm_bindgen(js_name = extend)]
    pub fn extend(&self, length: f64, side: &str) -> Result<Curve3DJs, JsValue>
    {
        if self.closed()
        {
            return Err(JsValue::from_str("Curve3DJs::extend(): cannot extend a closed curve"));
        }
        let (at_start, at_end) = match side
        {
            "start" => (true, false),
            "end" => (false, true),
            "both" => (true, true),
            other => return Err(err(format!("Curve3DJs::extend(): unknown side '{other}'"))),
        };

        let mut spans = self.exact_spans().map_err(err)?;
        // Tangents come from the world-space endpoints, then drop into local coordinates.
        if at_end
        {
            let t = self.tangent_at(1.0)?;
            let end = self.frame.to_world(seg_local(spans.last().map_or_else(
                || unreachable!("non-empty by construction"),
                |c| c.end(),
            )));
            let tip = end + Vector3::new(t.inner.x, t.inner.y, t.inner.z) * (length as Real);
            let seg = LineSeg2::try_new(
                hcurve::point(self.frame.to_local(&end)[0], self.frame.to_local(&end)[1]).map_err(err)?,
                hcurve::point(self.frame.to_local(&tip)[0], self.frame.to_local(&tip)[1]).map_err(err)?,
            )
            .map_err(|e| err(format!("extend: {e:?}")))?;
            spans.push(Curve2::from(seg));
        }
        if at_start
        {
            let t = self.tangent_at(0.0)?;
            let start = self.frame.to_world(seg_local(spans.first().map_or_else(
                || unreachable!("non-empty by construction"),
                |c| c.start(),
            )));
            let tip = start - Vector3::new(t.inner.x, t.inner.y, t.inner.z) * (length as Real);
            let seg = LineSeg2::try_new(
                hcurve::point(self.frame.to_local(&tip)[0], self.frame.to_local(&tip)[1]).map_err(err)?,
                hcurve::point(self.frame.to_local(&start)[0], self.frame.to_local(&start)[1]).map_err(err)?,
            )
            .map_err(|e| err(format!("extend: {e:?}")))?;
            spans.insert(0, Curve2::from(seg));
        }
        let path = hcurve::join_curves(spans).map_err(err)?;
        Ok(Curve3DJs::from_path_normalized(self.frame.clone(), path, false))
    }

    /// Per-axis scale about `origin`, exact for **closed** curves.
    ///
    /// A per-axis scale is not a similarity, so hypercurve's `transform_similarity` cannot
    /// express it — but the map it induces *within* the curve's plane is a plain 2D affine,
    /// and `CurveRegion2::transform_affine` accepts one. Scaling a circle by `[2, 1, 1]`
    /// therefore yields an exact **ellipse** of rational conic spans.
    ///
    /// Returns an error for open curves (a region is required) and for a scale that
    /// collapses the plane; the caller falls back to resampling.
    #[wasm_bindgen(js_name = scaleNonUniform)]
    pub fn scale_non_uniform(
        &self,
        sx: f64,
        sy: f64,
        sz: f64,
        origin: &Point3Js,
    ) -> Result<Curve3DJs, JsValue>
    {
        let path = self
            .closed_path()
            .ok_or_else(|| JsValue::from_str("scaleNonUniform(): closed curve required"))?;

        let s = Vector3::new(sx as Real, sy as Real, sz as Real);
        let scale_v = |v: Vector3<Real>| Vector3::new(v.x * s.x, v.y * s.y, v.z * s.z);
        // Where the frame's own axes land under the scale.
        let (fx, fy) = (scale_v(self.frame.x), scale_v(self.frame.y));
        let n = fx.cross(&fy);
        if !(n.norm().is_finite()) || n.norm() <= 1.0e-12
        {
            return Err(JsValue::from_str("scaleNonUniform(): scale collapses the curve's plane"));
        }
        // Orthonormal basis of the image plane, and the scaled origin.
        let xn = fx / fx.norm();
        let yn = n.cross(&xn);
        let yn = yn / yn.norm();
        let o = self.frame.origin;
        let scaled_origin = Point3::new(
            origin.inner.x + (o.x - origin.inner.x) * s.x,
            origin.inner.y + (o.y - origin.inner.y) * s.y,
            origin.inner.z + (o.z - origin.inner.z) * s.z,
        );
        // Local (u,v) maps to u*fx + v*fy, re-expressed in the image basis.
        let (m00, m10) = (fx.dot(&xn) as f64, fx.dot(&yn) as f64);
        let (m01, m11) = (fy.dot(&xn) as f64, fy.dot(&yn) as f64);

        let paths = hcurve::transform_affine_path(&path, m00, m01, m10, m11, 0.0, 0.0)
            .ok_or_else(|| JsValue::from_str("scaleNonUniform(): hypercurve declined the transform"))?;
        let out = paths
            .into_iter()
            .next()
            .ok_or_else(|| JsValue::from_str("scaleNonUniform(): empty result"))?;
        let frame = Frame { origin: scaled_origin, x: xn, y: yn, n: xn.cross(&yn) };
        Ok(Curve3DJs::from_path_normalized(frame, out, true))
    }

    /// Mirror across the plane through `origin` with unit normal `normal`.
    ///
    /// Costs nothing geometrically. A reflection `R` is affine, so for a planar curve
    /// `R(o + x*u + y*v) = R(o) + R(x)*u + R(y)*v` — the local `(u, v)` coordinates are
    /// unchanged and only the frame moves. A mirrored circle therefore stays two arc spans,
    /// where this used to reflect the tessellated boundary and rebuild a ~500-segment
    /// polyline, permanently destroying the geometry to apply an isometry.
    ///
    /// The reflected frame's normal is recomputed from `x cross y`, which correctly flips:
    /// a reflection reverses orientation.
    #[wasm_bindgen(js_name = mirror)]
    pub fn mirror(&self, normal: &Vector3Js, origin: &Point3Js) -> Result<Curve3DJs, JsValue>
    {
        let n = normal.inner;
        let len = n.norm();
        if !(len.is_finite() && len > 0.0)
        {
            return Err(JsValue::from_str("Curve3DJs::mirror(): degenerate plane normal"));
        }
        let n = n / len;
        let reflect_pt = |p: Point3<Real>| -> Point3<Real> {
            let d = (p - origin.inner).dot(&n);
            p - n * (2.0 * d)
        };
        let reflect_vec = |v: Vector3<Real>| -> Vector3<Real> { v - n * (2.0 * v.dot(&n)) };

        let x = reflect_vec(self.frame.x);
        let y = reflect_vec(self.frame.y);
        let frame = Frame { origin: reflect_pt(self.frame.origin), x, y, n: x.cross(&y) };
        Ok(Curve3DJs {
            frame,
            geom: self.geom.clone(),
            world_pts: self
                .world_pts
                .as_ref()
                .map(|ps| ps.iter().map(|p| reflect_pt(*p)).collect()),
        })
    }

    /// Deep copy.
    #[wasm_bindgen(js_name = clone)]
    pub fn clone_js(&self) -> Curve3DJs
    {
        Curve3DJs { frame: self.frame.clone(), geom: self.geom.clone(), world_pts: self.world_pts.clone() }
    }

    /// Whether the geometry is curved anywhere — a circular arc, or any conic / Bezier /
    /// spline span. Named for the line/arc case it was introduced for; on an exact path it
    /// answers the same underlying question ("is this more than straight line work?"), which
    /// the old line approximation always answered `false` to.
    #[wasm_bindgen(js_name = hasArcs)]
    pub fn has_arcs(&self) -> bool
    {
        match &self.geom
        {
            Geom::Open(_) | Geom::Closed(_) => self
                .native_segments()
                .unwrap_or_default()
                .iter()
                .any(|s| matches!(s, hypercurve::Segment2::Arc(_))),
            Geom::Path(pg) => pg
                .path
                .curves()
                .iter()
                .any(|c| !matches!(c.family(), CurveFamily2::Line)),
        }
    }

    /// Tessellate each native segment separately, returning a JS array of flat 3D
    /// point arrays (`Array<Float64Array>`, `[x,y,z,...]` per segment). Lets the TS
    /// layer rebuild a faithful compound curve (one span per arc/line) instead of a
    /// single flattened polyline.
    #[wasm_bindgen(js_name = segmentTessellations)]
    pub fn segment_tessellations(&self, tol: Option<f64>) -> Result<JsValue, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let out = js_sys::Array::new();
        // One array per EXACT span, whatever the family. A conic path used to come back as
        // a single lumped polyline, so the TS layer could not tell its spans apart.
        for span in self.exact_spans().map_err(err)?
        {
            let path = CurvePath2::try_new(vec![span])
                .map_err(|e| err(format!("hcurve: span path failed ({e:?})")))?;
            let pts2d = hcurve::tessellate_path(&path, chord).map_err(err)?;
            let flat: Vec<f64> = pts2d
                .iter()
                .flat_map(|xy| {
                    let w = self.frame.to_world(*xy);
                    [w.x as f64, w.y as f64, w.z as f64]
                })
                .collect();
            out.push(&js_sys::Float64Array::from(flat.as_slice()).into());
        }
        Ok(out.into())
    }

    /// A `Curve3DJs` is planar by construction.
    #[wasm_bindgen(js_name = isPlanar)]
    pub fn is_planar(&self) -> bool
    {
        true
    }

    /// The curve's plane as three vectors `[normal, localX, localY]`.
    #[wasm_bindgen(js_name = getOnPlane)]
    pub fn get_on_plane(&self) -> Vec<Vector3Js>
    {
        let v = |u: Vector3<Real>| Vector3Js::new(u.x as f64, u.y as f64, u.z as f64);
        vec![v(self.frame.n), v(self.frame.x), v(self.frame.y)]
    }

    /// Uniform scale about the world origin (hypercurve supports only uniform,
    /// similarity scaling of planar curves).
    #[wasm_bindgen(js_name = scale)]
    pub fn scale(&self, s: f64) -> Result<Curve3DJs, JsValue>
    {
        if !(s.is_finite() && s.abs() > 1e-12)
        {
            return Err(JsValue::from_str("Curve3DJs::scale(): invalid scale factor"));
        }
        let sim = hcurve::similarity(s, 0.0, 0.0, s, 0.0, 0.0).map_err(err)?;
        let geom = match &self.geom
        {
            Geom::Open(cs) => Geom::Open(hcurve::transform_open(cs, &sim).map_err(err)?),
            Geom::Closed(ct) => Geom::Closed(hcurve::transform_contour(ct, &sim).map_err(err)?),
            Geom::Path(pg) =>
            {
                let path = pg
                    .path
                    .transform_similarity(&sim)
                    .map_err(|e| err(format!("Curve3DJs::scale: {e:?}")))?;
                Geom::Path(PathGeom::new(path, pg.closed))
            }
        };
        let mut frame = self.frame.clone();
        frame.origin = Point3::new(frame.origin.x * s as Real, frame.origin.y * s as Real, frame.origin.z * s as Real);
        let world_pts = self.world_pts.as_ref().map(|ps| {
            ps.iter().map(|p| Point3::new(p.x * s as Real, p.y * s as Real, p.z * s as Real)).collect()
        });
        Ok(Curve3DJs { frame, geom, world_pts })
    }

    /// Rotate the curve by a unit quaternion `(w, x, y, z)` about the origin.
    #[wasm_bindgen(js_name = rotateQuaternion)]
    pub fn rotate_quaternion(&self, w: f64, x: f64, y: f64, z: f64) -> Curve3DJs
    {
        let q = nalgebra::UnitQuaternion::from_quaternion(nalgebra::Quaternion::new(
            w as Real, x as Real, y as Real, z as Real,
        ));
        let mut frame = self.frame.clone();
        frame.origin = q * frame.origin;
        frame.x = q * frame.x;
        frame.y = q * frame.y;
        frame.n = q * frame.n;
        let world_pts = self.world_pts.as_ref().map(|ps| ps.iter().map(|p| q * p).collect());
        Curve3DJs { frame, geom: self.geom.clone(), world_pts }
    }

    /// Rotate the curve by `angle` radians about a world axis through the origin.
    /// A planar curve rotates rigidly, so only its frame changes.
    #[wasm_bindgen(js_name = rotateAxis)]
    pub fn rotate_axis(&self, angle: f64, ax: f64, ay: f64, az: f64) -> Result<Curve3DJs, JsValue>
    {
        let axis = Vector3::new(ax as Real, ay as Real, az as Real);
        if axis.norm() < 1e-12
        {
            return Err(JsValue::from_str("Curve3DJs::rotateAxis(): zero axis"));
        }
        let rot = nalgebra::Rotation3::from_axis_angle(
            &nalgebra::Unit::new_normalize(axis),
            angle as Real,
        );
        let mut frame = self.frame.clone();
        frame.origin = rot * frame.origin;
        frame.x = rot * frame.x;
        frame.y = rot * frame.y;
        frame.n = rot * frame.n;
        let world_pts = self.world_pts.as_ref().map(|ps| ps.iter().map(|p| rot * p).collect());
        Ok(Curve3DJs { frame, geom: self.geom.clone(), world_pts })
    }

    /// Boolean against another closed curve (`union`/`intersection`/`difference`/
    /// `xor`), computed on **native geometry** (arcs/lines preserved, nothing
    /// tessellated). The other curve is mapped into this curve's plane by an exact
    /// similarity; both must be closed and coplanar. Results are native regions
    /// (exterior + holes) in this frame — feed them straight into further booleans
    /// to keep chained ops fast and compact. Errors (→ caller may fall back) when
    /// inputs are open / non-coplanar or hypercurve declines the topology.
    #[wasm_bindgen(js_name = boolean)]
    pub fn boolean(&self, other: &Curve3DJs, op: &str, _tol: Option<f64>) -> Result<Vec<BooleanRegion3DJs>, JsValue>
    {
        let op = parse_op(op)?;

        // An exact operand goes through hypercurve's mixed-family region boolean, so a
        // conic boundary is never lowered to line work. `native_closed_contour()` below
        // tessellates a closed Geom::Path, which is why this method's "arcs preserved,
        // nothing tessellated" guarantee used to hold for circles but not for ellipses.
        if matches!(self.geom, Geom::Path(_)) || matches!(other.geom, Geom::Path(_))
        {
            if let (Some(pa), Some(pb)) = (self.closed_path(), other.closed_path_in_frame(&self.frame))
            {
                if let Some(paths) = hcurve::boolean_paths(&pa, &pb, op)
                {
                    return Ok(paths
                        .into_iter()
                        .map(|p| BooleanRegion3DJs {
                            exterior: Curve3DJs::from_path_normalized(self.frame.clone(), p, true),
                            holes: Vec::new(),
                        })
                        .collect());
                }
            }
        }

        let a = self
            .native_closed_contour()
            .ok_or_else(|| JsValue::from_str("Curve3DJs::boolean(): 'this' is not a closed region"))?;
        let b = other
            .contour_in_frame(&self.frame)
            .ok_or_else(|| JsValue::from_str("Curve3DJs::boolean(): other is not a coplanar closed region"))?;

        let regions = match hcurve::boolean_native(&a, &b, op)
        {
            Some(r) => r,
            // hypercurve declined even after its tolerance ladder and simulation-of-
            // simplicity nudge. This is reachable now that joins preserve arcs: a chained
            // boolean feeds back genuine arc-arc tangencies where it used to see chorded
            // line work, and an exactly-tangent arc pair is topology hypercurve will not
            // decide. Retry on line work rather than failing the operation outright.
            None =>
            {
                let (la, lb) = (self.to_polyline_curve(DEFAULT_CHORD)?, other.to_polyline_curve(DEFAULT_CHORD)?);
                let (pa, pb) = (
                    la.native_closed_contour().ok_or_else(|| {
                        JsValue::from_str("Curve3DJs::boolean(): 'this' is not a closed region")
                    })?,
                    lb.contour_in_frame(&self.frame).ok_or_else(|| {
                        JsValue::from_str("Curve3DJs::boolean(): other is not a coplanar closed region")
                    })?,
                );
                hcurve::boolean_native(&pa, &pb, op).ok_or_else(|| {
                    JsValue::from_str("Curve3DJs::boolean(): hypercurve declined the topology")
                })?
            }
        };

        Ok(regions
            .into_iter()
            .map(|nr| {
                let exterior = Curve3DJs::from_closed(self.frame.clone(), nr.exterior);
                let holes = nr
                    .holes
                    .into_iter()
                    .map(|h| Curve3DJs::from_closed(self.frame.clone(), h))
                    .collect();
                BooleanRegion3DJs { exterior, holes }
            })
            .collect())
    }
}

/// A boolean-result region: an exterior curve and the hole curves it owns.
/// Mirrors curvo's `BooleanRegionJs` for the hypercurve-backed `Curve3DJs`.
#[wasm_bindgen]
pub struct BooleanRegion3DJs
{
    exterior: Curve3DJs,
    holes: Vec<Curve3DJs>,
}

#[wasm_bindgen]
impl BooleanRegion3DJs
{
    /// The exterior boundary curve.
    #[wasm_bindgen(getter)]
    pub fn exterior(&self) -> Curve3DJs
    {
        self.exterior.clone_js()
    }

    /// The interior hole curves.
    #[wasm_bindgen(js_name = holes)]
    pub fn holes(&self) -> Vec<Curve3DJs>
    {
        self.holes.iter().map(|h| h.clone_js()).collect()
    }

    /// Number of holes.
    #[wasm_bindgen(js_name = holeCount)]
    pub fn hole_count(&self) -> usize
    {
        self.holes.len()
    }
}

impl Curve3DJs
{
    /// This curve's native closed contour (only when it is a closed region).
    fn native_closed_contour(&self) -> Option<Contour2>
    {
        match &self.geom
        {
            Geom::Closed(ct) => Some(ct.clone()),
            Geom::Path(pg) if pg.closed =>
            {
                // A fine line contour of the closed ellipse for native boolean ops.
                let pts = hcurve::tessellate_path(&pg.path, DEFAULT_CHORD).ok()?;
                hcurve::closed_contour(&pts).ok()
            }
            Geom::Open(_) | Geom::Path(_) => None,
        }
    }

    /// This curve's native closed contour, mapped into `target`'s frame via an
    /// exact similarity. `None` if not a closed region or not coplanar with target.
    fn contour_in_frame(&self, target: &Frame) -> Option<Contour2>
    {
        let ct = self.native_closed_contour()?;
        let sim = target.similarity_from(&self.frame)?;
        ct.transform_similarity(&sim).ok()
    }

    /// This curve's geometry as an open curve string in its own local frame
    /// (a closed contour's segments are reused directly).
    fn as_curve_string(&self, chord: f64) -> Result<CurveString2, String>
    {
        match &self.geom
        {
            Geom::Open(cs) => Ok(cs.clone()),
            Geom::Closed(ct) =>
            {
                let pts = hcurve::tessellate_closed(ct, chord)?;
                hcurve::open_polyline(&pts)
            }
            Geom::Path(pg) =>
            {
                let pts = hcurve::tessellate_path(&pg.path, chord)?;
                hcurve::open_polyline(&pts)
            }
        }
    }

}

fn err(e: String) -> JsValue
{
    JsValue::from_str(&e)
}

/// A contour/curve-string that supports hypercurve's exact per-vertex chamfer.
/// Abstracts over the closed ([`Contour2`]) and open ([`CurveString2`]) cases,
/// which share the geometry but differ in vertex range (open curves have two free
/// endpoints that are not corners) and result type.
trait CornerTarget: Clone
{
    fn corner_segments(&self) -> &[Segment2];
    /// Closed targets treat every vertex as a corner and wrap the previous
    /// segment; open targets only chamfer interior vertices (`1..segments`) and
    /// never wrap.
    fn is_closed_corner_target() -> bool;
    fn chamfer_corner(&self, vi: usize, tp: &Point2, tn: &Point2, pol: &CurvePolicy) -> Option<Self>;
}

impl CornerTarget for Contour2
{
    fn corner_segments(&self) -> &[Segment2] { self.segments() }
    fn is_closed_corner_target() -> bool { true }
    fn chamfer_corner(&self, vi: usize, tp: &Point2, tn: &Point2, pol: &CurvePolicy) -> Option<Self>
    {
        self.chamfer_vertex_by_points(vi, tp, tn, pol)
            .ok()
            .and_then(|r| hcurve::decided(r).ok())
    }
}

impl CornerTarget for CurveString2
{
    fn corner_segments(&self) -> &[Segment2] { self.segments() }
    fn is_closed_corner_target() -> bool { false }
    fn chamfer_corner(&self, vi: usize, tp: &Point2, tn: &Point2, pol: &CurvePolicy) -> Option<Self>
    {
        self.chamfer_vertex_by_points(vi, tp, tn, pol)
            .ok()
            .and_then(|r| hcurve::decided(r).ok())
    }
}

/// Chamfer (bevel) every interior line–line corner of a contour/curve-string by
/// `amount` (setback along each edge). Corners where it does not fit, or that
/// involve an arc, are left unchanged. Uses hypercurve's exact vertex chamfer,
/// computing the tangent points here. Works for closed contours (every vertex) and
/// open curve strings (interior vertices only — the two free endpoints are not
/// corners). (Fillets use [`hcurve::fillet_segments`] instead — a `from_bulge` arc
/// avoids the exactly-equidistant-center that hypercurve's vertex fillet demands.)
/// `only`: when `Some`, restrict chamfering to those corner (vertex) indices; every other
/// corner is left sharp. `None` chamfers every fitting corner. An empty slice is a no-op.
fn chamfer_op<T: CornerTarget>(target: &T, amount: f64, only: Option<&[usize]>) -> Result<T, String>
{
    if !(amount.is_finite() && amount > 0.0)
    {
        return Ok(target.clone());
    }
    if only.is_some_and(|sel| sel.is_empty())
    {
        return Ok(target.clone());
    }
    let pol = hcurve::boolean_policy();
    let mut cur = target.clone();
    let n = cur.corner_segments().len();
    let closed = T::is_closed_corner_target();

    let norm = |v: (f64, f64)| -> (f64, f64) {
        let m = (v.0 * v.0 + v.1 * v.1).sqrt();
        if m > 1e-12 { (v.0 / m, v.1 / m) } else { (0.0, 0.0) }
    };
    let dot = |a: (f64, f64), b: (f64, f64)| a.0 * b.0 + a.1 * b.1;
    let dist = |a: (f64, f64), b: (f64, f64)| ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt();
    let l = |p: &Point2| seg_local(p);

    // Vertex vi is the junction of segment `vi-1` and segment `vi`. Closed: every
    // vertex `0..n` (vertex 0 wraps to the last segment). Open: interior vertices
    // `1..n` only (endpoints are not corners). Process high -> low so chamfering one
    // corner does not shift lower, unprocessed indices.
    let first = if closed { 0 } else { 1 };
    for vi in (first..n).rev()
    {
        if only.is_some_and(|sel| !sel.contains(&vi))
        {
            continue; // not one of the requested corners — leave it sharp
        }
        let segs = cur.corner_segments();
        let m = segs.len();
        if vi >= m
        {
            continue;
        }
        let prev_seg = &segs[if closed { (vi + m - 1) % m } else { vi - 1 }];
        let cur_seg = &segs[vi];
        if !matches!(prev_seg, Segment2::Line(_)) || !matches!(cur_seg, Segment2::Line(_))
        {
            continue; // only line–line corners
        }
        let v = { let p = cur_seg.start(); (l(p)[0], l(p)[1]) };
        let p = { let q = prev_seg.start(); (l(q)[0], l(q)[1]) };
        let q = { let e = cur_seg.end(); (l(e)[0], l(e)[1]) };

        let u = norm((p.0 - v.0, p.1 - v.1)); // toward previous vertex
        let w = norm((q.0 - v.0, q.1 - v.1)); // toward next vertex
        let half = dot(u, w).clamp(-1.0, 1.0).acos() / 2.0; // half interior angle
        if half < 1.0e-3 || half > std::f64::consts::FRAC_PI_2 - 1.0e-6
        {
            continue; // straight / degenerate
        }

        let d = amount;
        if d > dist(p, v) - 1e-9 || d > dist(v, q) - 1e-9
        {
            continue;
        }
        let tp = hcurve::point(v.0 + u.0 * d, v.1 + u.1 * d)?;
        let tn = hcurve::point(v.0 + w.0 * d, v.1 + w.1 * d)?;
        if let Some(c) = cur.chamfer_corner(vi, &tp, &tn, &pol)
        {
            cur = c;
        }
    }
    Ok(cur)
}

fn parse_op(op: &str) -> Result<BooleanOp, JsValue>
{
    match op
    {
        "union" => Ok(BooleanOp::Union),
        "intersection" => Ok(BooleanOp::Intersection),
        "difference" => Ok(BooleanOp::Difference),
        "xor" => Ok(BooleanOp::Xor),
        other => Err(JsValue::from_str(&format!("Curve3DJs: unknown boolean op '{other}'"))),
    }
}

//// CURVE IMPORT (SVG / DXF) ////

/// The result of importing a document into native curves: the `Curve3DJs` list plus any
/// non-fatal warnings (unsupported or skipped content).
#[cfg(any(feature = "svg-io", feature = "dxf-io"))]
#[wasm_bindgen]
pub struct CurveImportJs
{
    curves: Vec<Curve3DJs>,
    warnings: Vec<String>,
}

#[cfg(any(feature = "svg-io", feature = "dxf-io"))]
#[wasm_bindgen]
impl CurveImportJs
{
    /// Move the imported curves out (call once). Leaves the result empty.
    #[wasm_bindgen(js_name = takeCurves)]
    pub fn take_curves(&mut self) -> Vec<Curve3DJs>
    {
        std::mem::take(&mut self.curves)
    }

    /// Non-fatal warnings gathered during import (skipped elements/commands).
    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> Vec<String>
    {
        self.warnings.clone()
    }
}

/// Lift imported planar curves into `Curve3DJs` on the XY plane at z = 0.
#[cfg(any(feature = "svg-io", feature = "dxf-io"))]
fn imported_to_curves(imported: Vec<crate::io::curves::ImportedCurve>) -> Vec<Curve3DJs>
{
    use crate::io::curves::ImportedCurve;

    let frame = Frame::from_center_normal(Point3::origin(), Vector3::z());
    imported
        .into_iter()
        .map(|c| match c
        {
            ImportedCurve::Open(cs) => Curve3DJs::from_open(frame.clone(), cs),
            ImportedCurve::Closed(ct) => Curve3DJs::from_closed(frame.clone(), ct),
            // A Bezier, an <ellipse> or a DXF ELLIPSE/SPLINE arrives as an exact path and
            // stays one.
            ImportedCurve::Path(path, closed) =>
            {
                Curve3DJs::from_path_normalized(frame.clone(), path, closed)
            }
        })
        .collect()
}

/// Import an SVG document into native planar curves. Lines, circular arcs and Béziers are
/// all kept exact — a `C` command arrives as a `CubicBezier2` span, not as chords.
/// Unsupported path commands (elliptical arcs with rx ≠ ry) are skipped and surfaced via
/// `warnings`. Coordinates are SVG-space (y-down) at z = 0.
#[cfg(feature = "svg-io")]
#[wasm_bindgen(js_name = importSvgCurves)]
pub fn import_svg_curves(doc: &str) -> Result<CurveImportJs, JsValue>
{
    let (imported, warnings) = crate::io::svg_curves::import_svg_curves(doc)
        .map_err(|e| err(format!("SVG import failed: {e:?}")))?;
    Ok(CurveImportJs { curves: imported_to_curves(imported), warnings })
}

/// Import a DXF drawing into native planar curves.
///
/// LWPOLYLINE and POLYLINE bulges become real arcs, ARC and CIRCLE are exact rather than
/// sampled, and ELLIPSE, SPLINE and INSERT (resolved against the block table) are read
/// instead of dropped. Entity types with no curve meaning are counted and reported via
/// `warnings`. 2D content only — `MeshJs.fromDXF` still handles 3D.
#[cfg(feature = "dxf-io")]
#[wasm_bindgen(js_name = importDxfCurves)]
pub fn import_dxf_curves(bytes: &[u8]) -> Result<CurveImportJs, JsValue>
{
    let (imported, warnings) = crate::io::dxf_curves::import_dxf_curves(bytes)
        .map_err(|e| err(format!("DXF import failed: {e:?}")))?;
    Ok(CurveImportJs { curves: imported_to_curves(imported), warnings })
}
