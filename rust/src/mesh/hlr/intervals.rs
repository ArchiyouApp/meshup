//! A sorted list of disjoint `[start, end]` sub-ranges of `[0, 1]`.
//!
//! Occlusion along one edge is accumulated here: every triangle that hides part
//! of the edge contributes one interval, and what is left over after inverting
//! the union is exactly the visible line work. Keeping the list sorted and
//! merged as we insert means the inversion at the end is a single linear pass,
//! and — the point of the whole exercise — the boundaries are the *true*
//! crossing parameters rather than the nearest sample.

use crate::float_types::Real;

/// Sub-ranges shorter than this in `t` are treated as empty. Relative to a
/// unit-length parameter interval, so it needs no scene scale.
pub(crate) const MIN_SPAN: Real = 1e-12;

/// A merged, sorted set of disjoint intervals within `[0, 1]`.
#[derive(Debug, Clone, Default)]
pub(crate) struct IntervalSet {
    spans: Vec<(Real, Real)>,
}

impl IntervalSet {
    #[inline]
    pub fn new() -> Self {
        IntervalSet { spans: Vec::new() }
    }

    #[inline]
    pub fn clear(&mut self) {
        self.spans.clear();
    }

    #[inline]
    pub fn spans(&self) -> &[(Real, Real)] {
        &self.spans
    }

    /// Add `[start, end]`, merging into any ranges it touches or overlaps.
    pub fn insert(&mut self, start: Real, end: Real) {
        // Reject NaN before clamping, not after: `f64::max`/`min` return the
        // non-NaN operand, so a NaN bound would silently become 0.0 or 1.0 and
        // blank out a span of the edge that nothing actually occludes.
        if start.is_nan() || end.is_nan() {
            return;
        }
        let mut lo = start.max(0.0);
        let mut hi = end.min(1.0);
        if !(lo.is_finite() && hi.is_finite()) || hi - lo <= MIN_SPAN {
            return;
        }

        // Find the first span that could touch [lo, hi], then absorb every span
        // that overlaps and splice the union in at that position.
        let first = self.spans.partition_point(|s| s.1 < lo - MIN_SPAN);
        let mut last = first;
        while last < self.spans.len() && self.spans[last].0 <= hi + MIN_SPAN {
            lo = lo.min(self.spans[last].0);
            hi = hi.max(self.spans[last].1);
            last += 1;
        }
        self.spans.splice(first..last, std::iter::once((lo, hi)));
    }

    /// The complement of this set within `[0, 1]`.
    ///
    /// Gaps shorter than [`MIN_SPAN`] are dropped, so an edge that is fully
    /// covered yields nothing rather than a scatter of zero-length slivers.
    pub fn complement(&self) -> Vec<(Real, Real)> {
        let mut out = Vec::with_capacity(self.spans.len() + 1);
        let mut cursor = 0.0;
        for &(lo, hi) in &self.spans {
            if lo - cursor > MIN_SPAN {
                out.push((cursor, lo));
            }
            cursor = cursor.max(hi);
        }
        if 1.0 - cursor > MIN_SPAN {
            out.push((cursor, 1.0));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spans(set: &IntervalSet) -> Vec<(Real, Real)> {
        set.spans().to_vec()
    }

    #[test]
    fn disjoint_inserts_stay_separate_and_sorted() {
        let mut s = IntervalSet::new();
        s.insert(0.6, 0.8);
        s.insert(0.1, 0.2);
        s.insert(0.4, 0.5);
        assert_eq!(spans(&s), vec![(0.1, 0.2), (0.4, 0.5), (0.6, 0.8)]);
    }

    #[test]
    fn overlapping_inserts_merge() {
        let mut s = IntervalSet::new();
        s.insert(0.1, 0.4);
        s.insert(0.3, 0.6);
        assert_eq!(spans(&s), vec![(0.1, 0.6)]);
    }

    #[test]
    fn an_insert_can_bridge_several_existing_spans() {
        let mut s = IntervalSet::new();
        s.insert(0.1, 0.2);
        s.insert(0.4, 0.5);
        s.insert(0.7, 0.8);
        s.insert(0.15, 0.75);
        assert_eq!(spans(&s), vec![(0.1, 0.8)]);
    }

    #[test]
    fn touching_spans_merge() {
        let mut s = IntervalSet::new();
        s.insert(0.1, 0.5);
        s.insert(0.5, 0.9);
        assert_eq!(spans(&s), vec![(0.1, 0.9)]);
    }

    #[test]
    fn inserts_are_clamped_to_the_unit_range() {
        let mut s = IntervalSet::new();
        s.insert(-3.0, 0.25);
        s.insert(0.75, 9.0);
        assert_eq!(spans(&s), vec![(0.0, 0.25), (0.75, 1.0)]);
    }

    #[test]
    fn degenerate_and_non_finite_inserts_are_ignored() {
        let mut s = IntervalSet::new();
        s.insert(0.5, 0.5);
        s.insert(0.5, 0.4);
        s.insert(Real::NAN, 0.5);
        s.insert(0.2, Real::INFINITY); // clamps to (0.2, 1.0) — this one counts
        assert_eq!(spans(&s), vec![(0.2, 1.0)]);
    }

    #[test]
    fn complement_of_empty_is_the_whole_edge() {
        let s = IntervalSet::new();
        assert_eq!(s.complement(), vec![(0.0, 1.0)]);
    }

    #[test]
    fn complement_returns_the_gaps() {
        let mut s = IntervalSet::new();
        s.insert(0.2, 0.4);
        s.insert(0.6, 0.8);
        assert_eq!(
            s.complement(),
            vec![(0.0, 0.2), (0.4, 0.6), (0.8, 1.0)]
        );
    }

    #[test]
    fn fully_covered_edge_has_no_complement() {
        let mut s = IntervalSet::new();
        s.insert(0.0, 1.0);
        assert!(s.complement().is_empty());
    }

    #[test]
    fn complement_drops_leading_and_trailing_slivers() {
        let mut s = IntervalSet::new();
        s.insert(MIN_SPAN * 0.5, 1.0 - MIN_SPAN * 0.5);
        assert!(s.complement().is_empty());
    }
}
