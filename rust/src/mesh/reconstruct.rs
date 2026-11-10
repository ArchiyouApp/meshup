//! Coplanar n-gon reconstruction.
//!
//! Boolean ops (BoolMesh/bmesh) triangulate their inputs, so results come back
//! as triangle soup. `reconstruct_ngons` welds vertices, buckets triangles by
//! oriented plane (+ metadata), finds connected components, cancels shared
//! interior edges and walks the remaining boundary into a single loop, emitting
//! one n-gon per component (collinear vertices dropped, unless another face keeps
//! them as a corner: dropping those would leave T-junctions, an open mesh).
//!
//! Safety: any component that does not resolve to exactly one clean boundary
//! loop, or whose n-gon does not triangulate back to the same area, keeps its
//! original triangles, so geometry is never lost. The render
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
        // A component becomes one n-gon when its boundary is a single loop; otherwise it keeps
        // its triangles. Every boundary edge is shared with a face of another plane.
        struct Comp<S> {
            normal: Vector3<Real>,
            metadata: Option<S>,
            tris: Vec<[usize; 3]>,
            boundary: Option<Vec<usize>>,
        }
        let metas = &metas;
        let mut comps: Vec<Comp<S>> = groups
            .iter()
            .flat_map(|(gkey, (normal, tris))| {
                connected_components(tris).into_iter().map(move |comp| {
                    let comp_tris: Vec<[usize; 3]> = comp.iter().map(|&i| tris[i]).collect();
                    Comp {
                        normal: *normal,
                        metadata: metas[gkey.4].clone(),
                        boundary: boundary_loop(&comp_tris),
                        tris: comp_tris,
                    }
                })
            })
            .collect();

        // A collinear vertex may only go when no face keeps it: when one does (a corner of a
        // face of another plane, or a face left as triangles), dropping it from this n-gon
        // leaves a T-junction - the mesh is no longer closed and the next boolean has to
        // take the BSP path. Leaving a component as triangles makes all its vertices kept,
        // so repeat until nothing changes.
        let mut kept = vec![false; positions.len()];
        let ngons: Vec<Option<Vec<usize>>> = loop {
            comps.iter().for_each(|c| match &c.boundary {
                Some(b) => b.iter().enumerate().filter(|&(i, _)| !is_collinear(b, i, &positions, eps)).for_each(|(_, &v)| kept[v] = true),
                None => c.tris.iter().flatten().for_each(|&v| kept[v] = true),
            });
            let ngons: Vec<Option<Vec<usize>>> = comps
                .iter()
                .map(|c| {
                    let b = c.boundary.as_ref()?;
                    let cleaned: Vec<usize> = b
                        .iter()
                        .enumerate()
                        .filter(|&(i, &v)| kept[v] && !is_coincident(b, i, &positions, eps))
                        .map(|(_, &v)| v)
                        .collect();
                    // the n-gon, when it triangulates back to the component's area: whether
                    // it does can depend on where its loop starts, which is a hash map's order
                    (cleaned.len() >= 3 && same_area(&cleaned, &c.tris, &positions, &c.normal, eps)).then_some(cleaned)
                })
                .collect();
            let failed: Vec<usize> = (0..comps.len()).filter(|&i| comps[i].boundary.is_some() && ngons[i].is_none()).collect();
            if failed.is_empty() {
                break ngons;
            }
            failed.iter().for_each(|&i| comps[i].boundary = None);
        };

        let mut out_polys: Vec<Polygon<S>> = Vec::new();
        for (c, ngon) in comps.iter().zip(ngons) {
            match ngon {
                Some(loop_idx) => {
                    // Orient CCW with respect to the plane normal.
                    let loop_idx: Vec<usize> = if signed_area(&loop_idx, &positions, &c.normal) < 0.0 {
                        loop_idx.into_iter().rev().collect()
                    } else {
                        loop_idx
                    };
                    let verts: Vec<Vertex> = loop_idx.iter().map(|&i| Vertex::new(positions[i], c.normal)).collect();
                    out_polys.push(Polygon::new(verts, c.metadata.clone()));
                }
                None => {
                    // Fallback: keep the component's triangles verbatim.
                    for t in &c.tris {
                        let verts: Vec<Vertex> = t.iter().map(|&i| Vertex::new(positions[i], c.normal)).collect();
                        out_polys.push(Polygon::new(verts, c.metadata.clone()));
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

/// Walk the boundary of a coplanar triangle component into a single loop, every vertex
/// included. Returns `None` if the boundary is not a single clean loop (holes, pinch
/// points, open) so the caller can fall back.
fn boundary_loop(tris: &[[usize; 3]]) -> Option<Vec<usize>> {
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
    Some(loop_idx)
}

/// The loop's edges into and out of vertex `i`.
fn loop_edges(loop_idx: &[usize], i: usize, positions: &[Point3<Real>]) -> (Vector3<Real>, Vector3<Real>) {
    let n = loop_idx.len();
    let prev = positions[loop_idx[(i + n - 1) % n]];
    let cur = positions[loop_idx[i]];
    let nxt = positions[loop_idx[(i + 1) % n]];
    (cur - prev, nxt - cur)
}

/// Vertex `i` of the loop lies on an edge to a neighbour (closer than `eps`).
fn is_coincident(loop_idx: &[usize], i: usize, positions: &[Point3<Real>], eps: Real) -> bool {
    let (d1, d2) = loop_edges(loop_idx, i, positions);
    d1.norm() < eps || d2.norm() < eps
}

/// Vertex `i` of the loop sits on a straight line between its neighbours (or on one).
fn is_collinear(loop_idx: &[usize], i: usize, positions: &[Point3<Real>], eps: Real) -> bool {
    let (d1, d2) = loop_edges(loop_idx, i, positions);
    let (l1, l2) = (d1.norm(), d2.norm());
    // collinear if the turn cross-product is ~0 relative to edge lengths
    l1 < eps || l2 < eps || (d1 / l1).cross(&(d2 / l2)).norm() <= 1e-6
}

/// The n-gon triangulates back to the area of the triangles it replaces.
fn same_area(
    loop_idx: &[usize],
    tris: &[[usize; 3]],
    positions: &[Point3<Real>],
    normal: &Vector3<Real>,
    eps: Real,
) -> bool {
    let area = |a: &Point3<Real>, b: &Point3<Real>, c: &Point3<Real>| 0.5 * (b - a).cross(&(c - a)).norm();
    let comp_area: Real = tris.iter().map(|t| area(&positions[t[0]], &positions[t[1]], &positions[t[2]])).sum();
    let verts: Vec<Vertex> = loop_idx.iter().map(|&i| Vertex::new(positions[i], *normal)).collect();
    let ngon: Polygon<()> = Polygon::new(verts, None);
    let ngon_area: Real = ngon.triangulate().iter().map(|t| area(&t[0].position, &t[1].position, &t[2].position)).sum();
    (ngon_area - comp_area).abs() <= 1e-6 * comp_area + eps * eps
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

#[cfg(test)]
mod tests {
    use crate::csg::CSG;
    use crate::mesh::Mesh;

    fn cuboid(at: [f64; 3], size: [f64; 3]) -> Mesh<()> {
        Mesh::cuboid(size[0], size[1], size[2], None).translate(at[0], at[1], at[2])
    }

    /// Two walls meeting at a corner, one with a window and one with a door: the merged faces
    /// must keep the vertices that other faces end at, or the union is no longer closed and the
    /// next boolean falls back to BSP. Repeated, because the result depends on hash order.
    #[test]
    fn union_of_cut_walls_stays_closed() {
        (0..20).for_each(|_| {
            let side = cuboid([0.0, 250.0, 0.0], [250.0, 3750.0, 3000.0])
                .difference(&cuboid([-100.0, 1000.0, 1000.0], [450.0, 800.0, 1000.0]))
                .reconstruct_ngons();
            let front = cuboid([0.0, 0.0, 0.0], [3000.0, 250.0, 3500.0])
                .difference(&cuboid([1000.0, -100.0, -10.0], [1000.0, 450.0, 2010.0]))
                .reconstruct_ngons();
            assert!(side.is_manifold() && front.is_manifold());
            assert!(side.union(&front).reconstruct_ngons().is_manifold());
        });
    }

    /// A side wall under a sloping roof (top 5478 at x = 0, 5569 at x = 250, as the house sketch
    /// makes it) and a row of doors flush with its bottom, cut one after the other. Triangulating
    /// the wall's n-gons must give back their exact corners: lifted back from 2D, the bottom
    /// drifted off z = 0 by a few ulps and the next door left a zero-thickness sheet (an open
    /// mesh, about one run in three).
    #[test]
    fn doors_flush_with_the_bottom_stay_closed() {
        use crate::polygon::Polygon;
        use crate::vertex::Vertex;
        use nalgebra::Point3;
        let (top0, top1, x1) = (5478.000205481719, 5568.992764048269, 249.99999999999997);
        let tris: [[f64; 9]; 12] = [
            [0.0, 10750.0, 0.0, 0.0, 10750.0, top0, 250.0, 10750.0, 0.0],
            [250.0, 10750.0, top1, 250.0, 10750.0, 0.0, 0.0, 10750.0, top0],
            [0.0, 250.0, top0, x1, 10750.0, top1, 0.0, 10750.0, top0],
            [x1, 250.0, top1, x1, 10750.0, top1, 0.0, 250.0, top0],
            [250.0, 250.0, 0.0, 0.0, 250.0, top0, 0.0, 250.0, 0.0],
            [250.0, 250.0, top1, 0.0, 250.0, top0, 250.0, 250.0, 0.0],
            [250.0, 250.0, 0.0, 250.0, 10750.0, top1, 250.0, 250.0, top1],
            [250.0, 10750.0, 0.0, 250.0, 10750.0, top1, 250.0, 250.0, 0.0],
            [0.0, 10750.0, 0.0, 0.0, 250.0, top0, 0.0, 10750.0, top0],
            [0.0, 250.0, 0.0, 0.0, 250.0, top0, 0.0, 10750.0, 0.0],
            [250.0, 250.0, 0.0, 0.0, 10750.0, 0.0, 250.0, 10750.0, 0.0],
            [0.0, 250.0, 0.0, 0.0, 10750.0, 0.0, 250.0, 250.0, 0.0],
        ];
        let polygons: Vec<Polygon<()>> = tris.iter().map(|t| {
            let p: Vec<Point3<f64>> = t.chunks(3).map(|c| Point3::new(c[0], c[1], c[2])).collect();
            let n = (p[1] - p[0]).cross(&(p[2] - p[0])).normalize();
            Polygon::new(p.iter().map(|q| Vertex::new(*q, n)).collect(), None)
        }).collect();
        let volume = |m: &Mesh<()>| m.polygons.iter().flat_map(|p| p.triangulate())
            .map(|t| t[0].position.coords.dot(&t[1].position.coords.cross(&t[2].position.coords)) / 6.0).sum::<f64>();
        (0..30).for_each(|_| {
            let mut wall = Mesh::from_polygons(&polygons, None).reconstruct_ngons();
            let full = volume(&wall);
            [9136.0, 7521.0, 5907.0, 4293.0, 2679.0, 1064.0].iter().enumerate().for_each(|(i, &y)| {
                wall = wall.difference(&cuboid([-500.0, y, 0.0], [1000.0, 800.0, 2000.0])).reconstruct_ngons();
                assert!(wall.is_manifold(), "open after door {i}");
                assert!((volume(&wall) - (full - (i + 1) as f64 * 250.0 * 800.0 * 2000.0)).abs() < 1.0, "volume after door {i}");
            });
        });
    }
}
