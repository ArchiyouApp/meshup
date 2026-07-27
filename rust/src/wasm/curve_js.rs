//! `Curve3DJs` — a **planar** 3D curve backed by the [`crate::hcurve`] hypercurve
//! engine (replacing `curvo`). A curve is a 3D plane/frame plus a 2D hypercurve
//! expressed in that frame's local XY coordinates. 3D points are projected into
//! local XY for exact planar operations, and results are lifted back to 3D.
//!
//! This is being built **alongside** the curvo-backed `NurbsCurve3DJs` while the
//! TypeScript `Curve` layer is migrated method-by-method.

use std::cell::OnceCell;

use crate::float_types::Real;
use crate::hcurve;
use crate::wasm::point_js::Point3Js;
use crate::wasm::vector_js::Vector3Js;
use hypercurve::{
    BooleanOp, Contour2, CurvePath2, CurvePolicy, CurveString2, Point2, Segment2, Similarity2,
};
use nalgebra::{Point3, Vector3};
use wasm_bindgen::prelude::*;

const DEFAULT_CHORD: f64 = hcurve::DEFAULT_CHORD_ERROR;

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
        let n = if n.norm() > 1e-9
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
            match best
            {
                Some(cross) if cross.norm() > 1e-9 => cross.normalize(),
                // Truly collinear: any perpendicular plane contains the line. Prefer a
                // cardinal plane the points actually lie in (curves are usually drawn in
                // XY / XZ / YZ), else any perpendicular to the span.
                _ =>
                {
                    let constant = |sel: fn(&Point3<Real>) -> Real| -> bool {
                        let v0 = sel(&pts[0]);
                        pts.iter().all(|p| (sel(p) - v0).abs() < 1e-9)
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
    /// An exact mixed-family path (e.g. an ellipse of rational conic spans) that
    /// `CurveString2`/`Contour2` cannot hold. Kept exact for tessellation, length,
    /// area, reverse, and similarity; segment-level operations use a lazily-built
    /// line approximation ([`PathGeom::segments`]).
    Path(PathGeom),
}

/// An exact [`CurvePath2`] plus a lazily-materialised line-segment approximation
/// for the segment-oriented `Curve3DJs` operations.
#[derive(Clone)]
struct PathGeom
{
    path: CurvePath2,
    closed: bool,
    lines: OnceCell<Vec<Segment2>>,
}

impl PathGeom
{
    fn new(path: CurvePath2, closed: bool) -> Self
    {
        Self { path, closed, lines: OnceCell::new() }
    }

    /// A fine line approximation of the exact path, built once and cached. Used by
    /// segment-level operations (`trim`, `spans`, `degree`, `controlPoints`, …)
    /// that have no exact mixed-family equivalent.
    fn segments(&self) -> &[Segment2]
    {
        self.lines
            .get_or_init(|| line_segments_of_path(&self.path, self.closed).unwrap_or_default())
    }
}

/// Tessellate an exact path and rebuild it as line `Segment2`s (open or closed).
fn line_segments_of_path(path: &CurvePath2, closed: bool) -> Result<Vec<Segment2>, String>
{
    let pts = hcurve::tessellate_path(path, DEFAULT_CHORD)?;
    if closed
    {
        Ok(hcurve::closed_contour(&pts)?.segments().to_vec())
    }
    else
    {
        Ok(hcurve::open_polyline(&pts)?.segments().to_vec())
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

    /// The native segment list. For an exact [`Geom::Path`], the lazily-built line
    /// approximation.
    fn segments(&self) -> &[hypercurve::Segment2]
    {
        match &self.geom
        {
            Geom::Open(cs) => cs.segments(),
            Geom::Closed(ct) => ct.segments(),
            Geom::Path(pg) => pg.segments(),
        }
    }

    /// A line-based `Geom` (identity for line/arc geometry; a fine tessellation for
    /// an exact conic [`Geom::Path`]). Lets segment/contour-only operations reuse
    /// the existing `Open`/`Closed` code paths.
    fn as_line_geom(&self) -> Result<Geom, String>
    {
        match &self.geom
        {
            Geom::Open(cs) => Ok(Geom::Open(cs.clone())),
            Geom::Closed(ct) => Ok(Geom::Closed(ct.clone())),
            Geom::Path(pg) =>
            {
                let pts = hcurve::tessellate_path(&pg.path, DEFAULT_CHORD)?;
                if pg.closed
                {
                    Ok(Geom::Closed(hcurve::closed_contour(&pts)?))
                }
                else
                {
                    Ok(Geom::Open(hcurve::open_polyline(&pts)?))
                }
            }
        }
    }

    /// A clone of this curve with its geometry lowered to lines (see
    /// [`Self::as_line_geom`]).
    fn to_line_curve(&self) -> Result<Curve3DJs, JsValue>
    {
        Ok(Curve3DJs { frame: self.frame.clone(), geom: self.as_line_geom().map_err(err)?, world_pts: None })
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
        let (pts, cum) = self.arc_length_table(DEFAULT_CHORD).map_err(err)?;
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

    /// Construct a smooth NURBS curve of `degree` (>= 2) interpolating the given
    /// 3D points. Stored as a fine polyline (meshup consumes interpolated curves
    /// tessellated); the curve passes through every input point.
    #[wasm_bindgen(js_name = makeInterpolated)]
    pub fn make_interpolated(points: Vec<Point3Js>, degree: usize) -> Result<Curve3DJs, JsValue>
    {
        let pts3: Vec<Point3<Real>> = points.iter().map(|p| p.inner).collect();
        let frame = Frame::from_points(&pts3).map_err(err)?;
        let local: Vec<[f64; 2]> = pts3.iter().map(|p| frame.to_local(p)).collect();
        let curve = hcurve::nurbs_interpolate(&local, degree).map_err(err)?;
        // Fine chord so the stored polyline closely follows the smooth curve.
        let tess = hcurve::tessellate_nurbs(&curve, 1.0e-5).map_err(err)?;
        let geom = Geom::Open(hcurve::open_polyline(&tess).map_err(err)?);
        Ok(Curve3DJs { frame, geom, world_pts: None })
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
            Geom::Path(pg) =>
            {
                // Sum the exact-conic tessellation; the frame is orthonormal, so
                // local distances equal world distances.
                let pts = hcurve::tessellate_path(&pg.path, chord).map_err(err)?;
                Ok(pts.windows(2).map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1])).sum())
            }
        }
    }

    /// Signed area (closed curves only); `None`/error for open curves.
    #[wasm_bindgen(js_name = area)]
    pub fn area(&self) -> Result<f64, JsValue>
    {
        match &self.geom
        {
            Geom::Closed(ct) => hcurve::signed_area(ct).map_err(err),
            Geom::Path(pg) if pg.closed =>
            {
                let pts = hcurve::tessellate_path(&pg.path, DEFAULT_CHORD).map_err(err)?;
                let ct = hcurve::closed_contour(&pts).map_err(err)?;
                hcurve::signed_area(&ct).map_err(err)
            }
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
    #[wasm_bindgen(js_name = offset)]
    pub fn offset(&self, distance: f64, tol: Option<f64>) -> Result<Curve3DJs, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let ring = match &self.geom
        {
            Geom::Open(cs) => hcurve::offset_open(cs, distance, chord).map_err(err)?,
            Geom::Closed(ct) => hcurve::offset_closed(ct, distance, chord).map_err(err)?,
            Geom::Path(pg) =>
            {
                let pts = hcurve::tessellate_path(&pg.path, chord).map_err(err)?;
                if pg.closed
                {
                    let ct = hcurve::closed_contour(&pts).map_err(err)?;
                    hcurve::offset_closed(&ct, distance, chord).map_err(err)?
                }
                else
                {
                    let cs = hcurve::open_polyline(&pts).map_err(err)?;
                    hcurve::offset_open(&cs, distance, chord).map_err(err)?
                }
            }
        };
        // Rebuild geometry from the offset polyline in local coords.
        let geom = if self.closed()
        {
            Geom::Closed(hcurve::closed_contour(&ring).map_err(err)?)
        }
        else
        {
            Geom::Open(hcurve::open_polyline(&ring).map_err(err)?)
        };
        Ok(Curve3DJs { frame: self.frame.clone(), geom, world_pts: None })
    }

    /// Intersection points with another curve (both projected into this frame),
    /// returned as 3D points.
    #[wasm_bindgen(js_name = intersect)]
    pub fn intersect(&self, other: &Curve3DJs, tol: Option<f64>) -> Result<Vec<Point3Js>, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
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

    /// Axis-aligned bounding box of the tessellated curve as
    /// `[minx,miny,minz, maxx,maxy,maxz]`.
    #[wasm_bindgen(js_name = bbox)]
    pub fn bbox(&self, tol: Option<f64>) -> Result<Vec<f64>, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        let pts = self.tessellate(Some(chord))?;
        if pts.is_empty()
        {
            return Err(JsValue::from_str("Curve3DJs::bbox(): empty curve"));
        }
        let (mut mn, mut mx) = ([f64::MAX; 3], [f64::MIN; 3]);
        for p in &pts
        {
            let c = [p.x(), p.y(), p.z()];
            for i in 0..3
            {
                mn[i] = mn[i].min(c[i]);
                mx[i] = mx[i].max(c[i]);
            }
        }
        Ok(vec![mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]])
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
        let segs: Vec<Segment2> = self.segments().iter().rev().map(|s| s.reversed()).collect();
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
        let (_, cum) = self.arc_length_table(DEFAULT_CHORD).map_err(err)?;
        let total = cum.last().copied().unwrap_or(0.0);
        if total <= 0.0
        {
            return Ok(0.0);
        }
        Ok((len / total).clamp(0.0, 1.0))
    }

    /// Native sub-curve between arc-length fractions `t0`, `t1` in `[0, 1]`,
    /// preserving line/arc segments exactly (no tessellation). Always open.
    #[wasm_bindgen(js_name = trim)]
    pub fn trim(&self, t0: f64, t1: f64) -> Result<Curve3DJs, JsValue>
    {
        let segs = hcurve::trim_segments(self.segments(), t0, t1).map_err(err)?;
        let cs = CurveString2::try_new(segs).map_err(|e| err(format!("Curve3DJs::trim: {e:?}")))?;
        Ok(Curve3DJs::from_open(self.frame.clone(), cs))
    }

    /// The arc-length parameter (in `[0, 1]`) of the tessellation vertex closest
    /// to the given 3D point.
    #[wasm_bindgen(js_name = paramClosestToPoint)]
    pub fn param_closest_to_point(&self, p: &Point3Js) -> Result<f64, JsValue>
    {
        let (pts, cum) = self.arc_length_table(DEFAULT_CHORD).map_err(err)?;
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

    /// Defining vertices (segment endpoints) as 3D points.
    #[wasm_bindgen(js_name = controlPoints)]
    pub fn control_points(&self) -> Vec<Point3Js>
    {
        let segs = self.segments();
        let mut out: Vec<Point3Js> = segs
            .iter()
            .map(|s| {
                let w = self.frame.to_world(seg_local(s.start()));
                Point3Js::new(w.x as f64, w.y as f64, w.z as f64)
            })
            .collect();
        if !self.closed()
        {
            if let Some(last) = segs.last()
            {
                let w = self.frame.to_world(seg_local(last.end()));
                out.push(Point3Js::new(w.x as f64, w.y as f64, w.z as f64));
            }
        }
        out
    }

    /// Classify the curve by its native segment types:
    /// `Line` | `Arc` | `Circle` | `Rect` | `Polyline` | `Spline`.
    #[wasm_bindgen(js_name = subtype)]
    pub fn subtype(&self) -> String
    {
        // Exact conic paths are ellipses/elliptical arcs by construction.
        if matches!(self.geom, Geom::Path(_))
        {
            return "Ellipse".to_string();
        }
        let segs = self.segments();
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

    /// One `Curve3DJs` per native segment (each an open single-segment curve).
    #[wasm_bindgen(js_name = spans)]
    pub fn spans(&self) -> Result<Vec<Curve3DJs>, JsValue>
    {
        self.segments()
            .iter()
            .map(|s| {
                CurveString2::try_new(vec![s.clone()])
                    .map(|cs| Curve3DJs::from_open(self.frame.clone(), cs))
                    .map_err(|e| err(format!("spans: {e:?}")))
            })
            .collect()
    }

    /// Number of native segments.
    #[wasm_bindgen(js_name = segmentCount)]
    pub fn segment_count(&self) -> usize
    {
        self.segments().len()
    }

    /// Effective polynomial degree: the max over segments (line = 1, arc = 2).
    /// A native re-architecture of curvo's single-NURBS `degree()`.
    #[wasm_bindgen(js_name = degree)]
    pub fn degree(&self) -> usize
    {
        self.segments()
            .iter()
            .map(|s| match s
            {
                Segment2::Line(_) => 1usize,
                Segment2::Arc(_) => 2usize,
            })
            .max()
            .unwrap_or(1)
    }

    /// Parameter domain. Curves are re-parameterised by normalised arc length,
    /// so the domain is always `[0, 1]`.
    #[wasm_bindgen(js_name = knotsDomain)]
    pub fn knots_domain(&self) -> Vec<f64>
    {
        vec![0.0, 1.0]
    }

    /// Fillet (round) every interior corner with an arc of the given `radius`.
    /// Corners where the radius does not fit are left sharp. Works on both closed
    /// contours (every vertex) and open curve strings (interior vertices only —
    /// the two free endpoints are not corners).
    #[wasm_bindgen(js_name = fillet)]
    pub fn fillet(&self, radius: f64) -> Result<Curve3DJs, JsValue>
    {
        match &self.geom
        {
            Geom::Closed(ct) =>
            {
                let segs = hcurve::fillet_segments(ct.segments(), radius, true).map_err(err)?;
                let c = Contour2::try_new(segs).map_err(|e| err(format!("Curve3DJs::fillet: {e:?}")))?;
                Ok(Curve3DJs::from_closed(self.frame.clone(), c))
            }
            Geom::Open(cs) =>
            {
                let segs = hcurve::fillet_segments(cs.segments(), radius, false).map_err(err)?;
                let c = CurveString2::try_new(segs).map_err(|e| err(format!("Curve3DJs::fillet: {e:?}")))?;
                Ok(Curve3DJs::from_open(self.frame.clone(), c))
            }
            // Fillet the line approximation of an exact conic path.
            Geom::Path(_) => self.to_line_curve()?.fillet(radius),
        }
    }

    /// Chamfer (bevel) every interior corner, cutting back `setback` along each edge.
    /// Works on both closed contours and open curve strings (interior vertices only).
    #[wasm_bindgen(js_name = chamfer)]
    pub fn chamfer(&self, setback: f64) -> Result<Curve3DJs, JsValue>
    {
        match &self.geom
        {
            Geom::Closed(ct) =>
            {
                let chamfered = chamfer_op(ct, setback).map_err(err)?;
                Ok(Curve3DJs::from_closed(self.frame.clone(), chamfered))
            }
            Geom::Open(cs) =>
            {
                let chamfered = chamfer_op(cs, setback).map_err(err)?;
                Ok(Curve3DJs::from_open(self.frame.clone(), chamfered))
            }
            // Chamfer the line approximation of an exact conic path.
            Geom::Path(_) => self.to_line_curve()?.chamfer(setback),
        }
    }

    /// Deep copy.
    #[wasm_bindgen(js_name = clone)]
    pub fn clone_js(&self) -> Curve3DJs
    {
        Curve3DJs { frame: self.frame.clone(), geom: self.geom.clone(), world_pts: self.world_pts.clone() }
    }

    /// Whether the geometry contains any circular-arc segments (vs. all straight).
    #[wasm_bindgen(js_name = hasArcs)]
    pub fn has_arcs(&self) -> bool
    {
        let segs = self.segments();
        segs.iter().any(|s| matches!(s, hypercurve::Segment2::Arc(_)))
    }

    /// Tessellate each native segment separately, returning a JS array of flat 3D
    /// point arrays (`Array<Float64Array>`, `[x,y,z,...]` per segment). Lets the TS
    /// layer rebuild a faithful compound curve (one span per arc/line) instead of a
    /// single flattened polyline.
    #[wasm_bindgen(js_name = segmentTessellations)]
    pub fn segment_tessellations(&self, tol: Option<f64>) -> Result<JsValue, JsValue>
    {
        let chord = tol.unwrap_or(DEFAULT_CHORD);
        // An exact conic path has no native line/arc segments; return its exact
        // tessellation as a single span.
        if let Geom::Path(pg) = &self.geom
        {
            let out = js_sys::Array::new();
            let pts2d = hcurve::tessellate_path(&pg.path, chord).map_err(err)?;
            let flat: Vec<f64> = pts2d
                .iter()
                .flat_map(|xy| {
                    let w = self.frame.to_world(*xy);
                    [w.x as f64, w.y as f64, w.z as f64]
                })
                .collect();
            out.push(&js_sys::Float64Array::from(flat.as_slice()).into());
            return Ok(out.into());
        }
        let segs: Vec<hypercurve::Segment2> = match &self.geom
        {
            Geom::Open(cs) => cs.segments().to_vec(),
            Geom::Closed(ct) => ct.segments().to_vec(),
            Geom::Path(_) => unreachable!("handled above"),
        };
        let out = js_sys::Array::new();
        for seg in &segs
        {
            let cs = hypercurve::CurveString2::try_new(vec![seg.clone()])
                .map_err(|e| err(format!("hcurve: segment string failed ({e:?})")))?;
            let pts2d = hcurve::tessellate_open(&cs, chord).map_err(err)?;
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

        let a = self
            .native_closed_contour()
            .ok_or_else(|| JsValue::from_str("Curve3DJs::boolean(): 'this' is not a closed region"))?;
        let b = other
            .contour_in_frame(&self.frame)
            .ok_or_else(|| JsValue::from_str("Curve3DJs::boolean(): other is not a coplanar closed region"))?;

        let regions = hcurve::boolean_native(&a, &b, op)
            .ok_or_else(|| JsValue::from_str("Curve3DJs::boolean(): hypercurve declined the topology"))?;

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
fn chamfer_op<T: CornerTarget>(target: &T, amount: f64) -> Result<T, String>
{
    if !(amount.is_finite() && amount > 0.0)
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

//// SVG IMPORT ////

/// The result of importing an SVG document into native curves: the `Curve3DJs`
/// list plus any non-fatal warnings (unsupported/skipped elements).
#[cfg(feature = "svg-io")]
#[wasm_bindgen]
pub struct SvgImportJs
{
    curves: Vec<Curve3DJs>,
    warnings: Vec<String>,
}

#[cfg(feature = "svg-io")]
#[wasm_bindgen]
impl SvgImportJs
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

/// Import an SVG document into native planar curves. Lines and circular arcs are
/// kept exact; Béziers are flattened to line segments; unsupported path commands
/// (elliptical/rotated arcs, …) are skipped and surfaced via `warnings`.
/// Coordinates are SVG-space (y-down) at z = 0.
#[cfg(feature = "svg-io")]
#[wasm_bindgen(js_name = importSvgCurves)]
pub fn import_svg_curves(doc: &str) -> Result<SvgImportJs, JsValue>
{
    use crate::io::svg_curves::{ImportedCurve, import_svg_curves as import_doc};

    let (imported, warnings) = import_doc(doc).map_err(|e| err(format!("SVG import failed: {e:?}")))?;
    // All imported geometry lives in the XY plane (z = 0), SVG coords.
    let frame = Frame::from_center_normal(Point3::origin(), Vector3::z());
    let curves = imported
        .into_iter()
        .map(|c| match c
        {
            ImportedCurve::Open(cs) => Curve3DJs::from_open(frame.clone(), cs),
            ImportedCurve::Closed(ct) => Curve3DJs::from_closed(frame.clone(), ct),
        })
        .collect();
    Ok(SvgImportJs { curves, warnings })
}
