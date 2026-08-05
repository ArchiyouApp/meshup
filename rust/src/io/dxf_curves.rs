//! Hypercurve-backed DXF import → native planar curves.
//!
//! The legacy [`dxf`](super::dxf) importer reduces every entity to a point list before
//! meshup sees it: `LWPOLYLINE` bulges are dropped, `ARC` and `CIRCLE` are sampled at a
//! fixed 48 chords whatever their radius, and `ELLIPSE`, `SPLINE` and `INSERT` fall into a
//! catch-all arm that discards them without a word. Arc-ness is destroyed at the import
//! boundary — the same defect the SVG importer was moved off, and for the same reason: a
//! `geo::LineString` has no concept of an arc.
//!
//! This module reads each entity into the hypercurve type that already models it. A
//! LWPOLYLINE vertex's bulge is `tan(theta / 4)`, which is precisely
//! [`hypercurve::BulgeVertex2`]; an ARC becomes the same thing via its sweep; an ELLIPSE is
//! an exact conic path; a SPLINE is a NURBS. Nothing is sampled.
//!
//! Coordinates are kept in DXF model space at z = 0 (2D entities only —
//! [`crate::mesh::Mesh::from_dxf`] still handles 3D content).

use std::collections::BTreeMap;
use std::io::Cursor;

use dxf::Drawing;
use dxf::entities::{Entity, EntityType};
use hypercurve::{
    BulgeVertex2, Contour2, CurvePath2, CurveString2, NurbsCurve2, Point2, Real, Segment2,
};

use super::IoError;
use super::curves::{ImportedCurve, Xform};
use crate::hcurve;

/// How deep an INSERT chain may nest before we assume a cycle. DXF has no rule against a
/// block referencing itself; readers pick a limit and this is ours.
const MAX_BLOCK_DEPTH: usize = 16;

/// Import a DXF drawing into native planar curves plus a list of warnings.
///
/// Warnings are aggregated by entity type rather than emitted per entity — a real drawing
/// carries thousands of TEXT and DIMENSION entities we do not read, and one line each
/// would bury everything else.
pub fn import_dxf_curves(bytes: &[u8]) -> Result<(Vec<ImportedCurve>, Vec<String>), IoError> {
    let drawing = Drawing::load(&mut Cursor::new(bytes))
        .map_err(|e| IoError::MalformedInput(format!("DXF parse failed: {e}")))?;

    let mut ctx = Ctx { skipped: BTreeMap::new(), notes: Vec::new() };
    let mut curves: Vec<ImportedCurve> = Vec::new();

    for entity in drawing.entities() {
        import_entity(&drawing, entity, &Xform::IDENTITY, 0, &mut curves, &mut ctx);
    }

    let mut warnings = ctx.notes;
    if !ctx.skipped.is_empty() {
        let list = ctx
            .skipped
            .iter()
            .map(|(kind, n)| format!("{n} {kind}"))
            .collect::<Vec<_>>()
            .join(", ");
        warnings.push(format!("DXF import skipped unsupported entities: {list}"));
    }
    Ok((curves, warnings))
}

/// Warning accumulator shared across the (possibly nested) entity walk.
struct Ctx {
    /// Entity type name → how many were skipped.
    skipped: BTreeMap<String, usize>,
    notes: Vec<String>,
}

impl Ctx {
    fn skip(&mut self, kind: &str) {
        *self.skipped.entry(kind.to_string()).or_insert(0) += 1;
    }
}

