// Some special WASM bindings for Meshup TS library
// - expose from curvo: NurbsCurve and CompoundCurve
// - TODO: BHV

use crate::float_types::Real;
use nalgebra::{ Point3, Point4, Quaternion, Rotation3, Translation3, Matrix4, UnitQuaternion, Vector3 };
use curvo::prelude::{ NurbsCurve2D, NurbsCurve3D, CompoundCurve2D, Tessellation, BoundingBox, Transformable,
        CompoundCurve3D, Fillet, FilletRadiusOption, FilletRadiusParameterOption,
        CurveOffsetOption, CurveOffsetCornerType, Offset, Intersects, HasIntersection,
        TrimRange, Split, Boolean, Clip, Invertible, Interpolation,
        NurbsSurface3D, AdaptiveTessellationOptions, CurveIntersectionSolverOptions };
use curvo::prelude::operation::BooleanOperation;

use super::point_js::{ Point3Js };
use super::vector_js::{ Vector3Js };

use wasm_bindgen::prelude::*;


/// Shared geo-buf / Sketch polygon offset used by NurbsCurve3DJs and CompoundCurve3DJs.
///
/// Closes the tessellated point list into a polygon, runs geo-buf's straight-skeleton
/// offset via [`Sketch::offset`], then extracts all exterior boundaries as a single
/// degree-1 CompoundCurve3D.
#[cfg(feature = "offset")]
fn offset_geo_sketch(pts_3d: &[Point3<Real>], distance: Real) -> Result<CompoundCurve3DJs, JsValue> {
    use crate::sketch::Sketch;
    use geo::{Coord, Geometry, GeometryCollection, LineString, Polygon};

    if pts_3d.len() < 3 {
        return Err(JsValue::from_str("offsetGeo: need at least 3 points to form a polygon"));
    }

    // Build a closed 2D polygon ring from XY coordinates.
    let mut coords: Vec<Coord<Real>> = pts_3d.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
    let first = coords[0];
    let last = *coords.last().unwrap();
    if (last.x - first.x).abs() > 1e-9 || (last.y - first.y).abs() > 1e-9 {
        coords.push(first); // close the ring
    }

    let polygon = Polygon::new(LineString::new(coords), vec![]);
    let sketch: Sketch<()> = Sketch::from_geo(
        GeometryCollection(vec![Geometry::Polygon(polygon)]),
        None,
    );

    // Delegate to geo-buf via Sketch::offset (straight-skeleton algorithm).
    let offset_sketch = sketch.offset(distance);
    let multi_poly = offset_sketch.to_multipolygon();

    if multi_poly.0.is_empty() {
        return Err(JsValue::from_str("offsetGeo: offset produced no polygons"));
    }

    // Collect all exterior rings from the result as individual degree-1 spans.
    let mut spans: Vec<NurbsCurve3D<Real>> = Vec::new();
    for poly in &multi_poly.0 {
        let pts: Vec<Point3<Real>> = poly
            .exterior()
            .coords()
            .map(|c| Point3::new(c.x, c.y, 0.0))
            .collect();
        if pts.len() >= 2 {
            spans.push(NurbsCurve3D::polyline(&pts, false));
        }
    }

    if spans.is_empty() {
        return Err(JsValue::from_str("offsetGeo: no valid spans in offset result"));
    }

    CompoundCurve3D::try_new(spans)
        .map(CompoundCurve3DJs::from)
        .map_err(|e| JsValue::from_str(&format!("offsetGeo: failed to build curve: {:?}", e)))
}


//// Point4Js for weighted control points ////

#[wasm_bindgen]
pub struct Point4Js {
    pub(crate) inner: Point4<Real>,
}

