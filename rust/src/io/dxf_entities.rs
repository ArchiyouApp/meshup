//! DXF → flat entity records, for callers that want the drawing rather than a mesh.
//!
//! [`Sketch::from_dxf`](super::dxf) exists already, but it answers a different question: it
//! produces geometry to model with, and to do that it funnels everything through `geo`'s
//! `LineString`, which has no arc. That is why circles and arcs come out of it as 48-segment
//! polylines, and why layers, colours and blocks are dropped — none of them survive the trip.
//!
//! A drawing importer needs the opposite: the file as it was written, with nothing normalised
//! away. So this module reads the same `Drawing` and hands back plain records — an ARC stays a
//! centre, a radius and two angles; a polyline keeps its bulges; every entity keeps its layer,
//! colour, linetype and extrusion. Deciding what any of it *means* is the caller's job, and doing
//! it in TypeScript is what keeps the awkward parts (block expansion, OCS, unit guessing) where
//! they can be iterated on against real files.
//!
//! Everything is `serde`-serialisable so the whole document can cross to JS in one call.
//!
//! Coordinates are **exactly as the file has them**: DXF's Y-up frame, in the file's own units.
//! No flip and no scaling happen here — the caller applies both, once, on plain numbers.

use dxf::entities::EntityType;
use dxf::{Drawing, Point as DxfPoint, Vector as DxfVector};
use serde::Serialize;

use super::IoError;
use core2::io::Cursor;

/// A whole DXF file, flattened.
#[derive(Serialize, Default)]
pub struct DxfDoc {
    pub header: DxfHeader,
    pub layers: Vec<DxfLayer>,
    pub blocks: Vec<DxfBlock>,
    /// Model-space entities. `INSERT`s are left as references — expanding them is the caller's
    /// job, because the expansion can multiply the count by a thousand and only the caller knows
    /// whether it wants that yet.
    pub entities: Vec<DxfEntity>,
}

#[derive(Serialize, Default)]
pub struct DxfHeader {
    /// `$INSUNITS`. 0 means the file declines to say, which is extremely common.
    pub units: i32,
    /// `$LTSCALE`, the global multiplier on every linetype pattern.
    pub ltscale: f64,
    /// `$EXTMIN` / `$EXTMAX`, when the file carries them.
    pub ext_min: [f64; 3],
    pub ext_max: [f64; 3],
}

#[derive(Serialize)]
pub struct DxfLayer {
    pub name: String,
    /// AutoCAD Color Index. Negative in the file means the layer is off; reported here as a
    /// positive index with `on` carrying the answer.
    pub color: i32,
    // NOTE: frozen and locked are NOT reported. They live in the LAYER table's code-70 flags and
    // the `dxf` crate does not surface them, so claiming a value would be inventing one. A frozen
    // layer therefore imports visible; `on` still works, which covers the common case.
    pub on: bool,
    pub line_type: String,
    /// 1/100 mm. Negative values are the BYLAYER/BYBLOCK/DEFAULT sentinels.
    pub line_weight: i32,
}

#[derive(Serialize)]
pub struct DxfBlock {
    pub name: String,
    /// The block's own origin, which an INSERT places at its insertion point.
    pub base: [f64; 3],
    pub entities: Vec<DxfEntity>,
}