fn import_entity(
    drawing: &Drawing,
    entity: &Entity,
    xform: &Xform,
    depth: usize,
    out: &mut Vec<ImportedCurve>,
    ctx: &mut Ctx,
) {
    match &entity.specific {
        EntityType::Line(line) => {
            let pts = [[line.p1.x, line.p1.y], [line.p2.x, line.p2.y]];
            match hcurve::open_polyline(&pts) {
                Ok(cs) => push_open(out, cs, xform, ctx),
                Err(e) => ctx.notes.push(format!("skipped a LINE: {e}")),
            }
        },

        // The bulge fix. `bulge` is tan(theta / 4) for the arc leaving each vertex, which
        // is exactly what BulgeVertex2 models — the old importer read the coordinates and
        // threw this field away, turning every rounded polyline into a faceted one.
        EntityType::LwPolyline(lwp) => {
            let verts: Vec<(f64, f64, f64)> =
                lwp.vertices.iter().map(|v| (v.x, v.y, v.bulge)).collect();
            push_bulge_run(out, &verts, lwp.is_closed(), mirrored(&entity_normal(entity)), xform, ctx, "LWPOLYLINE");
        },

        EntityType::Polyline(poly) => {
            // 8 = 3D polyline, 16/64 = polygon/polyface mesh: not planar curves.
            if poly.flags & (8 | 16 | 64) != 0 {
                ctx.skip("POLYLINE (3D/mesh)");
                return;
            }
            let verts: Vec<(f64, f64, f64)> = poly
                .vertices()
                .map(|v| (v.location.x, v.location.y, v.bulge))
                .collect();
            push_bulge_run(out, &verts, poly.is_closed(), mirrored(&entity_normal(entity)), xform, ctx, "POLYLINE");
        },

        EntityType::Circle(circle) => {
            match hcurve::circle(circle.center.x, circle.center.y, circle.radius) {
                Ok(ct) => push_closed(out, ct, xform, ctx),
                Err(e) => ctx.notes.push(format!("skipped a CIRCLE: {e}")),
            }
        },

        // A DXF ARC always runs counter-clockwise from start_angle to end_angle, in
        // degrees, about its own centre — so the exact arc is a direct construction, not
        // 48 chords whose count ignored both radius and sweep.
        EntityType::Arc(arc) => {
            match arc_from_center(arc.center.x, arc.center.y, arc.radius,
                arc.start_angle, arc.end_angle, mirrored(&entity_normal(entity)))
            {
                Ok(ArcOrCircle::Arc(seg)) => match CurveString2::try_new(vec![seg]) {
                    Ok(cs) => push_open(out, cs, xform, ctx),
                    Err(e) => ctx.notes.push(format!("skipped an ARC: {e:?}")),
                },
                // A sweep of a full turn is a circle; DXF files do write these.
                Ok(ArcOrCircle::Full) => {
                    match hcurve::circle(arc.center.x, arc.center.y, arc.radius) {
                        Ok(ct) => push_closed(out, ct, xform, ctx),
                        Err(e) => ctx.notes.push(format!("skipped a full-turn ARC: {e}")),
                    }
                },
                Err(e) => ctx.notes.push(format!("skipped an ARC: {e}")),
            }
        },

        // Previously dropped in silence.
        EntityType::Ellipse(el) => {
            let major = (el.major_axis.x, el.major_axis.y);
            let a = major.0.hypot(major.1);
            let b = a * el.minor_axis_ratio;
            let rotation = major.1.atan2(major.0);
            match hcurve::elliptical_arc(a, b, rotation, el.center.x, el.center.y,
                el.start_parameter, el.end_parameter)
            {
                Ok(path) => {
                    let closed = (el.end_parameter - el.start_parameter).abs()
                        >= std::f64::consts::TAU - 1.0e-9;
                    push_path(out, path, closed, xform, ctx);
                },
                Err(e) => ctx.notes.push(format!("skipped an ELLIPSE: {e}")),
            }
        },

        // Previously dropped in silence.
        EntityType::Spline(spline) => match spline_curve(spline) {
            Ok(path) => push_path(out, path, false, xform, ctx),
            Err(e) => ctx.notes.push(format!("skipped a SPLINE: {e}")),
        },

        // Blocks are a separate table: `Drawing::entities()` yields only top-level
        // entities and never expands an INSERT, which is why block content used to vanish
        // entirely — and most geometry in a real drawing lives in blocks.
        EntityType::Insert(ins) => {
            if depth >= MAX_BLOCK_DEPTH {
                ctx.notes.push(format!(
                    "stopped expanding INSERT '{}' at {MAX_BLOCK_DEPTH} levels deep (block cycle?)",
                    ins.name
                ));
                return;
            }
            let Some(block) = drawing.blocks().find(|b| b.name == ins.name) else {
                ctx.notes.push(format!("INSERT references unknown block '{}'", ins.name));
                return;
            };

            let cols = ins.column_count.max(1);
            let rows = ins.row_count.max(1);
            for col in 0..cols {
                for row in 0..rows {
                    let dx = ins.location.x + f64::from(col) * ins.column_spacing;
                    let dy = ins.location.y + f64::from(row) * ins.row_spacing;
                    let step = match insert_transform(ins, dx, dy) {
                        Ok(s) => s,
                        Err(e) => {
                            ctx.notes.push(format!("skipped INSERT '{}': {e}", ins.name));
                            return;
                        },
                    };
                    let combined = xform.compose(&step);
                    for inner in &block.entities {
                        import_entity(drawing, inner, &combined, depth + 1, out, ctx);
                    }
                }
            }
        },

        other => ctx.skip(entity_type_name(other)),
    }
}

