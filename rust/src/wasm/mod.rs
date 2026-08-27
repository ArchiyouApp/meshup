use serde_json::Value as JsonValue;
use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;

pub mod bvh_types_js;
pub mod curve_js;
pub mod edge_projection_js;
pub mod matrix_js;
pub mod mesh_js;
pub mod metaballs_js;
pub mod plane_js;
pub mod point_js;
pub mod polygon_js;
pub mod sketch_js;
pub mod vector_js;
pub mod vertex_js;


/// Install the tessellation profile every default-quality sampling route reads.
///
/// The counterpart of `setQuality()` on the TypeScript side: that owns the full profile
/// (which also covers loft/revolve facets and mesh primitive segments, decided in JS), and
/// pushes the four dials the exact-curve kernel needs down here. Sanitised on the way in,
/// so a nonsense dial falls back to the default rather than emptying a polyline or hanging
/// a sampling loop.
#[wasm_bindgen(js_name = setTessellationQuality)]
pub fn set_tessellation_quality(
    segments_per_turn: f64,
    chord_tolerance: f64,
    min_segments: usize,
    max_segments: usize,
)
{
    crate::hcurve::set_quality(crate::hcurve::TessQuality {
        segments_per_turn,
        chord_tolerance,
        min_segments,
        max_segments,
    });
}

/// The tessellation profile in force, as `[segmentsPerTurn, chordTolerance, min, max]`.
/// Lets the TypeScript side assert what it actually installed rather than what it sent.
#[wasm_bindgen(js_name = getTessellationQuality)]
pub fn get_tessellation_quality() -> Vec<f64>
{
    let q = crate::hcurve::quality();
    vec![q.segments_per_turn, q.chord_tolerance, q.min_segments as f64, q.max_segments as f64]
}

// Optional: better panic messages in the browser console.
#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

fn js_metadata_to_string(metadata: JsValue) -> Result<Option<String>, JsValue> {
    if metadata.is_undefined() || metadata.is_null() {
        return Ok(None);
    }

    // Convert arbitrary JS value -> serde_json::Value
    let json: JsonValue = from_value(metadata).map_err(|e| {
        JsValue::from_str(&format!("Failed to serialize metadata from JS: {:?}", e))
    })?;

    // Store it as a JSON string in Rust metadata
    let s = serde_json::to_string(&json).map_err(|e| {
        JsValue::from_str(&format!("Failed to stringify metadata as JSON: {}", e))
    })?;

    Ok(Some(s))
}
