use crate::float_types::Real;
use crate::mesh::{Mesh, plane::Plane};
use crate::csg::CSG;
use crate::wasm::{
    js_metadata_to_string, matrix_js::Matrix4Js, plane_js::PlaneJs, point_js::Point3Js,
    polygon_js::PolygonJs, sketch_js::SketchJs, vector_js::Vector3Js,
    meshup::{NurbsCurve3DJs, CompoundCurve3DJs},
};
use crate::io::gltf::{UpAxis};
use curvo::prelude::Tessellation;
use js_sys::{Float64Array, Object, Reflect, Uint32Array, Uint8Array};
use nalgebra::{Matrix4, Point3, Quaternion, UnitQuaternion, Vector3};
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MeshJs {
    pub(crate) inner: Mesh<String>,
}

#[wasm_bindgen]
impl MeshJs {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { inner: Mesh::new() }
    }

    #[wasm_bindgen(js_name=fromPolygons)]
    pub fn from_polygons(polygons: Vec<PolygonJs>, metadata: JsValue) -> MeshJs {
        let poly_vec: Vec<_> = polygons.iter().map(|p| p.inner.clone()).collect();
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_polygons(&poly_vec, meta);
        MeshJs { inner: mesh }
    }

    /// Create a triangulated mesh from a planar polygon (flat [x,y,z,...] outer boundary)
    /// with interior holes (array of flat [x,y,z,...] arrays).
    ///
    /// The normal for each vertex is computed from the outer boundary.
    #[wasm_bindgen(js_name=fromPointsWithHoles)]
    pub fn from_points_with_holes(
        outer_points: Vec<f64>,
        hole_arrays: Vec<js_sys::Float64Array>,
        metadata: JsValue,
    ) -> MeshJs {
        use crate::polygon::Polygon;
        use crate::vertex::Vertex;

        // Parse outer ring: groups of 3 floats → Vertex
        let outer_verts: Vec<Vertex> = outer_points
            .chunks_exact(3)
            .map(|c| {
                Vertex::new(
                    Point3::new(c[0] as Real, c[1] as Real, c[2] as Real),
                    Vector3::zeros(), // normal set below
                )
            })
            .collect();

        if outer_verts.len() < 3 {
            return MeshJs { inner: Mesh::new() };
        }

        // Compute a face normal from the outer ring
        let e1 = outer_verts[1].position - outer_verts[0].position;
        let e2 = outer_verts[2].position - outer_verts[0].position;
        let normal = e1.cross(&e2).normalize();

        // Assign the normal to all outer vertices
        let outer_verts: Vec<Vertex> = outer_verts
            .into_iter()
            .map(|mut v| {
                v.normal = normal;
                v
            })
            .collect();

        // Parse hole rings
        let holes: Vec<Vec<Vertex>> = hole_arrays
            .into_iter()
            .map(|arr| {
                let data = arr.to_vec();
                data.chunks_exact(3)
                    .map(|c| {
                        Vertex::new(
                            Point3::new(c[0] as Real, c[1] as Real, c[2] as Real),
                            normal,
                        )
                    })
                    .collect()
            })
            .collect();

        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let poly = Polygon::new_with_holes(outer_verts, holes, meta);
        let mesh = Mesh::from_polygons(&[poly], None);

        // Triangulate so the result is ready for rendering
        MeshJs {
            inner: mesh.triangulate(),
        }
    }

    /// Return an interleaved array of vertex positions (x,y,z)*.
    #[wasm_bindgen(js_name = positions)]
    pub fn positions(&self) -> Float64Array {
        let obj = self.to_arrays();
        let position = Reflect::get(&obj, &"positions".into()).unwrap();
        position.dyn_into::<Float64Array>().unwrap()
    }

    /// Return an interleaved array of vertex normals (nx,ny,nz)*.
    #[wasm_bindgen(js_name = normals)]
    pub fn normals(&self) -> Float64Array {
        let obj = self.to_arrays();
        let norms = Reflect::get(&obj, &"normals".into()).unwrap();
        norms.dyn_into::<Float64Array>().unwrap()
    }

    /// Return triangle indices (u32).
    #[wasm_bindgen(js_name = indices)]
    pub fn indices(&self) -> Uint32Array {
        let obj = self.to_arrays();
        let idx = Reflect::get(&obj, &"indices".into()).unwrap();
        idx.dyn_into::<Uint32Array>().unwrap()
    }

    /// +MESHUP
    pub fn polygons(&self) -> Vec<PolygonJs> 
    {
        self.inner.polygons.iter().map(
            |p| PolygonJs { inner: p.clone() }
        ).collect()
    }

    /// Number of triangles (handy to sanity-check).
    #[wasm_bindgen(js_name = triangleCount)]
    pub fn triangle_count(&self) -> u32 {
        self.inner.triangulate().polygons.len() as u32
    }

    #[wasm_bindgen(js_name = vertexCount)]
    pub fn vertex_count(&self) -> u32 {
        let mut vertices = Vec::new();
        for poly in &self.inner.polygons {
            for vertex in &poly.vertices {
                if !vertices.iter().any(|v: &Point3<f64>| {
                    (v.x - vertex.position.x).abs() < 1e-8
                        && (v.y - vertex.position.y).abs() < 1e-8
                        && (v.z - vertex.position.z).abs() < 1e-8
                }) {
                    vertices.push(vertex.position);
                }
            }
        }
        vertices.len() as u32
    }

    /// Convert a mesh to arrays of positions, normals, and indices
    #[wasm_bindgen(js_name = toArrays)]
    pub fn to_arrays(&self) -> js_sys::Object {
        let tri = &self.inner.triangulate();

        let tri_count = tri.polygons.len();
        let mut positions = Vec::with_capacity(tri_count * 3 * 3);
        let mut normals = Vec::with_capacity(tri_count * 3 * 3);
        let mut indices = Vec::with_capacity(tri_count * 3);

        let mut idx: u32 = 0;
        for p in &tri.polygons {
            for v in &p.vertices {
                positions.extend_from_slice(&[v.position.x as f64, v.position.y as f64, v.position.z as f64]);
                normals.extend_from_slice(&[
                    v.normal.x as f64,
                    v.normal.y as f64,
                    v.normal.z as f64,
                ]);
            }
            indices.extend_from_slice(&[idx, idx + 1, idx + 2]);
            idx += 3;
        }

        let obj = Object::new();
        Reflect::set(
            &obj,
            &"positions".into(),
            &Float64Array::from(positions.as_slice()).into(),
        )
        .unwrap();
        Reflect::set(
            &obj,
            &"normals".into(),
            &Float64Array::from(normals.as_slice()).into(),
        )
        .unwrap();
        Reflect::set(
            &obj,
            &"indices".into(),
            &Uint32Array::from(indices.as_slice()).into(),
        )
        .unwrap();

        obj
    }

    #[wasm_bindgen(js_name=vertices)]
    pub fn vertices(&self) -> JsValue {
        let verts = self.inner.vertices();
        let js_array = js_sys::Array::new();

        for v in verts {
            let js_vert = Object::new();

            // Wrap position and normal in Point3Js / Vector3Js
            let pos_js = Point3Js::from(v.position);
            let norm_js = Vector3Js::from(v.normal);

            Reflect::set(&js_vert, &"position".into(), &JsValue::from(pos_js)).unwrap();
            Reflect::set(&js_vert, &"normal".into(), &JsValue::from(norm_js)).unwrap();

            js_array.push(&js_vert);
        }

        js_array.into()
    }

    #[wasm_bindgen(js_name = containsVertex)]
    pub fn contains_vertex(&self, p: &Point3Js) -> bool {
        let point: Point3<Real> = p.into();
        self.inner.contains_vertex(&point)
    }

    #[wasm_bindgen(js_name = containsVertexComponents)]
    pub fn contains_vertex_components(&self, x: Real, y: Real, z: Real) -> bool {
        let point: Point3<Real> = Point3::new(x, y, z);
        self.inner.contains_vertex(&point)
    }

    // Boolean Operations
    #[wasm_bindgen(js_name = union)]
    pub fn union(&self, other: &MeshJs) -> Self {
        Self {
            inner: self.inner.union(&other.inner).reconstruct_ngons(),
        }
    }

    #[wasm_bindgen(js_name = difference)]
    pub fn difference(&self, other: &MeshJs) -> Self {
        Self {
            inner: self.inner.difference(&other.inner).reconstruct_ngons(),
        }
    }

    #[wasm_bindgen(js_name = intersection)]
    pub fn intersection(&self, other: &MeshJs) -> Self {
        Self {
            inner: self.inner.intersection(&other.inner).reconstruct_ngons(),
        }
    }

    #[wasm_bindgen(js_name = xor)]
    pub fn xor(&self, other: &MeshJs) -> Self {
        Self {
            inner: self.inner.xor(&other.inner).reconstruct_ngons(),
        }
    }

    /// Merge coplanar, edge-adjacent faces back into n-gons. Applied
    /// automatically after boolean ops; exposed for manual use too.
    #[wasm_bindgen(js_name = reconstructNgons)]
    pub fn reconstruct_ngons(&self) -> MeshJs {
        Self {
            inner: self.inner.reconstruct_ngons(),
        }
    }

    // Transformations
    #[wasm_bindgen(js_name = transform)]
    pub fn transform(&self, mat: &Matrix4Js) -> Self {
        Self {
            inner: self.inner.transform(&mat.inner),
        }
    }

    #[wasm_bindgen(js_name = transformComponents)]
    pub fn transform_components(
        &self,
        m00: Real,
        m01: Real,
        m02: Real,
        m03: Real,
        m10: Real,
        m11: Real,
        m12: Real,
        m13: Real,
        m20: Real,
        m21: Real,
        m22: Real,
        m23: Real,
        m30: Real,
        m31: Real,
        m32: Real,
        m33: Real,
    ) -> Self {
        let matrix = Matrix4::new(
            m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33,
        );
        Self {
            inner: self.inner.transform(&matrix),
        }
    }

    #[wasm_bindgen(js_name = translate)]
    pub fn translate(&self, offset: &Vector3Js) -> Self {
        let v: Vector3<Real> = offset.into();
        Self {
            inner: self.inner.translate(v.x, v.y, v.z),
        }
    }

    #[wasm_bindgen(js_name = translateComponents)]
    pub fn translate_components(&self, dx: Real, dy: Real, dz: Real) -> Self {
        Self {
            inner: self.inner.translate(dx, dy, dz),
        }
    }

    // Rotation angles are in degrees
    // This is extrinsic euler (so rotation is applied in x,y,z order, relative to world axes)
    #[wasm_bindgen(js_name = rotate)]
    pub fn rotate(&self, rx: Real, ry: Real, rz: Real) -> Self {
        Self {
            inner: self.inner.rotate(rx, ry, rz),
        }
    }

    /// Rotate this mesh by a unit quaternion given as components `(w, x, y, z)`.
    /// The quaternion is normalized before use, so non-unit input is safe.
    #[wasm_bindgen(js_name = rotateQuaternion)]
    pub fn rotate_quaternion(&self, w: Real, x: Real, y: Real, z: Real) -> Self {
        let q = UnitQuaternion::new_normalize(Quaternion::new(w, x, y, z));
        Self {
            inner: self.inner.transform(&q.to_homogeneous()),
        }
    }

    #[wasm_bindgen(js_name = scale)]
    pub fn scale(&self, sx: Real, sy: Real, sz: Real) -> Self {
        Self {
            inner: self.inner.scale(sx, sy, sz),
        }
    }

    #[wasm_bindgen(js_name = center)]
    pub fn center(&self) -> Self {
        Self {
            inner: self.inner.center(),
        }
    }

    //// +MESHUP
    pub fn mirror(&self, plane: &PlaneJs) -> Self {
        Self {
            inner: self.inner.mirror(plane.inner.clone())
        }
    }

    #[wasm_bindgen(js_name = float)]
    pub fn float(&self) -> Self {
        Self {
            inner: self.inner.float(),
        }
    }

    #[wasm_bindgen(js_name = inverse)]
    pub fn inverse(&self) -> Self {
        Self {
            inner: self.inner.inverse(),
        }
    }

    //// +MESHUP
    pub fn clone(&self) -> Self
    {
        Self {
            inner: self.inner.clone(),
        }
    }

    #[cfg(feature = "chull-io")]
    #[wasm_bindgen(js_name=convexHull)]
    pub fn convex_hull(&self) -> Self {
        Self {
            inner: self.inner.convex_hull(),
        }
    }

    #[cfg(feature = "chull-io")]
    #[wasm_bindgen(js_name=minkowskiSum)]
    pub fn minkowski_sum(&self, other: &MeshJs) -> Self {
        Self {
            inner: self.inner.minkowski_sum(&other.inner),
        }
    }

    #[wasm_bindgen(js_name=flatten)]
    pub fn flatten(&self) -> SketchJs {
        let sketch = self.inner.flatten();
        SketchJs { inner: sketch }
    }

    #[wasm_bindgen(js_name = slice)]
    pub fn slice(&self, plane: &PlaneJs) -> SketchJs {
        let sketch = self.inner.slice(plane.into());
        SketchJs { inner: sketch }
    }

    #[wasm_bindgen(js_name=sliceComponents)]
    pub fn slice_components(
        &self,
        normal_x: Real,
        normal_y: Real,
        normal_z: Real,
        offset: Real,
    ) -> SketchJs {
        let plane = Plane::from_normal(Vector3::new(normal_x, normal_y, normal_z), offset);
        let sketch = self.inner.slice(plane);
        SketchJs { inner: sketch }
    }

    /// Split this mesh by a plane into two halves.
    ///
    /// Returns `[front_mesh, back_mesh]` where:
    /// - `front_mesh` contains polygons on the side the plane normal points toward.
    /// - `back_mesh` contains polygons on the opposite side.
    ///
    /// Polygons spanning the plane are split at the intersection using
    /// Sutherland-Hodgman clipping.  Coplanar polygons go to `front_mesh`.
    /// Either half may be empty (zero polygons) if the mesh lies entirely on
    /// one side of the plane.
    #[wasm_bindgen(js_name = splitByPlane)]
    pub fn split_by_plane(&self, plane: &PlaneJs) -> Vec<MeshJs> {
        let p: Plane = plane.into();

        let mut front_polys = Vec::new();
        let mut back_polys = Vec::new();

        for poly in &self.inner.polygons {
            let (cf, cb, mut f, mut b) = p.split_polygon(poly);
            front_polys.extend(cf);
            back_polys.extend(cb);
            front_polys.append(&mut f);
            back_polys.append(&mut b);
        }

        vec![
            MeshJs { inner: Mesh::from_polygons(&front_polys, self.inner.metadata.clone()) },
            MeshJs { inner: Mesh::from_polygons(&back_polys, self.inner.metadata.clone()) },
        ]
    }

    #[wasm_bindgen(js_name=laplacianSmooth)]
    pub fn laplacian_smooth(
        &self,
        lambda: Real,
        iterations: usize,
        preserve_boundaries: bool,
    ) -> Self {
        let smoothed = self
            .inner
            .laplacian_smooth(lambda, iterations, preserve_boundaries);
        Self { inner: smoothed }
    }

    #[wasm_bindgen(js_name=taubinSmooth)]
    pub fn taubin_smooth(
        &self,
        lambda: Real,
        mu: Real,
        iterations: usize,
        preserve_boundaries: bool,
    ) -> Self {
        let smoothed = self
            .inner
            .taubin_smooth(lambda, mu, iterations, preserve_boundaries);
        Self { inner: smoothed }
    }

    #[wasm_bindgen(js_name=adaptiveRefine)]
    pub fn adaptive_refine(
        &self,
        quality_threshold: Real,
        max_edge_length: Real,
        curvature_threshold_deg: Real,
    ) -> Self {
        let refined = self.inner.adaptive_refine(
            quality_threshold,
            max_edge_length,
            curvature_threshold_deg,
        );
        Self { inner: refined }
    }

    #[wasm_bindgen(js_name=removePoorTriangles)]
    pub fn remove_poor_triangles(&self, min_quality: Real) -> Self {
        let cleaned = self.inner.remove_poor_triangles(min_quality);
        Self { inner: cleaned }
    }

    // Distribute functions
    #[wasm_bindgen(js_name = distributeLinear)]
    pub fn distribute_linear(
        &self,
        count: usize,
        direction: &Vector3Js,
        spacing: Real,
    ) -> Self {
        let dir: Vector3<Real> = direction.into();
        Self {
            inner: self.inner.distribute_linear(count, dir, spacing),
        }
    }

    #[wasm_bindgen(js_name = distributeLinearComponents)]
    pub fn distribute_linear_components(
        &self,
        count: usize,
        dx: Real,
        dy: Real,
        dz: Real,
        spacing: Real,
    ) -> Self {
        let direction = Vector3::new(dx, dy, dz);
        Self {
            inner: self.inner.distribute_linear(count, direction, spacing),
        }
    }

    #[wasm_bindgen(js_name=distributeArc)]
    pub fn distribute_arc(
        &self,
        count: usize,
        radius: Real,
        start_angle: Real,
        end_angle: Real,
    ) -> Self {
        Self {
            inner: self
                .inner
                .distribute_arc(count, radius, start_angle, end_angle),
        }
    }

    #[wasm_bindgen(js_name=distributeGrid)]
    pub fn distribute_grid(
        &self,
        rows: usize,
        cols: usize,
        row_spacing: Real,
        col_spacing: Real,
    ) -> Self {
        Self {
            inner: self
                .inner
                .distribute_grid(rows, cols, row_spacing, col_spacing),
        }
    }

    // Bounding Box
    #[wasm_bindgen(js_name = boundingBox)]
    pub fn bounding_box(&self) -> JsValue {
        let bb = self.inner.bounding_box();
        let min_js = Point3Js::from(bb.mins);
        let max_js = Point3Js::from(bb.maxs);

        let obj = Object::new();
        Reflect::set(&obj, &"min".into(), &JsValue::from(min_js)).unwrap();
        Reflect::set(&obj, &"max".into(), &JsValue::from(max_js)).unwrap();
        obj.into()
    }

    #[wasm_bindgen(js_name=invalidateBoundingBox)]
    pub fn invalidate_bounding_box(&mut self) {
        self.inner.invalidate_bounding_box();
    }

    // IO Operations
    #[wasm_bindgen(js_name = toSTLBinary)]
    pub fn to_stl_binary(&self) -> Result<Vec<u8>, JsValue> {
        self.inner
            .to_stl_binary("mesh")
            .map_err(|e| JsValue::from_str(&format!("STL export failed: {:?}", e)))
    }

    #[wasm_bindgen(js_name = toSTLASCII)]
    pub fn to_stl_ascii(&self) -> Result<String, JsValue> {
        let stl_content = self.inner.to_stl_ascii("mesh");
        Ok(stl_content)
    }

    #[wasm_bindgen(js_name = toAMF)]
    pub fn to_amf(&self, object_name: &str, units: &str) -> String {
        self.inner.to_amf(object_name, units)
    }

    #[wasm_bindgen(js_name = toAMFWithColor)]
    pub fn to_amf_with_color(
        &self,
        object_name: &str,
        units: &str,
        r: f64,
        g: f64,
        b: f64,
    ) -> String {
        self.inner
            .to_amf_with_color(object_name, units, (r as Real, g as Real, b as Real))
    }
    
    #[wasm_bindgen(js_name = toGLTF)]
    pub fn to_gltf(&self, object_name: &str, up_axis: &str) -> String {

        let axis = match up_axis.to_uppercase().as_str() {
            "Y" => Some(UpAxis::Y),
            "X" => Some(UpAxis::X),
            "Z" => Some(UpAxis::Z),
            _ => None,  // Let Rust use default in inner.to_gltf()
        };
        self.inner.to_gltf(object_name, axis)
    }

    #[wasm_bindgen(js_name=fromSketch)]
    pub fn from_sketch(sketch_js: &SketchJs) -> MeshJs {
        let mesh = Mesh::from(sketch_js.inner.clone());
        Self { inner: mesh }
    }

    //// FILE IMPORT ////

    /// Import a Wavefront **OBJ** mesh from its text content.
    #[wasm_bindgen(js_name = fromOBJ)]
    pub fn from_obj_js(obj_data: &str, metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_obj(std::io::Cursor::new(obj_data.as_bytes()), meta)
            .map_err(|e| JsValue::from_str(&format!("OBJ import error: {e:?}")))?;
        Ok(MeshJs { inner: mesh })
    }

    /// Import a binary or ASCII **STL** mesh from raw bytes.
    #[wasm_bindgen(js_name = fromSTL)]
    pub fn from_stl_js(stl_data: &[u8], metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_stl(stl_data, meta)
            .map_err(|e| JsValue::from_str(&format!("STL import error: {e:?}")))?;
        Ok(MeshJs { inner: mesh })
    }

    /// Import a **DXF** drawing (closed polylines / circles → faces) as a Mesh.
    #[wasm_bindgen(js_name = fromDXF)]
    pub fn from_dxf_js(dxf_data: &[u8], metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_dxf(dxf_data, meta)
            .map_err(|e| JsValue::from_str(&format!("DXF import error: {e}")))?;
        Ok(MeshJs { inner: mesh })
    }

    /// Import a **glTF 2.0** model (`.glb` or `.gltf`) as a single merged Mesh.
    #[wasm_bindgen(js_name = fromGLTF)]
    pub fn from_gltf_js(data: &[u8], metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_gltf(data, meta)
            .map_err(|e| JsValue::from_str(&format!("glTF import error: {e}")))?;
        Ok(MeshJs { inner: mesh })
    }

    /// Import an **AMF** model (plain XML or zipped) as a merged Mesh.
    #[wasm_bindgen(js_name = fromAMF)]
    pub fn from_amf_js(data: &[u8], metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_amf(data, meta)
            .map_err(|e| JsValue::from_str(&format!("AMF import error: {e}")))?;
        Ok(MeshJs { inner: mesh })
    }

    /// Import a **3MF** package as a merged Mesh (geometry only).
    #[wasm_bindgen(js_name = from3MF)]
    pub fn from_3mf_js(data: &[u8], metadata: JsValue) -> Result<MeshJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let mesh = Mesh::from_3mf(data, meta)
            .map_err(|e| JsValue::from_str(&format!("3MF import error: {e}")))?;
        Ok(MeshJs { inner: mesh })
    }

    // Metadata
    #[wasm_bindgen(js_name = sameMetadata)]
    pub fn same_metadata(&self, other: &MeshJs) -> bool {
        self.inner.same_metadata(&other.inner)
    }

    #[wasm_bindgen(js_name=filterPolygonsByMetadata)]
    pub fn filter_polygons_by_metadata(&self, needle: JsValue) -> MeshJs {
        let meta = js_metadata_to_string(needle).unwrap_or(None);

        if let Some(ref s) = meta {
            let mesh = self.inner.filter_polygons_by_metadata(s);
            MeshJs { inner: mesh }
        } else {
            MeshJs { inner: Mesh::new() }
        }
    }

    // Mass Properties
    #[wasm_bindgen(js_name = massProperties)]
    pub fn mass_properties(&self, density: Real) -> JsValue {
        let (mass, com, _frame) = self.inner.mass_properties(density);
        let obj = Object::new();

        let com_js = Point3Js::from(com);

        Reflect::set(&obj, &"mass".into(), &mass.into()).unwrap();
        Reflect::set(&obj, &"centerOfMass".into(), &JsValue::from(com_js)).unwrap();
        obj.into()
    }

    // Subdivision
    #[wasm_bindgen(js_name = subdivideTriangles)]
    pub fn subdivide_triangles(&self, levels: u32) -> Self {
        if levels == 0 {
            return Self {
                inner: self.inner.clone(),
            };
        }
        let levels_nonzero = std::num::NonZeroU32::new(levels).unwrap();
        Self {
            inner: self.inner.subdivide_triangles(levels_nonzero),
        }
    }

    #[wasm_bindgen(js_name = renormalize)]
    pub fn renormalize(&self) -> Self {
        let mut inner = self.inner.clone();
        inner.renormalize();
        Self { inner }
    }

    #[wasm_bindgen(js_name = triangulate)]
    pub fn triangulate(&self) -> Self {
        Self {
            inner: self.inner.triangulate(),
        }
    }

    // 3D Shapes
    #[wasm_bindgen(js_name = cube)]
    pub fn cube(size: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::cube(size, meta),
        }
    }

    #[wasm_bindgen(js_name = sphere)]
    pub fn sphere(
        radius: Real,
        segments_u: usize,
        segments_v: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::sphere(radius, segments_u, segments_v, meta),
        }
    }

    #[wasm_bindgen(js_name = cylinder)]
    pub fn cylinder(radius: Real, height: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::cylinder(radius, height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = cuboid)]
    pub fn cuboid(width: Real, length: Real, height: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::cuboid(width, length, height, meta),
        }
    }

    #[wasm_bindgen(js_name = frustum_ptp)]
    pub fn frustum_ptp(
        start: &Point3Js,
        end: &Point3Js,
        radius1: Real,
        radius2: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let start: Point3<Real> = start.into();
        let end: Point3<Real> = end.into();
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::frustum_ptp(start, end, radius1, radius2, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = frustum_ptpComponents)]
    pub fn frustum_ptp_components(
        start_x: Real,
        start_y: Real,
        start_z: Real,
        end_x: Real,
        end_y: Real,
        end_z: Real,
        radius1: Real,
        radius2: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let start: Point3<Real> = Point3::new(start_x, start_y, start_z);
        let end: Point3<Real> = Point3::new(end_x, end_y, end_z);
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::frustum_ptp(start, end, radius1, radius2, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = frustum)]
    pub fn frustum(
        radius1: Real,
        radius2: Real,
        height: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::frustum(radius1, radius2, height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = polyhedron)]
    pub fn polyhedron(
        points: JsValue,
        faces: JsValue,
        metadata: JsValue,
    ) -> Result<Self, JsValue> {
        let points_vec: Vec<[f64; 3]> = from_value(points)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse points: {:?}", e)))?;
        let faces_vec: Vec<Vec<usize>> = from_value(faces)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse faces: {:?}", e)))?;

        let points_3d: Vec<[Real; 3]> = points_vec
            .into_iter()
            .map(|[x, y, z]| [x as Real, y as Real, z as Real])
            .collect();

        let faces_ref: Vec<&[usize]> = faces_vec.iter().map(|f| f.as_slice()).collect();

        let meta = js_metadata_to_string(metadata).unwrap_or(None);

        let mesh = Mesh::polyhedron(&points_3d, &faces_ref, meta)
            .map_err(|e| JsValue::from_str(&format!("Polyhedron creation failed: {:?}", e)))?;

        Ok(Self { inner: mesh })
    }

    #[wasm_bindgen(js_name = egg)]
    pub fn egg(
        width: Real,
        length: Real,
        revolve_segments: usize,
        outline_segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::egg(width, length, revolve_segments, outline_segments, meta),
        }
    }

    #[wasm_bindgen(js_name = teardrop)]
    pub fn teardrop(
        width: Real,
        length: Real,
        revolve_segments: usize,
        shape_segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::teardrop(width, length, revolve_segments, shape_segments, meta),
        }
    }

    #[wasm_bindgen(js_name = teardropCylinder)]
    pub fn teardrop_cylinder(
        width: Real,
        length: Real,
        height: Real,
        shape_segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::teardrop_cylinder(width, length, height, shape_segments, meta),
        }
    }

    #[wasm_bindgen(js_name = ellipsoid)]
    pub fn ellipsoid(
        rx: Real,
        ry: Real,
        rz: Real,
        segments: usize,
        stacks: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::ellipsoid(rx, ry, rz, segments, stacks, meta),
        }
    }

    #[wasm_bindgen(js_name = arrow)]
    pub fn arrow(
        start: &Point3Js,
        direction: &Vector3Js,
        segments: usize,
        orientation: bool,
        metadata: JsValue,
    ) -> Self {
        let start: Point3<Real> = start.into();
        let dir: Vector3<Real> = direction.into();
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::arrow(start, dir, segments, orientation, meta),
        }
    }

    #[wasm_bindgen(js_name = octahedron)]
    pub fn octahedron(radius: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::octahedron(radius, meta),
        }
    }

    #[wasm_bindgen(js_name = icosahedron)]
    pub fn icosahedron(radius: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::icosahedron(radius, meta),
        }
    }

    #[wasm_bindgen(js_name = torus)]
    pub fn torus(
        major_r: Real,
        minor_r: Real,
        segments_major: usize,
        segments_minor: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::torus(major_r, minor_r, segments_major, segments_minor, meta),
        }
    }

    #[wasm_bindgen(js_name = spurGearInvolute)]
    pub fn spur_gear_involute(
        module_: Real,
        teeth: usize,
        pressure_angle_deg: Real,
        clearance: Real,
        backlash: Real,
        segments_per_flank: usize,
        thickness: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Mesh::spur_gear_involute(
                module_,
                teeth,
                pressure_angle_deg,
                clearance,
                backlash,
                segments_per_flank,
                thickness,
                meta,
            ),
        }
    }

    #[wasm_bindgen(js_name=gyroid)]
    pub fn gyroid(
        &self,
        resolution: u32,
        scale: Real,
        iso_value: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let gyroid_mesh =
            self.inner
                .gyroid(resolution.try_into().unwrap(), scale, iso_value, meta);
        Self { inner: gyroid_mesh }
    }

    #[wasm_bindgen(js_name=schwarzP)]
    pub fn schwarz_p(
        &self,
        resolution: u32,
        scale: Real,
        iso_value: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let schwarzp_mesh =
            self.inner
                .schwarz_p(resolution.try_into().unwrap(), scale, iso_value, meta);
        Self {
            inner: schwarzp_mesh,
        }
    }

    #[wasm_bindgen(js_name=schwarzD)]
    pub fn schwarz_d(
        &self,
        resolution: u32,
        scale: Real,
        iso_value: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let schwarzd_mesh =
            self.inner
                .schwarz_d(resolution.try_into().unwrap(), scale, iso_value, meta);
        Self {
            inner: schwarzd_mesh,
        }
    }

    // #[wasm_bindgen(js_name=metaballs)]
    // pub fn metaballs(balls: JsValue, resolution_x: u32, resolution_y: u32, resolution_z: u32, iso_value: Real, padding: Real) -> Self {
    // Parse the list of MetaBallJs objects or raw data.
    // let balls_vec: Vec<MetaBallJs> = from_value(balls).unwrap_or_else(|_| vec![]);
    // let meta_balls: Vec<MetaBall> = balls_vec.into_iter().map(|b| b.inner).collect();
    //
    // let resolution = (resolution_x.try_into().unwrap(), resolution_y.try_into().unwrap(), resolution_z.try_into().unwrap());
    // let metaball_mesh = Mesh::metaballs(&meta_balls, resolution, iso_value, padding, None);
    // Self { inner: metaball_mesh }
    // }

    /// Find intersection points between a NURBS curve and this Mesh.
    /// The curve is tessellated into a polyline (using the given tolerance),
    /// then each segment is tested against the mesh triangles.
    ///
    /// # Arguments
    /// - `curve`: A `NurbsCurve3DJs` to intersect with this mesh.
    /// - `tolerance`: Optional tessellation tolerance for the curve (default: 1e-4).
    ///
    /// # Returns
    /// A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
    #[wasm_bindgen(js_name = intersectCurve)]
    pub fn intersect_curve(&self, curve: &NurbsCurve3DJs, tolerance: Option<f64>) -> Vec<Point3Js> {
        let tol = tolerance.unwrap_or(1e-4);
        let polyline: Vec<Point3<Real>> = curve.inner
            .tessellate(Some(tol))
            .iter()
            .map(|p| Point3::new(p.x as Real, p.y as Real, p.z as Real))
            .collect();

        self.inner
            .intersect_polyline(&polyline)
            .into_iter()
            .map(|p| Point3Js::from(p))
            .collect()
    }

    /// Find intersection points between a compound curve and this Mesh.
    /// Each span of the compound curve is tessellated and tested against the mesh.
    ///
    /// # Arguments
    /// - `curve`: A `CompoundCurve3DJs` to intersect with this mesh.
    /// - `tolerance`: Optional tessellation tolerance (default: 1e-4).
    ///
    /// # Returns
    /// A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
    #[wasm_bindgen(js_name = intersectCompoundCurve)]
    pub fn intersect_compound_curve(&self, curve: &CompoundCurve3DJs, tolerance: Option<f64>) -> Vec<Point3Js> {
        let tol = tolerance.unwrap_or(1e-4);
        let polyline: Vec<Point3<Real>> = curve.inner
            .tessellate(Some(tol))
            .iter()
            .map(|p| Point3::new(p.x as Real, p.y as Real, p.z as Real))
            .collect();

        self.inner
            .intersect_polyline(&polyline)
            .into_iter()
            .map(|p| Point3Js::from(p))
            .collect()
    }

    /// Find intersection points between a raw polyline (array of Point3Js) and this Mesh.
    /// Each consecutive pair of points defines a segment tested against the mesh.
    ///
    /// # Arguments
    /// - `points`: Ordered 3D points forming a polyline.
    ///
    /// # Returns
    /// A `Vec<Point3Js>` of 3D intersection points, in polyline order.
    #[wasm_bindgen(js_name = intersectPolyline)]
    pub fn intersect_polyline_js(&self, points: Vec<Point3Js>) -> Vec<Point3Js> {
        let polyline: Vec<Point3<Real>> = points
            .iter()
            .map(|p| p.inner)
            .collect();

        self.inner
            .intersect_polyline(&polyline)
            .into_iter()
            .map(|p| Point3Js::from(p))
            .collect()
    }

    // ── BVH Spatial Queries ──────────────────────────────────────────────────

    /// BVH-accelerated first-hit raycast.
    ///
    /// Returns the closest intersection along `origin + t * direction` where
    /// `t ∈ [0, max_dist]`, or `undefined` if there is no hit.
    #[wasm_bindgen(js_name = raycastFirst)]
    pub fn raycast_first_js(
        &self,
        ox: Real, oy: Real, oz: Real,
        dx: Real, dy: Real, dz: Real,
        max_dist: Real,
    ) -> Option<crate::wasm::bvh_types_js::RaycastHitJs> {
        use crate::wasm::bvh_types_js::RaycastHitJs;
        let origin = Point3::new(ox, oy, oz);
        let direction = Vector3::new(dx, dy, dz);
        self.inner.raycast_first(&origin, &direction, max_dist)
            .as_ref()
            .map(RaycastHitJs::from_hit)
    }

    /// Batch first-hit visibility test.
    ///
    /// `origins` — flat `Float64Array` with 3×N floats (x₀,y₀,z₀, x₁,y₁,z₁, …).
    /// `dx, dy, dz` — shared ray direction (need not be normalised).
    /// `max_dist` — maximum hit distance.
    ///
    /// Returns a `Uint8Array` of length N: `1` = ray hit something (occluded),
    /// `0` = no hit (visible).
    ///
    /// This is the batch companion to `raycastFirst` for the TypeScript HLR pipeline:
    /// it builds the BVH once and does all raycasts inside Rust, eliminating N
    /// JS→WASM round-trips.
    #[wasm_bindgen(js_name = raycastBatchVisibility)]
    pub fn raycast_batch_visibility_js(
        &self,
        origins: &Float64Array,
        dx: Real, dy: Real, dz: Real,
        max_dist: Real,
    ) -> Uint8Array {
        let raw = origins.to_vec();
        let n = raw.len() / 3;
        let direction = Vector3::new(dx, dy, dz);
        let pts: Vec<(Real, Real, Real)> = (0..n)
            .map(|i| (raw[i * 3] as Real, raw[i * 3 + 1] as Real, raw[i * 3 + 2] as Real))
            .collect();
        let flags = self.inner.raycast_batch_visibility(&pts, &direction, max_dist);
        let bytes: Vec<u8> = flags.iter().map(|&hit| hit as u8).collect();
        Uint8Array::from(bytes.as_slice())
    }

    /// All-hits raycast: every triangle intersection along the ray, sorted by distance.
    #[wasm_bindgen(js_name = raycastAll)]
    pub fn raycast_all_js(
        &self,
        ox: Real, oy: Real, oz: Real,
        dx: Real, dy: Real, dz: Real,
        max_dist: Real,
    ) -> Vec<crate::wasm::bvh_types_js::RaycastHitJs> {
        use crate::wasm::bvh_types_js::RaycastHitJs;
        let origin = Point3::new(ox, oy, oz);
        let direction = Vector3::new(dx, dy, dz);
        self.inner.raycast_all(&origin, &direction, max_dist)
            .iter()
            .map(RaycastHitJs::from_hit)
            .collect()
    }

    /// Project a query point onto the nearest mesh surface (BVH-accelerated).
    ///
    /// Returns `undefined` if the mesh has no polygons.
    #[wasm_bindgen(js_name = closestPoint)]
    pub fn closest_point_js(
        &self,
        x: Real, y: Real, z: Real,
    ) -> Option<crate::wasm::bvh_types_js::ClosestPointResultJs> {
        use crate::wasm::bvh_types_js::ClosestPointResultJs;
        let pt = Point3::new(x, y, z);
        self.inner.closest_point(&pt)
            .as_ref()
            .map(ClosestPointResultJs::from_result)
    }

    /// Sample the signed distance field at a query point.
    ///
    /// Returns a **negative** signed distance when inside the mesh.
    /// Returns `undefined` if the mesh has no polygons.
    #[wasm_bindgen(js_name = sampleSdf)]
    pub fn sample_sdf_js(
        &self,
        x: Real, y: Real, z: Real,
    ) -> Option<crate::wasm::bvh_types_js::SdfSampleJs> {
        use crate::wasm::bvh_types_js::SdfSampleJs;
        let pt = Point3::new(x, y, z);
        self.inner.sample_sdf(&pt)
            .as_ref()
            .map(SdfSampleJs::from_sample)
    }

    /// Test whether this mesh physically overlaps another (BVH-accelerated).
    #[wasm_bindgen(js_name = hits)]
    pub fn hits_js(&self, other: &MeshJs) -> bool {
        self.inner.hits(&other.inner)
    }

    /// Minimum separating distance between this mesh and another.
    ///
    /// Returns `0.0` if they intersect.
    #[wasm_bindgen(js_name = distanceTo)]
    pub fn distance_to_js(&self, other: &MeshJs) -> Real {
        self.inner.distance_to_mesh(&other.inner)
    }

    #[wasm_bindgen(js_name = distanceToLegacy)]
    pub fn distance_to_legacy_js(&self, other: &MeshJs) -> Real {
        self.inner.distance_to_mesh_legacy(&other.inner)
    }

    /// Orthographically project every vertex of this mesh onto a plane.
    ///
    /// `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
    #[wasm_bindgen(js_name = projectToPlane)]
    pub fn project_to_plane_js(
        &self,
        ox: Real, oy: Real, oz: Real,
        nx: Real, ny: Real, nz: Real,
    ) -> MeshJs {
        let origin = Point3::new(ox, oy, oz);
        let normal = Vector3::new(nx, ny, nz);
        MeshJs { inner: self.inner.project_to_plane(&origin, &normal) }
    }

    /// Minimum absolute distance from any mesh vertex to a plane.
    ///
    /// `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
    #[wasm_bindgen(js_name = distanceToPlane)]
    pub fn distance_to_plane_js(
        &self,
        ox: Real, oy: Real, oz: Real,
        nx: Real, ny: Real, nz: Real,
    ) -> Real {
        let origin = Point3::new(ox, oy, oz);
        let normal = Vector3::new(nx, ny, nz);
        self.inner.distance_to_plane(&origin, &normal)
    }

    /// Create a mesh from pre-sampled SDF values on a regular grid.
    ///
    /// `values` must be laid out as `[z * res_y * res_x + y * res_x + x, ...]`.
    /// `iso_value` is the isosurface threshold (typically `0.0`).
    #[cfg(feature = "sdf")]
    #[wasm_bindgen(js_name = fromSdfValues)]
    pub fn from_sdf_values_js(
        values: Float64Array,
        res_x: usize,
        res_y: usize,
        res_z: usize,
        min_x: Real, min_y: Real, min_z: Real,
        max_x: Real, max_y: Real, max_z: Real,
        iso_value: Real,
    ) -> MeshJs {
        let vals: Vec<f64> = values.to_vec();
        let min_pt = Point3::new(min_x, min_y, min_z);
        let max_pt = Point3::new(max_x, max_y, max_z);
        let mesh = crate::mesh::Mesh::<String>::from_sdf_values(
            &vals,
            (res_x, res_y, res_z),
            min_pt,
            max_pt,
            iso_value,
            None,
        );
        MeshJs { inner: mesh }
    }

    // ── Edge Projection (HLR) ────────────────────────────────────────────────

    /// BVH-accelerated edge projection with hidden-line removal.
    ///
    /// - `(vx, vy, vz)` – view direction (normalised internally).
    /// - `(ox, oy, oz)` – projection plane origin.
    /// - `(nx, ny, nz)` – projection plane normal.
    /// - `feature_angle_deg` – crease angle threshold in degrees (e.g. `15.0`).
    /// - `n_samples` – HLR ray samples per edge segment (e.g. `8`).
    /// - `occluders` – additional meshes that can occlude edges of `self`;
    ///   `self` is always included as an occluder.
    #[wasm_bindgen(js_name = projectEdges)]
    pub fn project_edges_js(
        &self,
        vx: Real, vy: Real, vz: Real,
        ox: Real, oy: Real, oz: Real,
        nx: Real, ny: Real, nz: Real,
        feature_angle_deg: Real,
        n_samples: usize,
        occluders: Vec<MeshJs>,
    ) -> crate::wasm::edge_projection_js::EdgeProjectionResultJs {
        let view_normal = Vector3::new(vx, vy, vz);
        let plane_origin = Point3::new(ox, oy, oz);
        let plane_normal = Vector3::new(nx, ny, nz);
        let occ_inner: Vec<crate::mesh::Mesh<String>> = occluders.into_iter()
            .map(|m| m.inner)
            .collect();
        let occ_refs: Vec<&crate::mesh::Mesh<String>> = occ_inner.iter().collect();
        let result = self.inner.project_edges(
            &view_normal,
            &plane_origin,
            &plane_normal,
            feature_angle_deg,
            n_samples,
            &occ_refs,
        );
        crate::wasm::edge_projection_js::EdgeProjectionResultJs { inner: result }
    }

    /// Slice at a section plane and return visible/hidden edge projections plus
    /// the cut sketch.
    ///
    /// - `(snx, sny, snz)` / `section_offset` – section plane normal + d offset.
    /// - `(vx, vy, vz)` – view direction.
    /// - `(ox, oy, oz)` / `(nx, ny, nz)` – projection plane origin + normal.
    /// - `feature_angle_deg`, `n_samples`, `occluders` – as in `projectEdges`.
    #[cfg(feature = "sketch")]
    #[wasm_bindgen(js_name = projectEdgesSection)]
    pub fn project_edges_section_js(
        &self,
        snx: Real, sny: Real, snz: Real,
        section_offset: Real,
        vx: Real, vy: Real, vz: Real,
        ox: Real, oy: Real, oz: Real,
        nx: Real, ny: Real, nz: Real,
        feature_angle_deg: Real,
        n_samples: usize,
        occluders: Vec<MeshJs>,
    ) -> crate::wasm::edge_projection_js::SectionElevationResultJs {
        let section_normal = Vector3::new(snx, sny, snz);
        let view_normal = Vector3::new(vx, vy, vz);
        let plane_origin = Point3::new(ox, oy, oz);
        let plane_normal = Vector3::new(nx, ny, nz);
        let occ_inner: Vec<crate::mesh::Mesh<String>> = occluders.into_iter()
            .map(|m| m.inner)
            .collect();
        let occ_refs: Vec<&crate::mesh::Mesh<String>> = occ_inner.iter().collect();
        let r = self.inner.project_edges_section(
            &section_normal,
            section_offset,
            &view_normal,
            &plane_origin,
            &plane_normal,
            feature_angle_deg,
            n_samples,
            &occ_refs,
        );
        crate::wasm::edge_projection_js::SectionElevationResultJs {
            visible_polylines: crate::mesh::edge_projection::EdgeProjectionResult {
                visible_polylines: r.visible_polylines,
                hidden_polylines: r.hidden_polylines,
                silhouette_indices: r.silhouette_indices,
            },
            cut: r.cut,
        }
    }
}
