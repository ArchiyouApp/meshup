//! Edge projection with BVH-accelerated hidden-line removal (HLR).
//!
//! Inspired by [`three-edge-projection`](https://github.com/gkjohnson/three-edge-projection).
//!
//! # Pipeline
//! 1. Triangulate the mesh and record each edge's adjacent face normals.
//! 2. Classify edges as **boundary**, **silhouette**, or **feature/crease**.
//!    Back-facing smooth interior edges are discarded.
//! 3. For each surviving edge, sample `n_samples` positions along it, cast a
//!    ray toward the viewer against all occluder TriMeshes, and tag each sample
//!    visible/hidden.
//! 4. Consecutive same-visibility samples are merged into projected polylines.

use std::collections::HashMap;
use std::fmt::Debug;

use nalgebra::{Point3, Vector3};

use crate::float_types::{
    parry3d::query::RayCast,
    rapier3d::prelude::{Ray, TriMesh},
    {Real, tolerance},
};
use crate::mesh::Mesh;

const EDGE_FEATURE_ANGLE_MIN_DEG: Real = 0.0;
const EDGE_FEATURE_ANGLE_MAX_DEG: Real = 180.0;
const EDGE_MIN_SAMPLES: usize = 2;
const EDGE_MAX_SAMPLES: usize = 4096;
const EDGE_TARGET_PROJECTED_SEGMENT_LEN: Real = 25.0;
const EDGE_MIN_PROJECTED_SEGMENT_LEN: Real = 1.0;
const EDGE_ADAPTIVE_MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Copy)]
struct EdgeVisibilitySample {
    t: Real,
    visible: bool,
}

// ─── public result types ─────────────────────────────────────────────────────

/// A polyline of 3-D points that lie on the projection plane.
pub type Polyline3D = Vec<Point3<Real>>;

/// Output of [`Mesh::project_edges`].
#[derive(Debug, Clone, Default)]
pub struct EdgeProjectionResult {
    /// Polylines whose samples are unoccluded (visible to the viewer).
    pub visible_polylines: Vec<Polyline3D>,
    /// Polylines whose samples are occluded (hidden behind other geometry).
    pub hidden_polylines: Vec<Polyline3D>,
    /// Indices into `visible_polylines` whose source edge is a silhouette
    /// or naked boundary — i.e. the outer contour of the projection.
    /// Returned as indices rather than duplicated polylines so the consumer
    /// can tag the existing visible shapes in-place without doubling memory
    /// or shape counts.
    pub silhouette_indices: Vec<u32>,
}

/// Classification of an edge with respect to the current view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EdgeKind {
    /// Naked edge of an open mesh (single adjacent face).
    Boundary,
    /// Adjacent faces straddle the view direction — part of the outer contour.
    Silhouette,
    /// Dihedral crease between two faces, both facing the same side of the view.
    Feature,
}

impl EdgeKind {
    /// Edges that contribute to the outer contour of the projection.
    #[inline]
    fn is_outline(self) -> bool {
        matches!(self, EdgeKind::Boundary | EdgeKind::Silhouette)
    }
}

/// Output of [`Mesh::project_edges_section`].
#[cfg(feature = "sketch")]
#[derive(Debug, Clone)]
pub struct SectionElevationResult<S: Clone + Debug + Send + Sync> {
    /// 2-D sketch of the cut outline produced by slicing the mesh.
    pub cut: crate::sketch::Sketch<S>,
    /// Visible projected edge polylines.
    pub visible_polylines: Vec<Polyline3D>,
    /// Hidden projected edge polylines.
    pub hidden_polylines: Vec<Polyline3D>,
    /// Indices into `visible_polylines` forming the outer silhouette.
    /// See [`EdgeProjectionResult::silhouette_indices`].
    pub silhouette_indices: Vec<u32>,
}

// ─── Mesh impl ───────────────────────────────────────────────────────────────