/// One entity: what every entity has, plus what this kind of entity has.
#[derive(Serialize)]
pub struct DxfEntity {
    pub layer: String,
    /// `256` is BYLAYER and `0` is BYBLOCK — neither is a colour, and both have to be resolved
    /// against something else.
    pub color: i32,
    pub line_type: String,
    pub line_weight: i32,
    pub visible: bool,
    /// The OCS extrusion direction. `(0, 0, 1)` is the ordinary case; `(0, 0, -1)` mirrors the
    /// entity in X, and appears in anything that has been mirrored in AutoCAD.
    pub extrusion: [f64; 3],
    #[serde(flatten)]
    pub kind: DxfKind,
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum DxfKind {
    Point { at: [f64; 3] },
    Line { a: [f64; 3], b: [f64; 3] },
    /// Angles are degrees, counter-clockwise, as DXF stores them.
    Arc { center: [f64; 3], radius: f64, start: f64, end: f64 },
    Circle { center: [f64; 3], radius: f64 },
    /// `major` is the major-axis endpoint RELATIVE to the centre; `ratio` is minor/major; the
    /// parameters are radians and span the full 0..2π for a closed ellipse.
    Ellipse { center: [f64; 3], major: [f64; 3], ratio: f64, start: f64, end: f64 },
    /// A vertex's `bulge` is the tangent of a quarter of the arc's included angle — the DXF way
    /// of putting an arc into a polyline. Zero means the segment to the NEXT vertex is straight.
    Polyline { vertices: Vec<DxfVertex>, closed: bool },
    Spline {
        degree: i32,
        control_points: Vec<[f64; 3]>,
        fit_points: Vec<[f64; 3]>,
        knots: Vec<f64>,
        weights: Vec<f64>,
        closed: bool,
    },
    /// A block reference, unexpanded.
    Insert {
        name: String,
        at: [f64; 3],
        scale: [f64; 3],
        rotation: f64,
        columns: i32,
        rows: i32,
        column_spacing: f64,
        row_spacing: f64,
    },
    Text { at: [f64; 3], value: String, height: f64, rotation: f64 },
    /// Anything recognised but not carried. Reported so the caller can count it rather than
    /// silently dropping it.
    Other { name: String },
}

#[derive(Serialize)]
pub struct DxfVertex {
    pub x: f64,
    pub y: f64,
    pub bulge: f64,
}

/// Read a DXF file — ASCII or binary; the crate detects which — into flat records.
pub fn import_dxf_entities(data: &[u8]) -> Result<DxfDoc, IoError> {
    let drawing = Drawing::load(&mut Cursor::new(data))
        .map_err(|e| IoError::MalformedInput(format!("DXF parse failed: {e}")))?;

    let header = DxfHeader {
        units: drawing.header.default_drawing_units as i32,
        ltscale: drawing.header.line_type_scale,
        ext_min: pt(&drawing.header.minimum_drawing_extents),
        ext_max: pt(&drawing.header.maximum_drawing_extents),
    };

    let layers = drawing
        .layers()
        .map(|l| DxfLayer {
            name: l.name.clone(),
            color: l.color.index().map(i32::from).unwrap_or(7),
            // A NEGATIVE colour value is how DXF says "this layer is off" — there is no separate
            // flag, which is why it is decoded here rather than left to the caller.
            on: l.is_layer_on,
            line_type: l.line_type_name.clone(),
            line_weight: i32::from(l.line_weight.raw_value()),
            })
        .collect();

    let blocks = drawing
        .blocks()
        .map(|b| DxfBlock {
            name: b.name.clone(),
            base: pt(&b.base_point),
            entities: b.entities.iter().filter_map(entity).collect(),
        })
        .collect();

    let entities = drawing.entities().filter_map(entity).collect();

    Ok(DxfDoc { header, layers, blocks, entities })
}

fn entity(e: &dxf::entities::Entity) -> Option<DxfEntity> {
    let kind = kind(&e.specific)?;
    Some(DxfEntity {
        layer: e.common.layer.clone(),
        color: color_of(&e.common.color),
        line_type: e.common.line_type_name.clone(),
        line_weight: i32::from(e.common.lineweight_enum_value),
        visible: e.common.is_visible,
        extrusion: extrusion_of(&e.specific),
        kind,
    })
}

/// `Color` hides its representation, so the two sentinels are recovered explicitly: `index()`
/// answers `None` for both BYLAYER and BYBLOCK, which are not colours at all.
fn color_of(c: &dxf::Color) -> i32 {
    if c.is_by_layer() {
        256
    } else if c.is_by_block() {
        0
    } else {
        c.index().map(i32::from).unwrap_or(256)
    }
}

fn kind(spec: &EntityType) -> Option<DxfKind> {
    Some(match spec {
        EntityType::ModelPoint(p) => DxfKind::Point { at: pt(&p.location) },

        EntityType::Line(l) => DxfKind::Line { a: pt(&l.p1), b: pt(&l.p2) },

        EntityType::Arc(a) => DxfKind::Arc {
            center: pt(&a.center),
            radius: a.radius,
            start: a.start_angle,
            end: a.end_angle,
        },

        EntityType::Circle(c) => DxfKind::Circle { center: pt(&c.center), radius: c.radius },

        EntityType::Ellipse(e) => DxfKind::Ellipse {
            center: pt(&e.center),
            major: vec3(&e.major_axis),
            ratio: e.minor_axis_ratio,
            start: e.start_parameter,
            end: e.end_parameter,
        },

        EntityType::LwPolyline(p) => DxfKind::Polyline {
            vertices: p
                .vertices
                .iter()
                .map(|v| DxfVertex { x: v.x, y: v.y, bulge: v.bulge })
                .collect(),
            closed: p.is_closed(),
        },

        EntityType::Polyline(p) => DxfKind::Polyline {
            vertices: p
                .vertices()
                .map(|v| DxfVertex {
                    x: v.location.x,
                    y: v.location.y,
                    bulge: v.bulge,
                })
                .collect(),
            closed: p.is_closed(),
        },

        EntityType::Spline(s) => DxfKind::Spline {
            degree: s.degree_of_curve,
            control_points: s.control_points.iter().map(pt).collect(),
            fit_points: s.fit_points.iter().map(pt).collect(),
            knots: s.knot_values.clone(),
            weights: s.weight_values.clone(),
            closed: s.is_closed(),
        },

        EntityType::Insert(i) => DxfKind::Insert {
            name: i.name.clone(),
            at: pt(&i.location),
            scale: [i.x_scale_factor, i.y_scale_factor, i.z_scale_factor],
            rotation: i.rotation,
            columns: i32::from(i.column_count),
            rows: i32::from(i.row_count),
            column_spacing: i.column_spacing,
            row_spacing: i.row_spacing,
        },

        EntityType::Text(t) => DxfKind::Text {
            at: pt(&t.location),
            value: t.value.clone(),
            height: t.text_height,
            rotation: t.rotation,
        },

        EntityType::MText(t) => DxfKind::Text {
            at: pt(&t.insertion_point),
            value: t.text.clone(),
            height: t.initial_text_height,
            rotation: t.rotation_angle,
        },

        // Named rather than dropped, so the caller can tell the user what it skipped.
        other => DxfKind::Other { name: format!("{other:?}").split('(').next().unwrap_or("?").to_string() },
    })
}

/// The OCS extrusion, for the entities that carry one. Anything else is in world coordinates.
fn extrusion_of(spec: &EntityType) -> [f64; 3] {
    match spec {
        EntityType::Arc(a) => vec3(&a.normal),
        EntityType::Circle(c) => vec3(&c.normal),
        EntityType::Ellipse(e) => vec3(&e.normal),
        EntityType::LwPolyline(p) => vec3(&p.extrusion_direction),
        EntityType::Polyline(p) => vec3(&p.normal),
        EntityType::Line(l) => vec3(&l.extrusion_direction),
        EntityType::ModelPoint(p) => vec3(&p.extrusion_direction),
        EntityType::Insert(i) => vec3(&i.extrusion_direction),
        _ => [0.0, 0.0, 1.0],
    }
}

fn pt(p: &DxfPoint) -> [f64; 3] {
    [p.x, p.y, p.z]
}

fn vec3(v: &DxfVector) -> [f64; 3] {
    [v.x, v.y, v.z]
}
