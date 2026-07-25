//! Hypercurve-backed SVG import → native planar curves.
//!
//! The legacy [`svg`](super::svg) importer builds only polylines and errors on
//! every curve command. This module instead routes each SVG `<path>`'s data
//! through hypercurve's curve-aware importer
//! ([`import_svg_path_data_with_report`]), so **lines and circular arcs stay
//! exact**. meshup's [`Segment2`] has no Bézier variant, so cubic/quadratic
//! Béziers are flattened to line segments here. Unsupported path commands
//! (elliptical or rotated arcs, …) are skipped and reported as warnings.
//!
//! Shape elements (`<circle>`, `<ellipse>`, `<rect>`, `<polygon>`, `<polyline>`,
//! `<line>`) are turned into native contours/curve strings directly.
//!
//! Coordinates are kept in SVG space (y-down) at z = 0, matching the legacy
//! importer (no y-flip).

use crate::hcurve;
use hypercurve::{
    Contour2, CurveGeometry2, CurveString2, LineSeg2, Point2, Segment2,
    import_svg_path_data_with_report,
};

use super::IoError;

/// One imported planar curve (SVG coords, z = 0).
pub enum ImportedCurve {
    /// An open curve string.
    Open(CurveString2),
    /// A closed contour.
    Closed(Contour2),
}

/// Line segments emitted per flattened Bézier.
const BEZIER_SEGMENTS: usize = 24;

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
                    if let Some(c) = import_path(d, &mut warnings) {
                        curves.push(c);
                    }
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
                    push_closed(&mut curves, &mut warnings, ellipse_points(cx, cy, rx, ry), "<ellipse>");
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

/// Parse one `<path>`'s `d` data via hypercurve into a native curve.
fn import_path(d: &str, warnings: &mut Vec<String>) -> Option<ImportedCurve> {
    let result = import_svg_path_data_with_report(d, 0, 0, None);
    let curve_path = match result.into_curve_path() {
        Some(cp) => cp,
        None => {
            warnings.push(format!(
                "skipped an SVG <path> with unsupported commands (e.g. elliptical/rotated arc): '{}'",
                truncate(d)
            ));
            return None;
        },
    };

    let mut segs: Vec<Segment2> = Vec::new();
    for curve in curve_path.curves() {
        match curve.geometry() {
            CurveGeometry2::Line(l) => segs.push(Segment2::Line(l.clone())),
            CurveGeometry2::CircularArc(a) => segs.push(Segment2::Arc(a.clone())),
            CurveGeometry2::CubicBezier(b) => {
                if flatten_bezier(b.start().clone(), |t| b.point_at(t), &mut segs).is_none() {
                    warnings.push("skipped an SVG <path>: could not flatten a cubic Bézier".into());
                    return None;
                }
            },
            CurveGeometry2::QuadraticBezier(b) => {
                if flatten_bezier(b.start().clone(), |t| b.point_at(t), &mut segs).is_none() {
                    warnings.push("skipped an SVG <path>: could not flatten a quadratic Bézier".into());
                    return None;
                }
            },
            _ => {
                warnings.push("skipped an SVG <path> with an unsupported segment type".into());
                return None;
            },
        }
    }

    // A closed path's segments form a loop (hypercurve appends the closing line);
    // an open one does not. Let the contour constructor decide.
    match Contour2::try_new(segs.clone()) {
        Ok(ct) => Some(ImportedCurve::Closed(ct)),
        Err(_) => match CurveString2::try_new(segs) {
            Ok(cs) => Some(ImportedCurve::Open(cs)),
            Err(_) => {
                warnings.push("skipped an SVG <path>: could not assemble a curve".into());
                None
            },
        },
    }
}

/// Flatten a Bézier by uniformly sampling its parameterisation into line segments.
/// `start` must be the curve's first point (== the previous segment's end).
fn flatten_bezier(
    start: Point2,
    eval: impl Fn(hypercurve::Real) -> Point2,
    segs: &mut Vec<Segment2>,
) -> Option<()> {
    let mut prev = start;
    for k in 1..=BEZIER_SEGMENTS {
        let t = hcurve::real(k as f64 / BEZIER_SEGMENTS as f64).ok()?;
        let cur = eval(t);
        if let Ok(line) = LineSeg2::try_new(prev.clone(), cur.clone()) {
            segs.push(Segment2::Line(line));
        }
        prev = cur;
    }
    Some(())
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

fn ellipse_points(cx: f64, cy: f64, rx: f64, ry: f64) -> Vec<[f64; 2]> {
    let n = (rx.max(ry).ceil() as usize).clamp(16, 256);
    (0..n)
        .map(|i| {
            let a = std::f64::consts::TAU * (i as f64) / (n as f64);
            [cx + rx * a.cos(), cy + ry * a.sin()]
        })
        .collect()
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