impl<S: Clone + Send + Sync + Debug> Mesh<S> {
    /// Project silhouette, boundary, and feature edges onto a plane with
    /// full BVH-accelerated hidden-line removal.
    ///
    /// # Parameters
    /// - `view_normal` — direction toward the viewer (used for silhouette
    ///   classification and as the ray direction for HLR).
    /// - `plane_origin` / `plane_normal` — defines the projection plane.
    ///   Both endpoints of each edge are projected onto this plane before
    ///   chaining into polylines.
    /// - `feature_angle_deg` — minimum dihedral angle (degrees) between
    ///   adjacent face normals for an edge to be considered a feature crease.
    ///   Typical value: `15.0` (matches three-edge-projection default).
    ///   Accepted range is `[0, 180]`; the threshold is monotonic so higher
    ///   values strictly drop more crease edges. On smooth tessellated
    ///   surfaces (spheres, cylinders) the default low threshold keeps almost
    ///   every triangle edge, which moves the cost into the per-sample HLR
    ///   ray casts — raise it to reduce work, or pre-decimate the mesh.
    /// - `n_samples` — number of visibility samples per edge.
    ///   More samples give finer HLR at the cost of more ray casts.
    /// - `occluders` — additional meshes that can occlude edges of `self`.
    ///   The mesh itself is always included as an occluder.
    pub fn project_edges(
        &self,
        view_normal: &Vector3<Real>,
        plane_origin: &Point3<Real>,
        plane_normal: &Vector3<Real>,
        feature_angle_deg: Real,
        n_samples: usize,
        occluders: &[&Mesh<S>],
    ) -> EdgeProjectionResult {
        // Build TriMesh for self + all additional occluders.
        let mut trimeshes: Vec<TriMesh> = Vec::new();
        if let Some(t) = self.to_trimesh() {
            trimeshes.push(t);
        }
        for m in occluders {
            if let Some(t) = m.to_trimesh() {
                trimeshes.push(t);
            }
        }

        let view_dir = view_normal.normalize();
        let plane_n = plane_normal.normalize();
        let feature_thresh = normalize_feature_angle_rad(feature_angle_deg);
        let n = n_samples.max(EDGE_MIN_SAMPLES);

        // Pre-compute a `far_dist` large enough to start rays beyond the entire
        // scene along the view direction.  Used by the back-to-front HLR casts.
        let far_dist: Real = {
            let mut max_d: Real = 1.0;
            for tm in &trimeshes {
                for v in tm.vertices() {
                    let d = v.coords.dot(&view_dir).abs();
                    if d > max_d { max_d = d; }
                }
            }
            max_d * 4.0 + 1.0
        };

        let raw_edges = extract_edges(self);
        // Merge collinear edge segments that have the same face-normal signature.
        // BSP splitting creates extra vertices on existing edges (e.g. a cube edge
        // split at an intersecting BSP plane), producing collinear sub-edges that
        // would otherwise appear as multiple separate polylines.
        let edges = merge_collinear_edges(raw_edges);
        let mut result = EdgeProjectionResult::default();

        for (_key, edge) in &edges {
            // Skip degenerate edges (zero-length or near-zero after merging)
            if (edge.v1 - edge.v0).norm() < 1e-6 {
                continue;
            }
            let kind = match classify_edge(&edge.face_normals, &view_dir, feature_thresh) {
                Some(k) => k,
                None => continue,
            };

            let proj_v0 = project_point(&edge.v0, plane_origin, &plane_n);
            let proj_v1 = project_point(&edge.v1, plane_origin, &plane_n);
            let projected_len = (proj_v1 - proj_v0).norm();
            let vis = hlr_sample_edge(
                &edge.v0,
                &edge.v1,
                &trimeshes,
                &view_dir,
                n,
                far_dist,
                projected_len,
            );

            chain_segments(&vis, &proj_v0, &proj_v1, kind, &mut result);
        }

        result
    }

    /// Slice the mesh at `section_plane` and project its visible edges.
    ///
    /// Returns the cut `Sketch`, visible edge polylines, and hidden edge
    /// polylines, suitable for architectural section-elevation drawings.
    #[cfg(feature = "sketch")]
    pub fn project_edges_section(
        &self,
        section_normal: &Vector3<Real>,
        section_offset: Real,
        view_normal: &Vector3<Real>,
        plane_origin: &Point3<Real>,
        plane_normal: &Vector3<Real>,
        feature_angle_deg: Real,
        n_samples: usize,
        occluders: &[&Mesh<S>],
    ) -> SectionElevationResult<S> {
        use crate::mesh::plane::Plane;
        let cut_plane = Plane::from_normal(*section_normal, section_offset);
        let cut = self.slice(cut_plane);
        let edge_result = self.project_edges(
            view_normal,
            plane_origin,
            plane_normal,
            feature_angle_deg,
            n_samples,
            occluders,
        );
        SectionElevationResult {
            cut,
            visible_polylines: edge_result.visible_polylines,
            hidden_polylines: edge_result.hidden_polylines,
            silhouette_indices: edge_result.silhouette_indices,
        }
    }
}

// ─── internal record ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct EdgeRecord {
    v0: Point3<Real>,
    v1: Point3<Real>,
    /// Normals of the faces adjacent to this edge.
    face_normals: Vec<Vector3<Real>>,
}

// Canonical edge key: two quantised vertex triples in lexicographic order.
type EdgeKey = (i64, i64, i64, i64, i64, i64);

/// Quantise a coordinate to a stable integer (1 µm grid).
#[inline]
fn q(x: Real) -> i64 {
    (x * 1_000_000.0).round() as i64
}

#[inline]
fn vkey(p: &Point3<Real>) -> (i64, i64, i64) {
    (q(p.x), q(p.y), q(p.z))
}

// ─── helpers: edge extraction ─────────────────────────────────────────────────

/// Extract edges from polygon **boundaries** (not triangulation edges).
///
/// Using polygon boundary edges rather than triangle edges prevents collinear
/// interior triangulation edges — commonly introduced by CSG operations — from
/// appearing as separate feature edges and inflating the edge count.
///
/// Each polygon contributes:
/// - Its outer boundary edges (consecutive vertex pairs, wrapping around).
/// - Each hole's boundary edges.
///
/// The polygon's face normal is recorded against every one of its edges so that
/// `should_keep_edge` can classify silhouette / feature / back-facing edges.
fn extract_edges<S: Clone + Debug + Send + Sync>(
    mesh: &Mesh<S>,
) -> HashMap<EdgeKey, EdgeRecord> {
    let mut edges: HashMap<EdgeKey, EdgeRecord> = HashMap::new();

    for poly in &mesh.polygons {
        // Use the polygon's own plane normal (already computed and normalised).
        let face_normal: Vector3<Real> = poly.plane.normal().normalize();

        // Collect all boundary rings: outer vertices + each hole.
        let rings: Vec<&Vec<crate::vertex::Vertex>> =
            std::iter::once(&poly.vertices)
                .chain(poly.holes.iter())
                .collect();

        for ring in rings {
            let n = ring.len();
            if n < 2 { continue; }
            for i in 0..n {
                let a = ring[i].position;
                let b = ring[(i + 1) % n].position;
                let (ka, kb) = (vkey(&a), vkey(&b));
                if ka == kb { continue; } // zero-length edge
                let key: EdgeKey = if ka <= kb {
                    (ka.0, ka.1, ka.2, kb.0, kb.1, kb.2)
                } else {
                    (kb.0, kb.1, kb.2, ka.0, ka.1, ka.2)
                };
                let rec = edges.entry(key).or_insert_with(|| EdgeRecord {
                    v0: a,
                    v1: b,
                    face_normals: Vec::new(),
                });
                rec.face_normals.push(face_normal);
            }
        }
    }

    edges
}