#[wasm_bindgen]
impl Point4Js {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, z: f64, w: f64) -> Point4Js {
        Point4Js {
            inner: Point4::new(x as Real, y as Real, z as Real, w as Real),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f64 {
        self.inner.x as f64
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f64 {
        self.inner.y as f64
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f64 {
        self.inner.z as f64
    }

    #[wasm_bindgen(getter)]
    pub fn w(&self) -> f64 {
        self.inner.w as f64
    }

    #[wasm_bindgen(js_name = toString)]
    pub fn to_string_js(&self) -> String {
        format!("<Point4({}, {}, {}, {})>", self.inner.x, self.inner.y, self.inner.z, self.inner.w)
    }
}

// Rust-only conversions (not visible to JS)
impl From<Point4<Real>> for Point4Js {
    fn from(p: Point4<Real>) -> Self {
        Point4Js { inner: p }
    }
}

impl From<&Point4Js> for Point4<Real> {
    fn from(p: &Point4Js) -> Self {
        p.inner
    }
}


//// NURBSCURVE3DJS ////
// 
// NURBS Curve 3D JavaScript bindings
//
// NOTES:
//  - NurbsCurves control points have an extra weight coordinate,
//     so 3D curves use Point4Js for weighted control points

#[wasm_bindgen]
pub struct NurbsCurve3DJs 
{
    pub(crate) inner: NurbsCurve3D<Real>,
}

#[wasm_bindgen]
impl NurbsCurve3DJs 
{
    #[wasm_bindgen(constructor)]
    pub fn new(degree: usize, control_points: Vec<Point3Js>, weights: Option<Vec<Real>>, knots: Vec<Real>) -> Result<NurbsCurve3DJs, JsValue>
    {   
        let num_points = control_points.len();
        
        // Use provided weights or default to all 1.0
        let weights_vec = weights.unwrap_or_else(|| vec![1.0; num_points]);
        
        // Check that control points and weights have the same length
        if weights_vec.len() != num_points {
            return Err(JsValue::from_str(&format!(
                "Control points count ({}) must match weights count ({})", 
                num_points, 
                weights_vec.len()
            )));
        }
        
        // Combine points and weights into Point4 (homogeneous coordinates)
        let points4d: Vec<Point4<Real>> = control_points.into_iter()
            .zip(weights_vec.into_iter())
            .map(|(p, w)| Point4::new(p.inner.x, p.inner.y, p.inner.z, w))
            .collect();

        match NurbsCurve3D::try_new(degree, points4d, knots) 
        {
            Ok(curve) => Ok(Self { inner: curve }),
            Err(e) => Err(JsValue::from_str(&format!("Failed to create NURBS curve: {:?}", e)))
        }
    }

    pub fn clone(&self) -> Self {
        Self { inner: self.inner.clone() }
    }

    

    // Create a polyline NurbsCurve3D from a list of points
    #[wasm_bindgen(js_name = makePolyline)]
    pub fn make_polyline(points: Vec<Point3Js>, normalize: bool) -> Self
    {
        let control_points: Vec<Point3<Real>> = points.into_iter()
            .map(|p| p.inner)
            .collect();

        // NOTE: Future versions have try_polyline that can fail
        Self { inner: NurbsCurve3D::polyline(&control_points, normalize) }
    }

    /// Create NURBS Curve (degree 3) passing through given control points
    ///
    ///  # Arguments
    /// 
    /// * `points` - Control points to interpolate through (x,y,z)
    /// 
    #[wasm_bindgen(js_name = makeInterpolated)]
    pub fn make_interpolated(points: Vec<Point3Js>, degree: usize) -> Result<NurbsCurve3DJs, JsValue>
    {
        let control_points: Vec<Point3<Real>> = points.into_iter()
            .map(|p| p.inner)
            .collect();

        match NurbsCurve3D::interpolate(&control_points, degree) 
        {
            Ok(curve) => Ok(Self { inner: curve }),
            Err(e) => Err(JsValue::from_str(&format!("Interpolation failed: {:?}", e)))
        }
    }

    /// Create an exact NURBS circle.
    ///
    /// # Arguments
    ///
    /// * `radius`  – radius of the circle (required)
    /// * `center`  – centre point; defaults to the origin
    /// * `normal`  – plane normal; defaults to `(0, 0, 1)` (XY-plane).
    ///               The X and Y axes of the circle plane are derived from this vector.
    ///
    /// Returns a closed degree-2 NURBS curve that is an exact rational circle.
    #[wasm_bindgen(js_name = makeCircle)]
    pub fn make_circle(
        radius: Real,
        center: Option<Point3Js>,
        normal: Option<Vector3Js>,
    ) -> Result<NurbsCurve3DJs, JsValue>
    {
        // Resolve centre
        let center_pt: Point3<Real> = center
            .map(|c| c.inner)
            .unwrap_or_else(Point3::origin);

        // Resolve the plane normal and derive two orthonormal axes that lie in the plane
        let n: Vector3<Real> = normal
            .map(|v| Vector3::new(v.inner.x, v.inner.y, v.inner.z).normalize())
            .unwrap_or_else(Vector3::z);

        // Build a stable x_axis perpendicular to n
        // Avoid degeneracy by choosing a seed vector not parallel to n
        let seed = if n.cross(&Vector3::x()).norm() > 1e-6 {
            Vector3::x()
        } else {
            Vector3::y()
        };
        let x_axis: Vector3<Real> = n.cross(&seed).normalize();
        let y_axis: Vector3<Real> = n.cross(&x_axis).normalize();

        NurbsCurve3D::try_circle(&center_pt, &x_axis, &y_axis, radius)
            .map(|curve| NurbsCurve3DJs { inner: curve })
            .map_err(|e| JsValue::from_str(&format!("makeCircle failed: {:?}", e)))
    }

    /// PROPERTIES ///

    #[wasm_bindgen(js_name = controlPoints)]
    pub fn control_points(&self) -> Vec<Point3Js> 
    {
        // IMPORTANT: Curvo returns control points including weight component
        self.inner.control_points().iter()
            .map(|p| Point3Js::new(p.x, p.y, p.z)) // Remove the weight factor
            .collect()
    }

    pub fn weights(&self) -> Vec<Real> {
        self.inner.weights().to_vec()
    }

    pub fn knots(&self) -> Vec<Real> {
        self.inner.knots().to_vec()
    }

    #[wasm_bindgen(js_name = knotsDomain)]
    pub fn knots_domain(&self) -> Vec<Real> {
        let domain = self.inner.knots_domain();
        vec![domain.0, domain.1]
    }

    /// Get the degree of the curve
    pub fn degree(&self) -> usize {
        self.inner.degree()
    }

    //// CALCULATED PROPERTIES ////

    pub fn length(&self) -> Real {
        self.inner.try_length()
            .expect("Failed to compute curve length")
    }

    pub fn closed(&self) -> bool {
        self.inner.is_closed()
    }

    #[wasm_bindgen(js_name = paramAtLength)]
    pub fn param_at_length(&self, length: Real) -> Result<Real, JsValue> {
        match self.inner.try_parameter_at_length(length, Some(1e-4)) 
        {
            Ok(param) => Ok(param),
            Err(e) => Err(JsValue::from_str(&format!("Failed to compute parameter at given length: {:?}", e)))
        }
    }

    #[wasm_bindgen(js_name = paramClosestToPoint)]
    pub fn param_closest_to_point(&self, point: &Point3Js) -> Result<Real, JsValue> 
    {
        match self.inner.find_closest_parameter(&point.inner) 
        {
            Ok(param) => Ok(param),
            Err(e) => Err(JsValue::from_str(&format!("Failed to compute closest parameter to point: {:?}", e)))
        }
    }

    /// Get the point at given parameter
    #[wasm_bindgen(js_name = pointAtParam)]
    pub fn point_at_param(&self, param: Real) -> Point3Js {
        Point3Js::from(self.inner.point_at(param))
    }

    // Get tangent at given parameter
    #[wasm_bindgen(js_name = tangentAt)]
    pub fn tangent_at(&self, param: Real) -> Vector3Js {
        Vector3Js::from(self.inner.tangent_at(param))
    }

    pub fn bbox(&self) -> Vec<Point3Js> {
        let bbox = BoundingBox::from(&self.inner);
        let min = bbox.min();
        let max = bbox.max();
        vec![
            Point3Js::new(min.x as f64, min.y as f64, min.z as f64),
            Point3Js::new(max.x as f64, max.y as f64, max.z as f64),
        ]
    }

    #[wasm_bindgen(js_name = filletAtParams)]
    pub fn fillet_at_params(&self, radius: Real, at: Vec<Real>) -> Result<CompoundCurve3DJs, JsValue> {
        let knots = self.inner.knots();
        
        // Find closest knot value for each parameter and return slightly less for robustness
        let adjusted_params: Vec<Real> = at.into_iter()
            .map(|p| {
                // Find the closest knot value
                let closest_knot = knots.iter()
                    .min_by(|a, b| {
                        let diff_a = (*a - p).abs();
                        let diff_b = (*b - p).abs();
                        diff_a.partial_cmp(&diff_b).unwrap()
                    })
                    .copied()
                    .unwrap_or(p);
                
                // Return slightly less than the knot value for robustness
                closest_knot - 1e-6
            })
            .collect();
        
        let fillet_options = FilletRadiusParameterOption::new(radius, adjusted_params);
        match self.inner.fillet(fillet_options) {
            Ok(compound_curve) => Ok(CompoundCurve3DJs::from(compound_curve)),
            Err(e) => Err(JsValue::from_str(&format!("Failed to fillet curve: {:?}", e)))
        }
    }

    // Fillet sharp corner(s) of Curve. Optionally only at given point(s)
    pub fn fillet(&self, radius: Real, at: Option<Vec<Point3Js>>) -> Result<CompoundCurve3DJs, JsValue> {
        
        match at {
            Some(points) => {
  
                let params: Result<Vec<Real>, JsValue> = points.into_iter()
                    .map(|p| self.param_closest_to_point(&p))
                    .collect();
                let params = params?;
                self.fillet_at_params(radius, params)
            },
            None => {
                // Fillet all sharp corners
                let fillet_options = FilletRadiusOption::new(radius);
                match self.inner.fillet(fillet_options) {
                    Ok(compound_curve) => Ok(CompoundCurve3DJs::from(compound_curve)),
                    Err(e) => Err(JsValue::from_str(&format!("NurbsCurve3DJs::fillet(): Failed to fillet curve: {:?}", e)))
                }
            }
        }
    }


    /// Extend a curve at one or both ends.
    ///
    /// - **Degree 1 (polyline)**: appends/prepends a new control point along the last/first segment direction.
    /// - **Degree > 1**: adds a straight-line segment tangent to the curve at the boundary.
    ///
    /// Always returns a `CompoundCurve3DJs` (single-span for extended polylines).
    ///
    /// # Arguments
    /// * `distance` – how far to extend (world units)
    /// * `side`     – `"end"` (default), `"start"`, or `"both"`
    pub fn extend(&self, distance: Real, side: Option<String>) -> Result<CompoundCurve3DJs, JsValue> {
        let side = side.as_deref().unwrap_or("end").to_string();

        if self.inner.degree() == 1 {
            // Polyline: extend by adding control points
            let cps: Vec<Point3<Real>> = self.inner.dehomogenized_control_points();

            if cps.len() < 2 {
                return Err(JsValue::from_str(
                    "Curve must have at least 2 control points to extend",
                ));
            }

            let mut new_cps = cps.clone();

            if side == "end" || side == "both" {
                let n = new_cps.len();
                let dir = (new_cps[n - 1] - new_cps[n - 2]).normalize();
                new_cps.push(new_cps[n - 1] + dir * distance);
            }

            if side == "start" || side == "both" {
                let dir = (new_cps[0] - new_cps[1]).normalize();
                new_cps.insert(0, new_cps[0] + dir * distance);
            }

            // Try to merge spans that can be merged into a single polyline
            let extended = NurbsCurve3D::polyline(&new_cps, false);
            CompoundCurve3D::try_new(vec![extended])
                .map(CompoundCurve3DJs::from)
                .map(|c| c.merge_colinear_lines(1e-3))
                .map_err(|e| JsValue::from_str(&format!("Failed to wrap extended polyline: {:?}", e)))
                
        } else {
            // Higher-degree: add a tangent line segment at the boundary
            let (t_start, t_end) = self.inner.knots_domain();
            let mut spans: Vec<NurbsCurve3D<Real>> = Vec::new();

            if side == "start" || side == "both" {
                let start_pt = self.inner.point_at(t_start);
                let start_tan = self.inner.tangent_at(t_start).normalize();
                let new_pt = start_pt - start_tan * distance;
                spans.push(NurbsCurve3D::polyline(&[new_pt, start_pt], false));
            }

            spans.push(self.inner.clone());

            if side == "end" || side == "both" {
                let end_pt = self.inner.point_at(t_end);
                let end_tan = self.inner.tangent_at(t_end).normalize();
                let new_pt = end_pt + end_tan * distance;
                spans.push(NurbsCurve3D::polyline(&[end_pt, new_pt], false));
            }

            CompoundCurve3D::try_new(spans)
                .map(CompoundCurve3DJs::from)
                .map(|c| c.merge_colinear_lines(1e-3))
                .map_err(|e| JsValue::from_str(&format!("Failed to create extended curve: {:?}", e)))
        }
    }

    /// Offset the curve by a distance in the specified corner type ('sharp','round', 'smooth').
    /// The curve must already lie in the XY plane (z = 0).
    pub fn offset(&self, distance: Real, corner_type: &str) -> Result<CompoundCurve3DJs, JsValue> {
        let corner_type = match corner_type {
            "sharp"  => CurveOffsetCornerType::Sharp,
            "round"  => CurveOffsetCornerType::Round,
            "smooth" => CurveOffsetCornerType::Smooth,
            _        => CurveOffsetCornerType::Sharp,
        };

        let curve_2d = self.cast_to_2d(1e-6)
            .map_err(|e| JsValue::from_str(&format!("Cannot offset: {}", e)))?;

        let option = CurveOffsetOption::default()
            .with_corner_type(corner_type)
            .with_distance(distance)
            .with_normal_tolerance(1e-4);

        let offset_results = curve_2d.offset(option)
            .map_err(|e| JsValue::from_str(&format!("Offset failed: {:?}", e)))?;

        let mut all_3d_spans: Vec<NurbsCurve3D<Real>> = Vec::new();
        for compound_2d in &offset_results {
            for span_2d in compound_2d.spans() {
                let span_3d = NurbsCurve3DJs::from_2d_xy(&span_2d)
                    .map_err(|e| JsValue::from_str(&e))?;
                all_3d_spans.push(span_3d.inner);
            }
        }

        if all_3d_spans.is_empty() {
            return Err(JsValue::from_str("Offset produced no curves"));
        }

        CompoundCurve3D::try_new(all_3d_spans)
            .map(CompoundCurve3DJs::from)
            .map_err(|e| JsValue::from_str(&format!("Failed to build offset result: {:?}", e)))
    }
    

    /// Offset the curve using the geo-buf / Sketch polygon offset as a fallback.
    /// Tessellates to a polyline, closes it to form a polygon, offsets via geo-buf's
    /// straight-skeleton algorithm, then returns the exterior boundary as a degree-1 curve.
    /// The curve must lie in the XY plane (z ≈ 0).
    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name = offsetGeo)]
    pub fn offset_geo(&self, distance: Real) -> Result<CompoundCurve3DJs, JsValue> {
        let pts_3d = self.inner.tessellate(Some(1e-4));
        offset_geo_sketch(&pts_3d, distance)
    }

    /// Reverse the direction of this curve (swap start/end).
    /// Returns a new reversed copy.
    pub fn reverse(&self) -> NurbsCurve3DJs {
        NurbsCurve3DJs { inner: self.inner.inverse() }
    }

    /// Rotate the curve by Euler angles (in radians) around the X, Y, and Z axes
    pub fn rotate(&self, ax: Real, ay: Real, az: Real) -> NurbsCurve3DJs {
        let rotation = Rotation3::from_euler_angles(ax, ay, az);
        // Convert 3x3 rotation to 4x4 homogeneous matrix for Curvo's Transformable
        let mat4 = rotation.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        NurbsCurve3DJs { inner: curve }
    }

    /// Rotate the curve by a unit quaternion given as components `(w, x, y, z)`.
    /// The quaternion is normalized before use.
    #[wasm_bindgen(js_name = rotateQuaternion)]
    pub fn rotate_quaternion(&self, w: Real, x: Real, y: Real, z: Real) -> NurbsCurve3DJs {
        let q = UnitQuaternion::new_normalize(Quaternion::new(w, x, y, z));
        let mat4 = q.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        NurbsCurve3DJs { inner: curve }
    }

    /// Scale the curve by factors along the X, Y, and Z axes
    pub fn scale(&self, sx: Real, sy: Real, sz: Real) -> NurbsCurve3DJs {
        #[rustfmt::skip]
        let mat4 = Matrix4::new(
            sx,   0.0,  0.0,  0.0,
            0.0,  sy,   0.0,  0.0,
            0.0,  0.0,  sz,   0.0,
            0.0,  0.0,  0.0,  1.0,
        );
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        NurbsCurve3DJs { inner: curve }
    }

    /// Translate the curve by a Vector3Js offset
    #[wasm_bindgen(js_name = translate)]
    pub fn translate(&self, offset: &Vector3Js) -> NurbsCurve3DJs {
        let v: Vector3<Real> = offset.into();
        let translation = Translation3::new(v.x, v.y, v.z);
        let mat4 = translation.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        NurbsCurve3DJs { inner: curve }
    }

    // Tessellate curve into evenly spaced points by count
    #[wasm_bindgen(js_name = tessellate)]
    pub fn tessellate(&self, tol: Option<f64>) -> Vec<Point3Js> {
        let t = tol.unwrap_or(1e-4);
        return
            self.inner.tessellate(Some(t))
            .iter()
            .map(|p| Point3Js::new(p.x as f64, p.y as f64, p.z as f64))
            .collect();
    }

    /// Check if all control points lie on a single plane
    #[wasm_bindgen(js_name = isPlanar)]
    pub fn is_planar(&self, tolerance: Option<f64>) -> bool {
        self.get_on_plane(tolerance).len() == 3
    }

    /// Get the plane the curve lies on, returned as [normal, localX, localY].
    /// Returns an empty array if the curve is not planar.
    /// Local axes are aligned to the closest global axes for consistency.
    #[wasm_bindgen(js_name = getOnPlane)]
    pub fn get_on_plane(&self, tolerance: Option<f64>) -> Vec<Vector3Js> {
        let tol = tolerance.unwrap_or(1e-6);

        // Dehomogenize control points to get 3D positions
        let pts: Vec<Point3<Real>> = self.inner.control_points().iter()
            .map(|p4| {
                let w = p4.w;
                Point3::new(p4.x / w, p4.y / w, p4.z / w)
            })
            .collect();

        if pts.len() < 3 {
            // Degenerate: default to XY plane
            return vec![
                Vector3Js::new(0.0, 0.0, 1.0),
                Vector3Js::new(1.0, 0.0, 0.0),
                Vector3Js::new(0.0, 1.0, 0.0),
            ];
        }

        let p0 = &pts[0];

        // Find a plane normal from two non-degenerate edge vectors
        let mut normal: Option<Vector3<Real>> = None;
        'outer: for i in 1..pts.len() {
            let v1 = pts[i] - p0;
            if v1.norm() < tol { continue; }
            for j in (i + 1)..pts.len() {
                let v2 = pts[j] - p0;
                let n = v1.cross(&v2);
                if n.norm() > tol {
                    normal = Some(n.normalize());
                    break 'outer;
                }
            }
        }

        // All points collinear: default normal to Z-up
        let raw_normal = normal.unwrap_or(Vector3::new(0.0, 0.0, 1.0));

        // Canonicalize direction so differently-wound versions of the same plane
        // (e.g. a curve and its offset) always return the same normal.
        // Pick the half-space where the first non-zero component is positive.
        let normal = if raw_normal.z < -tol {
            -raw_normal
        } else if raw_normal.z.abs() <= tol && raw_normal.y < -tol {
            -raw_normal
        } else if raw_normal.z.abs() <= tol && raw_normal.y.abs() <= tol && raw_normal.x < 0.0 {
            -raw_normal
        } else {
            raw_normal
        };

        // Verify all points lie on the plane
        for p in &pts {
            let v = p - p0;
            if v.dot(&normal).abs() >= tol {
                return vec![]; // Not planar
            }
        }

        // Choose local axes aligned to closest global axes
        let global_axes = [
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
        ];

        // Pick the global axis most perpendicular to the normal (largest cross product)
        let mut best_axis = global_axes[0];
        let mut best_cross_len: Real = 0.0;
        for axis in &global_axes {
            let c = axis.cross(&normal);
            let len = c.norm();
            if len > best_cross_len {
                best_cross_len = len;
                best_axis = *axis;
            }
        }

        let mut local_x = best_axis.cross(&normal).normalize();
        let mut local_y = normal.cross(&local_x).normalize();

        // Swap so that local_x is closest to global X axis
        let angle_x_to_gx = local_x.angle(&global_axes[0]);
        let angle_y_to_gx = local_y.angle(&global_axes[0]);
        if angle_x_to_gx > angle_y_to_gx {
            std::mem::swap(&mut local_x, &mut local_y);
        }

        // Make absolute for consistency (curve coords get mapped via dot products anyway)
        local_x = Vector3::new(local_x.x.abs(), local_x.y.abs(), local_x.z.abs());
        local_y = Vector3::new(local_y.x.abs(), local_y.y.abs(), local_y.z.abs());

        vec![
            Vector3Js::from(normal),
            Vector3Js::from(local_x),
            Vector3Js::from(local_y),
        ]
    }

