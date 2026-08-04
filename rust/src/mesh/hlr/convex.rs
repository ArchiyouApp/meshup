//! Convexity test.
//!
//! The per-shape drawing strategies (`'clip'` and `'painter'`) are exact only
//! for convex bodies: it is convexity that makes "a face is visible iff it faces
//! the viewer" true, and that guarantees two disjoint bodies have a separating
//! plane to order them by. Everything else has to fall back to a general solver,
//! so this predicate is the gate in front of those paths.

use std::fmt::Debug;

use crate::csg::CSG;
use crate::float_types::Real;
use crate::mesh::Mesh;

/// How far outside a face plane a vertex may sit, relative to scene extent,
/// before the mesh is judged non-convex. Loose enough to tolerate the vertex
/// welding and BSP splitting that CSG leaves behind, tight enough that a real
/// dent fails.
const CONVEX_TOL_REL: Real = 1e-6;

impl<S: Clone + Send + Sync + Debug> Mesh<S> {
    /// Whether every vertex lies on the inner side of every face plane.
    ///
    /// Boxes, prisms, cylinders and spheres pass; anything with a notch,
    /// through-hole or re-entrant corner fails. An empty mesh is not convex —
    /// there is no body to draw.
    ///
    /// Cost is `O(vertices × faces)`, which is why callers with a cheaper
    /// sufficient test (a cuboid check, say) should try that first.
    pub fn is_convex(&self) -> bool {
        if self.polygons.is_empty() {
            return false;
        }

        let bb = self.bounding_box();
        let d = bb.maxs - bb.mins;
        let extent = d.x.max(d.y).max(d.z);
        if !extent.is_finite() || extent <= 0.0 {
            return false; // degenerate: no volume to be convex about
        }
        let tol = CONVEX_TOL_REL * extent;

        // A hole means a re-entrant boundary, which no convex solid has.
        if self.polygons.iter().any(|p| !p.holes.is_empty()) {
            return false;
        }

        for poly in &self.polygons {
            let normal = poly.plane.normal().normalize();
            if !normal.x.is_finite() {
                continue; // degenerate face carries no constraint
            }
            let Some(anchor) = poly.vertices.first() else {
                continue;
            };
            let offset = anchor.position.coords.dot(&normal);

            for other in &self.polygons {
                for v in &other.vertices {
                    if v.position.coords.dot(&normal) - offset > tol {
                        return false;
                    }
                }
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use crate::csg::CSG;
    use crate::mesh::Mesh;

    #[test]
    fn a_cube_is_convex() {
        let cube: Mesh<()> = Mesh::cube(10.0, None);
        assert!(cube.is_convex());
    }

    #[test]
    fn a_sphere_is_convex() {
        let sphere: Mesh<()> = Mesh::sphere(5.0, 16, 8, None);
        assert!(sphere.is_convex());
    }

    #[test]
    fn a_notched_cube_is_not_convex() {
        let cube: Mesh<()> = Mesh::cube(10.0, None);
        let notch: Mesh<()> = Mesh::cube(4.0, None).translate(8.0, 8.0, 8.0);
        assert!(!cube.difference(&notch).is_convex());
    }

    #[test]
    fn an_empty_mesh_is_not_convex() {
        let empty: Mesh<()> = Mesh::new();
        assert!(!empty.is_convex());
    }

    #[test]
    fn convexity_does_not_depend_on_model_size() {
        // The tolerance is relative, so the same shape must answer the same way
        // whether it was drawn in metres or micrometres.
        for size in [0.01, 1.0, 100.0, 10_000.0] {
            let cube: Mesh<()> = Mesh::cube(size, None);
            assert!(cube.is_convex(), "cube of size {size} should be convex");

            let notch: Mesh<()> = Mesh::cube(size * 0.4, None)
                .translate(size * 0.8, size * 0.8, size * 0.8);
            assert!(
                !cube.difference(&notch).is_convex(),
                "notched cube of size {size} should not be convex"
            );
        }
    }
}
