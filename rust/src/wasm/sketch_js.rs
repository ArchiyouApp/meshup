use crate::float_types::Real;
use crate::io::svg::{FromSVG, ToSVG};
use crate::sketch::Sketch;
use crate::csg::CSG;
use crate::wasm::{
    js_metadata_to_string, matrix_js::Matrix4Js, mesh_js::MeshJs, point_js::Point3Js,
    vector_js::Vector3Js,
};
use geo::{Geometry, GeometryCollection};
use js_sys::{Float64Array, Object, Reflect, Uint32Array};
use nalgebra::{Matrix4, Point3, Vector3};
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct SketchJs {
    pub(crate) inner: Sketch<String>,
}

/// Push one ring `{ points: Float64Array([x0,y0,...]), closed }` onto `out`.
fn push_ring_2d(out: &js_sys::Array, coords: &[geo::Coord<Real>], closed: bool) {
    let mut flat: Vec<f64> = Vec::with_capacity(coords.len() * 2);
    for c in coords {
        flat.push(c.x as f64);
        flat.push(c.y as f64);
    }
    let obj = Object::new();
    Reflect::set(&obj, &"points".into(), &Float64Array::from(flat.as_slice())).unwrap();
    Reflect::set(&obj, &"closed".into(), &JsValue::from_bool(closed)).unwrap();
    out.push(&obj);
}

