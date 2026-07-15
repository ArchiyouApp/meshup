//! Thin WASM bindings over [`crate::hcurve`] — the hypercurve-backed planar
//! curve engine that is replacing `curvo`. These free functions take/return
//! flat `[x0, y0, x1, y1, …]` f64 coordinate arrays (mapped to `Float64Array`
//! on the JS side), so the TypeScript `Curve` layer can drive the exact kernel
//! in local‑XY and lift results into 3D via the curve's stored plane.

use crate::hcurve;
use hypercurve::BooleanOp;
use wasm_bindgen::prelude::*;

/// Split a flat `[x,y,x,y,…]` array into `[[x,y], …]` pairs.
fn to_pairs(coords: &[f64]) -> Vec<[f64; 2]>
{
    coords.chunks_exact(2).map(|c| [c[0], c[1]]).collect()
}

/// Flatten `[[x,y], …]` pairs into `[x,y,x,y,…]`.
fn flatten(pairs: &[[f64; 2]]) -> Vec<f64>
{
    pairs.iter().flat_map(|p| [p[0], p[1]]).collect()
}

fn err(e: String) -> JsValue
{
    JsValue::from_str(&e)
}

/// Tessellate an open/closed polyline through `coords` to a flat point array.
#[wasm_bindgen(js_name = hcTessellatePolyline)]
pub fn hc_tessellate_polyline(coords: Vec<f64>, closed: bool, chord_error: f64) -> Result<Vec<f64>, JsValue>
{
    let pairs = to_pairs(&coords);
    let out = if closed
    {
        let ct = hcurve::closed_contour(&pairs).map_err(err)?;
        hcurve::tessellate_closed(&ct, chord_error).map_err(err)?
    }
    else
    {
        let cs = hcurve::open_polyline(&pairs).map_err(err)?;
        hcurve::tessellate_open(&cs, chord_error).map_err(err)?
    };
    Ok(flatten(&out))
}

/// Tessellate a circle (centre `cx,cy`, radius `r`) to a flat ring array.
#[wasm_bindgen(js_name = hcCircle)]
pub fn hc_circle(cx: f64, cy: f64, r: f64, chord_error: f64) -> Result<Vec<f64>, JsValue>
{
    let c = hcurve::circle(cx, cy, r).map_err(err)?;
    Ok(flatten(&hcurve::tessellate_closed(&c, chord_error).map_err(err)?))
}

/// Tessellate a 3‑point arc through `start`,`mid`,`end` to a flat point array.
#[wasm_bindgen(js_name = hcArc3pt)]
pub fn hc_arc_3pt(
    sx: f64,
    sy: f64,
    mx: f64,
    my: f64,
    ex: f64,
    ey: f64,
    chord_error: f64,
) -> Result<Vec<f64>, JsValue>
{
    let cs = hcurve::arc_3pt([sx, sy], [mx, my], [ex, ey]).map_err(err)?;
    Ok(flatten(&hcurve::tessellate_open(&cs, chord_error).map_err(err)?))
}

/// Signed area of the closed polyline `coords`.
#[wasm_bindgen(js_name = hcSignedArea)]
pub fn hc_signed_area(coords: Vec<f64>) -> Result<f64, JsValue>
{
    let ct = hcurve::closed_contour(&to_pairs(&coords)).map_err(err)?;
    hcurve::signed_area(&ct).map_err(err)
}

fn parse_op(op: &str) -> Result<BooleanOp, JsValue>
{
    match op
    {
        "union" => Ok(BooleanOp::Union),
        "intersection" => Ok(BooleanOp::Intersection),
        "difference" => Ok(BooleanOp::Difference),
        "xor" => Ok(BooleanOp::Xor),
        other => Err(JsValue::from_str(&format!("hcurve: unknown boolean op '{other}'"))),
    }
}

/// Boolean between two closed polylines. Returns a JS array of flat rings
/// (`Array<Float64Array>`).
#[wasm_bindgen(js_name = hcBoolean)]
pub fn hc_boolean(a: Vec<f64>, b: Vec<f64>, op: &str, chord_error: f64) -> Result<JsValue, JsValue>
{
    let ca = hcurve::closed_contour(&to_pairs(&a)).map_err(err)?;
    let cb = hcurve::closed_contour(&to_pairs(&b)).map_err(err)?;
    let rings = hcurve::boolean_rings(&ca, &cb, parse_op(op)?, chord_error).map_err(err)?;

    let out = js_sys::Array::new();
    for ring in &rings
    {
        out.push(&js_sys::Float64Array::from(flatten(ring).as_slice()).into());
    }
    Ok(out.into())
}

/// One‑sided offset of an open/closed polyline by `distance`. Returns a flat
/// point array.
#[wasm_bindgen(js_name = hcOffset)]
pub fn hc_offset(coords: Vec<f64>, closed: bool, distance: f64, chord_error: f64) -> Result<Vec<f64>, JsValue>
{
    let pairs = to_pairs(&coords);
    let out = if closed
    {
        let ct = hcurve::closed_contour(&pairs).map_err(err)?;
        hcurve::offset_closed(&ct, distance, chord_error).map_err(err)?
    }
    else
    {
        let cs = hcurve::open_polyline(&pairs).map_err(err)?;
        hcurve::offset_open(&cs, distance, chord_error).map_err(err)?
    };
    Ok(flatten(&out))
}

/// Intersection points between two open polylines, as a flat point array.
#[wasm_bindgen(js_name = hcIntersect)]
pub fn hc_intersect(a: Vec<f64>, b: Vec<f64>) -> Result<Vec<f64>, JsValue>
{
    let ca = hcurve::open_polyline(&to_pairs(&a)).map_err(err)?;
    let cb = hcurve::open_polyline(&to_pairs(&b)).map_err(err)?;
    Ok(flatten(&hcurve::intersect_open(&ca, &cb).map_err(err)?))
}

/// Tessellate a NURBS curve (flat control points, weights, knots) to a flat
/// point array.
#[wasm_bindgen(js_name = hcNurbsTessellate)]
pub fn hc_nurbs_tessellate(
    degree: usize,
    control_points: Vec<f64>,
    weights: Vec<f64>,
    knots: Vec<f64>,
    chord_error: f64,
) -> Result<Vec<f64>, JsValue>
{
    let cps = to_pairs(&control_points);
    let c = hcurve::nurbs(degree, &cps, &weights, &knots).map_err(err)?;
    Ok(flatten(&hcurve::tessellate_nurbs(&c, chord_error).map_err(err)?))
}
