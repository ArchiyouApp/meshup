//! Exact hidden-line removal by parametric interval clipping.
//!
//! # Why this exists
//!
//! The original solver in [`crate::mesh::edge_projection`] answers "is this edge
//! visible?" by probing a finite number of points along it and bisecting wherever
//! two neighbouring probes disagree. That has two consequences that show up
//! directly in drawings:
//!
//! - **Endpoints are approximate.** A visible run ends at whichever probe the
//!   bisection settled on, not at the silhouette it actually crosses, so lines
//!   stop short of — or run past — where they should end.
//! - **Small occluders vanish.** Bisection only refines intervals whose two ends
//!   already disagree. An occluder narrower than the probe spacing is never
//!   straddled by two disagreeing probes, so it is never found at all. This is
//!   why a small shape crossing a large one loses its occlusion entirely.
//!
//! # What this does instead
//!
//! Occlusion is computed, not sampled. Everything is projected once into a view
//! basis where `w` is depth. For each edge and each candidate triangle:
//!
//! 1. Clip the projected edge against the triangle's three half-planes. This is
//!    a closed-form parametric clip giving the exact range `[t0, t1]` over which
//!    the edge lies inside the triangle's projected outline.
//! 2. Over that range both the edge's depth and the triangle's plane depth are
//!    **affine in `t`**, so their difference is affine too. The part where the
//!    triangle is in front is therefore a single sub-interval with a closed-form
//!    boundary — one division, no search.
//!
//! Those intervals accumulate into an [`IntervalSet`]; inverting it yields the
//! visible pieces. Every boundary is a true silhouette crossing, and a triangle
//! covering any positive-width part of the edge contributes it regardless of how
//! narrow that part is.
//!
//! The solve is scale-invariant by construction — every tolerance below is
//! relative to the scene extent or to the unit parameter range — so unlike the
//! sampling path it needs no normalisation into a canonical size.

use std::fmt::Debug;

use nalgebra::{Point3, Vector3};

use crate::csg::CSG;
use crate::float_types::Real;
use crate::mesh::Mesh;
use crate::mesh::edge_projection::{
    EdgeProjectionResult, EdgeKind, classify_edge, extract_edges, merge_collinear_edges,
    normalize_feature_angle_rad, project_point,
};

use super::bvh2d::{Aabb2, Bvh2};
use super::intervals::{IntervalSet, MIN_SPAN};

/// How far in front of an edge a triangle must be, relative to scene extent,
/// before it counts as occluding.
///
/// This is what lets a face that *contains* the edge — its own adjacent faces,
/// or the coplanar touching face of a neighbouring box — decline to hide it,
/// without any adjacency bookkeeping: those faces evaluate to a depth difference
/// of zero, which is below the bias. It replaces the `__ISO_SHIFT__` nudge the
/// sampling path needed for the same situation.
const DEPTH_BIAS_REL: Real = 1e-7;

/// Triangles whose projected area is below this fraction of the scene's squared
/// extent are seen edge-on and cannot hide anything.
const DEGENERATE_AREA_REL: Real = 1e-14;

/// Shortest piece worth emitting, as a fraction of scene extent.
///
/// [`DEPTH_BIAS_REL`] necessarily leaves a hair of an edge unoccluded wherever
/// the occluding face *touches* it — at a shared vertex the depth difference
/// passes through zero, so the crossing is found just inside the bias rather
/// than exactly at the vertex. A fully hidden edge would otherwise be reported
/// as hidden plus a visible fragment some `1e-8` of its length long, which is
/// invisible in a drawing but inflates edge counts and reads as a stray dash.
///
/// This must stay comfortably above [`DEPTH_BIAS_REL`] — the fragments it exists
/// to remove are that size — and comfortably below anything a drawing could
/// show, which at `1e-5` of the model extent it is.
const MIN_SEGMENT_LEN_REL: Real = 1e-5;

/// An orthonormal frame with `w` pointing at the viewer.
struct ViewBasis {
    u: Vector3<Real>,
    v: Vector3<Real>,
    w: Vector3<Real>,
}

