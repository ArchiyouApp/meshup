//! Hidden-line-removal algorithms that compute occlusion rather than sample it.
//!
//! [`crate::mesh::edge_projection`] holds the original sampling solver and the
//! shared front half of the pipeline (edge extraction, collinear merging,
//! silhouette/crease classification). This module holds the alternatives, which
//! reuse that front half unchanged and replace only the visibility step.
//!
//! Select between them with
//! [`crate::mesh::edge_projection::HlrStrategy`].

pub mod bvh2d;
pub mod convex;
pub mod exact;
pub mod intervals;

pub use exact::project_edges_exact;