/// A DXF `ARC` is either a real arc or, when its sweep closes, a whole circle.
enum ArcOrCircle {
    Arc(Segment2),
    Full,
}

/// Build the exact arc a DXF `ARC` entity describes.
fn arc_from_center(
    cx: f64,
    cy: f64,
    r: f64,
    start_deg: f64,
    end_deg: f64,
    mirror_x: bool,
) -> Result<ArcOrCircle, String> {
    if !(r.is_finite() && r > 0.0) {
        return Err(format!("invalid radius {r}"));
    }
    let to_rad = std::f64::consts::PI / 180.0;
    let a0 = start_deg * to_rad;
    let mut sweep = (end_deg - start_deg) * to_rad;
    while sweep <= 0.0 {
        sweep += std::f64::consts::TAU;
    }
    if sweep >= std::f64::consts::TAU - 1.0e-12 {
        return Ok(ArcOrCircle::Full);
    }
    let a1 = a0 + sweep;

    let at = |ang: f64| -> Result<Point2, String> {
        let x = cx + r * ang.cos();
        hcurve::point(if mirror_x { -x } else { x }, cy + r * ang.sin())
    };

    // Built from the endpoints and a bulge rather than from the stated centre.
    //
    // `CircularArc2::try_from_center` certifies in exact arithmetic that both endpoints
    // are the same distance from the centre — and endpoints computed as
    // `centre + r * (cos a, sin a)` in f64 are not, so every ARC in the file was rejected
    // with RadiusMismatch. `from_bulge` derives the centre from the endpoints instead, so
    // the arc it returns is exactly consistent by construction. hcurve::fillet_segments
    // uses it for the same reason.
    let bulge_f = (sweep / 4.0).tan();
    // Mirroring reverses handedness, and the bulge's sign carries the direction.
    let bulge = hcurve::real(if mirror_x { -bulge_f } else { bulge_f })?;
    let seg = Segment2::from_bulge(at(a0)?, at(a1)?, bulge)
        .map_err(|e| format!("arc construction failed ({e:?})"))?;
    Ok(ArcOrCircle::Arc(seg))
}