impl ViewBasis {
    fn new(view_dir: &Vector3<Real>) -> Self {
        let w = view_dir.normalize();
        // Any axis not nearly parallel to `w` seeds a stable cross product.
        let seed = if w.x.abs() < 0.9 {
            Vector3::new(1.0, 0.0, 0.0)
        } else {
            Vector3::new(0.0, 1.0, 0.0)
        };
        let u = seed.cross(&w).normalize();
        let v = w.cross(&u);
        ViewBasis { u, v, w }
    }

    /// Screen position of `p`.
    #[inline]
    fn xy(&self, p: &Point3<Real>) -> [Real; 2] {
        [p.coords.dot(&self.u), p.coords.dot(&self.v)]
    }

    /// Depth of `p`. Larger means closer to the viewer.
    #[inline]
    fn depth(&self, p: &Point3<Real>) -> Real {
        p.coords.dot(&self.w)
    }
}

/// One occluder triangle, already projected.
struct ProjTri {
    /// Screen-space corners, wound counter-clockwise.
    p: [[Real; 2]; 3],
    /// Depth at each corner, in the same order as `p`.
    d: [Real; 3],
    /// Twice the signed screen area — the denominator of the barycentric solve.
    area2: Real,
}

impl ProjTri {
    /// Depth of this triangle's supporting plane above screen point `q`.
    ///
    /// Barycentric interpolation of the corner depths. Affine in `q`, which is
    /// what makes the occlusion test below closed-form.
    #[inline]
    fn depth_at(&self, q: [Real; 2]) -> Real {
        let e1 = [self.p[1][0] - self.p[0][0], self.p[1][1] - self.p[0][1]];
        let e2 = [self.p[2][0] - self.p[0][0], self.p[2][1] - self.p[0][1]];
        let qp = [q[0] - self.p[0][0], q[1] - self.p[0][1]];
        let w1 = (qp[0] * e2[1] - qp[1] * e2[0]) / self.area2;
        let w2 = (e1[0] * qp[1] - e1[1] * qp[0]) / self.area2;
        self.d[0] + w1 * (self.d[1] - self.d[0]) + w2 * (self.d[2] - self.d[0])
    }
}

#[inline]
fn coord(p: [Real; 2]) -> robust::Coord<Real> {
    robust::Coord { x: p[0], y: p[1] }
}

/// Signed area of the triangle `(a, b, c)`, doubled. Sign is exact.
#[inline]
fn orient2d(a: [Real; 2], b: [Real; 2], c: [Real; 2]) -> Real {
    robust::orient2d(coord(a), coord(b), coord(c))
}

/// Clip the parameter range `[lo, hi]` to where the affine function running from
/// `s_a` at `t = 0` to `s_b` at `t = 1` is non-negative.
///
/// Returns `false` when nothing survives. This is the half-plane step of the
/// triangle clip, applied once per triangle edge.
#[inline]
fn clip_halfplane(lo: &mut Real, hi: &mut Real, s_a: Real, s_b: Real) -> bool {
    let delta = s_b - s_a;
    if delta.abs() <= Real::MIN_POSITIVE {
        // Parallel: the whole segment is on one side.
        return s_a >= 0.0;
    }
    // s(t) = s_a + t * delta crosses zero here.
    let t = -s_a / delta;
    if delta > 0.0 {
        // Entering the half-plane at t.
        if t > *lo {
            *lo = t;
        }
    } else {
        // Leaving the half-plane at t.
        if t < *hi {
            *hi = t;
        }
    }
    *hi - *lo > MIN_SPAN
}

