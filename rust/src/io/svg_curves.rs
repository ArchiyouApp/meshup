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
use super::curves::{ImportedCurve, Xform, transform_imported};

/// Import an SVG document into native planar curves plus a list of warnings for
/// any skipped/unsupported content.
pub fn import_svg_curves(doc: &str) -> Result<(Vec<ImportedCurve>, Vec<String>), IoError> {
    use svg::node::element::tag::{self, Type::*};
    use svg::parser::Event;

    let mut curves: Vec<ImportedCurve> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    // Innermost transform last; the top of the stack is what applies to the next element.
    // Without this, a `<g transform="translate(...)">` imported its contents at the wrong
    // place, silently — the geometry was right and only its position was wrong, which is
    // the hardest kind of error to notice.
    let mut stack: Vec<Xform> = vec![Xform::IDENTITY];

    for event in svg::read(doc)? {
        match event {
            Event::Error(error) => return Err(error.into()),

            Event::Tag(tag::Path, Empty, attrs) => {
                if let Some(d) = attrs.get("d") {
                    let mark = curves.len();
                    curves.extend(import_path(d, &mut warnings));
                    apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                        &mut warnings);
                }
            },

            Event::Tag(tag::Circle, Empty, attrs) => {
                let mark = curves.len();
                if let (Some(cx), Some(cy), Some(r)) =
                    (attr_f64(&attrs, "cx"), attr_f64(&attrs, "cy"), attr_f64(&attrs, "r"))
                {
                    match hcurve::circle(cx, cy, r) {
                        Ok(ct) => curves.push(ImportedCurve::Closed(ct)),
                        Err(e) => warnings.push(format!("skipped <circle>: {e}")),
                    }
                }
                apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                    &mut warnings);
            },

            Event::Tag(tag::Ellipse, Empty, attrs) => {
                let mark = curves.len();
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
                apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                    &mut warnings);
            },

            Event::Tag(tag::Rectangle, Empty, attrs) => {
                if let (Some(x), Some(y), Some(w), Some(h)) = (
                    attr_f64(&attrs, "x"),
                    attr_f64(&attrs, "y"),
                    attr_f64(&attrs, "width"),
                    attr_f64(&attrs, "height"),
                ) {
                    // rx/ry each default to the other, per the SVG spec; absent both, the
                    // corners are sharp.
                    let (rx, ry) = (attr_f64(&attrs, "rx"), attr_f64(&attrs, "ry"));
                    let rx = rx.or(ry).unwrap_or(0.0);
                    let ry = ry.or(Some(rx)).unwrap_or(0.0);
                    let mark = curves.len();
                    match hcurve::rounded_rect(x, y, w, h, rx, ry) {
                        Ok(hcurve::RoundedRect::Native(ct)) => {
                            curves.push(ImportedCurve::Closed(ct))
                        },
                        Ok(hcurve::RoundedRect::Path(p)) => {
                            curves.push(ImportedCurve::Path(p, true))
                        },
                        Err(e) => warnings.push(format!("skipped <rect>: {e}")),
                    }
                    apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                        &mut warnings);
                }
            },

            Event::Tag(tag::Line, Empty, attrs) => {
                let mark = curves.len();
                if let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
                    attr_f64(&attrs, "x1"),
                    attr_f64(&attrs, "y1"),
                    attr_f64(&attrs, "x2"),
                    attr_f64(&attrs, "y2"),
                ) {
                    push_open(&mut curves, &mut warnings, vec![[x1, y1], [x2, y2]], "<line>");
                }
                apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                    &mut warnings);
            },

            Event::Tag(tag::Polygon, Empty, attrs) => {
                let mark = curves.len();
                if let Some(points) = attrs.get("points") {
                    match parse_points(points) {
                        Ok(pts) => push_closed(&mut curves, &mut warnings, pts, "<polygon>"),
                        Err(e) => warnings.push(format!("skipped <polygon>: {e}")),
                    }
                }
                apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                    &mut warnings);
            },

            Event::Tag(tag::Polyline, Empty, attrs) => {
                let mark = curves.len();
                if let Some(points) = attrs.get("points") {
                    match parse_points(points) {
                        Ok(pts) => push_open(&mut curves, &mut warnings, pts, "<polyline>"),
                        Err(e) => warnings.push(format!("skipped <polyline>: {e}")),
                    }
                }
                apply_from(&mut curves, mark, &element_xform(&stack, &attrs, &mut warnings),
                    &mut warnings);
            },

            Event::Tag(tag::Group, Start, attrs) => {
                let parent = *stack.last().unwrap_or(&Xform::IDENTITY);
                let local = attrs
                    .get("transform")
                    .map(|t| parse_transform(t))
                    .transpose()
                    .unwrap_or_else(|e| {
                        warnings.push(format!("ignored a <g transform>: {e}"));
                        None
                    })
                    .unwrap_or(Xform::IDENTITY);
                stack.push(parent.compose(&local));
            },

            Event::Tag(tag::Group, End, _) => {
                // A stray </g> must not pop the root frame.
                if stack.len() > 1 {
                    stack.pop();
                }
            },

            // Everything else (svg/title/text/…) is ignored.
            _ => {},
        }
    }

    Ok((curves, warnings))
}

