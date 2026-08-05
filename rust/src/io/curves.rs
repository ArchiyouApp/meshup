//! Shared vocabulary for the curve-aware importers (SVG, DXF).
//!
//! Both read a document into exact hypercurve geometry rather than the point lists the
//! legacy importers produced, and both need the same two things: a carrier for "one
//! imported planar curve, whatever family it turned out to be", and a planar transform to
//! carry through nested groups or blocks.

use crate::hcurve;
use hypercurve::{Contour2, CurvePath2, CurveString2};

/// One imported planar curve (document coords, z = 0).
pub enum ImportedCurve
{
    /// An open curve string of native line/arc segments.
    Open(CurveString2),
    /// A closed contour of native line/arc segments.
    Closed(Contour2),
    /// An exact mixed-family path — an SVG `C`/`Q` Bézier, an `<ellipse>`, a DXF ELLIPSE
    /// or SPLINE — which `CurveString2`/`Contour2` cannot hold. The flag says whether it
    /// closes.
    Path(CurvePath2, bool),
}

/// A planar affine map, `x' = m00*x + m01*y + tx`.
///
/// Carried through SVG group nesting and DXF block INSERTs. Kept in f64 and converted to
/// an exact [`hypercurve::Similarity2`] only where it is applied: hypercurve offers no
/// identity or composition on that type, and the numbers arrive from the file as f64
/// anyway, so composing exactly at every nesting level would cost more than it buys.
#[derive(Clone, Copy, Debug)]
pub struct Xform
{
    pub m00: f64,
    pub m01: f64,
    pub m10: f64,
    pub m11: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Xform
{
    pub const IDENTITY: Self =
        Self { m00: 1.0, m01: 0.0, m10: 0.0, m11: 1.0, tx: 0.0, ty: 0.0 };

    /// `self` applied *after* `inner` — the order a nested group or block needs.
    pub fn compose(&self, inner: &Self) -> Self
    {
        Self {
            m00: self.m00 * inner.m00 + self.m01 * inner.m10,
            m01: self.m00 * inner.m01 + self.m01 * inner.m11,
            m10: self.m10 * inner.m00 + self.m11 * inner.m10,
            m11: self.m10 * inner.m01 + self.m11 * inner.m11,
            tx: self.m00 * inner.tx + self.m01 * inner.ty + self.tx,
            ty: self.m10 * inner.tx + self.m11 * inner.ty + self.ty,
        }
    }

    pub fn is_identity(&self) -> bool
    {
        self.m00 == 1.0
            && self.m01 == 0.0
            && self.m10 == 0.0
            && self.m11 == 1.0
            && self.tx == 0.0
            && self.ty == 0.0
    }

    /// The exact similarity this map represents, or an error when it is not one
    /// (a non-uniform scale or a skew).
    pub fn to_similarity(self) -> Result<hypercurve::Similarity2, String>
    {
        hcurve::similarity(self.m00, self.m01, self.m10, self.m11, self.tx, self.ty)
    }
}

/// Apply `xform` to an imported curve, or describe why it could not be.
pub fn transform_imported(curve: ImportedCurve, xform: &Xform)
    -> Result<ImportedCurve, String>
{
    if xform.is_identity()
    {
        return Ok(curve);
    }
    let sim = xform.to_similarity()?;
    match curve
    {
        ImportedCurve::Open(cs) => hcurve::transform_open(&cs, &sim).map(ImportedCurve::Open),
        ImportedCurve::Closed(ct) =>
        {
            hcurve::transform_contour(&ct, &sim).map(ImportedCurve::Closed)
        },
        ImportedCurve::Path(path, closed) => path
            .transform_similarity(&sim)
            .map(|p| ImportedCurve::Path(p, closed))
            .map_err(|e| format!("path transform failed ({e:?})")),
    }
}