/// Project the edges of `mesh` with exact interval hidden-line removal.
///
/// Mirrors the signature of the sampling solver minus `n_samples`, which has no
/// meaning here — there is nothing to sample.
pub fn project_edges_exact<S: Clone + Send + Sync + Debug>(
    mesh: &Mesh<S>,
    view_normal: &Vector3<Real>,
    plane_origin: &Point3<Real>,
    plane_normal: &Vector3<Real>,
    feature_angle_deg: Real,
    occluders: &[&Mesh<S>],
) -> EdgeProjectionResult {
    let basis = ViewBasis::new(view_normal);
    let view_dir = basis.w;
    let plane_n = plane_normal.normalize();
    let feature_thresh = normalize_feature_angle_rad(feature_angle_deg);

    // ── scene extent, for the relative tolerances ────────────────────────────
    let extent = {
        let mut bb = mesh.bounding_box();
        for m in occluders {
            let o = m.bounding_box();
            bb = parry3d_f64::bounding_volume::Aabb::new(bb.mins.inf(&o.mins), bb.maxs.sup(&o.maxs));
        }
        let d = bb.maxs - bb.mins;
        let e = d.x.max(d.y).max(d.z);
        if e.is_finite() && e > 0.0 { e } else { 1.0 }
    };
    let depth_bias = DEPTH_BIAS_REL * extent;
    let min_area2 = DEGENERATE_AREA_REL * extent * extent;
    let query_pad = DEPTH_BIAS_REL * extent;

    // ── collect and project every occluder triangle ──────────────────────────
    //
    // Back faces are kept. Culling them is only sound for closed shells, and an
    // open shell's back faces really do occlude — correctness first.
    let mut tris: Vec<ProjTri> = Vec::new();
    let mut boxes: Vec<Aabb2> = Vec::new();
    for source in std::iter::once(mesh).chain(occluders.iter().copied()) {
        for poly in &source.polygons {
            for tri in poly.triangulate() {
                let p = [
                    basis.xy(&tri[0].position),
                    basis.xy(&tri[1].position),
                    basis.xy(&tri[2].position),
                ];
                let d = [
                    basis.depth(&tri[0].position),
                    basis.depth(&tri[1].position),
                    basis.depth(&tri[2].position),
                ];

                let area2 = orient2d(p[0], p[1], p[2]);
                if area2.abs() <= min_area2 {
                    continue; // seen edge-on: covers no area, hides nothing
                }
                // Wind counter-clockwise so the half-plane test below is a
                // uniform `>= 0` on all three edges.
                let (p, d, area2) = if area2 < 0.0 {
                    ([p[0], p[2], p[1]], [d[0], d[2], d[1]], -area2)
                } else {
                    (p, d, area2)
                };

                boxes.push(Aabb2::from_triangle(p[0], p[1], p[2]));
                tris.push(ProjTri { p, d, area2 });
            }
        }
    }
    let bvh = Bvh2::build(&boxes);

    // ── walk the edges ───────────────────────────────────────────────────────
    let edges = merge_collinear_edges(extract_edges(mesh));
    let mut result = EdgeProjectionResult::default();
    let mut occluded = IntervalSet::new();
    let mut candidates: Vec<usize> = Vec::new();

    for edge in edges.values() {
        if (edge.v1 - edge.v0).norm() < 1e-6 * extent {
            continue;
        }
        let Some(kind) = classify_edge(&edge.face_normals, &view_dir, feature_thresh) else {
            continue;
        };

        let a = basis.xy(&edge.v0);
        let b = basis.xy(&edge.v1);
        let da = basis.depth(&edge.v0);
        let db = basis.depth(&edge.v1);

        occluded.clear();
        bvh.query(&Aabb2::from_segment(a, b).padded(query_pad), &mut candidates);
        for &ti in &candidates {
            accumulate_occlusion(&tris[ti], a, b, da, db, depth_bias, &mut occluded);
        }

        // Output lives on the projection plane, which is a separate thing from
        // the view basis used for the occlusion solve above.
        let proj_v0 = project_point(&edge.v0, plane_origin, &plane_n);
        let proj_v1 = project_point(&edge.v1, plane_origin, &plane_n);

        // Convert the length floor into this edge's parameter space.
        let proj_len = (proj_v1 - proj_v0).norm();
        let min_span = if proj_len > 0.0 {
            (MIN_SEGMENT_LEN_REL * extent / proj_len).min(0.5)
        } else {
            0.0
        };
        emit(&occluded, &proj_v0, &proj_v1, kind, min_span, &mut result);
    }

    result
}