    //// TRIM & SPLIT ////

    /// Trim the curve to the sub-curve between parameters t0 and t1.
    /// When t0 < t1, returns the "inside" portion.
    /// Returns one or more NurbsCurve3DJs segments.
    #[wasm_bindgen(js_name = trimRange)]
    pub fn trim_range(&self, t0: Real, t1: Real) -> Result<Vec<NurbsCurve3DJs>, JsValue> {
        self.inner
            .try_trim_range((t0, t1))
            .map(|curves| curves.into_iter().map(NurbsCurve3DJs::from).collect())
            .map_err(|e| JsValue::from_str(&format!("trimRange() failed: {:?}", e)))
    }

    /// Split the curve at parameter t, returning [left, right].
    #[wasm_bindgen(js_name = split)]
    pub fn split(&self, t: Real) -> Result<Vec<NurbsCurve3DJs>, JsValue> {
        self.inner
            .try_split(t)
            .map(|(a, b)| vec![NurbsCurve3DJs::from(a), NurbsCurve3DJs::from(b)])
            .map_err(|e| JsValue::from_str(&format!("split() failed: {:?}", e)))
    }

    //// INTERACTIONS WITH OTHER CURVES ////
    
    /// Find intersection points with another `NurbsCurve3DJs`.
    /// Returns the 3D intersection points.
    pub fn intersect(&self, other: &NurbsCurve3DJs) -> Result<Vec<Point3Js>, JsValue> {
        self.inner
            .find_intersection(&other.inner, None)
            .map(|its| {
                its.into_iter()
                    .map(|it| Point3Js::from(it.a().0.clone()))
                    .collect()
            })
            .map_err(|e| JsValue::from_str(&format!("intersect() failed: {:?}", e)))
    }

    /// Find intersection points with a `CompoundCurve3DJs`.
    /// Intersects `self` against each span of the compound curve.
    /// Returns the 3D intersection points.
    #[wasm_bindgen(js_name = intersectCompound)]
    pub fn intersect_compound(&self, other: &CompoundCurve3DJs) -> Result<Vec<Point3Js>, JsValue> {
        let mut results: Vec<Point3Js> = Vec::new();

        for span in other.inner.spans() {
            let its = self.inner
                .find_intersection(span, None)
                .map_err(|e| JsValue::from_str(&format!("intersectCompound() failed on span: {:?}", e)))?;

            for it in its {
                results.push(Point3Js::from(it.a().0.clone()));
            }
        }

        Ok(results)
    }

    //// BOOLEAN OPERATIONS ////

    /// Perform a boolean operation (union / intersection / difference) with another NurbsCurve3D.
    /// Both curves must be planar and coplanar. The operation is performed in 2D
    /// and the result is projected back to 3D.
    /// Returns BooleanRegionJs results containing exterior curves and interior holes.
    #[wasm_bindgen(js_name = booleanCurve)]
    pub fn boolean_curve(&self, other: &NurbsCurve3DJs, operation: &str) -> Result<Vec<BooleanRegionJs>, JsValue> {
        let op = parse_boolean_operation(operation)?;
        let (origin, local_x, local_y) = get_plane_from_nurbs(self)?;

        let mut self_2d = self.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;
        let mut other_2d = other.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;

        ensure_closed_nurbs_2d(&mut self_2d, 1e-8);
        ensure_closed_nurbs_2d(&mut other_2d, 1e-8);

        robust_boolean_regions(
            |jit| self_2d
                .boolean(op, &perturb_nurbs_2d(&other_2d, jit), Some(default_solver_options()))
                .map_err(|e| format!("{:?}", e)),
            || geo_boolean_fallback(
                &nurbs2d_ring(&self_2d, GEO_TESS_TOL),
                &nurbs2d_ring(&other_2d, GEO_TESS_TOL),
                op, &origin, &local_x, &local_y,
            ),
            &origin,
            &local_x,
            &local_y,
            "Curve",
        )
    }

    /// Perform a boolean operation (union / intersection / difference) with a CompoundCurve3D.
    /// Both curves must be planar and coplanar. The operation is performed in 2D
    /// and the result is projected back to 3D.
    /// Returns BooleanRegionJs results containing exterior curves and interior holes.
    #[wasm_bindgen(js_name = booleanCompoundCurve)]
    pub fn boolean_compound_curve(&self, other: &CompoundCurve3DJs, operation: &str) -> Result<Vec<BooleanRegionJs>, JsValue> {
        let op = parse_boolean_operation(operation)?;
        let (origin, local_x, local_y) = get_plane_from_nurbs(self)?;

        let mut self_2d = self.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;
        let other_2d = other.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;

        ensure_closed_nurbs_2d(&mut self_2d, 1e-8);
        let other_2d = ensure_closed_compound_2d(other_2d, 1e-8)
            .map_err(|e| JsValue::from_str(&e))?;

        // Wrap single NurbsCurve2D into a CompoundCurve2D so we can use compound vs compound boolean
        let self_compound_2d = CompoundCurve2D::try_new(vec![self_2d])
            .map_err(|e| JsValue::from_str(&format!("Failed to wrap curve as compound: {:?}", e)))?;

        robust_boolean_regions(
            |jit| {
                let cand = perturb_compound_2d(&other_2d, jit)?;
                self_compound_2d
                    .boolean(op, &cand, Some(default_solver_options()))
                    .map_err(|e| format!("{:?}", e))
            },
            || geo_boolean_fallback(
                &compound2d_ring(&self_compound_2d, GEO_TESS_TOL),
                &compound2d_ring(&other_2d, GEO_TESS_TOL),
                op, &origin, &local_x, &local_y,
            ),
            &origin,
            &local_x,
            &local_y,
            "CompoundCurve",
        )
    }

    // -----------------------------------------------------------------------
    // Surface creation
    // -----------------------------------------------------------------------

    /// Extrude this curve along a direction vector to create a `NurbsSurfaceJs`.
    pub fn extrude(&self, direction: &Vector3Js) -> NurbsSurfaceJs {
        let v: Vector3<Real> = direction.into();
        NurbsSurfaceJs { inner: NurbsSurface3D::extrude(&self.inner, &v) }
    }

    /// Extrude this curve along XYZ components to create a `NurbsSurfaceJs`.
    #[wasm_bindgen(js_name = extrudeComponents)]
    pub fn extrude_components(&self, dx: Real, dy: Real, dz: Real) -> NurbsSurfaceJs {
        NurbsSurfaceJs { inner: NurbsSurface3D::extrude(&self.inner, &Vector3::new(dx, dy, dz)) }
    }

    /// Sweep this curve (as profile) along a `rail` curve to create a `NurbsSurfaceJs`.
    ///
    /// # Arguments
    /// * `rail`     – the path curve
    /// * `degree_v` – optional degree for the sweep direction
    pub fn sweep(&self, rail: &NurbsCurve3DJs, degree_v: Option<usize>) -> Result<NurbsSurfaceJs, JsValue> {
        NurbsSurface3D::try_sweep(&self.inner, &rail.inner, degree_v)
            .map(|s| NurbsSurfaceJs { inner: s })
            .map_err(|e| JsValue::from_str(&format!("sweep() failed: {:?}", e)))
    }

    /// Loft through an ordered array of curves to create a `NurbsSurfaceJs`.
    ///
    /// Static method — call as `NurbsCurve3DJs.loft(curves, degreeV?)`.
    ///
    /// # Arguments
    /// * `curves`   – ordered array of profile curves
    /// * `degree_v` – optional degree for the loft direction
    pub fn loft(curves: Vec<NurbsCurve3DJs>, degree_v: Option<usize>) -> Result<NurbsSurfaceJs, JsValue> {
        let inner_curves: Vec<NurbsCurve3D<Real>> = curves.into_iter().map(|c| c.inner).collect();
        NurbsSurface3D::try_loft(&inner_curves, degree_v)
            .map(|s| NurbsSurfaceJs { inner: s })
            .map_err(|e| JsValue::from_str(&format!("loft() failed: {:?}", e)))
    }

}

///// NURBSCURVE3DJS NON-WASM  ////


impl NurbsCurve3DJs {
    /// Project this 3D NURBS curve onto a 2D plane, producing a NurbsCurve2D.
    /// The plane is defined by an origin point and two orthonormal axis vectors (localX, localY).
    /// Each 3D control point is projected to 2D via dot products with the local axes.
    /// Degree, knots, and weights are preserved.
    pub(crate) fn project_to_2d(&self, origin: &Point3<Real>, local_x: &Vector3<Real>, local_y: &Vector3<Real>) -> Result<NurbsCurve2D<Real>, String> {
        let o = origin;
        let lx = local_x;
        let ly = local_y;

        // Project each homogeneous 3D control point (Point4: x*w, y*w, z*w, w) to homogeneous 2D (Point3: x*w, y*w, w)
        let control_points_2d: Vec<Point3<Real>> = self.inner.control_points().iter()
            .map(|p4| {
                let w = p4.w;
                // Dehomogenize to get the actual 3D coordinates
                let p3 = Point3::new(p4.x / w, p4.y / w, p4.z / w);
                let diff = p3 - o;
                let x_2d = diff.dot(lx);
                let y_2d = diff.dot(ly);
                // Re-homogenize for 2D: (x*w, y*w, w)
                Point3::new(x_2d * w, y_2d * w, w)
            })
            .collect();

        let degree = self.inner.degree();
        let knots = self.inner.knots().to_vec();

        NurbsCurve2D::try_new(degree, control_points_2d, knots)
            .map_err(|e| format!("Failed to project curve to 2D: {:?}", e))
    }

    /// Cast a 3D NURBS curve that already lies in the XY plane (z ≈ 0) to a NurbsCurve2D
    /// by simply dropping the Z homogeneous component.
    /// Returns an error if any control point has |z| > tol.
    pub(crate) fn cast_to_2d(&self, tol: Real) -> Result<NurbsCurve2D<Real>, String> {
        for p4 in self.inner.control_points() {
            let z = p4.z / p4.w;
            if z.abs() > tol {
                return Err(format!("cast_to_2d: curve is not in XY plane — control point z = {:.6}", z));
            }
        }
        // Drop Z: Point4(x*w, y*w, z*w, w) → Point3(x*w, y*w, w)
        let cps_2d: Vec<Point3<Real>> = self.inner.control_points().iter()
            .map(|p4| Point3::new(p4.x, p4.y, p4.w))
            .collect();
        NurbsCurve2D::try_new(self.inner.degree(), cps_2d, self.inner.knots().to_vec())
            .map_err(|e| format!("cast_to_2d: failed to construct NurbsCurve2D: {:?}", e))
    }

