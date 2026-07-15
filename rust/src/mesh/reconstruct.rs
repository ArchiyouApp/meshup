//! Coplanar n-gon reconstruction.
//!
//! Boolean ops (BoolMesh/bmesh) triangulate their inputs, so results come back
//! as triangle soup. `reconstruct_ngons` welds vertices, buckets triangles by
//! oriented plane (+ metadata), finds connected components, cancels shared
//! interior edges and walks the remaining boundary into a single loop, emitting
//! one n-gon per component (collinear vertices dropped).
//!
//! Safety: any component that does not resolve to exactly one clean boundary
//! loop keeps its original triangles, so geometry is never lost. The render
//! path (`to_arrays`/`to_gltf`) re-triangulates, so n-gons are purely a
//! face-topology improvement.

use crate::float_types::{Real, tolerance};
use crate::mesh::Mesh;
use crate::polygon::Polygon;
use crate::vertex::Vertex;
use nalgebra::{Point3, Vector3};
use std::collections::{HashMap, HashSet};
use std::fmt::Debug;

/// Group key: quantised plane (normal xyz + offset) plus a metadata index.
type GroupKey = (i64, i64, i64, i64, usize);

impl<S: Clone + Send + Sync + Debug + PartialEq> Mesh<S> {
    /// Merge coplanar, edge-adjacent triangular faces back into n-gons.
    /// Idempotent; never loses geometry (unresolved components stay triangles).
    pub fn reconstruct_ngons(&self) -> Mesh<S> {
        let eps = tolerance();
        let inv = 1.0 / eps;
        let quant = |v: Real| (v * inv).round() as i64;

        // ---- 1. Weld vertices globally + bucket triangles by (plane, metadata) ----
        let mut positions: Vec<Point3<Real>> = Vec::new();
        let mut vmap: HashMap<(i64, i64, i64), usize> = HashMap::new();
        let mut metas: Vec<Option<S>> = Vec::new();
        // group -> (plane normal, list of welded triangles)
        let mut groups: HashMap<GroupKey, (Vector3<Real>, Vec<[usize; 3]>)> = HashMap::new();

        for poly in &self.polygons {
            // metadata discriminator (linear scan — few distinct values)
            let midx = match metas.iter().position(|m| m == &poly.metadata) {
                Some(i) => i,
                None => {
                    metas.push(poly.metadata.clone());
                    metas.len() - 1
                }
            };
            let n = poly.plane.normal();

            for tri in poly.triangulate() {
                let mut idx = [0usize; 3];
                for (k, v) in tri.iter().enumerate() {
                    let p = v.position;
                    let key = (quant(p.x), quant(p.y), quant(p.z));
                    idx[k] = *vmap.entry(key).or_insert_with(|| {
                        positions.push(p);
                        positions.len() - 1
                    });
                }
                if idx[0] == idx[1] || idx[1] == idx[2] || idx[2] == idx[0] {
                    continue; // degenerate after welding
                }
                let off = n.dot(&positions[idx[0]].coords);
                let gkey = (quant(n.x), quant(n.y), quant(n.z), quant(off), midx);
                groups
                    .entry(gkey)
                    .or_insert_with(|| (n, Vec::new()))
                    .1
                    .push(idx);
            }
        }

        // ---- 2. Per group: connected components → boundary loop → n-gon ----
        let mut out_polys: Vec<Polygon<S>> = Vec::new();

        for (gkey, (normal, tris)) in &groups {
            let metadata = metas[gkey.4].clone();
            for comp in connected_components(tris) {
                let comp_tris: Vec<[usize; 3]> = comp.iter().map(|&i| tris[i]).collect();
                match boundary_ngon(&comp_tris, &positions, normal, eps) {
                    Some(loop_idx) => {
                        let verts: Vec<Vertex> = loop_idx
                            .iter()
                            .map(|&i| Vertex::new(positions[i], *normal))
                            .collect();
                        out_polys.push(Polygon::new(verts, metadata.clone()));
                    }
                    None => {
                        // Fallback: keep the component's triangles verbatim.
                        for t in &comp_tris {
                            let verts: Vec<Vertex> =
                                t.iter().map(|&i| Vertex::new(positions[i], *normal)).collect();
                            out_polys.push(Polygon::new(verts, metadata.clone()));
                        }
                    }
                }
            }
        }

        Mesh::from_polygons(&out_polys, None)
    }
}