// ─── helpers: collinear edge merging ─────────────────────────────────────────

/// Quantise a direction vector to a canonical signed integer triple.
/// Two edges are collinear iff their direction vectors (or negations) have the
/// same canonical key.  The sign convention: first non-zero component is positive.
#[inline]
fn dir_key(d: &Vector3<Real>) -> (i64, i64, i64) {
    // Normalise then quantise to 1e-4 grid.
    let len = d.norm();
    if len < 1e-12 {
        return (0, 0, 0);
    }
    let n = d / len;
    let ix = (n.x * 10_000.0).round() as i64;
    let iy = (n.y * 10_000.0).round() as i64;
    let iz = (n.z * 10_000.0).round() as i64;
    // Make canonical: flip so first non-zero component is positive.
    if ix < 0 || (ix == 0 && iy < 0) || (ix == 0 && iy == 0 && iz < 0) {
        (-ix, -iy, -iz)
    } else {
        (ix, iy, iz)
    }
}

/// Normal signature for an edge: sorted pair of quantised normal keys.
/// Used to group edges that lie between the same pair of geometric faces.
type NormalSig = ((i64, i64, i64), (i64, i64, i64));

fn normal_sig(face_normals: &[Vector3<Real>]) -> NormalSig {
    if face_normals.is_empty() {
        return ((0, 0, 0), (0, 0, 0));
    }
    let k0 = {
        let n = face_normals[0];
        let s = if n.x < 0.0 || (n.x == 0.0 && n.y < 0.0) || (n.x == 0.0 && n.y == 0.0 && n.z < 0.0) { -1.0 } else { 1.0 };
        ((n.x * s * 1000.0).round() as i64, (n.y * s * 1000.0).round() as i64, (n.z * s * 1000.0).round() as i64)
    };
    if face_normals.len() < 2 {
        let mut pair = (k0, k0);
        if pair.0 > pair.1 { std::mem::swap(&mut pair.0, &mut pair.1); }
        return pair;
    }
    let k1 = {
        let n = face_normals[1];
        let s = if n.x < 0.0 || (n.x == 0.0 && n.y < 0.0) || (n.x == 0.0 && n.y == 0.0 && n.z < 0.0) { -1.0 } else { 1.0 };
        ((n.x * s * 1000.0).round() as i64, (n.y * s * 1000.0).round() as i64, (n.z * s * 1000.0).round() as i64)
    };
    let mut pair = (k0, k1);
    if pair.0 > pair.1 { std::mem::swap(&mut pair.0, &mut pair.1); }
    pair
}