    /// Construct a 3D NURBS curve from a 2D curve by adding z = 0 to every control point.
    #[allow(dead_code)]
    pub(crate) fn from_2d_xy(curve_2d: &NurbsCurve2D<Real>) -> Result<NurbsCurve3DJs, String> {
        // Point3(x*w, y*w, w) → Point4(x*w, y*w, 0, w)
        let cps_3d: Vec<Point4<Real>> = curve_2d.control_points().iter()
            .map(|p3| Point4::new(p3.x, p3.y, 0.0, p3.z))
            .collect();
        NurbsCurve3D::try_new(curve_2d.degree(), cps_3d, curve_2d.knots().to_vec())
            .map(|c| NurbsCurve3DJs { inner: c })
            .map_err(|e| format!("from_2d_xy: failed to construct NurbsCurve3D: {:?}", e))
    }

    /// Reconstruct a 3D NURBS curve from a 2D curve and its projection plane.
    /// This is the inverse of `project_to_2d`: given a NurbsCurve2D and the plane
    /// (origin + localX + localY) it was projected onto, map each 2D control point
    /// back to 3D space.
    pub(crate) fn from_2d(curve_2d: &NurbsCurve2D<Real>, origin: &Point3<Real>, local_x: &Vector3<Real>, local_y: &Vector3<Real>) -> Result<NurbsCurve3DJs, String> {
        let o = origin;
        let lx = local_x;
        let ly = local_y;

        // Map each 2D homogeneous control point (Point3: x*w, y*w, w) back to 3D homogeneous (Point4: x*w, y*w, z*w, w)
        let control_points_3d: Vec<Point4<Real>> = curve_2d.control_points().iter()
            .map(|p3| {
                let w = p3.z;
                let x_2d = p3.x / w;
                let y_2d = p3.y / w;
                // Reconstruct the 3D point on the plane
                let p = o + lx * x_2d + ly * y_2d;
                Point4::new(p.x * w, p.y * w, p.z * w, w)
            })
            .collect();

        let degree = curve_2d.degree();
        let knots = curve_2d.knots().to_vec();

        NurbsCurve3D::try_new(degree, control_points_3d, knots)
            .map(|c| NurbsCurve3DJs { inner: c })
            .map_err(|e| format!("Failed to project curve to 3D: {:?}", e))
    }
}


impl From<NurbsCurve3D<Real>> for NurbsCurve3DJs {
    fn from(curve: NurbsCurve3D<Real>) -> Self {
        NurbsCurve3DJs { inner: curve }
    }
}


//// BOOLEAN REGION JS ////

/// Result of a boolean operation: an exterior boundary curve with zero or more interior hole curves.
/// Each region from a Clip result is represented as one BooleanRegionJs.
#[wasm_bindgen]
pub struct BooleanRegionJs {
    exterior: CompoundCurve3D<Real>,
    holes: Vec<CompoundCurve3D<Real>>,
}

#[wasm_bindgen]
impl BooleanRegionJs {
    /// Get the exterior boundary curve of this region
    #[wasm_bindgen(getter)]
    pub fn exterior(&self) -> CompoundCurve3DJs {
        CompoundCurve3DJs { inner: self.exterior.clone() }
    }

    /// Get the interior hole curves of this region
    #[wasm_bindgen(getter)]
    pub fn holes(&self) -> Vec<CompoundCurve3DJs> {
        self.holes.iter().map(|h| CompoundCurve3DJs { inner: h.clone() }).collect()
    }

    /// Number of interior holes
    #[wasm_bindgen(js_name = holeCount)]
    pub fn hole_count(&self) -> usize {
        self.holes.len()
    }

    /// Whether this region has any interior holes
    #[wasm_bindgen(js_name = hasHoles)]
    pub fn has_holes(&self) -> bool {
        !self.holes.is_empty()
    }
}

//// COMPOUNDCURVE3DJS ////

// A composite curve made of separate NurbsCurve3DJs (called spans)

#[wasm_bindgen]
pub struct CompoundCurve3DJs 
{
    pub(crate) inner: CompoundCurve3D<Real>,
}

#[wasm_bindgen]
impl CompoundCurve3DJs 
{
    #[wasm_bindgen(constructor)]
    pub fn new(spans: Vec<NurbsCurve3DJs>) -> Result<CompoundCurve3DJs, JsValue>
    {
        match CompoundCurve3D::try_new(spans.into_iter().map(|s| s.inner).collect()) 
        {
            Ok(curve) => Ok(Self { inner: curve }),
            Err(e) => Err(JsValue::from_str(&format!("Failed to create Compound NURBS curve: {:?}", e)))
        }
    }

    pub fn clone(&self) -> Self {
        Self { inner: self.inner.clone() }
    }

    /// PROPERTIES ///

    pub fn spans(&self) -> Vec<NurbsCurve3DJs> 
    {
        self.inner.clone().into_spans().iter()
            .map(|s| NurbsCurve3DJs::from(s.clone()))
            .collect()
    }

    /// Get all unique control points across all spans
    #[wasm_bindgen(js_name = controlPoints)]
    pub fn control_points(&self) -> Vec<Point3Js> 
    {
        let spans = self.inner.clone().into_spans();
        let mut points: Vec<Point3Js> = Vec::new();

        for (i, span) in spans.iter().enumerate() {
            let pts = span.control_points();
            // Skip the first point of subsequent spans to avoid duplicates at joins
            let start = if i == 0 { 0 } else { 1 };
            for p in &pts[start..] {
                points.push(Point3Js::new(p.x as f64, p.y as f64, p.z as f64));
            }
        }

        points
    }

    #[wasm_bindgen(js_name = knotsDomain)]
    pub fn knots_domain(&self) -> Vec<Real> {
        let domain = self.inner.knots_domain();
        vec![domain.0, domain.1]
    }

    pub fn find_span(&self, param: Real) -> NurbsCurve3DJs {
        NurbsCurve3DJs { inner: self.inner.find_span(param).clone() }
    }

    //// CALCULATED PROPERTIES ////

    pub fn length(&self) -> Real {
        self.inner.try_length()
            .expect("Failed to compute curve length")
    }

    pub fn closed(&self, tol: Option<Real>) -> bool {
        let t = tol.unwrap_or(1e-4);
        self.inner.is_closed(Some(t))
    }

    #[wasm_bindgen(js_name = closestPoint)]
    pub fn closest_point(&self, point: &Point3Js) -> Result<Point3Js, JsValue> {
        match self.inner.find_closest_point(&point.inner) {
            Ok(p) => Ok(Point3Js::from(p)),
            Err(e) => Err(JsValue::from_str(&format!("Can't get closest point: {:?}", e)))
        }
    }

    /// Get the point at given parameter
    #[wasm_bindgen(js_name = pointAtParam)]
    pub fn point_at_param(&self, param: Real) -> Point3Js {
        Point3Js::from(self.inner.point_at(param))
    }

    // Get tangent at given parameter
    #[wasm_bindgen(js_name = tangentAt)]
    pub fn tangent_at(&self, param: Real) -> Vector3Js {
        Vector3Js::from(self.inner.tangent_at(param))
    }

    pub fn bbox(&self) -> Vec<Point3Js> {
        let bbox = BoundingBox::from(&self.inner);
        let min = bbox.min();
        let max = bbox.max();
        vec![
            Point3Js::new(min.x as f64, min.y as f64, min.z as f64),
            Point3Js::new(max.x as f64, max.y as f64, max.z as f64),
        ]
    }
    

    //// OPERATIONS ////
    
    /// Reverse the direction of the compound curve (swap start/end).
    /// Returns a new reversed copy.
    pub fn reverse(&self) -> CompoundCurve3DJs {
        CompoundCurve3DJs { inner: self.inner.inverse() }
    }

    /// Translate the compound curve by a Vector3Js offset
    #[wasm_bindgen(js_name = translate)]
    pub fn translate(&self, offset: &Vector3Js) -> CompoundCurve3DJs {
        let v: Vector3<Real> = offset.into();
        let translation = Translation3::new(v.x, v.y, v.z);
        let mat4 = translation.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        CompoundCurve3DJs { inner: curve }
    }

    /// Rotate the compound curve by Euler angles (in radians) around the X, Y, and Z axes
    pub fn rotate(&self, ax: Real, ay: Real, az: Real) -> CompoundCurve3DJs {
        let rotation = Rotation3::from_euler_angles(ax, ay, az);
        let mat4 = rotation.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        CompoundCurve3DJs { inner: curve }
    }

    /// Rotate the compound curve by a unit quaternion given as components `(w, x, y, z)`.
    /// The quaternion is normalized before use.
    #[wasm_bindgen(js_name = rotateQuaternion)]
    pub fn rotate_quaternion(&self, w: Real, x: Real, y: Real, z: Real) -> CompoundCurve3DJs {
        let q = UnitQuaternion::new_normalize(Quaternion::new(w, x, y, z));
        let mat4 = q.to_homogeneous();
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        CompoundCurve3DJs { inner: curve }
    }

    /// Scale the compound curve by factors along the X, Y, and Z axes
    pub fn scale(&self, sx: Real, sy: Real, sz: Real) -> CompoundCurve3DJs {
        #[rustfmt::skip]
        let mat4 = Matrix4::new(
            sx,   0.0,  0.0,  0.0,
            0.0,  sy,   0.0,  0.0,
            0.0,  0.0,  sz,   0.0,
            0.0,  0.0,  0.0,  1.0,
        );
        let mut curve = self.inner.clone();
        curve.transform(&mat4);
        CompoundCurve3DJs { inner: curve }
    }

    /// Tessellate curve into evenly spaced points by count
    #[wasm_bindgen(js_name = tessellate)]
    pub fn tessellate(&self, tol: Option<f64>) -> Vec<Point3Js> {
        let t = tol.unwrap_or(1e-4);
        return
            self.inner.tessellate(Some(t))
            .iter()
            .map(|p| Point3Js::new(p.x as f64, p.y as f64, p.z as f64))
            .collect();
    }

    /// Offset the compound curve by a distance with the specified corner type ('sharp','round','smooth').
    /// The curve must already lie in the XY plane (z = 0).
    pub fn offset(&self, distance: Real, corner_type: &str) -> Result<CompoundCurve3DJs, JsValue> {
        let corner_type_enum = match corner_type {
            "sharp"  => CurveOffsetCornerType::Sharp,
            "round"  => CurveOffsetCornerType::Round,
            "smooth" => CurveOffsetCornerType::Smooth,
            _        => CurveOffsetCornerType::Sharp,
        };

        let compound_2d = self.cast_to_2d(1e-6)
            .map_err(|e| JsValue::from_str(&format!("Cannot offset: {}", e)))?;

        let option = CurveOffsetOption::default()
            .with_corner_type(corner_type_enum)
            .with_distance(distance)
            .with_normal_tolerance(1e-4);

        let offset_results = compound_2d.offset(option)
            .map_err(|e| JsValue::from_str(&format!("Offset failed: {:?}", e)))?;

        let mut all_3d_spans: Vec<NurbsCurve3D<Real>> = Vec::new();
        for compound_2d in &offset_results {
            for span_2d in compound_2d.spans() {
                let span_3d = NurbsCurve3DJs::from_2d_xy(&span_2d)
                    .map_err(|e| JsValue::from_str(&e))?;
                all_3d_spans.push(span_3d.inner);
            }
        }

        if all_3d_spans.is_empty() {
            return Err(JsValue::from_str("Offset produced no curves"));
        }

        CompoundCurve3D::try_new(all_3d_spans)
            .map(CompoundCurve3DJs::from)
            .map_err(|e| JsValue::from_str(&format!("Failed to build offset result: {:?}", e)))
    }