/// Connected components of a triangle list, adjacency via shared undirected edges.
fn connected_components(tris: &[[usize; 3]]) -> Vec<Vec<usize>> {
    // edge -> triangle indices sharing it
    let mut edge_tris: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (ti, t) in tris.iter().enumerate() {
        for &(a, b) in &[(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let e = if a < b { (a, b) } else { (b, a) };
            edge_tris.entry(e).or_default().push(ti);
        }
    }
    let mut seen = vec![false; tris.len()];
    let mut comps = Vec::new();
    for start in 0..tris.len() {
        if seen[start] {
            continue;
        }
        let mut stack = vec![start];
        let mut comp = Vec::new();
        seen[start] = true;
        while let Some(ti) = stack.pop() {
            comp.push(ti);
            let t = tris[ti];
            for &(a, b) in &[(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                let e = if a < b { (a, b) } else { (b, a) };
                if let Some(neigh) = edge_tris.get(&e) {
                    for &nt in neigh {
                        if !seen[nt] {
                            seen[nt] = true;
                            stack.push(nt);
                        }
                    }
                }
            }
        }
        comps.push(comp);
    }
    comps
}

/// Walk the boundary of a coplanar triangle component into a single n-gon loop
/// (collinear vertices dropped). Returns `None` if the boundary is not a single
/// clean loop (holes, pinch points, open) so the caller can fall back.
fn boundary_ngon(
    tris: &[[usize; 3]],
    positions: &[Point3<Real>],
    normal: &Vector3<Real>,
    eps: Real,
) -> Option<Vec<usize>> {
    // Directed edges; an edge is interior iff its reverse also appears.
    let mut dir: HashSet<(usize, usize)> = HashSet::new();
    for t in tris {
        for &(a, b) in &[(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            dir.insert((a, b));
        }
    }
    // next[start] = end for each boundary directed edge
    let mut next: HashMap<usize, usize> = HashMap::new();
    let mut n_boundary = 0usize;
    for &(a, b) in &dir {
        if !dir.contains(&(b, a)) {
            // fan-out ambiguity → not a simple loop
            if next.insert(a, b).is_some() {
                return None;
            }
            n_boundary += 1;
        }
    }
    if n_boundary < 3 {
        return None;
    }

    // Walk from an arbitrary boundary vertex.
    let start = *next.keys().next()?;
    let mut loop_idx = vec![start];
    let mut cur = *next.get(&start)?;
    while cur != start {
        loop_idx.push(cur);
        cur = *next.get(&cur)?; // open loop → None → fallback
        if loop_idx.len() > n_boundary {
            return None; // didn't close in time
        }
    }
    // Single loop must consume every boundary edge (else there are holes/islands).
    if loop_idx.len() != n_boundary {
        return None;
    }

    let cleaned = drop_collinear(&loop_idx, positions, eps);
    if cleaned.len() < 3 {
        return None;
    }
    // Orient CCW with respect to the plane normal.
    if signed_area(&cleaned, positions, normal) < 0.0 {
        Some(cleaned.into_iter().rev().collect())
    } else {
        Some(cleaned)
    }
}

/// Remove vertices whose incident edges are collinear.
fn drop_collinear(loop_idx: &[usize], positions: &[Point3<Real>], eps: Real) -> Vec<usize> {
    let n = loop_idx.len();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let prev = positions[loop_idx[(i + n - 1) % n]];
        let cur = positions[loop_idx[i]];
        let nxt = positions[loop_idx[(i + 1) % n]];
        let d1 = cur - prev;
        let d2 = nxt - cur;
        let (l1, l2) = (d1.norm(), d2.norm());
        if l1 < eps || l2 < eps {
            continue; // coincident — drop
        }
        // collinear if the turn cross-product is ~0 relative to edge lengths
        if (d1 / l1).cross(&(d2 / l2)).norm() > 1e-6 {
            out.push(loop_idx[i]);
        }
    }
    out
}

/// Signed area of a planar loop w.r.t. `normal` (positive = CCW).
fn signed_area(loop_idx: &[usize], positions: &[Point3<Real>], normal: &Vector3<Real>) -> Real {
    let p0 = positions[loop_idx[0]];
    let mut area = Vector3::zeros();
    for i in 1..loop_idx.len() - 1 {
        let a = positions[loop_idx[i]] - p0;
        let b = positions[loop_idx[i + 1]] - p0;
        area += a.cross(&b);
    }
    0.5 * area.dot(normal)
}