/// The transform in force for one element: the enclosing groups', then its own.
fn element_xform(
    stack: &[Xform],
    attrs: &std::collections::HashMap<String, svg::node::Value>,
    warnings: &mut Vec<String>,
) -> Xform {
    let parent = *stack.last().unwrap_or(&Xform::IDENTITY);
    match attrs.get("transform") {
        None => parent,
        Some(t) => match parse_transform(t) {
            Ok(local) => parent.compose(&local),
            Err(e) => {
                warnings.push(format!("ignored a transform attribute: {e}"));
                parent
            },
        },
    }
}

/// Parse an SVG `transform` list into a single affine map.
///
/// Handles `matrix`, `translate`, `scale`, `rotate` (with or without a centre), `skewX`
/// and `skewY`, composed left to right as the spec requires. hypercurve only *applies*
/// similarities, so a skew or a non-uniform scale parses here and is rejected later, with
/// the element named — better than quietly placing it wrong.
fn parse_transform(input: &str) -> Result<Xform, String> {
    let mut out = Xform::IDENTITY;
    let mut rest = input.trim();

    while !rest.is_empty() {
        let open = rest.find('(').ok_or_else(|| format!("malformed transform '{input}'"))?;
        let close = rest.find(')').ok_or_else(|| format!("unclosed transform '{input}'"))?;
        let name = rest[..open].trim_matches(|c: char| c.is_whitespace() || c == ',');
        let args: Vec<f64> = rest[open + 1..close]
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|t| !t.is_empty())
            .map(|t| t.parse::<f64>().map_err(|e| format!("{name}: {e}")))
            .collect::<Result<_, _>>()?;

        let rad = |d: f64| d * std::f64::consts::PI / 180.0;
        let step = match (name, args.as_slice()) {
            // SVG's matrix(a b c d e f) is x' = a*x + c*y + e, y' = b*x + d*y + f.
            ("matrix", [a, b, c, d, e, f]) =>
                Xform { m00: *a, m01: *c, m10: *b, m11: *d, tx: *e, ty: *f },
            ("translate", [tx]) => Xform { tx: *tx, ..Xform::IDENTITY },
            ("translate", [tx, ty]) => Xform { tx: *tx, ty: *ty, ..Xform::IDENTITY },
            ("scale", [s]) => Xform { m00: *s, m11: *s, ..Xform::IDENTITY },
            ("scale", [sx, sy]) => Xform { m00: *sx, m11: *sy, ..Xform::IDENTITY },
            ("rotate", [a]) => {
                let (c, s) = (rad(*a).cos(), rad(*a).sin());
                Xform { m00: c, m01: -s, m10: s, m11: c, tx: 0.0, ty: 0.0 }
            },
            ("rotate", [a, cx, cy]) => {
                let (c, s) = (rad(*a).cos(), rad(*a).sin());
                // Rotate about (cx, cy): translate in, rotate, translate back.
                Xform {
                    m00: c,
                    m01: -s,
                    m10: s,
                    m11: c,
                    tx: cx - c * cx + s * cy,
                    ty: cy - s * cx - c * cy,
                }
            },
            ("skewX", [a]) => Xform { m01: rad(*a).tan(), ..Xform::IDENTITY },
            ("skewY", [a]) => Xform { m10: rad(*a).tan(), ..Xform::IDENTITY },
            _ => return Err(format!("unsupported transform '{name}' with {} args", args.len())),
        };
        out = out.compose(&step);
        rest = rest[close + 1..].trim_start_matches(|c: char| c.is_whitespace() || c == ',');
    }
    Ok(out)
}