    /// Offset the compound curve using the geo-buf / Sketch polygon offset as a fallback.
    /// Tessellates to a polyline, closes it to form a polygon, offsets via geo-buf's
    /// straight-skeleton algorithm, then returns the exterior boundary as a degree-1 curve.
    /// The curve must lie in the XY plane (z ≈ 0).
    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name = offsetGeo)]
    pub fn offset_geo(&self, distance: Real) -> Result<CompoundCurve3DJs, JsValue> {
        let pts_3d = self.inner.tessellate(Some(1e-4));
        offset_geo_sketch(&pts_3d, distance)
    }

    /// Merge consecutive collinear degree-1 spans into single polyline spans.
    ///
    /// Walks through all spans and checks if consecutive degree-1 spans share
    /// the same direction (within a small angular tolerance). Collinear runs are
    /// collapsed into one polyline keeping only start and end points. Non-degree-1
    /// spans and non-collinear degree-1 spans are preserved unchanged.
    ///
    /// Always returns a `CompoundCurve3DJs`.
    #[wasm_bindgen(js_name = mergeColinearLines)]
    pub fn merge_colinear_lines(&self, colinear_tol: Real) -> CompoundCurve3DJs {
        let spans: Vec<NurbsCurve3D<Real>> = self.inner.clone().into_spans();

        if spans.is_empty() {
            return self.clone();
        }

        // If any span is not degree-1, return unchanged
        if spans.iter().any(|s| s.degree() != 1) {
            return self.clone();
        }

        let colinear_tol: Real = colinear_tol;

        fn point_eq(a: &Point3<Real>, b: &Point3<Real>, eps: Real) -> bool {
            (*a - *b).norm() <= eps
        }

        fn unit_dir(from: Point3<Real>, to: Point3<Real>) -> Option<Vector3<Real>> {
            let d = to - from;
            let len = d.norm();
            if len < 1e-12 { None } else { Some(d / len) }
        }

        fn simplify_polyline_points(cps: &[Point3<Real>], tol: Real) -> Vec<Point3<Real>> {
            if cps.len() <= 2 {
                return cps.to_vec();
            }

            let mut out: Vec<Point3<Real>> = Vec::with_capacity(cps.len());
            out.push(cps[0]);

            for i in 1..(cps.len() - 1) {
                let prev = *out.last().unwrap();
                let curr = cps[i];
                let next = cps[i + 1];

                let d1 = unit_dir(prev, curr);
                let d2 = unit_dir(curr, next);

                let keep = match (d1, d2) {
                    (Some(a), Some(b)) => (a.dot(&b) - 1.0).abs() >= tol,
                    _ => true,
                };

                if keep {
                    out.push(curr);
                }
            }

            out.push(cps[cps.len() - 1]);
            out
        }

        fn start_dir(span: &NurbsCurve3D<Real>) -> Option<Vector3<Real>> {
            let cps = span.dehomogenized_control_points();
            if cps.len() < 2 {
                None
            } else {
                unit_dir(cps[0], cps[1])
            }
        }

        fn end_dir(span: &NurbsCurve3D<Real>) -> Option<Vector3<Real>> {
            let cps = span.dehomogenized_control_points();
            let n = cps.len();
            if n < 2 {
                None
            } else {
                unit_dir(cps[n - 2], cps[n - 1])
            }
        }

        // First simplify each degree-1 span itself (removes redundant colinear interior points).
        let simplified_spans: Vec<NurbsCurve3D<Real>> = spans
            .into_iter()
            .map(|s| {
                let cps = s.dehomogenized_control_points();
                let simplified = simplify_polyline_points(&cps, colinear_tol);
                NurbsCurve3D::polyline(&simplified, false)
            })
            .collect();

        // Build groups of collinear and connected consecutive spans.
        let mut groups: Vec<Vec<usize>> = vec![vec![0]];
        for i in 1..simplified_spans.len() {
            let prev = &simplified_spans[i - 1];
            let curr = &simplified_spans[i];

            let prev_cps = prev.dehomogenized_control_points();
            let curr_cps = curr.dehomogenized_control_points();
            let connected = !prev_cps.is_empty()
                && !curr_cps.is_empty()
                && point_eq(&prev_cps[prev_cps.len() - 1], &curr_cps[0], 1e-9);

            let collinear = match (end_dir(prev), start_dir(curr)) {
                (Some(a), Some(b)) => (a.dot(&b) - 1.0).abs() < colinear_tol,
                _ => false,
            };

            if connected && collinear {
                groups.last_mut().unwrap().push(i);
            } else {
                groups.push(vec![i]);
            }
        }

        // Build merged spans from groups by concatenating polyline points.
        let mut merged_spans: Vec<NurbsCurve3D<Real>> = Vec::new();
        for group in &groups {
            let mut pts: Vec<Point3<Real>> = Vec::new();

            for (k, idx) in group.iter().enumerate() {
                let cps = simplified_spans[*idx].dehomogenized_control_points();
                if cps.is_empty() {
                    continue;
                }

                if k == 0 {
                    pts.extend(cps);
                } else if !pts.is_empty() {
                    let skip_first = point_eq(&pts[pts.len() - 1], &cps[0], 1e-9);
                    if skip_first {
                        pts.extend(cps.into_iter().skip(1));
                    } else {
                        pts.extend(cps);
                    }
                }
            }

            if pts.len() >= 2 {
                let simplified_pts = simplify_polyline_points(&pts, colinear_tol);
                merged_spans.push(NurbsCurve3D::polyline(&simplified_pts, false));
            }
        }

        if merged_spans.is_empty() {
            return self.clone();
        }

        match CompoundCurve3D::try_new(merged_spans) {
            Ok(compound) => CompoundCurve3DJs::from(compound),
            Err(_) => self.clone(),
        }
    }

    /// Extend the compound curve at one or both ends.
    ///
    /// - **Degree-1 boundary spans** are extended inline (new control point).
    /// - **Higher-degree boundary spans** get a tangent line segment prepended/appended.
    ///
    /// # Arguments
    /// * `distance` – how far to extend (world units)
    /// * `side`     – `"end"` (default), `"start"`, or `"both"`
    pub fn extend(&self, distance: Real, side: Option<String>) -> Result<CompoundCurve3DJs, JsValue> {
        let side_str = side.as_deref().unwrap_or("end").to_string();

        let mut spans: Vec<NurbsCurve3D<Real>> = self.inner.clone().into_spans();

        if spans.is_empty() {
            return Err(JsValue::from_str("Cannot extend an empty compound curve"));
        }

        // Extend at start
        if side_str == "start" || side_str == "both" {
            let first = &spans[0];
            if first.degree() == 1 {
                let cps: Vec<Point3<Real>> = first.dehomogenized_control_points();
                if cps.len() >= 2 {
                    let dir = (cps[0] - cps[1]).normalize();
                    let mut new_cps = cps;
                    new_cps.insert(0, new_cps[0] + dir * distance);
                    spans[0] = NurbsCurve3D::polyline(&new_cps, false);
                }
            } else {
                let (t_start, _) = first.knots_domain();
                let start_pt = first.point_at(t_start);
                let start_tan = first.tangent_at(t_start).normalize();
                let new_pt = start_pt - start_tan * distance;
                spans.insert(0, NurbsCurve3D::polyline(&[new_pt, start_pt], false));
            }
        }

        // Extend at end
        if side_str == "end" || side_str == "both" {
            let last = spans.last().unwrap().clone();
            if last.degree() == 1 {
                let cps: Vec<Point3<Real>> = last.dehomogenized_control_points();
                let n = cps.len();
                if n >= 2 {
                    let dir = (cps[n - 1] - cps[n - 2]).normalize();
                    let mut new_cps = cps;
                    new_cps.push(new_cps[n - 1] + dir * distance);
                    *spans.last_mut().unwrap() = NurbsCurve3D::polyline(&new_cps, false);
                }
            } else {
                let (_, t_end) = last.knots_domain();
                let end_pt = last.point_at(t_end);
                let end_tan = last.tangent_at(t_end).normalize();
                let new_pt = end_pt + end_tan * distance;
                spans.push(NurbsCurve3D::polyline(&[end_pt, new_pt], false));
            }
        }

        CompoundCurve3D::try_new(spans)
            .map(CompoundCurve3DJs::from)
            .map(|c| c.merge_colinear_lines(1e-3))
            .map_err(|e| JsValue::from_str(&format!(
                "Failed to rebuild compound curve after extend: {:?}", e
            )))
    }

    //// TRIM & SPLIT ////

    /// Trim the compound curve to the sub-curve between parameters t0 and t1.
    /// Parameters are in the compound curve's global knot domain.
    /// Returns one or more NurbsCurve3DJs segments.
    #[wasm_bindgen(js_name = trimRange)]
    pub fn trim_range(&self, t0: Real, t1: Real) -> Result<Vec<NurbsCurve3DJs>, JsValue> {
        self.inner
            .try_trim_range((t0, t1))
            .map(|curves| curves.into_iter().map(NurbsCurve3DJs::from).collect())
            .map_err(|e| JsValue::from_str(&format!("trimRange() failed: {:?}", e)))
    }

    /// Split the compound curve at parameter t, returning [left, right] as CompoundCurve3DJs.
    #[wasm_bindgen(js_name = split)]
    pub fn split(&self, t: Real) -> Result<Vec<CompoundCurve3DJs>, JsValue> {
        self.inner
            .try_split(t)
            .map(|(a, b)| vec![CompoundCurve3DJs::from(a), CompoundCurve3DJs::from(b)])
            .map_err(|e| JsValue::from_str(&format!("split() failed: {:?}", e)))
    }

    /// Find the closest parameter on this compound curve to the given point.
    /// Iterates over all spans and returns the parameter with the minimum distance.
    #[wasm_bindgen(js_name = paramClosestToPoint)]
    pub fn param_closest_to_point(&self, point: &Point3Js) -> Result<Real, JsValue> {
        let mut best_param: Option<Real> = None;
        let mut best_dist_sq = Real::MAX;

        for span in self.inner.spans() {
            if let Ok(param) = span.find_closest_parameter(&point.inner) {
                let pt = span.point_at(param);
                let dist_sq = (pt - point.inner).norm_squared();
                if dist_sq < best_dist_sq {
                    best_dist_sq = dist_sq;
                    best_param = Some(param);
                }
            }
        }

        best_param.ok_or_else(|| JsValue::from_str("paramClosestToPoint: no spans could compute closest parameter"))
    }

    //// INTERACTIONS WITH OTHER CURVES ////
    
    /// Find intersection points with a `NurbsCurve3DJs`.
    /// Intersects each span of `self` against `other`.
    /// Returns the 3D intersection points.
    pub fn intersect(&self, other: &NurbsCurve3DJs) -> Result<Vec<Point3Js>, JsValue> {
        let mut results: Vec<Point3Js> = Vec::new();
        for span in self.inner.spans() {
            let its = span
                .find_intersection(&other.inner, None)
                .map_err(|e| JsValue::from_str(&format!("intersect() failed on span: {:?}", e)))?;
            for it in its {
                results.push(Point3Js::from(it.a().0.clone()));
            }
        }
        Ok(results)
    }

    /// Find intersection points with another `CompoundCurve3DJs`.
    /// Intersects each span of `self` against each span of `other`.
    /// Returns the 3D intersection points.
    #[wasm_bindgen(js_name = intersectCompound)]
    pub fn intersect_compound(&self, other: &CompoundCurve3DJs) -> Result<Vec<Point3Js>, JsValue> {
        let mut results: Vec<Point3Js> = Vec::new();
        for span_a in self.inner.spans() {
            for span_b in other.inner.spans() {
                let its = span_a
                    .find_intersection(span_b, None)
                    .map_err(|e| JsValue::from_str(&format!("intersectCompound() failed on span pair: {:?}", e)))?;
                for it in its {
                    results.push(Point3Js::from(it.a().0.clone()));
                }
            }
        }
        Ok(results)
    }

    //// BOOLEAN OPERATIONS ////

    /// Perform a boolean operation (union / intersection / difference) with a NurbsCurve3D.
    /// Both curves must be planar and coplanar. The operation is performed in 2D
    /// and the result is projected back to 3D.
    /// Returns BooleanRegionJs results containing exterior curves and interior holes.
    #[wasm_bindgen(js_name = booleanCurve)]
    pub fn boolean_curve(&self, other: &NurbsCurve3DJs, operation: &str) -> Result<Vec<BooleanRegionJs>, JsValue> {
        let op = parse_boolean_operation(operation)?;
        let (origin, local_x, local_y) = get_plane_from_compound(self)?;

        let self_2d = self.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;
        let mut other_2d = other.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;

        let self_2d = ensure_closed_compound_2d(self_2d, 1e-8)
            .map_err(|e| JsValue::from_str(&e))?;
        ensure_closed_nurbs_2d(&mut other_2d, 1e-8);

        robust_boolean_regions(
            |jit| self_2d
                .boolean(op, &perturb_nurbs_2d(&other_2d, jit), Some(default_solver_options()))
                .map_err(|e| format!("{:?}", e)),
            || geo_boolean_fallback(
                &compound2d_ring(&self_2d, GEO_TESS_TOL),
                &nurbs2d_ring(&other_2d, GEO_TESS_TOL),
                op, &origin, &local_x, &local_y,
            ),
            &origin,
            &local_x,
            &local_y,
            "Curve",
        )
    }

    /// Perform a boolean operation (union / intersection / difference) with another CompoundCurve3D.
    /// Both curves must be planar and coplanar. The operation is performed in 2D
    /// and the result is projected back to 3D.
    /// Returns BooleanRegionJs results containing exterior curves and interior holes.
    #[wasm_bindgen(js_name = booleanCompoundCurve)]
    pub fn boolean_compound_curve(&self, other: &CompoundCurve3DJs, operation: &str) -> Result<Vec<BooleanRegionJs>, JsValue> {
        let op = parse_boolean_operation(operation)?;
        let (origin, local_x, local_y) = get_plane_from_compound(self)?;

        let self_2d = self.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;
        let other_2d = other.project_to_2d(&origin, &local_x, &local_y)
            .map_err(|e| JsValue::from_str(&e))?;

        let self_2d = ensure_closed_compound_2d(self_2d, 1e-8)
            .map_err(|e| JsValue::from_str(&e))?;
        let other_2d = ensure_closed_compound_2d(other_2d, 1e-8)
            .map_err(|e| JsValue::from_str(&e))?;

        robust_boolean_regions(
            |jit| {
                let cand = perturb_compound_2d(&other_2d, jit)?;
                self_2d
                    .boolean(op, &cand, Some(default_solver_options()))
                    .map_err(|e| format!("{:?}", e))
            },
            || geo_boolean_fallback(
                &compound2d_ring(&self_2d, GEO_TESS_TOL),
                &compound2d_ring(&other_2d, GEO_TESS_TOL),
                op, &origin, &local_x, &local_y,
            ),
            &origin,
            &local_x,
            &local_y,
            "CompoundCurve",
        )
    }

    // -----------------------------------------------------------------------
    // Surface creation
    // -----------------------------------------------------------------------

    /// Extrude each span of this compound curve along a direction vector.
    ///
    /// Returns one `NurbsSurfaceJs` per span. The surfaces share boundaries at
    /// span junctions and together form a continuous ruled solid.
    pub fn extrude(&self, direction: &Vector3Js) -> Vec<NurbsSurfaceJs> {
        let v: Vector3<Real> = direction.into();
        self.inner.spans()
            .iter()
            .map(|span| NurbsSurfaceJs { inner: NurbsSurface3D::extrude(span, &v) })
            .collect()
    }

    /// Extrude each span of this compound curve along XYZ components.
    ///
    /// Returns one `NurbsSurfaceJs` per span.
    #[wasm_bindgen(js_name = extrudeComponents)]
    pub fn extrude_components(&self, dx: Real, dy: Real, dz: Real) -> Vec<NurbsSurfaceJs> {
        let v = Vector3::new(dx, dy, dz);
        self.inner.spans()
            .iter()
            .map(|span| NurbsSurfaceJs { inner: NurbsSurface3D::extrude(span, &v) })
            .collect()
    }
}

