//! Hidden-line-removal solvers that compute occlusion rather than sample it.
//!
//! [`crate::mesh::edge_projection`] owns the front half of the pipeline — edge
//! extraction, collinear merging, silhouette/crease classification — and the
//! original sampling solver. Read its module docs first: everything here reuses
//! stages 1-3 unchanged and replaces only the visibility step.
//!
//! # The four strategies
//!
//! Selected per call with [`crate::mesh::edge_projection::HlrStrategy`] from
//! Rust, or a `strategy` option on `isometry`/`elevation`/`section` from
//! TypeScript. They exist side by side so they can be compared on one model.
//!
//! | strategy | lives in | occlusion decided by | requires |
//! |---|---|---|---|
//! | `raycast` | `edge_projection` | rays fired at sample points | — |
//! | `exact` | [`exact`] | parametric clip + closed-form depth | — |
//! | `clip` | TS `ShapeCollection` | [`exact`], per shape vs its siblings | convex, disjoint |
//! | `painter` | TS `ShapeCollection` | paint order — nothing is computed | convex, disjoint |
//!
//! ## `raycast` — sample and bisect
//!
//! The original, and the default. Probes visibility at points along each edge
//! and bisects where neighbouring probes disagree. Endpoints are only located to
//! bisection depth, and an occluder narrower than the probe spacing is never
//! straddled by two disagreeing probes, so it is never found at all. See
//! [`crate::mesh::edge_projection`] for the mechanism and both failure modes.
//!
//! ## `exact` — clip and solve
//!
//! Projects everything once into a view basis, indexes the occluder triangles in
//! a 2-D BVH ([`bvh2d`]), and for each edge/triangle pair clips the segment to
//! the triangle's projected outline and then solves the depth crossing in closed
//! form. Occluded ranges accumulate in an `intervals::IntervalSet`; inverting
//! it gives the visible pieces. Correct on any geometry, with no preconditions,
//! and faster than `raycast` in practice. See [`exact`].
//!
//! ## `clip` — per shape, occluded by its siblings
//!
//! Orchestrated in TypeScript (`ShapeCollection._projectPerShape`), but the
//! occlusion itself is [`exact`]: each shape is projected with the *other*
//! shapes as occluders, and no BSP merge happens at all.
//!
//! It needs no explicit front-to-back reasoning because a sibling behind the
//! shape simply fails the depth test and clips nothing — "what is in front" is
//! already encoded in the depth comparison. Skipping the merge is what preserves
//! which shape each edge came from, which is in turn what lets per-shape styling
//! and grouping work, what keeps contact edges between touching solids, and what
//! stops a large assembly from falling over inside the BSP.
//!
//! Exact only for convex, non-interpenetrating shapes: convexity is what makes
//! "a face is visible iff it faces the viewer" true. [`convex`] is the gate —
//! note a cuboid test is *not* sufficient, since a cube with a notch cut out of
//! it still passes one.
//!
//! ## `painter` — compute nothing
//!
//! Also TypeScript. Each shape is projected against nothing but itself, giving
//! its own self-occluded wireframe, and its front faces are emitted as opaque
//! closed outlines. Shapes are written back to front, so a nearer shape's fill
//! covers whatever was drawn before it — the paint order *is* the occlusion.
//! Overlapping front faces of one convex body cover exactly its silhouette, so
//! that silhouette never has to be assembled as a polygon.
//!
//! In practice this has not paid off: generating and emitting the fills costs
//! more than the occlusion it avoids, and the fills make the output unusable for
//! DXF. It earns its keep as a comparison baseline.
//!
//! # Linear shapes
//!
//! [`project_polylines_exact`] projects free-standing curves — a wireframe, a
//! centreline, imported linework — against the same occluders through the same
//! occluder set. Mesh edges and curves are the same question asked of the same
//! geometry, so they must not answer it differently. Curves are hidden by solids
//! but never occlude anything, having no area.

pub mod bvh2d;
pub mod convex;
pub mod exact;
pub mod intervals;

pub use exact::{project_edges_exact, project_polylines_exact};