/// Add the range over which `tri` hides the edge `a → b` to `out`.
fn accumulate_occlusion(
    tri: &ProjTri,
    a: [Real; 2],
    b: [Real; 2],
    da: Real,
    db: Real,
    depth_bias: Real,
    out: &mut IntervalSet,
) {
    // ── 1. exact clip to the triangle's projected outline ────────────────────
    let mut lo = 0.0;
    let mut hi = 1.0;
    for i in 0..3 {
        let e0 = tri.p[i];
        let e1 = tri.p[(i + 1) % 3];
        // Signed distance of each endpoint from this edge's supporting line.
        // Exact in sign, which keeps slivers from flipping side arbitrarily.
        if !clip_halfplane(&mut lo, &mut hi, orient2d(e0, e1, a), orient2d(e0, e1, b)) {
            return;
        }
    }

    // ── 2. closed-form depth comparison over [lo, hi] ────────────────────────
    //
    // `g(t)` = how far the triangle sits in front of the edge. Both terms are
    // affine in `t`, so evaluating at the two ends determines it everywhere.
    let at = |t: Real| -> [Real; 2] {
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    };
    let edge_depth = |t: Real| -> Real { da + (db - da) * t };
    let g = |t: Real| -> Real { tri.depth_at(at(t)) - edge_depth(t) };

    let g_lo = g(lo);
    let g_hi = g(hi);
    let in_front_lo = g_lo > depth_bias;
    let in_front_hi = g_hi > depth_bias;

    if in_front_lo && in_front_hi {
        out.insert(lo, hi);
        return;
    }
    if !in_front_lo && !in_front_hi {
        return;
    }

    // Exactly one end is behind: the crossing is the single root of an affine
    // function — no bisection, no tolerance on the location.
    let denom = g_hi - g_lo;
    if denom.abs() <= Real::MIN_POSITIVE {
        return;
    }
    let t_cross = lo + (hi - lo) * (depth_bias - g_lo) / denom;
    let t_cross = t_cross.clamp(lo, hi);
    if in_front_lo {
        out.insert(lo, t_cross);
    } else {
        out.insert(t_cross, hi);
    }
}

