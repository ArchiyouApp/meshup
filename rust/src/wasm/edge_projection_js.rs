//! WASM-bindgen wrappers for edge-projection result types.

use crate::mesh::edge_projection::EdgeProjectionResult;
use wasm_bindgen::prelude::*;

/// Edge projection result returned to JavaScript.
///
/// Call `visiblePolylines()` / `hiddenPolylines()` to get the serialised
/// polyline data as a JS array of arrays of `[x, y, z]` triplets.
#[wasm_bindgen]
pub struct EdgeProjectionResultJs {
    pub(crate) inner: EdgeProjectionResult,
}

#[wasm_bindgen]
impl EdgeProjectionResultJs {
    /// Returns visible polylines as a JS value.
    ///
    /// Shape: `Array< Array<[x: number, y: number, z: number]> >`
    #[wasm_bindgen(js_name = visiblePolylines)]
    pub fn visible_polylines(&self) -> JsValue {
        polylines_to_js(&self.inner.visible_polylines)
    }

    /// Returns hidden polylines as a JS value.
    ///
    /// Shape: `Array< Array<[x: number, y: number, z: number]> >`
    #[wasm_bindgen(js_name = hiddenPolylines)]
    pub fn hidden_polylines(&self) -> JsValue {
        polylines_to_js(&self.inner.hidden_polylines)
    }

    /// Indices into `visiblePolylines()` whose source edge is a silhouette or
    /// open-mesh boundary — i.e. the outer contour of the projection.
    #[wasm_bindgen(js_name = silhouetteIndices)]
    pub fn silhouette_indices(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(self.inner.silhouette_indices.as_slice())
    }
}

// ─── SectionElevationResultJs ─────────────────────────────────────────────────

/// Section-elevation result (cut sketch + visible/hidden edge polylines).
#[cfg(feature = "sketch")]
#[wasm_bindgen]
pub struct SectionElevationResultJs {
    pub(crate) visible_polylines: crate::mesh::edge_projection::EdgeProjectionResult,
    pub(crate) cut: crate::sketch::Sketch<String>,
}

#[cfg(feature = "sketch")]
#[wasm_bindgen]
impl SectionElevationResultJs {
    #[wasm_bindgen(js_name = visiblePolylines)]
    pub fn get_visible_polylines(&self) -> JsValue {
        polylines_to_js(&self.visible_polylines.visible_polylines)
    }

    #[wasm_bindgen(js_name = hiddenPolylines)]
    pub fn get_hidden_polylines(&self) -> JsValue {
        polylines_to_js(&self.visible_polylines.hidden_polylines)
    }

    /// Indices into `visiblePolylines()` forming the outer silhouette contour.
    #[wasm_bindgen(js_name = silhouetteIndices)]
    pub fn silhouette_indices(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(self.visible_polylines.silhouette_indices.as_slice())
    }

    #[wasm_bindgen(js_name = cutSketch)]
    pub fn cut_sketch(&self) -> crate::wasm::sketch_js::SketchJs {
        crate::wasm::sketch_js::SketchJs {
            inner: self.cut.clone(),
        }
    }
}

// ─── helper: serialise polyline vec ───────────────────────────────────────────

fn polylines_to_js(polylines: &[crate::mesh::edge_projection::Polyline3D]) -> JsValue {
    let outer = js_sys::Array::new();
    for pl in polylines {
        let inner = js_sys::Array::new();
        for p in pl {
            let pt = js_sys::Array::new();
            pt.push(&JsValue::from_f64(p.x as f64));
            pt.push(&JsValue::from_f64(p.y as f64));
            pt.push(&JsValue::from_f64(p.z as f64));
            inner.push(&JsValue::from(pt));
        }
        outer.push(&JsValue::from(inner));
    }
    JsValue::from(outer)
}