#[wasm_bindgen]
impl SketchJs {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Sketch::new(),
        }
    }

    #[wasm_bindgen(js_name = isEmpty)]
    pub fn is_empty(&self) -> bool {
        self.inner.geometry.0.is_empty()
    }

    #[wasm_bindgen(js_name = toArrays)]
    pub fn to_arrays(&self) -> JsValue {
        let mut positions = Vec::new();
        let mut indices = Vec::new();
        let mut normals = Vec::new();

        // Convert 2D geometry to 3D triangles for visualization
        let triangulated = self.inner.triangulate();
        for tri in triangulated {
            let [a, b, c] = tri;

            // Push vertices (Z=0 for 2D)
            positions.push(a.x);
            positions.push(a.y);
            positions.push(0.0);
            positions.push(b.x);
            positions.push(b.y);
            positions.push(0.0);
            positions.push(c.x);
            positions.push(c.y);
            positions.push(0.0);

            // Push normals (upwards for 2D)
            normals.push(0.0);
            normals.push(0.0);
            normals.push(1.0);
            normals.push(0.0);
            normals.push(0.0);
            normals.push(1.0);
            normals.push(0.0);
            normals.push(0.0);
            normals.push(1.0);

            // Push indices
            let base_idx = indices.len() / 3;
            indices.push(base_idx as u32);
            indices.push((base_idx + 1) as u32);
            indices.push((base_idx + 2) as u32);
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

    /// Typed accessor for ring geometry. Returns
    /// `Array<{ points: Float64Array([x0,y0,x1,y1,...]), closed: boolean }>`.
    /// Polygon exteriors and holes are emitted as separate `closed: true`
    /// rings; LineStrings / Lines come back as `closed: false`.
    #[wasm_bindgen(js_name = rings)]
    pub fn rings(&self) -> JsValue {
        let out = js_sys::Array::new();
        for geom in &self.inner.geometry.0 {
            match geom {
                Geometry::Polygon(p) => {
                    push_ring_2d(&out, &p.exterior().0, true);
                    for hole in p.interiors() {
                        push_ring_2d(&out, &hole.0, true);
                    }
                }
                Geometry::MultiPolygon(mp) => {
                    for p in &mp.0 {
                        push_ring_2d(&out, &p.exterior().0, true);
                        for hole in p.interiors() {
                            push_ring_2d(&out, &hole.0, true);
                        }
                    }
                }
                Geometry::LineString(ls) => push_ring_2d(&out, &ls.0, false),
                Geometry::MultiLineString(mls) => {
                    for ls in &mls.0 {
                        push_ring_2d(&out, &ls.0, false);
                    }
                }
                Geometry::Line(l) => {
                    let coords = [l.start, l.end];
                    push_ring_2d(&out, &coords, false);
                }
                _ => {} // Point / MultiPoint / GeometryCollection / Rect / Triangle
            }
        }
        out.into()
    }

    #[wasm_bindgen(js_name = polygon)]
    pub fn polygon(points: JsValue, metadata: JsValue) -> Result<Self, JsValue> {
        let points_vec: Vec<[f64; 2]> = from_value(points)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse points: {:?}", e)))?;

        let points_2d: Vec<[Real; 2]> = points_vec
            .into_iter()
            .map(|[x, y]| [x as Real, y as Real])
            .collect();

        let meta = js_metadata_to_string(metadata).unwrap_or(None);

        Ok(Self {
            inner: Sketch::polygon(&points_2d, meta),
        })
    }

    // #[wasm_bindgen(js_name=triangulateWithHoles)]
    // pub fn triangulate_with_holes(outer, holes) -> Vec<JsValue> {
    // let tris = Sketch::<()>::triangulate_with_holes(outer, holes);
    // tris.into_iter()
    // .map(|tri| {
    // let points: Vec<[f64; 3]> = tri
    // .iter()
    // .map(|v| [v.x, v.y, v.z])
    // .collect();
    // JsValue::from_serde(&points).unwrap_or(JsValue::NULL)
    // })
    // .collect()
    // }

    // error[E0609]: no field `pos` on type `&OPoint<f64, Const<3>>`
    // --> src/lib.rs:159:33
    // |
    // 159 |                     .map(|v| [v.pos.x, v.pos.y, v.pos.z])
    // |                                 ^^^ unknown field
    // |
    // = note: available field is: `coords`
    // = note: available fields are: `x`, `y`, `z`
    //
    // #[wasm_bindgen(js_name=triangulate)]
    // pub fn triangulate(&self) -> Vec<JsValue> {
    // let tris = self.inner.triangulate();
    // tris.into_iter()
    // .map(|tri| {
    // let points: Vec<[f64; 3]> = tri
    // .iter()
    // .map(|v| [v.pos.x, v.pos.y, v.pos.z])
    // .collect();
    // JsValue::from_serde(&points).unwrap_or(JsValue::NULL)
    // })
    // .collect()
    // }

    // IO operations
    #[wasm_bindgen(js_name = fromSVG)]
    pub fn from_svg(svg_data: &str, metadata: JsValue) -> Result<Self, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let sketch = Sketch::from_svg(svg_data, meta)
            .map_err(|e| JsValue::from_str(&format!("SVG parsing error: {:?}", e)))?;
        Ok(Self { inner: sketch })
    }

    /// Import 2-D geometry from DXF as a Sketch (curves). See `Sketch::from_dxf`.
    #[wasm_bindgen(js_name = fromDXF)]
    pub fn from_dxf(dxf_data: &[u8], metadata: JsValue) -> Result<SketchJs, JsValue> {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let sketch = Sketch::from_dxf(dxf_data, meta)
            .map_err(|e| JsValue::from_str(&format!("DXF import error: {e}")))?;
        Ok(SketchJs { inner: sketch })
    }

    #[wasm_bindgen(js_name = toSVG)]
    pub fn to_svg(&self) -> String {
        self.inner.to_svg()
    }

    #[wasm_bindgen(js_name=fromGeo)]
    pub fn from_geo(geo_json: &str, metadata: JsValue) -> Result<SketchJs, JsValue> {
        let geometry: Geometry<Real> = serde_json::from_str(geo_json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse GeoJSON: {}", e)))?;
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let sketch = Sketch::from_geo(GeometryCollection(vec![geometry]), meta);
        Ok(SketchJs { inner: sketch })
    }

    /// Build a 2-D Sketch from **outline (filled) text** using a TrueType/OpenType
    /// font. Each glyph becomes closed `Polygon`(s) with holes for counters (the
    /// hole in `O`, `e`, `A`, …), plus open `LineString`s for any open contours.
    /// `scale` is the desired point size; glyphs are laid out with the font's own
    /// horizontal advance metrics. Extrude the result for solid 3-D text.
    ///
    /// See `Sketch::text`.
    #[cfg(feature = "truetype-text")]
    #[wasm_bindgen(js_name = text)]
    pub fn text(text: &str, font_data: &[u8], scale: Real, metadata: JsValue) -> SketchJs {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        SketchJs {
            inner: Sketch::text(text, font_data, scale, meta),
        }
    }

    /// Build a 2-D Sketch from **single-stroke line text** using a Hershey `.jhf`
    /// font. Each glyph stroke becomes an open `LineString` (ideal for CNC
    /// engraving / pen plotting). `offset_code` is the Unicode code point mapped
    /// to the font's first record (32 = ASCII space for the standard fonts).
    ///
    /// See `Sketch::from_hershey_str`.
    #[cfg(feature = "hershey-text")]
    #[wasm_bindgen(js_name = fromHershey)]
    pub fn from_hershey(
        text: &str,
        jhf: &str,
        size: Real,
        offset_code: u32,
        metadata: JsValue,
    ) -> SketchJs {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        let offset = char::from_u32(offset_code).unwrap_or(' ');
        SketchJs {
            inner: Sketch::from_hershey_str(text, jhf, size, offset, meta),
        }
    }

    #[wasm_bindgen(js_name=toMultiPolygon)]
    pub fn to_multipolygon(&self) -> String {
        let mp = self.inner.to_multipolygon();
        serde_json::to_string(&mp).unwrap_or_else(|_| "null".to_string())
    }

    #[wasm_bindgen(js_name=fromMesh)]
    pub fn from_mesh(mesh_js: &MeshJs) -> SketchJs {
        let sketch = Sketch::from(mesh_js.inner.clone());
        SketchJs { inner: sketch }
    }

    // Boolean Operations
    #[wasm_bindgen(js_name = union)]
    pub fn union(&self, other: &SketchJs) -> Self {
        Self {
            inner: self.inner.union(&other.inner),
        }
    }

    #[wasm_bindgen(js_name = difference)]
    pub fn difference(&self, other: &SketchJs) -> Self {
        Self {
            inner: self.inner.difference(&other.inner),
        }
    }

    #[wasm_bindgen(js_name = intersection)]
    pub fn intersection(&self, other: &SketchJs) -> Self {
        Self {
            inner: self.inner.intersection(&other.inner),
        }
    }

    #[wasm_bindgen(js_name = xor)]
    pub fn xor(&self, other: &SketchJs) -> Self {
        Self {
            inner: self.inner.xor(&other.inner),
        }
    }

    // Transformations
    #[wasm_bindgen(js_name=transform)]
    pub fn transform(&self, mat: &Matrix4Js) -> SketchJs {
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
    ) -> SketchJs {
        let matrix = Matrix4::new(
            m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33,
        );
        SketchJs {
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

    #[wasm_bindgen(js_name = rotate)]
    pub fn rotate(&self, rx: Real, ry: Real, rz: Real) -> Self {
        Self {
            inner: self.inner.rotate(rx, ry, rz),
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

    #[wasm_bindgen(js_name=inverse)]
    pub fn inverse(&self) -> SketchJs {
        let sketch = self.inner.inverse();
        Self { inner: sketch }
    }

    #[wasm_bindgen(js_name=renormalize)]
    pub fn renormalize(&self) -> SketchJs {
        let sketch = self.inner.renormalize();
        Self { inner: sketch }
    }

    // Extrusion and 3D Operations
    #[wasm_bindgen(js_name = extrude)]
    pub fn extrude(&self, height: Real) -> MeshJs {
        let mesh = self.inner.extrude(height);
        MeshJs { inner: mesh }
    }


    #[wasm_bindgen(js_name=extrudeVectorComponents)]
    pub fn extrude_vector_components(&self, dx: Real, dy: Real, dz: Real) -> MeshJs {
        let direction = Vector3::new(dx, dy, dz);
        let mesh = self.inner.extrude_vector(direction);
        MeshJs { inner: mesh }
    }

    #[wasm_bindgen(js_name = extrudeVector)]
    pub fn extrude_vector(&self, dir: &Vector3Js) -> MeshJs {
        let direction: Vector3<Real> = dir.into();
        let mesh = self.inner.extrude_vector(direction);
        MeshJs { inner: mesh }
    }

      
    #[wasm_bindgen(js_name = revolve)]
    pub fn revolve(&self, angle_degrees: Real, segments: usize) -> Result<MeshJs, JsValue> {
        let mesh = self
            .inner
            .revolve(angle_degrees, segments)
            .map_err(|e| JsValue::from_str(&format!("Revolve failed: {:?}", e)))?;
        Ok(MeshJs { inner: mesh })
    }

    #[wasm_bindgen(js_name = sweep)]
    pub fn sweep(&self, path: Vec<Point3Js>) -> MeshJs {
        // Move the inner nalgebra points out of the wrappers.
        let path_points: Vec<Point3<Real>> = path.into_iter().map(|p| p.inner).collect();
        let mesh = self.inner.sweep(&path_points);
        MeshJs { inner: mesh }
    }

    #[wasm_bindgen(js_name=sweepComponents)]
    pub fn sweep_components(&self, path: JsValue) -> MeshJs {
        // Parse the path from a JS array of [x, y, z] coordinates.
        let path_vec: Vec<[f64; 3]> = from_value(path).unwrap_or_else(|_| vec![]);
        let path_points: Vec<Point3<Real>> = path_vec
            .into_iter()
            .map(|[x, y, z]| Point3::new(x as Real, y as Real, z as Real))
            .collect();
        let mesh = self.inner.sweep(&path_points);
        MeshJs { inner: mesh }
    }

    // Offset Operations (if offset feature is enabled)
    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name = offset)]
    pub fn offset(&self, distance: Real) -> Self {
        Self {
            inner: self.inner.offset(distance),
        }
    }

    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name = offsetRounded)]
    pub fn offset_rounded(&self, distance: Real) -> Self {
        Self {
            inner: self.inner.offset_rounded(distance),
        }
    }

    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name=straightSkeleton)]
    pub fn straight_skeleton(&self, orientation: bool) -> SketchJs {
        let sketch = self.inner.straight_skeleton(orientation);
        Self { inner: sketch }
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

    // 2D Shapes
    #[wasm_bindgen(js_name = square)]
    pub fn square(width: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::square(width, meta),
        }
    }

    #[wasm_bindgen(js_name = circle)]
    pub fn circle(radius: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::circle(radius, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = rectangle)]
    pub fn rectangle(width: Real, length: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::rectangle(width, length, meta),
        }
    }

    #[wasm_bindgen(js_name = rightTriangle)]
    pub fn right_triangle(width: Real, height: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::right_triangle(width, height, meta),
        }
    }

    #[wasm_bindgen(js_name = ellipse)]
    pub fn ellipse(width: Real, height: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::ellipse(width, height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = regularNGon)]
    pub fn regular_ngon(sides: usize, radius: Real, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::regular_ngon(sides, radius, meta),
        }
    }

    #[wasm_bindgen(js_name = arrow)]
    pub fn arrow(
        shaft_length: Real,
        shaft_width: Real,
        head_length: Real,
        head_width: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::arrow(shaft_length, shaft_width, head_length, head_width, meta),
        }
    }

    #[wasm_bindgen(js_name = trapezoid)]
    pub fn trapezoid(
        top_width: Real,
        bottom_width: Real,
        height: Real,
        top_offset: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::trapezoid(top_width, bottom_width, height, top_offset, meta),
        }
    }

    #[wasm_bindgen(js_name = star)]
    pub fn star(
        num_points: usize,
        outer_radius: Real,
        inner_radius: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::star(num_points, outer_radius, inner_radius, meta),
        }
    }

    #[wasm_bindgen(js_name = teardrop)]
    pub fn teardrop(width: Real, length: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::teardrop(width, length, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = egg)]
    pub fn egg(width: Real, length: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::egg(width, length, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = roundedRectangle)]
    pub fn rounded_rectangle(
        width: Real,
        height: Real,
        corner_radius: Real,
        corner_segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::rounded_rectangle(
                width,
                height,
                corner_radius,
                corner_segments,
                meta,
            ),
        }
    }

    #[wasm_bindgen(js_name = squircle)]
    pub fn squircle(width: Real, height: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::squircle(width, height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = keyhole)]
    pub fn keyhole(
        circle_radius: Real,
        handle_width: Real,
        handle_height: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::keyhole(circle_radius, handle_width, handle_height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = reuleaux)]
    pub fn reuleaux(
        sides: usize,
        diameter: Real,
        circle_segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::reuleaux(sides, diameter, circle_segments, meta),
        }
    }

    #[wasm_bindgen(js_name = ring)]
    pub fn ring(id: Real, thickness: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::ring(id, thickness, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = pieSlice)]
    pub fn pie_slice(
        radius: Real,
        start_angle_deg: Real,
        end_angle_deg: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::pie_slice(radius, start_angle_deg, end_angle_deg, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = supershape)]
    pub fn supershape(
        a: Real,
        b: Real,
        m: Real,
        n1: Real,
        n2: Real,
        n3: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::supershape(a, b, m, n1, n2, n3, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = circleWithKeyway)]
    pub fn circle_with_keyway(
        radius: Real,
        segments: usize,
        key_width: Real,
        key_depth: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::circle_with_keyway(radius, segments, key_width, key_depth, meta),
        }
    }

    #[wasm_bindgen(js_name = circleWithFlat)]
    pub fn circle_with_flat(
        radius: Real,
        segments: usize,
        flat_dist: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::circle_with_flat(radius, segments, flat_dist, meta),
        }
    }

    #[wasm_bindgen(js_name = circleWithTwoFlats)]
    pub fn circle_with_two_flats(
        radius: Real,
        segments: usize,
        flat_dist: Real,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::circle_with_two_flats(radius, segments, flat_dist, meta),
        }
    }

    #[wasm_bindgen(js_name = bezier)]
    pub fn bezier(
        control: JsValue,
        segments: usize,
        metadata: JsValue,
    ) -> Result<Self, JsValue> {
        let control_vec: Vec<[f64; 2]> = from_value(control).map_err(|e| {
            JsValue::from_str(&format!("Failed to parse control points: {:?}", e))
        })?;

        let control_2d: Vec<[Real; 2]> = control_vec
            .into_iter()
            .map(|[x, y]| [x as Real, y as Real])
            .collect();

        let meta = js_metadata_to_string(metadata).unwrap_or(None);

        Ok(Self {
            inner: Sketch::bezier(&control_2d, segments, meta),
        })
    }

    #[wasm_bindgen(js_name = bspline)]
    pub fn bspline(
        control: JsValue,
        p: usize,
        segments_per_span: usize,
        metadata: JsValue,
    ) -> Result<Self, JsValue> {
        let control_vec: Vec<[f64; 2]> = from_value(control).map_err(|e| {
            JsValue::from_str(&format!("Failed to parse control points: {:?}", e))
        })?;

        let control_2d: Vec<[Real; 2]> = control_vec
            .into_iter()
            .map(|[x, y]| [x as Real, y as Real])
            .collect();

        let meta = js_metadata_to_string(metadata).unwrap_or(None);

        Ok(Self {
            inner: Sketch::bspline(&control_2d, p, segments_per_span, meta),
        })
    }

    #[wasm_bindgen(js_name = heart)]
    pub fn heart(width: Real, height: Real, segments: usize, metadata: JsValue) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::heart(width, height, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = crescent)]
    pub fn crescent(
        outer_r: Real,
        inner_r: Real,
        offset: Real,
        segments: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::crescent(outer_r, inner_r, offset, segments, meta),
        }
    }

    #[wasm_bindgen(js_name = involuteGear)]
    pub fn involute_gear(
        module_: Real,
        teeth: usize,
        pressure_angle_deg: Real,
        clearance: Real,
        backlash: Real,
        segments_per_flank: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::involute_gear(
                module_,
                teeth,
                pressure_angle_deg,
                clearance,
                backlash,
                segments_per_flank,
                meta,
            ),
        }
    }

    #[wasm_bindgen(js_name = airfoilNACA4)]
    pub fn airfoil_naca4(
        max_camber: Real,
        camber_position: Real,
        thickness: Real,
        chord: Real,
        samples: usize,
        metadata: JsValue,
    ) -> Self {
        let meta = js_metadata_to_string(metadata).unwrap_or(None);
        Self {
            inner: Sketch::airfoil_naca4(
                max_camber,
                camber_position,
                thickness,
                chord,
                samples,
                meta,
            ),
        }
    }

    #[cfg(feature = "offset")]
    #[wasm_bindgen(js_name = hilbertCurve)]
    pub fn hilbert_curve(&self, order: usize, padding: Real) -> Self {
        Self {
            inner: self.inner.hilbert_curve(order, padding),
        }
    }

    /// Return a human-readable summary of every ring coordinate in the
    /// underlying `geo::GeometryCollection`.  Useful for debugging sketch
    /// content from TypeScript without having to read raw buffers.
    ///
    /// Example output:
    /// ```
    /// Geometry[0] Polygon
    ///   exterior (6 pts): [0.00,0.00] [1.00,0.00] ...
    ///   hole[0]   (5 pts): [0.25,0.25] ...
    /// Geometry[1] LineString
    ///   (3 pts): [0.00,0.00] [5.00,5.00] ...
    /// ```
    #[wasm_bindgen(js_name = debugGeometry)]
    pub fn debug_geometry(&self) -> String {
        use geo::{CoordsIter, Geometry};
        use std::fmt::Write;

        let mut out = String::new();

        for (gi, geom) in self.inner.geometry.0.iter().enumerate() {
            match geom {
                Geometry::Polygon(poly) => {
                    let _ = writeln!(out, "Geometry[{gi}] Polygon");

                    // exterior ring
                    let ext_pts: Vec<String> = poly
                        .exterior()
                        .coords_iter()
                        .map(|c| format!("[{:.4},{:.4}]", c.x, c.y))
                        .collect();
                    let _ = writeln!(
                        out,
                        "  exterior ({} pts): {}",
                        ext_pts.len(),
                        ext_pts.join(" ")
                    );

                    // interior holes
                    for (hi, hole) in poly.interiors().iter().enumerate() {
                        let hole_pts: Vec<String> = hole
                            .coords_iter()
                            .map(|c| format!("[{:.4},{:.4}]", c.x, c.y))
                            .collect();
                        let _ = writeln!(
                            out,
                            "  hole[{hi}] ({} pts): {}",
                            hole_pts.len(),
                            hole_pts.join(" ")
                        );
                    }
                }

                Geometry::MultiPolygon(mp) => {
                    let _ = writeln!(out, "Geometry[{gi}] MultiPolygon ({} polys)", mp.0.len());
                    for (pi, poly) in mp.0.iter().enumerate() {
                        let ext_pts: Vec<String> = poly
                            .exterior()
                            .coords_iter()
                            .map(|c| format!("[{:.4},{:.4}]", c.x, c.y))
                            .collect();
                        let _ = writeln!(
                            out,
                            "  poly[{pi}] exterior ({} pts): {}",
                            ext_pts.len(),
                            ext_pts.join(" ")
                        );
                        for (hi, hole) in poly.interiors().iter().enumerate() {
                            let hole_pts: Vec<String> = hole
                                .coords_iter()
                                .map(|c| format!("[{:.4},{:.4}]", c.x, c.y))
                                .collect();
                            let _ = writeln!(
                                out,
                                "  poly[{pi}] hole[{hi}] ({} pts): {}",
                                hole_pts.len(),
                                hole_pts.join(" ")
                            );
                        }
                    }
                }

                Geometry::LineString(ls) => {
                    let pts: Vec<String> = ls
                        .coords_iter()
                        .map(|c| format!("[{:.4},{:.4}]", c.x, c.y))
                        .collect();
                    let _ = writeln!(
                        out,
                        "Geometry[{gi}] LineString ({} pts): {}",
                        pts.len(),
                        pts.join(" ")
                    );
                }

                Geometry::Point(p) => {
                    let _ = writeln!(
                        out,
                        "Geometry[{gi}] Point [{:.4},{:.4}]",
                        p.x(),
                        p.y()
                    );
                }

                Geometry::Line(l) => {
                    let _ = writeln!(
                        out,
                        "Geometry[{gi}] Line [{:.4},{:.4}] -> [{:.4},{:.4}]",
                        l.start.x, l.start.y, l.end.x, l.end.y
                    );
                }

                other => {
                    // geo::Geometry doesn't implement Display, so use Debug
                    let _ = writeln!(out, "Geometry[{gi}] (unsupported type: {:?})", std::mem::discriminant(other));
                }
            }
        }

        if out.is_empty() {
            "(empty sketch)".to_string()
        } else {
            out
        }
    }
}
