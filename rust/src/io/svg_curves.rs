//! Hypercurve-backed SVG import → native planar curves.
//!
//! The legacy [`svg`](super::svg) importer builds only polylines and errors on
//! every curve command. This module instead routes each SVG `<path>`'s data
//! through hypercurve's curve-aware importer
//! ([`parse_svg_path_data`]), so **lines, circular arcs, and cubic/quadratic Béziers all
//! stay exact**. meshup's [`Segment2`] has no Bézier variant, but `CurvePath2` does, so a
//! Bézier is carried through as an exact path rather than flattened at the import boundary.
//! Unsupported path commands (rotated arcs, …) are skipped and reported as warnings.
//!
//! Shape elements (`<circle>`, `<ellipse>`, `<rect>`, `<polygon>`, `<polyline>`,
//! `<line>`) are turned into native contours/curve strings directly.
//!
//! Coordinates are kept in SVG space (y-down) at z = 0, matching the legacy
//! importer (no y-flip).

use crate::hcurve;
use hypercurve::{
    Contour2, CurveGeometry2, CurveString2, Segment2, parse_svg_path_data,
};

use super::IoError;

/// One imported planar curve (SVG coords, z = 0).
pub enum ImportedCurve {
    /// An open curve string.
    Open(CurveString2),
    /// A closed contour.
    Closed(Contour2),
    /// An exact mixed-family path — an SVG `C`/`Q` Bézier or an `<ellipse>` — which
    /// `CurveString2`/`Contour2` cannot hold.
    Path(hypercurve::CurvePath2, bool),
}

/// Import an SVG document into native planar curves plus a list of warnings for
/// any skipped/unsupported content.
pub fn import_svg_curves(doc: &str) -> Result<(Vec<ImportedCurve>, Vec<String>), IoError> {
    use svg::node::element::tag::{self, Type::*};
    use svg::parser::Event;

    let mut curves: Vec<ImportedCurve> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for event in svg::read(doc)? {
        match event {
            Event::Error(error) => return Err(error.into()),

            Event::Tag(tag::Path, Empty, attrs) => {
                if let Some(d) = attrs.get("d") {
                    curves.extend(import_path(d, &mut warnings));
                }
            },

            Event::Tag(tag::Circle, Empty, attrs) => {
                if let (Some(cx), Some(cy), Some(r)) =
                    (attr_f64(&attrs, "cx"), attr_f64(&attrs, "cy"), attr_f64(&attrs, "r"))
                {
                    match hcurve::circle(cx, cy, r) {
                        Ok(ct) => curves.push(ImportedCurve::Closed(ct)),
                        Err(e) => warnings.push(format!("skipped <circle>: {e}")),
                    }
                }
            },

            Event::Tag(tag::Ellipse, Empty, attrs) => {
                if let (Some(cx), Some(cy), Some(rx), Some(ry)) = (
                    attr_f64(&attrs, "cx"),
                    attr_f64(&attrs, "cy"),
                    attr_f64(&attrs, "rx"),
                    attr_f64(&attrs, "ry"),
                ) {
                    match hcurve::ellipse(rx, ry, 0.0, cx, cy) {
                        // Exact rational-conic ellipse. This used to be sampled at a count
                        // derived from the raw radius value (`clamp(16, 256)`), so the
                        // fidelity of an imported ellipse depended on the document's units
                        // — a small one arrived as a 16-gon.
                        Ok(path) => curves.push(ImportedCurve::Path(path, true)),
                        Err(e) => warnings.push(format!("skipped an <ellipse>: {e}")),
                    }
                }
            },

            Event::Tag(tag::Rectangle, Empty, attrs) => {
                if let (Some(x), Some(y), Some(w), Some(h)) = (
                    attr_f64(&attrs, "x"),
                    attr_f64(&attrs, "y"),
                    attr_f64(&attrs, "width"),
                    attr_f64(&attrs, "height"),
                ) {
                    push_closed(&mut curves, &mut warnings, rect_points(x, y, w, h), "<rect>");
                }
            },

            Event::Tag(tag::Line, Empty, attrs) => {
                if let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
                    attr_f64(&attrs, "x1"),
                    attr_f64(&attrs, "y1"),
                    attr_f64(&attrs, "x2"),
                    attr_f64(&attrs, "y2"),
                ) {
                    push_open(&mut curves, &mut warnings, vec![[x1, y1], [x2, y2]], "<line>");
                }
            },

            Event::Tag(tag::Polygon, Empty, attrs) => {
                if let Some(points) = attrs.get("points") {
                    match parse_points(points) {
                        Ok(pts) => push_closed(&mut curves, &mut warnings, pts, "<polygon>"),
                        Err(e) => warnings.push(format!("skipped <polygon>: {e}")),
                    }
                }
            },

            Event::Tag(tag::Polyline, Empty, attrs) => {
                if let Some(points) = attrs.get("points") {
                    match parse_points(points) {
                        Ok(pts) => push_open(&mut curves, &mut warnings, pts, "<polyline>"),
                        Err(e) => warnings.push(format!("skipped <polyline>: {e}")),
                    }
                }
            },

            // Everything else (svg/group/title/text/…) is ignored.
            _ => {},
        }
    }

    Ok((curves, warnings))
}