// COMPOUND CURVE3D JS - NON-WASM
impl CompoundCurve3DJs {
    /// Cast a compound curve that already lies in the XY plane (z ≈ 0) to a CompoundCurve2D.
    /// Each span is cast individually via NurbsCurve3DJs::cast_to_2d.
    pub(crate) fn cast_to_2d(&self, tol: Real) -> Result<CompoundCurve2D<Real>, String> {
        let spans_2d: Vec<NurbsCurve2D<Real>> = self.inner.clone().into_spans().iter()
            .enumerate()
            .map(|(i, span)| {
                NurbsCurve3DJs { inner: span.clone() }
                    .cast_to_2d(tol)
                    .map_err(|e| format!("span {}: {}", i, e))
            })
            .collect::<Result<_, _>>()?;

        CompoundCurve2D::try_new(spans_2d)
            .map_err(|e| format!("cast_to_2d: failed to construct CompoundCurve2D: {:?}", e))
    }

    /// Construct a 3D compound curve from a 2D compound curve by adding z = 0 to every span.
    #[allow(dead_code)]
    pub(crate) fn from_2d_xy(compound_2d: &CompoundCurve2D<Real>) -> Result<CompoundCurve3DJs, String> {
        let spans_3d: Vec<NurbsCurve3D<Real>> = compound_2d.spans().iter()
            .enumerate()
            .map(|(i, span_2d)| {
                NurbsCurve3DJs::from_2d_xy(span_2d)
                    .map(|c| c.inner)
                    .map_err(|e| format!("span {}: {}", i, e))
            })
            .collect::<Result<_, _>>()?;

        CompoundCurve3D::try_new(spans_3d)
            .map(CompoundCurve3DJs::from)
            .map_err(|e| format!("from_2d_xy: failed to construct CompoundCurve3D: {:?}", e))
    }

    /// Project this 3D compound curve onto a 2D plane, producing a CompoundCurve2D.
    /// Each span is projected individually and then combined.
    pub(crate) fn project_to_2d(&self, origin: &Point3<Real>, local_x: &Vector3<Real>, local_y: &Vector3<Real>) -> Result<CompoundCurve2D<Real>, String> {
        let spans_3d = self.inner.clone().into_spans();
        let mut spans_2d: Vec<NurbsCurve2D<Real>> = Vec::new();

        for span in &spans_3d {
            let wrapper = NurbsCurve3DJs { inner: span.clone() };
            let span_2d = wrapper.project_to_2d(origin, local_x, local_y)?;
            spans_2d.push(span_2d);
        }

        CompoundCurve2D::try_new(spans_2d)
            .map_err(|e| format!("Failed to create 2D compound curve: {:?}", e))
    }
}

impl From<CompoundCurve3D<Real>> for CompoundCurve3DJs {
    fn from(curve: CompoundCurve3D<Real>) -> Self {
        CompoundCurve3DJs { inner: curve }
    }
}


//// NURBS SURFACE ////

/// JavaScript wrapper around Curvo's `NurbsSurface3D`.
///
/// ## Construction
/// Surfaces are obtained from the curve classes:
/// - `curve.extrude(direction)` / `curve.extrudeComponents(dx, dy, dz)` on `NurbsCurve3DJs`
/// - `curve.sweep(rail, degreeV?)` on `NurbsCurve3DJs`
/// - `NurbsCurve3DJs.loft(curves, degreeV?)` static method
/// - `compound.extrude(direction)` / `compound.extrudeComponents(dx, dy, dz)` on `CompoundCurve3DJs`
///
/// ## Output
/// Call `toArrays(tolerance?)` to get `{ positions, normals, indices }` typed arrays
/// suitable for direct use in WebGL / Three.js buffer geometries.
#[wasm_bindgen]
pub struct NurbsSurfaceJs {
    pub(crate) inner: NurbsSurface3D<Real>,
}

#[wasm_bindgen]
impl NurbsSurfaceJs {

    // -----------------------------------------------------------------------
    // Output – tessellation → buffer arrays
    // -----------------------------------------------------------------------

    /// Tessellate the surface and return `{ positions, normals, indices }` flat typed arrays.
    ///
    /// # Arguments
    /// * `tolerance` – adaptive tessellation normal-tolerance (default `1e-2`).
    ///                 Smaller values produce a finer mesh.
    #[wasm_bindgen(js_name = toArrays)]
    pub fn to_arrays(&self, tolerance: Option<f64>) -> JsValue {
        use js_sys::{Float64Array, Object, Reflect, Uint32Array};

        let tol = tolerance.unwrap_or(1e-2);
        let options = AdaptiveTessellationOptions::<f64>::default().with_norm_tolerance(tol);
        let tess = self.inner.tessellate(Some(options));

        let pts = tess.points();
        let nrm = tess.normals();
        let fcs = tess.faces();

        let mut positions: Vec<f64> = Vec::with_capacity(pts.len() * 3);
        for p in pts {
            positions.push(p.x as f64);
            positions.push(p.y as f64);
            positions.push(p.z as f64);
        }

        let mut normals: Vec<f64> = Vec::with_capacity(nrm.len() * 3);
        for n in nrm {
            normals.push(n.x as f64);
            normals.push(n.y as f64);
            normals.push(n.z as f64);
        }

        let mut indices: Vec<u32> = Vec::with_capacity(fcs.len() * 3);
        for f in fcs {
            indices.push(f[0] as u32);
            indices.push(f[1] as u32);
            indices.push(f[2] as u32);
        }

        let pos_array = Float64Array::from(positions.as_slice());
        let norm_array = Float64Array::from(normals.as_slice());
        let idx_array = Uint32Array::from(indices.as_slice());

        let obj = Object::new();
        Reflect::set(&obj, &"positions".into(), &pos_array).unwrap();
        Reflect::set(&obj, &"normals".into(), &norm_array).unwrap();
        Reflect::set(&obj, &"indices".into(), &idx_array).unwrap();
        obj.into()
    }

    /// Return a regular (uniform grid) tessellation as `{ positions, normals, indices }`.
    ///
    /// # Arguments
    /// * `divs_u` – number of divisions in the U direction
    /// * `divs_v` – number of divisions in the V direction
    #[wasm_bindgen(js_name = toArraysRegular)]
    pub fn to_arrays_regular(&self, divs_u: usize, divs_v: usize) -> JsValue {
        use js_sys::{Float64Array, Object, Reflect, Uint32Array};

        let tess = self.inner.regular_tessellate(divs_u, divs_v);

        let pts = tess.points();
        let nrm = tess.normals();
        let fcs = tess.faces();

        let mut positions: Vec<f64> = Vec::with_capacity(pts.len() * 3);
        for p in pts {
            positions.push(p.x as f64);
            positions.push(p.y as f64);
            positions.push(p.z as f64);
        }

        let mut normals: Vec<f64> = Vec::with_capacity(nrm.len() * 3);
        for n in nrm {
            normals.push(n.x as f64);
            normals.push(n.y as f64);
            normals.push(n.z as f64);
        }

        let mut indices: Vec<u32> = Vec::with_capacity(fcs.len() * 3);
        for f in fcs {
            indices.push(f[0] as u32);
            indices.push(f[1] as u32);
            indices.push(f[2] as u32);
        }

        let pos_array = Float64Array::from(positions.as_slice());
        let norm_array = Float64Array::from(normals.as_slice());
        let idx_array = Uint32Array::from(indices.as_slice());

        let obj = Object::new();
        Reflect::set(&obj, &"positions".into(), &pos_array).unwrap();
        Reflect::set(&obj, &"normals".into(), &norm_array).unwrap();
        Reflect::set(&obj, &"indices".into(), &idx_array).unwrap();
        obj.into()
    }