/// Apply `xform` to the curves appended since `from`, dropping any it cannot place.
fn apply_from(
    curves: &mut Vec<ImportedCurve>,
    from: usize,
    xform: &Xform,
    warnings: &mut Vec<String>,
) {
    if xform.is_identity() {
        return;
    }
    let tail: Vec<ImportedCurve> = curves.drain(from..).collect();
    for c in tail {
        match transform_imported(c, xform) {
            Ok(t) => curves.push(t),
            // hypercurve models similarities; a non-uniform scale or skew is not one.
            // Dropping the element is the honest outcome — keeping it would place exact
            // geometry at a position the document does not ask for.
            Err(e) => warnings.push(format!("dropped a transformed element: {e}")),
        }
    }
}

/// Parse one `<path>`'s `d` data via hypercurve into native curves (one per subpath).
fn import_path(d: &str, warnings: &mut Vec<String>) -> Vec<ImportedCurve> {
    // Parsed per subpath rather than all at once. `parse_svg_path_data` is all-or-nothing,
    // so one unsupported command — an elliptical arc, say — used to discard the entire
    // element: a 500-command drawing could vanish because of a single `A`. Splitting at
    // the move commands costs one subpath instead.
    match parse_svg_path_data(d) {
        Ok(subpaths) => subpaths
            .into_iter()
            .filter_map(|subpath| import_curve_path(subpath.into_path(), warnings))
            .collect(),
        Err(_) => {
            let parts = split_subpaths(d);
            if parts.len() < 2 {
                warnings.push(format!(
                    "skipped an SVG <path> with unsupported commands (e.g. an elliptical arc): '{}'",
                    truncate(d)
                ));
                return Vec::new();
            }
            let mut out = Vec::new();
            let mut lost = 0usize;
            for part in &parts {
                match parse_svg_path_data(part) {
                    Ok(subpaths) => out.extend(
                        subpaths
                            .into_iter()
                            .filter_map(|sp| import_curve_path(sp.into_path(), warnings)),
                    ),
                    Err(_) => lost += 1,
                }
            }
            if lost > 0 {
                warnings.push(format!(
                    "skipped {lost} of {} subpaths in an SVG <path> (unsupported commands): '{}'",
                    parts.len(),
                    truncate(d)
                ));
            }
            out
        },
    }
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

/// Split a `d` attribute at its move commands, so each subpath can be parsed alone.
///
/// A relative `m` continues from where the previous subpath ended, so only an absolute `M`
/// is a safe cut: splitting at a relative move would silently relocate everything after it.
fn split_subpaths(d: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    for (i, ch) in d.char_indices() {
        if ch == 'M' && i > 0 && !cur.trim().is_empty() {
            parts.push(std::mem::take(&mut cur));
        }
        cur.push(ch);
    }
    if !cur.trim().is_empty() {
        parts.push(cur);
    }
    parts
}

fn truncate(s: &str) -> String {
    if s.len() <= 60 {
        s.to_string()
    } else {
        format!("{}…", &s[..60])
    }
}
