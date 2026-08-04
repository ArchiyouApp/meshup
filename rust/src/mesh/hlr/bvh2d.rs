//! A small bounding-volume hierarchy over 2-D axis-aligned boxes.
//!
//! The exact HLR solver asks the same question millions of times: *which
//! projected triangles could possibly overlap this projected edge?* Answering it
//! by scanning every triangle is quadratic and dominates the solve on anything
//! larger than a few boxes.
//!
//! This is a plain median-split BVH built once per projection and queried with a
//! segment's bounding box. It is deliberately hand-rolled rather than pulled from
//! a crate: the whole structure is a hundred lines, it keeps the WASM binary from
//! growing, and — more importantly — the exact solver depends on the leaf order
//! being stable, which a third-party build heuristic does not have to guarantee.

use crate::float_types::Real;

/// An axis-aligned rectangle. `min` is inclusive, `max` is inclusive.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Aabb2 {
    pub min: [Real; 2],
    pub max: [Real; 2],
}

impl Aabb2 {
    /// An empty box that absorbs any point on the first `expand`.
    #[inline]
    pub fn empty() -> Self {
        Aabb2 {
            min: [Real::INFINITY, Real::INFINITY],
            max: [Real::NEG_INFINITY, Real::NEG_INFINITY],
        }
    }

    /// The tight box around three points (one projected triangle).
    #[inline]
    pub fn from_triangle(a: [Real; 2], b: [Real; 2], c: [Real; 2]) -> Self {
        Aabb2 {
            min: [a[0].min(b[0]).min(c[0]), a[1].min(b[1]).min(c[1])],
            max: [a[0].max(b[0]).max(c[0]), a[1].max(b[1]).max(c[1])],
        }
    }

    /// The tight box around a segment's two endpoints.
    #[inline]
    pub fn from_segment(a: [Real; 2], b: [Real; 2]) -> Self {
        Aabb2 {
            min: [a[0].min(b[0]), a[1].min(b[1])],
            max: [a[0].max(b[0]), a[1].max(b[1])],
        }
    }

    #[inline]
    pub fn union(&self, other: &Aabb2) -> Aabb2 {
        Aabb2 {
            min: [self.min[0].min(other.min[0]), self.min[1].min(other.min[1])],
            max: [self.max[0].max(other.max[0]), self.max[1].max(other.max[1])],
        }
    }

    /// Grow the box by `pad` on every side.
    ///
    /// Queries pad by the solver's epsilon so a triangle that merely *touches*
    /// the edge is still handed to the exact test rather than being rejected by
    /// a floating-point hair here, where there is no tolerance context.
    #[inline]
    pub fn padded(&self, pad: Real) -> Aabb2 {
        Aabb2 {
            min: [self.min[0] - pad, self.min[1] - pad],
            max: [self.max[0] + pad, self.max[1] + pad],
        }
    }

    #[inline]
    pub fn intersects(&self, other: &Aabb2) -> bool {
        self.min[0] <= other.max[0]
            && self.max[0] >= other.min[0]
            && self.min[1] <= other.max[1]
            && self.max[1] >= other.min[1]
    }

    #[inline]
    pub fn centroid(&self) -> [Real; 2] {
        [
            (self.min[0] + self.max[0]) * 0.5,
            (self.min[1] + self.max[1]) * 0.5,
        ]
    }
}

/// Leaves per node below which we stop splitting.
const LEAF_SIZE: usize = 4;

#[derive(Debug)]
enum Node {
    Leaf {
        bounds: Aabb2,
        /// Range into [`Bvh2::order`].
        start: usize,
        end: usize,
    },
    Inner {
        bounds: Aabb2,
        left: usize,
        right: usize,
    },
}

/// A static BVH over 2-D boxes, queried by box overlap.
#[derive(Debug)]
pub(crate) struct Bvh2 {
    nodes: Vec<Node>,
    /// Permutation of the input indices, grouped by leaf.
    order: Vec<usize>,
    /// The input boxes, kept so leaves can reject non-overlapping members.
    boxes: Vec<Aabb2>,
    root: Option<usize>,
}

impl Bvh2 {
    /// Build a hierarchy over `boxes`. The returned indices in [`Bvh2::query`]
    /// refer to positions in this slice.
    pub fn build(boxes: &[Aabb2]) -> Self {
        let mut bvh = Bvh2 {
            nodes: Vec::new(),
            order: (0..boxes.len()).collect(),
            boxes: boxes.to_vec(),
            root: None,
        };
        if boxes.is_empty() {
            return bvh;
        }
        let len = boxes.len();
        bvh.root = Some(bvh.build_range(boxes, 0, len));
        bvh
    }