    // -----------------------------------------------------------------------
    // Properties
    // -----------------------------------------------------------------------

    /// U-direction degree of the surface
    #[wasm_bindgen(js_name = uDegree)]
    pub fn u_degree(&self) -> usize {
        self.inner.u_degree()
    }

    /// V-direction degree of the surface
    #[wasm_bindgen(js_name = vDegree)]
    pub fn v_degree(&self) -> usize {
        self.inner.v_degree()
    }

    /// Point on surface at parameters (u, v)
    #[wasm_bindgen(js_name = pointAt)]
    pub fn point_at(&self, u: Real, v: Real) -> Point3Js {
        Point3Js::from(self.inner.point_at(u, v))
    }

    /// Normal vector at parameters (u, v)
    #[wasm_bindgen(js_name = normalAt)]
    pub fn normal_at(&self, u: Real, v: Real) -> Vector3Js {
        Vector3Js::from(self.inner.normal_at(u, v))
    }

    /// Knot domains as [u_min, u_max, v_min, v_max]
    #[wasm_bindgen(js_name = knotsDomain)]
    pub fn knots_domain(&self) -> Vec<Real> {
        let ((u0, u1), (v0, v1)) = self.inner.knots_domain();
        vec![u0, u1, v0, v1]
    }

    // -----------------------------------------------------------------------
    // Transformations
    // -----------------------------------------------------------------------

    /// Translate the surface by a vector
    pub fn translate(&self, offset: &Vector3Js) -> NurbsSurfaceJs {
        let v: Vector3<Real> = offset.into();
        let mat4 = Translation3::new(v.x, v.y, v.z).to_homogeneous();
        let mut s = self.inner.clone();
        s.transform(&mat4);
        NurbsSurfaceJs { inner: s }
    }

    /// Rotate the surface by Euler angles (radians)
    pub fn rotate(&self, ax: Real, ay: Real, az: Real) -> NurbsSurfaceJs {
        let mat4 = Rotation3::from_euler_angles(ax, ay, az).to_homogeneous();
        let mut s = self.inner.clone();
        s.transform(&mat4);
        NurbsSurfaceJs { inner: s }
    }

    /// Scale the surface by per-axis factors
    pub fn scale(&self, sx: Real, sy: Real, sz: Real) -> NurbsSurfaceJs {
        #[rustfmt::skip]
        let mat4 = Matrix4::new(
            sx,  0.0, 0.0, 0.0,
            0.0,  sy, 0.0, 0.0,
            0.0, 0.0,  sz, 0.0,
            0.0, 0.0, 0.0, 1.0,
        );
        let mut s = self.inner.clone();
        s.transform(&mat4);
        NurbsSurfaceJs { inner: s }
    }
}


//// HELPERS ////

/// Parse a boolean operation string ("union", "intersection", "difference") into a BooleanOperation enum.
fn parse_boolean_operation(op: &str) -> Result<BooleanOperation, JsValue> {
    match op {
        "union" => Ok(BooleanOperation::Union),
        "intersection" => Ok(BooleanOperation::Intersection),
        "difference" => Ok(BooleanOperation::Difference),
        _ => Err(JsValue::from_str(&format!("Unknown boolean operation: '{}'. Use 'union', 'intersection', or 'difference'.", op))),
    }
}


/// Extract the projection plane (origin, local_x, local_y) from a NurbsCurve3DJs.
/// Fails if the curve is not planar.
fn get_plane_from_nurbs(curve: &NurbsCurve3DJs) -> Result<(Point3<Real>, Vector3<Real>, Vector3<Real>), JsValue> {
    let plane = curve.get_on_plane(None);
    if plane.len() != 3 {
        return Err(JsValue::from_str("Cannot perform boolean on non-planar curve"));
    }
    let local_x: Vector3<Real> = (&plane[1]).into();
    let local_y: Vector3<Real> = (&plane[2]).into();
    let first_cp = curve.inner.control_points()[0];
    let w = first_cp.w;
    let origin = Point3::new(first_cp.x / w, first_cp.y / w, first_cp.z / w);
    Ok((origin, local_x, local_y))
}

/// Extract the projection plane (origin, local_x, local_y) from a CompoundCurve3DJs
/// by inspecting its first span. Fails if not planar.
fn get_plane_from_compound(curve: &CompoundCurve3DJs) -> Result<(Point3<Real>, Vector3<Real>, Vector3<Real>), JsValue> {
    let spans = curve.inner.clone().into_spans();
    if spans.is_empty() {
        return Err(JsValue::from_str("Cannot perform boolean on empty compound curve"));
    }
    let first_span = NurbsCurve3DJs { inner: spans[0].clone() };
    get_plane_from_nurbs(&first_span)
}

/// Snap the last control point of a NurbsCurve2D to the first if they are within `tol`.
/// This fixes floating-point closure gaps (e.g. from NURBS circles).
fn ensure_closed_nurbs_2d(curve: &mut NurbsCurve2D<Real>, tol: Real) {
    let n = curve.control_points().len();
    if n < 2 { return; }
    let first = curve.control_points()[0];
    let last = curve.control_points()[n - 1];
    // Dehomogenize: 2D NURBS control point is (x*w, y*w, w)
    let w0 = first.z;
    let w1 = last.z;
    let dx = first.x / w0 - last.x / w1;
    let dy = first.y / w0 - last.y / w1;
    if (dx * dx + dy * dy).sqrt() < tol {
        if let Some(p) = curve.control_points_iter_mut().nth(n - 1) {
            *p = first;
        }
    }
}

/// Snap the endpoint of a CompoundCurve2D's last span to the startpoint of the first span
/// if they are within `tol`. Returns the (possibly modified) CompoundCurve2D.
fn ensure_closed_compound_2d(compound: CompoundCurve2D<Real>, tol: Real) -> Result<CompoundCurve2D<Real>, String> {
    let mut spans: Vec<NurbsCurve2D<Real>> = compound.into_spans();
    if spans.is_empty() {
        return CompoundCurve2D::try_new(spans)
            .map_err(|e| format!("Failed to recreate empty compound curve: {:?}", e));
    }
    // Get first control point of first span
    let first_cp = spans[0].control_points()[0];
    // Snap last control point of last span
    let last_span = spans.last_mut().unwrap();
    let n = last_span.control_points().len();
    if n >= 2 {
        let last_cp = last_span.control_points()[n - 1];
        let w0 = first_cp.z;
        let w1 = last_cp.z;
        let dx = first_cp.x / w0 - last_cp.x / w1;
        let dy = first_cp.y / w0 - last_cp.y / w1;
        if (dx * dx + dy * dy).sqrt() < tol {
            if let Some(p) = last_span.control_points_iter_mut().nth(n - 1) {
                *p = first_cp;
            }
        }
    }
    CompoundCurve2D::try_new(spans)
        .map_err(|e| format!("Failed to close compound curve: {:?}", e))
}

/// 2-D tessellation resolution for the geo fallback (world units).
const GEO_TESS_TOL: Real = 1e-2;

/// Run a 2-D curve boolean with **escalating jitter** and a **deterministic geo
/// fallback**, keeping the cleanest result (fewest exterior regions).
///
/// curvo's 2-D boolean is numerically unstable on exact-tangency / degenerate
/// inputs: it "succeeds" but fragments the result into many sliver regions and
/// is non-deterministic across repeats. We first retry with an increasing
/// perturbation and keep the fewest-region attempt. If the best is still
/// fragmented (> 1 region) we fall back to a geo polygon boolean, which is
/// deterministic and merges the slivers — at the cost of a polyline (not
/// smooth-arc) approximation. The fallback only wins when it yields *fewer*
/// regions, so clean and genuinely multi-region curvo results keep their
/// smooth curves.
fn robust_boolean_regions<F, G>(
    try_boolean: F,
    geo_fallback: G,
    origin: &Point3<Real>,
    local_x: &Vector3<Real>,
    local_y: &Vector3<Real>,
    op_label: &str,
) -> Result<Vec<BooleanRegionJs>, JsValue>
where
    F: Fn(Real) -> Result<Clip<Real>, String>,
    G: Fn() -> Result<Vec<BooleanRegionJs>, String>,
{
    const JITTERS: [Real; 9] = [0.0, 1e-6, 1e-5, 1e-4, 5e-4, 1e-3, 5e-3, 1e-2, 3e-2];
    let mut best: Option<Vec<BooleanRegionJs>> = None;
    let mut best_n = usize::MAX;
    let mut last_err = String::from("no result");

    for &j in JITTERS.iter() {
        match try_boolean(j) {
            Ok(clip) => match clip_regions_to_3d(clip, origin, local_x, local_y) {
                Ok(regions) => {
                    let n = regions.len();
                    if n > 0 && n < best_n {
                        best_n = n;
                        best = Some(regions);
                        if best_n == 1 {
                            break; // a single region is already ideal
                        }
                    }
                }
                Err(e) => last_err = format!("{:?}", e),
            },
            Err(e) => last_err = e,
        }
    }

    let region_closed = |r: &BooleanRegionJs| r.exterior.is_closed(Some(1e-4));

    // Fast path: a single *closed* region is already ideal — keep curvo's smooth
    // curve (the common case; avoids the geo fallback cost entirely).
    if best_n == 1 {
        if let Some(r) = &best {
            if region_closed(&r[0]) {
                return Ok(best.unwrap());
            }
        }
    }

    // Otherwise curvo fragmented or returned an open/degenerate region. Use the
    // deterministic geo fallback when it merges better, or whenever curvo's best
    // isn't a clean set of closed regions. Genuinely multi-region curvo results
    // that are all closed and not improved by geo keep their smooth curves.
    match geo_fallback().ok().filter(|g| !g.is_empty()) {
        Some(geo_regions) => {
            let curvo_all_closed =
                best.as_ref().map_or(false, |r| !r.is_empty() && r.iter().all(region_closed));
            if !curvo_all_closed || geo_regions.len() < best_n {
                Ok(geo_regions)
            } else {
                Ok(best.unwrap())
            }
        }
        None => best.ok_or_else(|| {
            JsValue::from_str(&format!(
                "boolean{}() failed (curvo + geo fallback): {}",
                op_label, last_err
            ))
        }),
    }
}

/// Tessellate a 2-D NURBS curve into a closed ring of (x, y) points.
fn nurbs2d_ring(curve: &NurbsCurve2D<Real>, tol: Real) -> Vec<(Real, Real)> {
    let mut ring: Vec<(Real, Real)> = curve
        .tessellate(Some(tol))
        .iter()
        .map(|p| (p.x, p.y))
        .collect();
    close_ring(&mut ring);
    ring
}

/// Tessellate a 2-D compound curve (concatenating its spans) into a closed ring.
fn compound2d_ring(curve: &CompoundCurve2D<Real>, tol: Real) -> Vec<(Real, Real)> {
    let mut ring: Vec<(Real, Real)> = curve
        .spans()
        .iter()
        .flat_map(|s| s.tessellate(Some(tol)))
        .map(|p| (p.x, p.y))
        .collect();
    close_ring(&mut ring);
    ring
}

fn close_ring(ring: &mut Vec<(Real, Real)>) {
    if let (Some(&first), Some(&last)) = (ring.first(), ring.last()) {
        if first != last {
            ring.push(first);
        }
    }
}