/// Merge collinear consecutive edge segments that share the same face-normal signature.
///
/// After CSG/BSP operations, a single logical edge (e.g. a cube edge) may be split into
/// several collinear segments by the BSP planes of the operand mesh.  This function
/// stitches them back together so each logical edge appears as one `EdgeRecord`.
fn merge_collinear_edges(
    edges: HashMap<EdgeKey, EdgeRecord>,
) -> HashMap<EdgeKey, EdgeRecord> {
    // ── 1. Group edges by (direction, normal_signature) ───────────────────
    // key: (dir_key, normal_sig)
    type GroupKey = ((i64, i64, i64), NormalSig);
    let mut groups: HashMap<GroupKey, Vec<EdgeRecord>> = HashMap::new();

    for (_, rec) in edges {
        let dir = rec.v1 - rec.v0;
        let dk = dir_key(&dir);
        let ns = normal_sig(&rec.face_normals);
        groups.entry((dk, ns)).or_default().push(rec);
    }

    let mut result: HashMap<EdgeKey, EdgeRecord> = HashMap::new();

    for ((dk, _ns), group) in groups {
        if dk == (0, 0, 0) {
            // degenerate
            for rec in group {
                let (ka, kb) = (vkey(&rec.v0), vkey(&rec.v1));
                let key = if ka <= kb { (ka.0,ka.1,ka.2,kb.0,kb.1,kb.2) } else { (kb.0,kb.1,kb.2,ka.0,ka.1,ka.2) };
                result.insert(key, rec);
            }
            continue;
        }

        // ── 2. Build adjacency: endpoint → list of edge indices ───────────
        // Only edges that are actually collinear (same direction key) are in this group.
        // We want to chain them: find sequences where v1 of one = v0 of next.

        // Build a map from quantised vertex key to edge index (both endpoints)
        let mut endpoint_map: HashMap<(i64,i64,i64), Vec<usize>> = HashMap::new();
        for (i, rec) in group.iter().enumerate() {
            endpoint_map.entry(vkey(&rec.v0)).or_default().push(i);
            endpoint_map.entry(vkey(&rec.v1)).or_default().push(i);
        }

        let mut used = vec![false; group.len()];

        // ── 3. Walk chains from endpoints (vertices with degree == 1) ─────
        // A chain start is a vertex that appears in only one edge of this group.
        let chain_starts: Vec<usize> = (0..group.len())
            .filter(|&i| {
                let k0 = vkey(&group[i].v0);
                let k1 = vkey(&group[i].v1);
                endpoint_map[&k0].len() == 1 || endpoint_map[&k1].len() == 1
            })
            .collect();

        // Helper: walk from an edge in a direction to build the merged span.
        let walk_chain = |start_idx: usize, used: &mut Vec<bool>, group: &[EdgeRecord], ep_map: &HashMap<(i64,i64,i64), Vec<usize>>| -> EdgeRecord {
            used[start_idx] = true;
            let mut chain_start = group[start_idx].v0;
            let mut chain_end = group[start_idx].v1;
            let face_normals = group[start_idx].face_normals.clone();

            // Extend forward (from chain_end)
            loop {
                let ek = vkey(&chain_end);
                let next = ep_map.get(&ek).and_then(|idxs| {
                    idxs.iter().find(|&&j| !used[j]).copied()
                });
                match next {
                    Some(j) => {
                        used[j] = true;
                        // chain_end is either group[j].v0 or group[j].v1
                        if vkey(&group[j].v0) == ek {
                            chain_end = group[j].v1;
                        } else {
                            chain_end = group[j].v0;
                        }
                    }
                    None => break,
                }
            }

            // Extend backward (from chain_start)
            loop {
                let sk = vkey(&chain_start);
                let prev = ep_map.get(&sk).and_then(|idxs| {
                    idxs.iter().find(|&&j| !used[j]).copied()
                });
                match prev {
                    Some(j) => {
                        used[j] = true;
                        if vkey(&group[j].v1) == sk {
                            chain_start = group[j].v0;
                        } else {
                            chain_start = group[j].v1;
                        }
                    }
                    None => break,
                }
            }

            EdgeRecord { v0: chain_start, v1: chain_end, face_normals }
        };

        // Start walks from chain start edges first
        let mut processed_starts: std::collections::HashSet<usize> = std::collections::HashSet::new();
        for &si in &chain_starts {
            if used[si] { continue; }
            processed_starts.insert(si);
            let merged = walk_chain(si, &mut used, &group, &endpoint_map);
            let (ka, kb) = (vkey(&merged.v0), vkey(&merged.v1));
            let key = if ka <= kb { (ka.0,ka.1,ka.2,kb.0,kb.1,kb.2) } else { (kb.0,kb.1,kb.2,ka.0,ka.1,ka.2) };
            result.insert(key, merged);
        }

        // Handle any remaining (e.g. isolated single edges or loops)
        for i in 0..group.len() {
            if used[i] { continue; }
            let merged = walk_chain(i, &mut used, &group, &endpoint_map);
            let (ka, kb) = (vkey(&merged.v0), vkey(&merged.v1));
            let key = if ka <= kb { (ka.0,ka.1,ka.2,kb.0,kb.1,kb.2) } else { (kb.0,kb.1,kb.2,ka.0,ka.1,ka.2) };
            result.insert(key, merged);
        }
    }

    result
}

// ─── helpers: edge classification ─────────────────────────────────────────────

/// Classify an edge with respect to the current view direction, returning the
/// kind to keep or `None` if it should be discarded.
///
/// Rules (in priority order):
/// - **Boundary** (one adjacent face): always keep.
/// - **Coplanar check first**: if adjacent faces lie on the same geometric plane
///   (`|n0 · n1|` close to 1) the edge is a BSP-split artifact or interior
///   tessellation edge — always skip. Both parallel (same-direction coplanar)
///   and anti-parallel (opposite-winding CSG artifact) cases are caught.
/// - **Silhouette**: adjacent faces straddle the silhouette plane
///   (`dot(n0, view) × dot(n1, view) ≤ 0`).
/// - **Feature/crease**: angle between adjacent face normals ≥ `feature_thresh`.
///   Kept for all orientations; HLR will classify as visible or hidden.
///   *Performance note:* once the coplanar guard passes, this branch keeps
///   the edge unconditionally. On smooth tessellated surfaces (spheres,
///   cylinders) almost every triangle edge passes a modest threshold, so the
///   bulk of the work shifts to the HLR ray casts. Increase
///   `feature_angle_deg` to drop more crease edges before HLR.
/// - Otherwise: skip (returns `None`).
///
/// `feature_thresh` is in radians, in the range `[0, π]`. The test uses
/// `|n0 · n1| > cos(feature_thresh)` so the threshold behaves monotonically
/// across the full range: increasing it strictly grows the set of edges
/// classified as coplanar. (The previous `sin(thresh)`-based check folded
/// values >90° back to their supplement.)
fn classify_edge(
    face_normals: &[Vector3<Real>],
    view_dir: &Vector3<Real>,
    feature_thresh: Real,
) -> Option<EdgeKind> {
    match face_normals.len() {
        0 => None,
        1 => Some(EdgeKind::Boundary), // naked edge of an open mesh
        _ => {
            let n0 = face_normals[0];
            let n1 = face_normals[1];

            // Coplanar guard via `|cos(angle)| > cos(threshold)`. Equivalent
            // to the previous `|cross|² < sin²(threshold)` check for
            // thresholds in [0°, 90°], but monotonic across [0°, 180°]:
            // thresholds above 90° produce a negative `cos_thresh` and the
            // guard rejects every edge past this point (only boundaries and
            // silhouettes survive). The absolute value also catches the
            // anti-parallel (opposite-winding) case where dot ≈ -1.
            let dot = n0.dot(&n1);
            let cos_thresh = feature_thresh.cos();
            if dot.abs() > cos_thresh {
                return None;
            }

            let d0 = n0.dot(view_dir);
            let d1 = n1.dot(view_dir);

            // Silhouette: sign change across view direction
            if d0 * d1 <= 0.0 {
                return Some(EdgeKind::Silhouette);
            }

            // Feature crease: dihedral angle ≥ threshold (already ensured by the
            // coplanar guard above).
            // Keep back-facing feature edges too — HLR will classify as hidden.
            Some(EdgeKind::Feature)
        }
    }
}