    fn build_range(&mut self, boxes: &[Aabb2], start: usize, end: usize) -> usize {
        let mut bounds = Aabb2::empty();
        for &i in &self.order[start..end] {
            bounds = bounds.union(&boxes[i]);
        }

        if end - start <= LEAF_SIZE {
            self.nodes.push(Node::Leaf { bounds, start, end });
            return self.nodes.len() - 1;
        }

        // Split along whichever axis the bounds are widest on, at the median
        // centroid. Median rather than midpoint keeps the tree balanced when
        // geometry clusters, which is the normal case for a building model.
        let extent = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]];
        let axis = if extent[0] >= extent[1] { 0 } else { 1 };

        let slice = &mut self.order[start..end];
        slice.sort_unstable_by(|&a, &b| {
            let ca = boxes[a].centroid()[axis];
            let cb = boxes[b].centroid()[axis];
            ca.partial_cmp(&cb).unwrap_or(std::cmp::Ordering::Equal)
        });

        let mid = start + (end - start) / 2;
        let left = self.build_range(boxes, start, mid);
        let right = self.build_range(boxes, mid, end);
        self.nodes.push(Node::Inner {
            bounds,
            left,
            right,
        });
        self.nodes.len() - 1
    }

    /// Append the indices of every box overlapping `query` to `out`.
    ///
    /// Leaf members are tested individually rather than returned wholesale on a
    /// node-bounds hit, so this is the exact overlap set, not a superset. The
    /// caller's per-candidate work is an exact clip and depth solve, which is
    /// far more expensive than the box test that avoids it.
    ///
    /// `out` is cleared first, and is reused across edges by the caller so the
    /// per-edge query allocates nothing.
    pub fn query(&self, query: &Aabb2, out: &mut Vec<usize>) {
        out.clear();
        let Some(root) = self.root else { return };
        // An explicit stack: edge counts run into the hundreds of thousands and
        // recursion depth here is log(n), but the stack reuse matters more.
        let mut stack = [0usize; 64];
        let mut sp = 0usize;
        stack[sp] = root;
        sp += 1;

        while sp > 0 {
            sp -= 1;
            let node = &self.nodes[stack[sp]];
            match node {
                Node::Leaf { bounds, start, end } => {
                    if bounds.intersects(query) {
                        for &i in &self.order[*start..*end] {
                            if self.boxes[i].intersects(query) {
                                out.push(i);
                            }
                        }
                    }
                },
                Node::Inner {
                    bounds,
                    left,
                    right,
                } => {
                    if bounds.intersects(query) {
                        // Depth is log2(n) so 64 slots cover 2^61 primitives;
                        // the guard is belt-and-braces against a pathological build.
                        if sp + 2 <= stack.len() {
                            stack[sp] = *left;
                            sp += 1;
                            stack[sp] = *right;
                            sp += 1;
                        }
                    }
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxes() -> Vec<Aabb2> {
        // A row of 10 unit squares at x = 0, 2, 4, ... 18.
        (0..10)
            .map(|i| {
                let x = i as Real * 2.0;
                Aabb2 {
                    min: [x, 0.0],
                    max: [x + 1.0, 1.0],
                }
            })
            .collect()
    }

    #[test]
    fn query_returns_only_overlapping_boxes() {
        let bs = boxes();
        let bvh = Bvh2::build(&bs);
        let mut hits = Vec::new();

        // A query straddling squares 2 (x 4..5) and 3 (x 6..7).
        bvh.query(
            &Aabb2 {
                min: [4.5, 0.2],
                max: [6.5, 0.8],
            },
            &mut hits,
        );
        hits.sort_unstable();
        assert_eq!(hits, vec![2, 3]);
    }

    #[test]
    fn query_matches_brute_force_on_every_box() {
        let bs = boxes();
        let bvh = Bvh2::build(&bs);
        let mut hits = Vec::new();
        for (i, b) in bs.iter().enumerate() {
            bvh.query(b, &mut hits);
            hits.sort_unstable();
            let mut expected: Vec<usize> = bs
                .iter()
                .enumerate()
                .filter(|(_, o)| o.intersects(b))
                .map(|(j, _)| j)
                .collect();
            expected.sort_unstable();
            assert_eq!(hits, expected, "mismatch querying box {i}");
        }
    }

    #[test]
    fn disjoint_query_returns_nothing() {
        let bs = boxes();
        let bvh = Bvh2::build(&bs);
        let mut hits = Vec::new();
        bvh.query(
            &Aabb2 {
                min: [0.0, 10.0],
                max: [100.0, 11.0],
            },
            &mut hits,
        );
        assert!(hits.is_empty());
    }

    #[test]
    fn empty_input_is_queryable() {
        let bvh = Bvh2::build(&[]);
        let mut hits = Vec::new();
        bvh.query(
            &Aabb2 {
                min: [0.0, 0.0],
                max: [1.0, 1.0],
            },
            &mut hits,
        );
        assert!(hits.is_empty());
    }
}
