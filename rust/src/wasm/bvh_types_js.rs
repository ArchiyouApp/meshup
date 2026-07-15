//! WASM-bindgen wrappers for BVH spatial-query result types.

use wasm_bindgen::prelude::*;

// ─── RaycastHitJs ─────────────────────────────────────────────────────────────

/// Result of a BVH-accelerated first-hit raycast returned to JavaScript.
#[wasm_bindgen]
pub struct RaycastHitJs {
    point_x: f64,
    point_y: f64,
    point_z: f64,
    normal_x: f64,
    normal_y: f64,
    normal_z: f64,
    distance: f64,
    triangle_index: u32,
}

#[wasm_bindgen]
impl RaycastHitJs {
    #[wasm_bindgen(getter = pointX)]
    pub fn point_x(&self) -> f64 { self.point_x }
    #[wasm_bindgen(getter = pointY)]
    pub fn point_y(&self) -> f64 { self.point_y }
    #[wasm_bindgen(getter = pointZ)]
    pub fn point_z(&self) -> f64 { self.point_z }
    #[wasm_bindgen(getter = normalX)]
    pub fn normal_x(&self) -> f64 { self.normal_x }
    #[wasm_bindgen(getter = normalY)]
    pub fn normal_y(&self) -> f64 { self.normal_y }
    #[wasm_bindgen(getter = normalZ)]
    pub fn normal_z(&self) -> f64 { self.normal_z }
    #[wasm_bindgen(getter)]
    pub fn distance(&self) -> f64 { self.distance }
    #[wasm_bindgen(getter = triangleIndex)]
    pub fn triangle_index(&self) -> u32 { self.triangle_index }
}

impl RaycastHitJs {
    pub(crate) fn from_hit(hit: &crate::mesh::bvh::RaycastHit) -> Self {
        Self {
            point_x: hit.point.x as f64,
            point_y: hit.point.y as f64,
            point_z: hit.point.z as f64,
            normal_x: hit.normal.x as f64,
            normal_y: hit.normal.y as f64,
            normal_z: hit.normal.z as f64,
            distance: hit.distance as f64,
            triangle_index: hit.triangle_index,
        }
    }
}

// ─── ClosestPointResultJs ─────────────────────────────────────────────────────

/// Result of a closest-surface-point query returned to JavaScript.
#[wasm_bindgen]
pub struct ClosestPointResultJs {
    point_x: f64,
    point_y: f64,
    point_z: f64,
    normal_x: f64,
    normal_y: f64,
    normal_z: f64,
    distance: f64,
    is_inside: bool,
}

#[wasm_bindgen]
impl ClosestPointResultJs {
    #[wasm_bindgen(getter = pointX)]
    pub fn point_x(&self) -> f64 { self.point_x }
    #[wasm_bindgen(getter = pointY)]
    pub fn point_y(&self) -> f64 { self.point_y }
    #[wasm_bindgen(getter = pointZ)]
    pub fn point_z(&self) -> f64 { self.point_z }
    #[wasm_bindgen(getter = normalX)]
    pub fn normal_x(&self) -> f64 { self.normal_x }
    #[wasm_bindgen(getter = normalY)]
    pub fn normal_y(&self) -> f64 { self.normal_y }
    #[wasm_bindgen(getter = normalZ)]
    pub fn normal_z(&self) -> f64 { self.normal_z }
    #[wasm_bindgen(getter)]
    pub fn distance(&self) -> f64 { self.distance }
    #[wasm_bindgen(getter = isInside)]
    pub fn is_inside(&self) -> bool { self.is_inside }
}

impl ClosestPointResultJs {
    pub(crate) fn from_result(r: &crate::mesh::bvh::ClosestPointResult) -> Self {
        Self {
            point_x: r.point.x as f64,
            point_y: r.point.y as f64,
            point_z: r.point.z as f64,
            normal_x: r.normal.x as f64,
            normal_y: r.normal.y as f64,
            normal_z: r.normal.z as f64,
            distance: r.distance as f64,
            is_inside: r.is_inside,
        }
    }
}

// ─── SdfSampleJs ──────────────────────────────────────────────────────────────

/// SDF sample result returned to JavaScript.
#[wasm_bindgen]
pub struct SdfSampleJs {
    distance: f64,
    is_inside: bool,
    closest_x: f64,
    closest_y: f64,
    closest_z: f64,
}

#[wasm_bindgen]
impl SdfSampleJs {
    #[wasm_bindgen(getter)]
    pub fn distance(&self) -> f64 { self.distance }
    #[wasm_bindgen(getter = isInside)]
    pub fn is_inside(&self) -> bool { self.is_inside }
    #[wasm_bindgen(getter = closestX)]
    pub fn closest_x(&self) -> f64 { self.closest_x }
    #[wasm_bindgen(getter = closestY)]
    pub fn closest_y(&self) -> f64 { self.closest_y }
    #[wasm_bindgen(getter = closestZ)]
    pub fn closest_z(&self) -> f64 { self.closest_z }
}

impl SdfSampleJs {
    pub(crate) fn from_sample(s: &crate::mesh::bvh::SdfSample) -> Self {
        Self {
            distance: s.distance as f64,
            is_inside: s.is_inside,
            closest_x: s.closest_point.x as f64,
            closest_y: s.closest_point.y as f64,
            closest_z: s.closest_point.z as f64,
        }
    }
}