/// Back-compat shim for existing tests that only care whether an edge is kept.
#[cfg(test)]
fn should_keep_edge(
    face_normals: &[Vector3<Real>],
    view_dir: &Vector3<Real>,
    feature_thresh: Real,
) -> bool {
    classify_edge(face_normals, view_dir, feature_thresh).is_some()
}

// ─── helpers: orthographic projection ─────────────────────────────────────────

/// Project `p` orthographically onto the plane `(origin, normal)`.
#[inline]
fn project_point(
    p: &Point3<Real>,
    origin: &Point3<Real>,
    normal: &Vector3<Real>,
) -> Point3<Real> {
    let d = (*p - *origin).dot(normal);
    Point3::from(p.coords - normal * d)
}

// ─── helpers: HLR ray sampling ───────────────────────────────────────────────

/// Sample `n` positions along edge `(v0, v1)` and return a visibility flag
/// for each (`true` = visible, `false` = hidden).
///
/// Rays are cast **back-to-front**: from `far_dist` units ahead of each sample
/// in the view direction, back toward the sample, stopping `min_gap` before the
/// sample to avoid self-intersection.  Because the ray always originates outside
/// the mesh, only front-face intersections need to be checked (`solid = false`).
///
/// This correctly classifies both:
/// - Front-facing visible edges (no occluder between sample and viewer).
/// - Back-facing hidden edges (the mesh itself occludes the sample — the reverse
///   ray hits a front face of the closed shell before reaching the back edge).
fn hlr_sample_edge(
    v0: &Point3<Real>,
    v1: &Point3<Real>,
    trimeshes: &[TriMesh],
    view_dir: &Vector3<Real>,
    n: usize,
    far_dist: Real,
    projected_len: Real,
) -> Vec<EdgeVisibilitySample> {
    // Stop just before reaching the sample to skip the surface self-intersection.
    let min_gap = tolerance() * 100.0;
    let toi_limit = far_dist - min_gap;
    let edge_len = (v1 - v0).norm();
    let base_sample_count = allocated_sample_count_for_projected_length(n, projected_len);

    if edge_len <= tolerance() * 10.0 {
        let p = Point3::from((v0.coords + v1.coords) * 0.5);
        let ray_origin = Point3::from(p.coords + view_dir * far_dist);
        let ray = Ray::new(ray_origin, -(*view_dir));
        let visible = !trimeshes
            .iter()
            .any(|tm| tm.cast_local_ray(&ray, toi_limit, false).is_some());
        return vec![
            EdgeVisibilitySample { t: 0.0, visible },
            EdgeVisibilitySample { t: 1.0, visible },
        ];
    }

    // Keep the original 2% inset for normal and long edges because that is
    // robust against vertex-coincident misses, but taper it down for genuinely
    // short edges so they are not disproportionately shortened.
    let short_edge_threshold = tolerance() * 5_000.0;
    let short_edge_t = 0.002;
    let long_edge_t = 0.02;
    let t_min = if edge_len >= short_edge_threshold {
        long_edge_t
    } else {
        let alpha = (edge_len / short_edge_threshold).clamp(0.0, 1.0);
        short_edge_t + (long_edge_t - short_edge_t) * alpha
    }
    .clamp(0.0, 0.49);
    let t_max = 1.0 - t_min;

    let base_samples: Vec<EdgeVisibilitySample> = (0..base_sample_count)
        .map(|i| {
            let t_raw = i as Real / (base_sample_count - 1) as Real;
            let t = t_min + t_raw * (t_max - t_min);
            EdgeVisibilitySample {
                t,
                visible: sample_edge_visibility(
                    v0,
                    v1,
                    trimeshes,
                    view_dir,
                    far_dist,
                    toi_limit,
                    t,
                ),
            }
        })
        .collect();

    let adaptive_min_t_span = adaptive_min_t_span_for_projected_length(projected_len);
    let mut refined_samples: Vec<EdgeVisibilitySample> = Vec::with_capacity(base_samples.len() + 2);
    if let Some(first) = base_samples.first().copied() {
        refined_samples.push(EdgeVisibilitySample {
            t: 0.0,
            visible: first.visible,
        });
    }
    for i in 0..base_samples.len() - 1 {
        let left = base_samples[i];
        let right = base_samples[i + 1];
        if i == 0 {
            refined_samples.push(left);
        }

        if left.visible != right.visible {
            collect_transition_samples(
                &mut refined_samples,
                v0,
                v1,
                trimeshes,
                view_dir,
                far_dist,
                toi_limit,
                left,
                right,
                adaptive_min_t_span,
                0,
            );
        }

        if refined_samples.len() >= EDGE_MAX_SAMPLES {
            break;
        }
        refined_samples.push(right);
    }

    if refined_samples.last().map(|s| s.t < 1.0).unwrap_or(true) {
        refined_samples.push(EdgeVisibilitySample {
            t: 1.0,
            visible: base_samples.last().map(|s| s.visible).unwrap_or(true),
        });
    }

    refined_samples
}

