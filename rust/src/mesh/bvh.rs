//! Result types for BVH-accelerated spatial queries on [`Mesh`](super::Mesh).

use crate::float_types::Real;
use nalgebra::{Point3, Vector3};

/// Result of a BVH-accelerated first-hit raycast against a mesh.
///
/// The BVH is provided by Parry's internal `TriMesh` acceleration structure,
/// giving O(log n) ray–triangle performance.
#[derive(Debug, Clone)]
pub struct RaycastHit {
    /// 3-D world-space position of the hit.
    pub point: Point3<Real>,
    /// Surface normal at the hit (unit vector, faces outward from mesh).
    pub normal: Vector3<Real>,
    /// Parametric distance along the ray (`ray.origin + distance * ray.dir`).
    pub distance: Real,
    /// Index of the hit triangle in the Parry `TriMesh` face list.
    pub triangle_index: u32,
}

/// Result of projecting a point onto the nearest surface of a mesh.
#[derive(Debug, Clone)]
pub struct ClosestPointResult {
    /// Nearest point on the mesh surface.
    pub point: Point3<Real>,
    /// Approximate outward surface normal at the nearest point.
    ///
    /// Computed as the normalised direction from `point` to the query point
    /// (reversed if the query is inside).
    pub normal: Vector3<Real>,
    /// Euclidean distance from the query to the surface.
    pub distance: Real,
    /// Whether the query point is inside the mesh (useful for SDF sign).
    pub is_inside: bool,
}

/// Signed-distance-field sample at a query point against a mesh.
#[derive(Debug, Clone)]
pub struct SdfSample {
    /// Signed distance: **negative** inside the mesh, **positive** outside.
    pub distance: Real,
    /// Whether the query point is inside the mesh (`distance < 0`).
    pub is_inside: bool,
    /// Nearest point on the mesh surface.
    pub closest_point: Point3<Real>,
}