/// Build the exact NURBS a DXF `SPLINE` entity describes.
fn spline_curve(spline: &dxf::entities::Spline) -> Result<CurvePath2, String> {
    let degree = usize::try_from(spline.degree_of_curve)
        .map_err(|_| format!("invalid degree {}", spline.degree_of_curve))?;

    // Some writers store only fit points and leave the control net to the reader.
    if spline.control_points.is_empty() {
        if spline.fit_points.len() < 2 {
            return Err("no control points and too few fit points".into());
        }
        let pts: Vec<[f64; 2]> = spline.fit_points.iter().map(|p| [p.x, p.y]).collect();
        let nurbs = hcurve::nurbs_interpolate(&pts, degree.max(2))?;
        return CurvePath2::try_new(vec![nurbs.into()])
            .map_err(|e| format!("spline path failed ({e:?})"));
    }

    let ctrl: Vec<Point2> = spline
        .control_points
        .iter()
        .map(|p| hcurve::point(p.x, p.y))
        .collect::<Result<_, _>>()?;
    // An absent weight list means an ordinary, non-rational B-spline.
    let weights: Vec<Real> = if spline.weight_values.len() == ctrl.len() {
        spline.weight_values.iter().map(|w| hcurve::real(*w)).collect::<Result<_, _>>()?
    } else {
        vec![Real::from(1_i8); ctrl.len()]
    };
    let knots: Vec<Real> =
        spline.knot_values.iter().map(|k| hcurve::real(*k)).collect::<Result<_, _>>()?;

    // The same invariant the exporter enforces: a clamped B-spline of degree d over n
    // control points has exactly n + d + 1 knots. Rejecting a mismatch here keeps a
    // malformed file from becoming malformed geometry.
    if knots.len() != ctrl.len() + degree + 1 {
        return Err(format!(
            "{} knots for {} control points at degree {degree} (expected {})",
            knots.len(),
            ctrl.len(),
            ctrl.len() + degree + 1
        ));
    }

    let nurbs = NurbsCurve2::try_new(degree, ctrl, weights, knots)
        .map_err(|e| format!("NURBS construction failed ({e:?})"))?;
    CurvePath2::try_new(vec![nurbs.into()]).map_err(|e| format!("spline path failed ({e:?})"))
}

/// Assemble a run of `(x, y, bulge)` vertices into a native contour or curve string.
fn push_bulge_run(
    out: &mut Vec<ImportedCurve>,
    verts: &[(f64, f64, f64)],
    closed: bool,
    mirror_x: bool,
    xform: &Xform,
    ctx: &mut Ctx,
    what: &str,
) {
    if verts.len() < 2 {
        return;
    }
    let mut bvs: Vec<BulgeVertex2> = Vec::with_capacity(verts.len());
    for (x, y, bulge) in verts {
        let x = if mirror_x { -x } else { *x };
        // A mirror reverses every arc's direction, and the bulge carries that sign.
        let bulge = if mirror_x { -bulge } else { *bulge };
        match (hcurve::point(x, *y), hcurve::real(bulge)) {
            (Ok(p), Ok(b)) => bvs.push(BulgeVertex2::new(p, b)),
            _ => {
                ctx.notes.push(format!("skipped a {what}: non-finite vertex"));
                return;
            },
        }
    }

    if closed {
        match Contour2::from_bulge_vertices(&bvs) {
            Ok(ct) => push_closed(out, ct, xform, ctx),
            Err(e) => ctx.notes.push(format!("skipped a closed {what}: {e:?}")),
        }
    } else {
        match CurveString2::from_bulge_vertices(&bvs) {
            Ok(cs) => push_open(out, cs, xform, ctx),
            Err(e) => ctx.notes.push(format!("skipped an open {what}: {e:?}")),
        }
    }
}

fn push_open(out: &mut Vec<ImportedCurve>, cs: CurveString2, xform: &Xform, ctx: &mut Ctx) {
    if xform.is_identity() {
        out.push(ImportedCurve::Open(cs));
        return;
    }
    match xform.to_similarity().and_then(|s| hcurve::transform_open(&cs, &s)) {
        Ok(t) => out.push(ImportedCurve::Open(t)),
        Err(e) => ctx.notes.push(format!("skipped a curve: {e}")),
    }
}

fn push_closed(out: &mut Vec<ImportedCurve>, ct: Contour2, xform: &Xform, ctx: &mut Ctx) {
    if xform.is_identity() {
        out.push(ImportedCurve::Closed(ct));
        return;
    }
    match xform.to_similarity().and_then(|s| hcurve::transform_contour(&ct, &s)) {
        Ok(t) => out.push(ImportedCurve::Closed(t)),
        Err(e) => ctx.notes.push(format!("skipped a closed curve: {e}")),
    }
}