fn sample_edge_visibility(
    v0: &Point3<Real>,
    v1: &Point3<Real>,
    trimeshes: &[TriMesh],
    view_dir: &Vector3<Real>,
    far_dist: Real,
    toi_limit: Real,
    t: Real,
) -> bool {
    let p = Point3::from(v0.coords + (v1.coords - v0.coords) * t);
    let ray_origin = Point3::from(p.coords + view_dir * far_dist);
    let ray = Ray::new(ray_origin, -(*view_dir));
    !trimeshes
        .iter()
        .any(|tm| tm.cast_local_ray(&ray, toi_limit, false).is_some())
}

fn collect_transition_samples(
    out: &mut Vec<EdgeVisibilitySample>,
    v0: &Point3<Real>,
    v1: &Point3<Real>,
    trimeshes: &[TriMesh],
    view_dir: &Vector3<Real>,
    far_dist: Real,
    toi_limit: Real,
    left: EdgeVisibilitySample,
    right: EdgeVisibilitySample,
    min_t_span: Real,
    depth: usize,
) {
    if depth >= EDGE_ADAPTIVE_MAX_DEPTH || out.len() >= EDGE_MAX_SAMPLES {
        return;
    }

    let span = right.t - left.t;
    if span <= min_t_span {
        return;
    }

    let mid_t = (left.t + right.t) * 0.5;
    let mid = EdgeVisibilitySample {
        t: mid_t,
        visible: sample_edge_visibility(
            v0,
            v1,
            trimeshes,
            view_dir,
            far_dist,
            toi_limit,
            mid_t,
        ),
    };

    if left.visible != mid.visible {
        collect_transition_samples(
            out,
            v0,
            v1,
            trimeshes,
            view_dir,
            far_dist,
            toi_limit,
            left,
            mid,
            min_t_span,
            depth + 1,
        );
    }

    if out.last().map(|s| (s.t - mid.t).abs() > tolerance()).unwrap_or(true) {
        out.push(mid);
    }

    if mid.visible != right.visible {
        collect_transition_samples(
            out,
            v0,
            v1,
            trimeshes,
            view_dir,
            far_dist,
            toi_limit,
            mid,
            right,
            min_t_span,
            depth + 1,
        );
    }
}

#[inline]
fn allocated_sample_count_for_projected_length(base_samples: usize, projected_len: Real) -> usize {
    let base = base_samples.max(EDGE_MIN_SAMPLES);
    if !projected_len.is_finite() || projected_len <= tolerance() {
        return base;
    }

    let length_based_segments = (projected_len / EDGE_TARGET_PROJECTED_SEGMENT_LEN)
        .ceil()
        .max(1.0) as usize;
    (length_based_segments + 1)
        .max(base)
        .min(EDGE_MAX_SAMPLES)
}

#[inline]
fn adaptive_min_t_span_for_projected_length(projected_len: Real) -> Real {
    if !projected_len.is_finite() || projected_len <= tolerance() {
        return 0.5;
    }

    (EDGE_MIN_PROJECTED_SEGMENT_LEN / projected_len)
        .clamp(1.0 / EDGE_MAX_SAMPLES as Real, 0.25)
}

#[inline]
fn normalize_feature_angle_rad(feature_angle_deg: Real) -> Real {
    let clamped_deg = if feature_angle_deg.is_finite() {
        feature_angle_deg
            .max(EDGE_FEATURE_ANGLE_MIN_DEG)
            .min(EDGE_FEATURE_ANGLE_MAX_DEG)
    } else {
        EDGE_FEATURE_ANGLE_MIN_DEG
    };
    clamped_deg * std::f64::consts::PI as Real / 180.0
}

// ─── helpers: segment chaining ───────────────────────────────────────────────

