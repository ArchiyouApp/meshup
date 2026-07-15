//! Create `Sketch`s using single stroke Hershey fonts

use crate::float_types::Real;
use crate::sketch::Sketch;
use geo::{Geometry, GeometryCollection, LineString, coord};
use hershey::{Font, Glyph as HersheyGlyph, Vector as HersheyVector};
use std::fmt::Debug;
use std::sync::OnceLock;

impl<S: Clone + Debug + Send + Sync> Sketch<S> {
    /// Creates **2D line-stroke text** in the XY plane using a Hershey font.
    ///
    /// Each glyph’s strokes become one or more `LineString<Real>` entries in `geometry`.
    /// If you need them filled or thickened, you can later offset or extrude these lines.
    ///
    /// # Parameters
    /// - `text`: The text to render
    /// - `font`: The Hershey font (e.g., `hershey::fonts::GOTHIC_ENG_SANS`)
    /// - `size`: Scale factor for glyphs
    /// - `metadata`: Optional user data to store in the resulting Sketch
    ///
    /// # Returns
    /// A new `Sketch` where each glyph stroke is a `Geometry::LineString` in `geometry`.
    pub fn from_hershey(
        text: &str,
        font: &Font,
        size: Real,
        metadata: Option<S>,
    ) -> Sketch<S> {
        let mut all_strokes = Vec::new();
        let mut cursor_x: Real = 0.0;

        for ch in text.chars() {
            // Skip control chars or spaces as needed
            if ch.is_control() {
                continue;
            }

            // Attempt to find a glyph in this font
            match font.glyph(ch) {
                Ok(glyph) => {
                    // Convert the Hershey lines to geo::LineString objects
                    let glyph_width = (glyph.max_x - glyph.min_x) as Real;
                    let strokes = build_hershey_glyph_lines(&glyph, size, cursor_x, 0.0);

                    // Collect them
                    all_strokes.extend(strokes);

                    // Advance the pen in X
                    cursor_x += glyph_width * size * 0.8;
                },
                Err(_) => {
                    // Missing glyph => skip or just advance
                    cursor_x += 6.0 * size;
                },
            }
        }

        // Insert each stroke as a separate LineString in the geometry
        let mut geo_coll = GeometryCollection::default();
        for line_str in all_strokes {
            geo_coll.0.push(Geometry::LineString(line_str));
        }

        // Return a new Sketch that has no 3D polygons, but has these lines in geometry.
        Sketch {
            geometry: geo_coll,
            bounding_box: OnceLock::new(),
            metadata,
        }
    }

    /// Convenience wrapper around [`Sketch::from_hershey`] that accepts the raw
    /// text of a Hershey `.jhf` font file instead of a pre-built [`Font`].
    ///
    /// The `.jhf` records are parsed (see [`parse_jhf_records`]) into per-glyph
    /// coordinate strings and indexed from `offset` (ASCII space `' '` for the
    /// standard single-stroke fonts, where record 0 is the space glyph).
    ///
    /// # Parameters
    /// - `text`:   the text to render
    /// - `jhf`:    the full contents of a `.jhf` font file
    /// - `size`:   scale factor for glyphs
    /// - `offset`: the character mapped to the first record (usually `' '`)
    /// - `metadata`: optional user data stored on the resulting Sketch
    pub fn from_hershey_str(
        text: &str,
        jhf: &str,
        size: Real,
        offset: char,
        metadata: Option<S>,
    ) -> Sketch<S> {
        let records = parse_jhf_records(jhf);
        let refs: Vec<&str> = records.iter().map(String::as_str).collect();
        let font = Font::new(&refs, offset);
        Self::from_hershey(text, &font, size, metadata)
    }
}

/// Parse a Hershey `.jhf` font file into per-glyph coordinate strings suitable
/// for [`hershey::Font::new`].
///
/// The `.jhf` format packs each glyph as: 5 columns of glyph number, 3 columns
/// of vertex count `n` (which *includes* the leading left/right-bearing pair),
/// then `n` coordinate pairs (2 chars each). Long glyphs wrap across multiple
/// physical lines with no repeated header, so we flatten all newlines first and
/// then slice records by their declared vertex count. The returned strings have
/// the 8-char header removed — exactly what the `hershey` crate's glyph parser
/// expects.
pub fn parse_jhf_records(jhf: &str) -> Vec<String> {
    // Join physical lines with no separator; coordinate pairs are 2 chars wide
    // and header/line widths are even, so pairs never straddle a line break.
    let chars: Vec<char> = jhf.lines().collect::<String>().chars().collect();

    let mut records = Vec::new();
    let mut i = 0;
    while i + 8 <= chars.len() {
        // Columns [i+5 .. i+8] hold the (right-justified) vertex count.
        let nvert: usize = match chars[i + 5..i + 8]
            .iter()
            .collect::<String>()
            .trim()
            .parse()
        {
            Ok(n) => n,
            Err(_) => break, // malformed / trailing content — stop cleanly
        };
        if nvert == 0 {
            break;
        }

        let start = i + 8;
        let end = (start + nvert * 2).min(chars.len());
        records.push(chars[start..end].iter().collect());
        i = end;
    }

    records
}

/// Helper for building open polygons from a single Hershey `Glyph`.
fn build_hershey_glyph_lines(
    glyph: &HersheyGlyph,
    scale: Real,
    offset_x: Real,
    offset_y: Real,
) -> Vec<geo::LineString<Real>> {
    let mut strokes = Vec::new();

    // We'll accumulate each stroke’s points in `current_coords`,
    // resetting whenever Hershey issues a "MoveTo"
    let mut current_coords = Vec::new();

    for vector_cmd in &glyph.vectors {
        match vector_cmd {
            HersheyVector::MoveTo { x, y } => {
                // If we already had 2+ points, that stroke is complete:
                if current_coords.len() >= 2 {
                    strokes.push(LineString::from(current_coords));
                }
                // Start a new stroke
                current_coords = Vec::new();
                let px = offset_x + (*x as Real) * scale;
                let py = offset_y + (*y as Real) * scale;
                current_coords.push(coord! { x: px, y: py });
            },
            HersheyVector::LineTo { x, y } => {
                let px = offset_x + (*x as Real) * scale;
                let py = offset_y + (*y as Real) * scale;
                current_coords.push(coord! { x: px, y: py });
            },
        }
    }

    // End-of-glyph: if our final stroke has 2+ points, convert to a line string
    if current_coords.len() >= 2 {
        strokes.push(LineString::from(current_coords));
    }

    strokes
}