/// Parse one `<path>`'s `d` data via hypercurve into native curves (one per subpath).
fn import_path(d: &str, warnings: &mut Vec<String>) -> Vec<ImportedCurve> {
    let subpaths = match parse_svg_path_data(d) {
        Ok(subpaths) => subpaths,
        Err(_) => {
            warnings.push(format!(
                "skipped an SVG <path> with unsupported commands (e.g. elliptical/rotated arc): '{}'",
                truncate(d)
            ));
            return Vec::new();
        },
    };

    subpaths
        .into_iter()
        .filter_map(|subpath| import_curve_path(subpath.into_path(), warnings))
        .collect()
}

/// Convert one hypercurve subpath into a native curve.
///
/// The parser already hands us an exact [`hypercurve::CurvePath2`], so a `C`/`Q` Bézier is
/// carried straight through. This used to flatten every Bézier into 24 line segments before
/// meshup ever saw it — the arc-ness was destroyed at the import boundary, which is why an
/// imported SVG curve could never report `degree() > 1`.
fn import_curve_path(
    curve_path: hypercurve::CurvePath2,
    warnings: &mut Vec<String>,
) -> Option<ImportedCurve> {
    // Line/arc content keeps the native contour/curve-string carriers, which unlock
    // hypercurve's decided fast paths downstream.
    let mut segs: Vec<Segment2> = Vec::with_capacity(curve_path.curves().len());
    let all_line_arc = curve_path.curves().iter().all(|curve| match curve.geometry() {
        CurveGeometry2::Line(l) => {
            segs.push(Segment2::Line(l.clone()));
            true
        },
        CurveGeometry2::CircularArc(a) => {
            segs.push(Segment2::Arc(a.clone()));
            true
        },
        _ => false,
    });

    if all_line_arc {
        // A closed path's segments form a loop (hypercurve appends the closing line);
        // an open one does not. Let the contour constructor decide.
        return match Contour2::try_new(segs.clone()) {
            Ok(ct) => Some(ImportedCurve::Closed(ct)),
            Err(_) => match CurveString2::try_new(segs) {
                Ok(cs) => Some(ImportedCurve::Open(cs)),
                Err(_) => {
                    warnings.push("skipped an SVG <path>: could not assemble a curve".into());
                    None
                },
            },
        };
    }

    let closed = curve_path.start() == curve_path.end();
    Some(ImportedCurve::Path(curve_path, closed))
}

fn push_closed(curves: &mut Vec<ImportedCurve>, warnings: &mut Vec<String>, pts: Vec<[f64; 2]>, what: &str) {
    if pts.len() < 3 {
        return;
    }
    match hcurve::closed_contour(&pts) {
        Ok(ct) => curves.push(ImportedCurve::Closed(ct)),
        Err(e) => warnings.push(format!("skipped {what}: {e}")),
    }
}

fn push_open(curves: &mut Vec<ImportedCurve>, warnings: &mut Vec<String>, pts: Vec<[f64; 2]>, what: &str) {
    if pts.len() < 2 {
        return;
    }
    match hcurve::open_polyline(&pts) {
        Ok(cs) => curves.push(ImportedCurve::Open(cs)),
        Err(e) => warnings.push(format!("skipped {what}: {e}")),
    }
}

fn attr_f64(attrs: &std::collections::HashMap<String, svg::node::Value>, key: &str) -> Option<f64> {
    attrs.get(key).and_then(|v| v.parse::<f64>().ok())
}

/// Parse an SVG `points` attribute ("x1,y1 x2,y2 …") into coordinate pairs.
fn parse_points(s: &str) -> Result<Vec<[f64; 2]>, String> {
    let nums: Vec<f64> = s
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|t| !t.is_empty())
        .map(|t| t.parse::<f64>().map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;
    if nums.len() % 2 != 0 {
        return Err("odd number of coordinates".into());
    }
    Ok(nums.chunks(2).map(|c| [c[0], c[1]]).collect())
}

/// A (sharp) rectangle outline. Rounded corners are simplified to sharp for now.
fn rect_points(x: f64, y: f64, w: f64, h: f64) -> Vec<[f64; 2]> {
    vec![[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
}

fn truncate(s: &str) -> String {
    if s.len() <= 60 {
        s.to_string()
    } else {
        format!("{}…", &s[..60])
    }
}