fn push_path(
    out: &mut Vec<ImportedCurve>,
    path: CurvePath2,
    closed: bool,
    xform: &Xform,
    ctx: &mut Ctx,
) {
    if xform.is_identity() {
        out.push(ImportedCurve::Path(path, closed));
        return;
    }
    match xform.to_similarity() {
        Ok(sim) => match path.transform_similarity(&sim) {
            Ok(t) => out.push(ImportedCurve::Path(t, closed)),
            Err(e) => ctx.notes.push(format!("skipped a curve: transform failed ({e:?})")),
        },
        Err(e) => ctx.notes.push(format!("skipped a curve: {e}")),
    }
}

/// The planar transform one INSERT placement applies to its block's contents.
///
/// hypercurve models similarities only, so a block scaled differently in x and y is
/// rejected rather than silently placed at the wrong shape.
fn insert_transform(ins: &dxf::entities::Insert, dx: f64, dy: f64) -> Result<Xform, String> {
    let (sx, sy) = (ins.x_scale_factor, ins.y_scale_factor);
    if (sx.abs() - sy.abs()).abs() > 1.0e-9 * sx.abs().max(1.0) {
        return Err(format!("non-uniform block scale {sx} x {sy} is not a similarity"));
    }
    let rot = ins.rotation * std::f64::consts::PI / 180.0;
    let (c, s) = (rot.cos(), rot.sin());
    // x' = sx(c*x - s*y) + dx, y' = sy(s*x + c*y) + dy. A negative scale factor mirrors,
    // which hypercurve accepts as a reversed-orientation similarity.
    Ok(Xform { m00: sx * c, m01: -sx * s, m10: sy * s, m11: sy * c, tx: dx, ty: dy })
}

/// An entity's extrusion direction (its OCS z axis), defaulting to +Z.
fn entity_normal(entity: &Entity) -> (f64, f64, f64) {
    match &entity.specific {
        EntityType::LwPolyline(e) => (e.extrusion_direction.x, e.extrusion_direction.y, e.extrusion_direction.z),
        EntityType::Polyline(e) => (e.normal.x, e.normal.y, e.normal.z),
        EntityType::Circle(e) => (e.normal.x, e.normal.y, e.normal.z),
        EntityType::Arc(e) => (e.normal.x, e.normal.y, e.normal.z),
        _ => (0.0, 0.0, 1.0),
    }
}

/// Whether an entity's OCS is the mirrored one.
///
/// `(0, 0, 1)` is the ordinary case and `(0, 0, -1)` — common for mirrored blocks — maps
/// to a reflection in x under the Arbitrary Axis Algorithm. Any other extrusion tilts the
/// entity out of the XY plane, which this planar importer cannot represent; those are
/// read as if they were flat and reported, rather than dropped.
fn mirrored(normal: &(f64, f64, f64)) -> bool {
    normal.2 < 0.0 && normal.0.abs() < 1.0e-9 && normal.1.abs() < 1.0e-9
}

fn entity_type_name(t: &EntityType) -> &'static str {
    match t {
        EntityType::Text(_) => "TEXT",
        EntityType::MText(_) => "MTEXT",
        EntityType::Attribute(_) => "ATTRIB",
        EntityType::AttributeDefinition(_) => "ATTDEF",
        EntityType::RotatedDimension(_)
        | EntityType::RadialDimension(_)
        | EntityType::DiameterDimension(_)
        | EntityType::AngularThreePointDimension(_)
        | EntityType::OrdinateDimension(_) => "DIMENSION",
        EntityType::Leader(_) => "LEADER",
        EntityType::ModelPoint(_) => "POINT",
        EntityType::Solid(_) => "SOLID",
        EntityType::Face3D(_) => "3DFACE",
        EntityType::Ray(_) => "RAY",
        EntityType::XLine(_) => "XLINE",
        _ => "other",
    }
}