/// Convert the per-sample visibility flags into polylines and append them to
/// `result`.
///
/// Consecutive samples with the same visibility are merged into one polyline.
/// Sample positions are linearly interpolated `proj_v0 → proj_v1`.
///
/// `kind` carries the source edge's classification (boundary / silhouette /
/// feature). When a visible polyline's source edge is part of the outer
/// contour (boundary or silhouette), its index in `result.visible_polylines`
/// is recorded in `result.silhouette_indices` so consumers can identify the
/// outline subset without re-running the classifier or duplicating data.
fn chain_segments(
    vis: &[EdgeVisibilitySample],
    proj_v0: &Point3<Real>,
    proj_v1: &Point3<Real>,
    kind: EdgeKind,
    result: &mut EdgeProjectionResult,
) {
    if vis.len() < 2 {
        return;
    }
    let sample_pt = |t: Real| -> Point3<Real> {
        Point3::from(proj_v0.coords + (proj_v1.coords - proj_v0.coords) * t)
    };
    let is_outline = kind.is_outline();

    let mut run_start = 0usize;
    for i in 1..=vis.len() {
        let end_of_run = i == vis.len() || vis[i].visible != vis[i - 1].visible;
        if end_of_run {
            let end = i.min(vis.len() - 1);
            if run_start < end {
                let pts: Vec<Point3<Real>> =
                    vis[run_start..=end].iter().map(|sample| sample_pt(sample.t)).collect();
                if pts.len() >= 2 {
                    if vis[run_start].visible {
                        if is_outline {
                            result.silhouette_indices
                                .push(result.visible_polylines.len() as u32);
                        }
                        result.visible_polylines.push(pts);
                    } else {
                        result.hidden_polylines.push(pts);
                    }
                }
            }
            run_start = i;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::csg::CSG;
    use nalgebra::{Point3, Vector3};

    fn translate(
        m: crate::mesh::Mesh<()>,
        dx: Real, dy: Real, dz: Real,
    ) -> crate::mesh::Mesh<()> {
        crate::mesh::Mesh {
            polygons: m.polygons.into_iter().map(|p| {
                let verts: Vec<_> = p.vertices.iter().map(|v| {
                    let mut vv = *v;
                    vv.position = Point3::new(v.position.x + dx, v.position.y + dy, v.position.z + dz);
                    vv
                }).collect();
                crate::polygon::Polygon::new(verts, p.metadata.clone())
            }).collect(),
            bounding_box: std::sync::OnceLock::new(),
            query_trimesh: std::sync::OnceLock::new(),
            metadata: m.metadata,
            #[cfg(feature = "bmesh")]
            bool_algorithm: m.bool_algorithm,
        }
    }

    #[test]
    fn edge_count_plain_cube() {
        let c = translate(crate::mesh::Mesh::<()>::cube(10.0, None), -5.0, -5.0, -5.0);
        let view = Vector3::new(1.0_f64, 1.0, 1.0).normalize();
        let origin = Point3::new(0.0, 0.0, 0.0);
        let r = c.project_edges(&view, &origin, &view, 15.0, 8, &[]);
        eprintln!("cube: vis={} hid={} sil={}",
            r.visible_polylines.len(),
            r.hidden_polylines.len(),
            r.silhouette_indices.len());
        assert_eq!(r.visible_polylines.len(), 9, "cube should have 9 visible edges");
        assert_eq!(r.hidden_polylines.len(), 3, "cube should have 3 hidden edges");
        // The isometric silhouette of a cube is a hexagon → 6 edges.
        assert_eq!(r.silhouette_indices.len(), 6, "cube silhouette should have 6 edges");
        // Indices must reference valid visible polylines.
        let vis_len = r.visible_polylines.len();
        for &idx in &r.silhouette_indices {
            assert!((idx as usize) < vis_len, "silhouette index out of range");
        }
    }

    #[test]
    fn edge_count_subtracted_box() {
        let c1 = translate(crate::mesh::Mesh::<()>::cube(10.0, None), -5.0, -5.0, -5.0);
        let c2 = translate(crate::mesh::Mesh::<()>::cube(2.0, None), 4.0, 4.0, 4.0);
        let sub = c1.difference(&c2);

        eprintln!("Polygon count: {}", sub.polygons.len());
        for (i, poly) in sub.polygons.iter().enumerate() {
            let n = poly.plane.normal();
            eprintln!("  poly[{}] verts={} n=({:.3},{:.3},{:.3})", i, poly.vertices.len(), n.x, n.y, n.z);
        }

        let view = Vector3::new(1.0_f64, 1.0, 1.0).normalize();
        let origin = Point3::new(0.0, 0.0, 0.0);
        let r = sub.project_edges(&view, &origin, &view, 15.0, 8, &[]);

        eprintln!("sub: vis={} hid={}", r.visible_polylines.len(), r.hidden_polylines.len());
        for (i, pl) in r.visible_polylines.iter().enumerate() {
            if let (Some(p0), Some(p1)) = (pl.first(), pl.last()) {
                eprintln!("  vis[{}]: ({:.2},{:.2},{:.2})->({:.2},{:.2},{:.2})", i,
                    p0.x,p0.y,p0.z, p1.x,p1.y,p1.z);
            }
        }

        assert_eq!(r.visible_polylines.len(), 18, "sub should have 18 visible edges");
        assert_eq!(r.hidden_polylines.len(), 3, "sub should have 3 hidden edges");
    }

    #[test]
    fn projected_length_allocation_scales_up_long_edges() {
        let short = allocated_sample_count_for_projected_length(8, 10.0);
        let long = allocated_sample_count_for_projected_length(8, 300.0);

        assert_eq!(short, 8);
        assert!(long > short, "long projected edges should allocate more initial samples");
    }

    // ── classification coverage ──────────────────────────────────────────

    #[test]
    fn coplanar_guard_rejects_parallel_normals() {
        // Two perfectly aligned face normals → angle = 0° → must be rejected.
        let n = Vector3::new(0.0_f64, 0.0, 1.0);
        let view = Vector3::new(0.5_f64, 0.0, 0.5).normalize();
        let thresh = normalize_feature_angle_rad(15.0);
        assert!(!should_keep_edge(&[n, n], &view, thresh));
    }

    #[test]
    fn coplanar_guard_rejects_antiparallel_normals() {
        // Anti-parallel normals (a common CSG/BSP artifact from opposite winding)
        // would pass the silhouette `d0*d1 ≤ 0` test as a false silhouette.
        // The coplanar guard must catch them first.
        let n0 = Vector3::new(0.0_f64, 0.0, 1.0);
        let n1 = -n0;
        let view = Vector3::new(0.0_f64, 0.0, 1.0); // straight on
        let thresh = normalize_feature_angle_rad(15.0);
        assert!(!should_keep_edge(&[n0, n1], &view, thresh));
    }

    #[test]
    fn feature_angle_threshold_is_monotonic_past_90deg() {
        // Regression: the previous sin²-threshold folded thresholds > 90°
        // back to (180° - thresh). With the cos check, a 170° threshold
        // must reject what a 10° threshold barely keeps.
        // n0, n1 separated by ~60° — well past 10° but well under 170°.
        let n0 = Vector3::new(1.0_f64, 0.0, 0.0);
        let n1 = Vector3::new(0.5_f64, (3.0_f64).sqrt() / 2.0, 0.0); // 60° from n0
        let view = Vector3::new(0.0_f64, 0.0, 1.0); // perpendicular → silhouette test fails
        let low_thresh = normalize_feature_angle_rad(10.0);
        let high_thresh = normalize_feature_angle_rad(170.0);
        assert!(
            should_keep_edge(&[n0, n1], &view, low_thresh),
            "60° pair should pass at 10° threshold",
        );
        assert!(
            !should_keep_edge(&[n0, n1], &view, high_thresh),
            "60° pair must be rejected at 170° threshold (monotonic)",
        );
    }

    #[test]
    fn boundary_edge_always_kept() {
        // Single adjacent face = naked / boundary edge — must always be kept,
        // regardless of view direction or threshold.
        let n = Vector3::new(0.0_f64, 0.0, 1.0);
        let view = Vector3::new(0.0_f64, 0.0, 1.0);
        let thresh = normalize_feature_angle_rad(90.0);
        assert!(should_keep_edge(&[n], &view, thresh));
    }

    #[test]
    fn silhouette_classification_on_sphere() {
        // A sphere projected from +Z should have many silhouette edges (around
        // the equator from that viewpoint). Coarse stacks/segments keep the
        // test fast while still producing a clear silhouette ring.
        let sphere = crate::mesh::Mesh::<()>::sphere(5.0, 12, 8, None);
        let view = Vector3::new(0.0_f64, 0.0, 1.0);
        let origin = Point3::new(0.0, 0.0, 0.0);
        let r = sphere.project_edges(&view, &origin, &view, 15.0, 4, &[]);
        assert!(
            !r.visible_polylines.is_empty(),
            "sphere should produce visible silhouette polylines"
        );
        assert!(
            !r.hidden_polylines.is_empty(),
            "sphere should produce hidden polylines (back hemisphere)"
        );
    }

    #[test]
    fn sphere_high_feature_angle_drops_most_edges() {
        // With a very high feature angle, only true silhouettes and boundaries
        // should remain. A sphere has no boundaries, so this filters to the
        // silhouette only — strictly fewer polylines than the low-threshold case.
        let sphere = crate::mesh::Mesh::<()>::sphere(5.0, 12, 8, None);
        let view = Vector3::new(0.0_f64, 0.0, 1.0);
        let origin = Point3::new(0.0, 0.0, 0.0);
        let low = sphere.project_edges(&view, &origin, &view, 5.0, 4, &[]);
        let high = sphere.project_edges(&view, &origin, &view, 175.0, 4, &[]);
        let low_total = low.visible_polylines.len() + low.hidden_polylines.len();
        let high_total = high.visible_polylines.len() + high.hidden_polylines.len();
        assert!(
            high_total < low_total,
            "high feature angle should keep strictly fewer edges (low={low_total} high={high_total})",
        );
    }

    #[cfg(feature = "sketch")]
    #[test]
    fn section_produces_cut_and_projected_edges() {
        // Slice a centered cube through Z=0 and project along Z. Expect a
        // non-empty cut Sketch (the square at Z=0) and projected visible edges.
        let cube = translate(crate::mesh::Mesh::<()>::cube(10.0, None), -5.0, -5.0, -5.0);
        let section_normal = Vector3::new(0.0_f64, 0.0, 1.0);
        let view_normal = Vector3::new(0.0_f64, 0.0, 1.0);
        let plane_origin = Point3::new(0.0, 0.0, 0.0);
        let plane_normal = Vector3::new(0.0_f64, 0.0, -1.0);
        let r = cube.project_edges_section(
            &section_normal, 0.0,
            &view_normal, &plane_origin, &plane_normal,
            15.0, 4, &[],
        );
        // The cut Sketch should contain the square cross-section as at least
        // one geometry feature.
        assert!(
            !r.cut.geometry.0.is_empty(),
            "cube sliced at Z=0 should produce a non-empty cut sketch"
        );
        // Visible projected edges must exist (the top face boundary).
        assert!(
            !r.visible_polylines.is_empty(),
            "section should produce visible projected edges of the cube"
        );
    }
}