/// Deterministic geo polygon-boolean fallback for curve booleans. Builds geo
/// polygons from tessellated rings, runs the 2-D boolean, and lifts the result
/// back onto the working plane as polyline compound curves.
fn geo_boolean_fallback(
    self_ring: &[(Real, Real)],
    other_ring: &[(Real, Real)],
    op: BooleanOperation,
    origin: &Point3<Real>,
    local_x: &Vector3<Real>,
    local_y: &Vector3<Real>,
) -> Result<Vec<BooleanRegionJs>, String> {
    use geo::orient::Direction;
    use geo::{BooleanOps, LineString, MultiPolygon, Orient, Polygon as GeoPolygon};

    if self_ring.len() < 4 || other_ring.len() < 4 {
        return Err("geo fallback: degenerate ring".into());
    }

    let a = MultiPolygon(vec![GeoPolygon::new(LineString::from(self_ring.to_vec()), vec![])]);
    let b = MultiPolygon(vec![GeoPolygon::new(LineString::from(other_ring.to_vec()), vec![])]);

    let result = match op {
        BooleanOperation::Intersection => a.intersection(&b),
        BooleanOperation::Difference => a.difference(&b),
        _ => a.union(&b),
    }
    .orient(Direction::Default);

    let mut regions = Vec::new();
    for poly in &result.0 {
        let exterior = ring_to_compound_3d(&poly.exterior().0, origin, local_x, local_y)?;
        let mut holes = Vec::new();
        for hole in poly.interiors() {
            holes.push(ring_to_compound_3d(&hole.0, origin, local_x, local_y)?);
        }
        regions.push(BooleanRegionJs { exterior, holes });
    }
    Ok(regions)
}

/// Lift a 2-D geo ring back onto the working plane as a polyline compound curve.
fn ring_to_compound_3d(
    coords: &[geo::Coord<Real>],
    origin: &Point3<Real>,
    local_x: &Vector3<Real>,
    local_y: &Vector3<Real>,
) -> Result<CompoundCurve3D<Real>, String> {
    let pts: Vec<Point3<Real>> = coords
        .iter()
        .map(|c| Point3::from(origin.coords + local_x.scale(c.x) + local_y.scale(c.y)))
        .collect();
    if pts.len() < 2 {
        return Err("geo fallback: degenerate ring".into());
    }
    let curve = NurbsCurve3D::polyline(&pts, false);
    CompoundCurve3D::try_new(vec![curve]).map_err(|e| format!("{:?}", e))
}

/// Convert a 2D Clip result back to 3D BooleanRegionJs.
/// Each Region's exterior and interior holes are projected back into 3D.
fn clip_regions_to_3d(
    clip: Clip<Real>,
    origin: &Point3<Real>,
    local_x: &Vector3<Real>,
    local_y: &Vector3<Real>,
) -> Result<Vec<BooleanRegionJs>, JsValue> {
    let mut results: Vec<BooleanRegionJs> = Vec::new();
    for region in clip.into_regions() {
        // Decompose region into exterior and interior holes
        let (exterior_2d, interiors_2d) = region.into_tuple();

        // Project exterior to 3D
        let mut ext_spans_3d: Vec<NurbsCurve3D<Real>> = Vec::new();
        for span_2d in exterior_2d.spans() {
            let curve_3d = NurbsCurve3DJs::from_2d(span_2d, origin, local_x, local_y)
                .map_err(|e| JsValue::from_str(&e))?;
            ext_spans_3d.push(curve_3d.inner);
        }
        if ext_spans_3d.is_empty() {
            continue;
        }
        let exterior_3d = CompoundCurve3D::try_new(ext_spans_3d)
            .map_err(|e| JsValue::from_str(&format!("Failed to create compound curve from boolean result exterior: {:?}", e)))?;

        // Project each interior hole to 3D
        let mut holes_3d: Vec<CompoundCurve3D<Real>> = Vec::new();
        for hole_2d in &interiors_2d {
            let mut hole_spans_3d: Vec<NurbsCurve3D<Real>> = Vec::new();
            for span_2d in hole_2d.spans() {
                let curve_3d = NurbsCurve3DJs::from_2d(span_2d, origin, local_x, local_y)
                    .map_err(|e| JsValue::from_str(&e))?;
                hole_spans_3d.push(curve_3d.inner);
            }
            if !hole_spans_3d.is_empty() {
                let hole_compound = CompoundCurve3D::try_new(hole_spans_3d)
                    .map_err(|e| JsValue::from_str(&format!("Failed to create compound curve from boolean result hole: {:?}", e)))?;
                holes_3d.push(hole_compound);
            }
        }

        results.push(BooleanRegionJs {
            exterior: exterior_3d,
            holes: holes_3d,
        });
    }
    Ok(results)
}

/// Create solver options with tighter tolerances for better degenerate-case handling.
fn default_solver_options() -> CurveIntersectionSolverOptions<Real> {
    CurveIntersectionSolverOptions::default()
        .with_minimum_distance(1e-6)
        .with_cost_tolerance(1e-10)
        .with_step_size_tolerance(1e-10)
}

/// Perturb a NurbsCurve2D by translating control points by a small epsilon.
/// Returns a new curve; the original is not modified.
fn perturb_nurbs_2d(curve: &NurbsCurve2D<Real>, eps: Real) -> NurbsCurve2D<Real> {
    let mut perturbed = curve.clone();
    for p in perturbed.control_points_iter_mut() {
        let w = p.z;
        p.x += eps * w;
        p.y += eps * w;
    }
    perturbed
}

/// Perturb a CompoundCurve2D by translating each span's control points by a small epsilon.
/// Returns a new compound curve; the original is not modified.
fn perturb_compound_2d(compound: &CompoundCurve2D<Real>, eps: Real) -> Result<CompoundCurve2D<Real>, String> {
    let perturbed_spans: Vec<NurbsCurve2D<Real>> = compound.spans()
        .iter()
        .map(|span| perturb_nurbs_2d(span, eps))
        .collect();
    CompoundCurve2D::try_new(perturbed_spans)
        .map_err(|e| format!("Failed to create perturbed compound curve: {:?}", e))
}

/* 
/// Offset a CompoundCurve2D by offsetting each span individually and creating
/// sharp corners between adjacent offset results using tangent-based line intersection.
/// This handles mixed-degree compounds that Curvo's native offset cannot process.
/// TODO: Move this logic into the Curvo layer (patch CompoundCurve2D::offset) for
/// proper support of all corner types (round, smooth, chamfer) on mixed-degree spans.
fn offset_compound_per_span(
    compound: &CompoundCurve2D<Real>,
    option: &CurveOffsetOption<Real>,
) -> Result<Vec<NurbsCurve2D<Real>>, String> {
    let spans = compound.spans();
    if spans.is_empty() {
        return Err("Cannot offset empty compound curve".to_string());
    }

    // Offset each span individually — this works for any degree
    let mut offset_spans: Vec<Vec<NurbsCurve2D<Real>>> = Vec::new();
    for span in spans {
        let results = span.offset(option.clone())
            .map_err(|e| format!("Failed to offset span: {:?}", e))?;
        let flat: Vec<NurbsCurve2D<Real>> = results
            .into_iter()
            .flat_map(|c| c.into_spans())
            .collect();
        offset_spans.push(flat);
    }

    // Connect adjacent offset results with sharp corners
    let mut all_spans: Vec<NurbsCurve2D<Real>> = Vec::new();
    let is_closed = compound.is_closed(None);
    let n = offset_spans.len();

    for i in 0..n {
        // Add all spans of this offset result
        for span in &offset_spans[i] {
            all_spans.push(span.clone());
        }

        // Determine the next index for corner creation
        let next_i = if i + 1 < n {
            Some(i + 1)
        } else if is_closed {
            Some(0)
        } else {
            None
        };

        if let Some(j) = next_i {
            // Get the last span of current offset and first span of next offset
            let last_span = match offset_spans[i].last() {
                Some(s) => s,
                None => continue,
            };
            let next_span = match offset_spans[j].first() {
                Some(s) => s,
                None => continue,
            };

            // Get endpoint of last span and startpoint of next span
            let (_, t_end) = last_span.knots_domain();
            let end_pt = last_span.point_at(t_end);
            let (t_start, _) = next_span.knots_domain();
            let start_pt = next_span.point_at(t_start);

            let gap = ((end_pt.x - start_pt.x).powi(2) + (end_pt.y - start_pt.y).powi(2)).sqrt();

            if gap < 1e-6 {
                // Already connected, no corner needed
                continue;
            }

            // Compute tangent directions at the endpoints
            let end_tan = last_span.tangent_at(t_end);
            let start_tan = next_span.tangent_at(t_start);

            // Try sharp corner: extend tangent lines and intersect
            if let Some(corner_pt) = tangent_line_intersection(
                &end_pt, &end_tan, &start_pt, &start_tan,
                option.distance().abs() * 10.0,
            ) {
                // Create polyline corner: endpoint → intersection → startpoint
                let corner = NurbsCurve2D::polyline(
                    &[end_pt, corner_pt, start_pt],
                    false,
                );
                all_spans.push(corner);
            } else {
                // Fallback: direct straight line connection
                let connector = NurbsCurve2D::polyline(&[end_pt, start_pt], false);
                all_spans.push(connector);
            }
        }
    }

    Ok(all_spans)
} */

/// Degree-elevate a single-segment degree-1 NurbsCurve2D to degree-2.
/// The geometry is preserved exactly: the line becomes a quadratic Bezier with a
/// midpoint control point. For polyline NURBS with more than 2 control points,
/// returns the curve unchanged (can't trivially elevate multi-span polylines).
#[allow(dead_code)]
fn elevate_degree1_span_2d(curve: &NurbsCurve2D<Real>) -> NurbsCurve2D<Real> {
    if curve.degree() != 1 {
        return curve.clone();
    }
    let cps = curve.control_points();
    if cps.len() != 2 {
        return curve.clone();
    }
    let p0 = cps[0];
    let p1 = cps[1];
    // Midpoint in homogeneous 2D space (Point3: x*w, y*w, w)
    let p_mid = Point3::new((p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5, (p0.z + p1.z) * 0.5);
    let knots = vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
    NurbsCurve2D::try_new(2, vec![p0, p_mid, p1], knots)
        .unwrap_or_else(|_| curve.clone())
}

/// Elevate all degree-1 spans in a CompoundCurve2D to degree-2.
/// Non-degree-1 spans are preserved unchanged.
/// Returns None if the resulting compound cannot be constructed (connectivity failure).
#[allow(dead_code)]
fn homogenize_degree_to_2(compound: &CompoundCurve2D<Real>) -> Option<CompoundCurve2D<Real>> {
    let elevated: Vec<NurbsCurve2D<Real>> = compound.spans()
        .iter()
        .map(|span| elevate_degree1_span_2d(span))
        .collect();
    CompoundCurve2D::try_new(elevated).ok()
}

/*
/// Find the intersection of two tangent lines extending from endpoints.
/// Returns None if lines are nearly parallel or intersection is too far away.
fn tangent_line_intersection(
    p0: &Point2<Real>,
    d0: &Vector2<Real>,
    p1: &Point2<Real>,
    d1: &Vector2<Real>,
    max_dist: Real,
) -> Option<Point2<Real>> {
    // Solve: p0 + t*d0 = p1 + s*d1
    // Cross product denominator: d0.x * d1.y - d0.y * d1.x
    let denom = d0.x * d1.y - d0.y * d1.x;
    if denom.abs() < 1e-10 {
        return None; // Parallel lines
    }

    let dp = Point2::new(p1.x - p0.x, p1.y - p0.y);
    let t = (dp.x * d1.y - dp.y * d1.x) / denom;

    let intersection = Point2::new(p0.x + t * d0.x, p0.y + t * d0.y);

    // Check distance from both endpoints to avoid wildly diverging corners
    let dist0 = ((intersection.x - p0.x).powi(2) + (intersection.y - p0.y).powi(2)).sqrt();
    let dist1 = ((intersection.x - p1.x).powi(2) + (intersection.y - p1.y).powi(2)).sqrt();

    if dist0 > max_dist || dist1 > max_dist {
        return None;
    }

    Some(intersection)
}
*/