/// Turn the occluded set into visible and hidden polylines on the projection
/// plane, recording which visible pieces belong to the outer contour.
///
/// Each piece is emitted as a straight two-point segment: with exact
/// boundaries there is nothing between them to describe, unlike the sampling
/// path which has to carry every probe position through to the output.
fn emit(
    occluded: &IntervalSet,
    proj_v0: &Point3<Real>,
    proj_v1: &Point3<Real>,
    kind: EdgeKind,
    min_span: Real,
    result: &mut EdgeProjectionResult,
) {
    let point_at = |t: Real| -> Point3<Real> {
        Point3::from(proj_v0.coords + (proj_v1.coords - proj_v0.coords) * t)
    };
    let is_outline = kind.is_outline();

    for (lo, hi) in occluded.complement() {
        if hi - lo < min_span {
            continue; // bias artefact at a touching vertex, not real line work
        }
        if is_outline {
            result
                .silhouette_indices
                .push(result.visible_polylines.len() as u32);
        }
        result
            .visible_polylines
            .push(vec![point_at(lo), point_at(hi)]);
    }
    for &(lo, hi) in occluded.spans() {
        if hi - lo < min_span {
            continue;
        }
        result
            .hidden_polylines
            .push(vec![point_at(lo), point_at(hi)]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn halfplane_clip_keeps_the_inside_range() {
        // s runs -1 → +1, so it is non-negative on the upper half of the range.
        let (mut lo, mut hi) = (0.0, 1.0);
        assert!(clip_halfplane(&mut lo, &mut hi, -1.0, 1.0));
        assert!((lo - 0.5).abs() < 1e-12);
        assert!((hi - 1.0).abs() < 1e-12);

        // Mirrored: non-negative on the lower half.
        let (mut lo, mut hi) = (0.0, 1.0);
        assert!(clip_halfplane(&mut lo, &mut hi, 1.0, -1.0));
        assert!((lo - 0.0).abs() < 1e-12);
        assert!((hi - 0.5).abs() < 1e-12);
    }

    #[test]
    fn halfplane_clip_rejects_a_fully_outside_segment() {
        let (mut lo, mut hi) = (0.0, 1.0);
        assert!(!clip_halfplane(&mut lo, &mut hi, -1.0, -2.0));
    }

    #[test]
    fn halfplane_clip_handles_a_parallel_segment() {
        let (mut lo, mut hi) = (0.0, 1.0);
        assert!(clip_halfplane(&mut lo, &mut hi, 2.0, 2.0));
        assert_eq!((lo, hi), (0.0, 1.0));

        let (mut lo, mut hi) = (0.0, 1.0);
        assert!(!clip_halfplane(&mut lo, &mut hi, -2.0, -2.0));
    }

    /// A unit triangle at depth 1, and an edge at depth 0 crossing it.
    fn covering_tri() -> ProjTri {
        let p = [[-1.0, -1.0], [3.0, -1.0], [1.0, 3.0]];
        let area2 = orient2d(p[0], p[1], p[2]);
        assert!(area2 > 0.0, "fixture must be counter-clockwise");
        ProjTri {
            p,
            d: [1.0, 1.0, 1.0],
            area2,
        }
    }

    #[test]
    fn triangle_in_front_hides_the_covered_span_exactly() {
        // Edge from x = -3 to x = 5 along y = 0, so t = (x + 3) / 8.
        //
        // The triangle's two slanted sides cross y = 0 at:
        //   (1,3) → (-1,-1):  three quarters down, x = 1 + 0.75·(-2) = -0.5
        //   (3,-1) → (1,3):   one quarter up,      x = 3 + 0.25·(-2) =  2.5
        // giving t = 2.5/8 = 0.3125 and t = 5.5/8 = 0.6875.
        let mut out = IntervalSet::new();
        accumulate_occlusion(
            &covering_tri(),
            [-3.0, 0.0],
            [5.0, 0.0],
            0.0,
            0.0,
            1e-9,
            &mut out,
        );
        let spans = out.spans();
        assert_eq!(spans.len(), 1);
        assert!((spans[0].0 - 0.3125).abs() < 1e-12, "got {:?}", spans[0]);
        assert!((spans[0].1 - 0.6875).abs() < 1e-12, "got {:?}", spans[0]);
    }

    #[test]
    fn triangle_behind_hides_nothing() {
        let mut tri = covering_tri();
        tri.d = [-1.0, -1.0, -1.0]; // behind the edge
        let mut out = IntervalSet::new();
        accumulate_occlusion(&tri, [-3.0, 0.0], [5.0, 0.0], 0.0, 0.0, 1e-9, &mut out);
        assert!(out.spans().is_empty());
    }

    #[test]
    fn coplanar_triangle_hides_nothing() {
        // Same depth as the edge: this is an edge lying on its own face, or on
        // the touching face of a neighbouring box. The bias must let it through.
        let mut tri = covering_tri();
        tri.d = [0.0, 0.0, 0.0];
        let mut out = IntervalSet::new();
        accumulate_occlusion(&tri, [-3.0, 0.0], [5.0, 0.0], 0.0, 0.0, 1e-9, &mut out);
        assert!(out.spans().is_empty());
    }

    #[test]
    fn a_slanted_triangle_produces_the_exact_depth_crossing() {
        // Depth ramps 0 → 4 across x ∈ [-1, 3]; the edge sits at depth 1, so the
        // triangle passes in front of it at x = 1 exactly.
        let p = [[-1.0, -1.0], [3.0, -1.0], [1.0, 3.0]];
        let area2 = orient2d(p[0], p[1], p[2]);
        // depth = x + 1 at each corner
        let tri = ProjTri {
            p,
            d: [0.0, 4.0, 2.0],
            area2,
        };
        let mut out = IntervalSet::new();
        // Edge along y = 0 from x = -3 to x = 5 at constant depth 1, so
        // t = (x + 3) / 8.
        accumulate_occlusion(&tri, [-3.0, 0.0], [5.0, 0.0], 1.0, 1.0, 0.0, &mut out);
        let spans = out.spans();
        assert_eq!(spans.len(), 1);
        // The triangle passes in front of depth 1 where x + 1 > 1, i.e. x > 0
        // (t = 3/8), and stops at its own right boundary x = 2.5 (t = 5.5/8).
        // The near end is a depth crossing, the far end an outline crossing —
        // both solved in closed form.
        assert!((spans[0].0 - 0.375).abs() < 1e-12, "got {:?}", spans[0]);
        assert!((spans[0].1 - 0.6875).abs() < 1e-12, "got {:?}", spans[0]);
    }

    // ── whole-mesh behaviour ─────────────────────────────────────────────────

    /// The standard isometric view used by the sampling solver's own tests.
    fn iso_view() -> (Vector3<Real>, Point3<Real>) {
        (
            Vector3::new(1.0, 1.0, 1.0).normalize(),
            Point3::new(0.0, 0.0, 0.0),
        )
    }

    fn centred_cube(size: Real) -> Mesh<()> {
        Mesh::<()>::cube(size, None).translate(-size / 2.0, -size / 2.0, -size / 2.0)
    }

    #[test]
    fn cube_matches_the_sampling_solver() {
        let (view, origin) = iso_view();
        let cube = centred_cube(10.0);
        let r = project_edges_exact(&cube, &view, &origin, &view, 15.0, &[]);

        // A cube seen down its diagonal: 9 visible edges, 3 hidden behind it,
        // and a hexagonal silhouette. Same answer as the sampling solver, which
        // is the point — the two must agree wherever sampling is adequate.
        assert_eq!(r.visible_polylines.len(), 9, "cube should have 9 visible edges");
        assert_eq!(r.hidden_polylines.len(), 3, "cube should have 3 hidden edges");
        assert_eq!(r.silhouette_indices.len(), 6, "silhouette should be a hexagon");
        for &idx in &r.silhouette_indices {
            assert!((idx as usize) < r.visible_polylines.len());
        }
    }

    #[test]
    fn results_do_not_depend_on_model_size() {
        // Every tolerance in the exact solver is relative, so this holds without
        // the canonical-extent renormalisation the sampling path needs.
        let (view, origin) = iso_view();
        let mut baseline = None;
        for size in [0.1, 1.0, 10.0, 1_000.0, 100_000.0] {
            let cube = centred_cube(size);
            let r = project_edges_exact(&cube, &view, &origin, &view, 15.0, &[]);
            let counts = (
                r.visible_polylines.len(),
                r.hidden_polylines.len(),
                r.silhouette_indices.len(),
            );
            match baseline {
                None => baseline = Some(counts),
                Some(b) => assert_eq!(counts, b, "counts changed at size {size}"),
            }
        }
    }

    #[test]
    fn every_visible_piece_is_a_straight_two_point_segment() {
        // Exact boundaries mean there is nothing to describe between the ends.
        // The sampling path instead carries every probe position into the
        // output, which is what SVGExporter has to simplify away afterwards.
        let (view, origin) = iso_view();
        let cube = centred_cube(10.0);
        let r = project_edges_exact(&cube, &view, &origin, &view, 15.0, &[]);
        for pl in r.visible_polylines.iter().chain(r.hidden_polylines.iter()) {
            assert_eq!(pl.len(), 2, "expected a plain segment, got {} points", pl.len());
        }
    }

    /// **The reported bug.**
    ///
    /// A slab with one long horizontal edge, and a thin post standing in front
    /// of its midpoint. The post is far narrower than the sampling solver's
    /// probe spacing, so no two probes straddle it and its bisection never
    /// triggers — the occlusion is missed entirely. The exact solver clips
    /// against the post's projected outline, so width never enters into it.
    #[test]
    fn a_thin_occluder_that_sampling_misses_is_found_exactly() {
        // View straight down -Z so the geometry is easy to reason about.
        let view = Vector3::new(0.0, 0.0, 1.0);
        let origin = Point3::new(0.0, 0.0, 0.0);

        // A wide, flat slab at z = 0 spanning x ∈ [-500, 500].
        let slab: Mesh<()> = Mesh::<()>::cube(1.0, None)
            .scale(1000.0, 40.0, 1.0)
            .translate(-500.0, -20.0, -1.0);

        // A post 0.4 units wide standing in front of the slab at x ≈ 0.
        let post: Mesh<()> = Mesh::<()>::cube(1.0, None)
            .scale(0.4, 200.0, 20.0)
            .translate(-0.2, -100.0, 5.0);

        let exact = project_edges_exact(&slab, &view, &origin, &view, 15.0, &[&post]);
        let sampled = slab.project_edges(&view, &origin, &view, 15.0, 16, &[&post]);

        // The slab is a solid, so its underside edges are hidden behind its own
        // top face in both solvers. What distinguishes them is whether the
        // *post* is found, so count only spans the width of the post.
        let post_width_spans = |r: &EdgeProjectionResult| {
            r.hidden_polylines
                .iter()
                .filter(|pl| {
                    let len = (pl[pl.len() - 1] - pl[0]).norm();
                    (len - 0.4).abs() < 1e-6
                })
                .count()
        };

        assert_eq!(
            post_width_spans(&sampled),
            0,
            "fixture is only meaningful if sampling misses the post",
        );
        assert!(
            post_width_spans(&exact) > 0,
            "exact solver must find the thin occluder; hidden spans were {:?}",
            exact
                .hidden_polylines
                .iter()
                .map(|pl| (pl[pl.len() - 1] - pl[0]).norm())
                .collect::<Vec<_>>(),
        );
    }

    /// Endpoints must land on the true crossing, not on the nearest probe.
    #[test]
    fn visible_runs_end_exactly_at_the_occluder_boundary() {
        let view = Vector3::new(0.0, 0.0, 1.0);
        let origin = Point3::new(0.0, 0.0, 0.0);

        // Slab edge along y = -20 running x ∈ [-500, 500]; a block in front
        // covers exactly x ∈ [-100, 100].
        let slab: Mesh<()> = Mesh::<()>::cube(1.0, None)
            .scale(1000.0, 40.0, 1.0)
            .translate(-500.0, -20.0, -1.0);
        let blocker: Mesh<()> = Mesh::<()>::cube(1.0, None)
            .scale(200.0, 200.0, 20.0)
            .translate(-100.0, -100.0, 5.0);

        let r = project_edges_exact(&slab, &view, &origin, &view, 15.0, &[&blocker]);

        // Gather every x where a visible run stops mid-edge. Each must be a
        // blocker boundary at ±100 to full double precision.
        let mut breaks: Vec<Real> = Vec::new();
        for pl in &r.visible_polylines {
            for p in [pl[0], pl[1]] {
                if p.x.abs() < 499.999 {
                    breaks.push(p.x);
                }
            }
        }
        assert!(!breaks.is_empty(), "expected the blocker to split some edges");
        for x in breaks {
            let err = (x.abs() - 100.0).abs();
            assert!(
                err < 1e-9,
                "visible run ended at x={x}, which is {err} off the true boundary",
            );
        }
    }

    #[test]
    fn a_narrow_triangle_is_still_found() {
        // The failure the sampling solver cannot see: an occluder far thinner
        // than any practical probe spacing. Width 1e-4 on an edge of length 8.
        let p = [[-0.00005, -1.0], [0.00005, -1.0], [0.0, 3.0]];
        let area2 = orient2d(p[0], p[1], p[2]);
        let tri = ProjTri {
            p,
            d: [1.0, 1.0, 1.0],
            area2,
        };
        let mut out = IntervalSet::new();
        accumulate_occlusion(&tri, [-3.0, 0.0], [5.0, 0.0], 0.0, 0.0, 1e-9, &mut out);
        assert_eq!(out.spans().len(), 1, "narrow occluder must be detected");
        let (lo, hi) = out.spans()[0];
        assert!(hi - lo > 0.0 && hi - lo < 1e-4);
    }
}
