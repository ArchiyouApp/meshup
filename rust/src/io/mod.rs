#[cfg(feature = "svg-io")]
pub mod svg;

#[cfg(feature = "stl-io")]
mod stl;

#[cfg(feature = "dxf-io")]
mod dxf;

#[cfg(feature = "obj-io")]
mod obj;

#[cfg(feature = "ply-io")]
mod ply;

#[cfg(feature = "amf-io")]
mod amf;

#[cfg(feature = "gltf-io")]
pub mod gltf;

#[cfg(feature = "threemf-io")]
mod threemf;

/// Read XML text from raw bytes: if the data is a ZIP (3MF, zipped AMF),
/// extract the first entry whose name ends with `want_ext`; otherwise treat the
/// bytes as UTF-8 XML.
#[cfg(any(feature = "amf-io", feature = "threemf-io"))]
pub(crate) fn unzip_or_text(data: &[u8], want_ext: &str) -> Result<String, String> {
    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        use std::io::{Cursor, Read};
        let mut archive =
            zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("zip open error: {e}"))?;
        let mut chosen = 0usize;
        for i in 0..archive.len() {
            if let Ok(f) = archive.by_index(i) {
                if f.name().to_ascii_lowercase().ends_with(want_ext) {
                    chosen = i;
                    break;
                }
            }
        }
        let mut f = archive
            .by_index(chosen)
            .map_err(|e| format!("zip entry error: {e}"))?;
        let mut s = String::new();
        f.read_to_string(&mut s)
            .map_err(|e| format!("zip read error: {e}"))?;
        Ok(s)
    } else {
        String::from_utf8(data.to_vec()).map_err(|e| format!("input is not UTF-8 XML: {e}"))
    }
}

/// Build a triangle Mesh from a vertex pool + triangle index list, computing a
/// per-face normal and skipping degenerate (zero-area) triangles.
#[cfg(any(feature = "amf-io", feature = "threemf-io"))]
pub(crate) fn build_tri_mesh<S: Clone + Send + Sync + std::fmt::Debug>(
    verts: &[nalgebra::Point3<crate::float_types::Real>],
    tris: &[[usize; 3]],
    metadata: Option<S>,
) -> crate::mesh::Mesh<S> {
    use crate::polygon::Polygon;
    use crate::vertex::Vertex;
    let polygons: Vec<Polygon<S>> = tris
        .iter()
        .filter_map(|t| {
            let a = verts.get(t[0])?;
            let b = verts.get(t[1])?;
            let c = verts.get(t[2])?;
            let n = (*b - *a).cross(&(*c - *a)).try_normalize(1e-12)?;
            Some(Polygon::new(
                vec![Vertex::new(*a, n), Vertex::new(*b, n), Vertex::new(*c, n)],
                metadata.clone(),
            ))
        })
        .collect();
    crate::mesh::Mesh::from_polygons(&polygons, metadata)
}

/// Generic I/O and format‑conversion errors.
///
/// Many I/O features are behind cargo feature‑flags.  
/// When a feature is disabled the corresponding variant is *not*
/// constructed in user code.
#[derive(Debug)]
pub enum IoError {
    StdIo(std::io::Error),
    ParseFloat(std::num::ParseFloatError),

    MalformedInput(String),
    MalformedPath(String),
    Unimplemented(String),

    #[cfg(feature = "svg-io")]
    /// Error bubbled up from the `svg` crate during parsing.
    SvgParsing(::svg::parser::Error),

    #[cfg(feature = "obj-io")]
    /// Error during OBJ file processing.
    ObjParsing(String),

    #[cfg(feature = "ply-io")]
    /// Error during PLY file processing.
    PlyParsing(String),

    #[cfg(feature = "amf-io")]
    /// Error during AMF file processing.
    AmfParsing(String),
}

impl std::fmt::Display for IoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use IoError::*;

        match self {
            StdIo(error) => write!(f, "std::io::Error: {error}"),
            ParseFloat(error) => write!(f, "Could not parse float: {error}"),

            MalformedInput(msg) => write!(f, "Input is malformed: {msg}"),
            MalformedPath(msg) => write!(f, "The path is malformed: {msg}"),
            Unimplemented(msg) => write!(f, "Feature is not implemented: {msg}"),

            #[cfg(feature = "svg-io")]
            SvgParsing(error) => write!(f, "SVG Parsing error: {error}"),

            #[cfg(feature = "obj-io")]
            ObjParsing(error) => write!(f, "OBJ Parsing error: {error}"),

            #[cfg(feature = "ply-io")]
            PlyParsing(error) => write!(f, "PLY Parsing error: {error}"),

            #[cfg(feature = "amf-io")]
            AmfParsing(error) => write!(f, "AMF Parsing error: {error}"),
        }
    }
}

impl std::error::Error for IoError {}

impl From<std::io::Error> for IoError {
    fn from(value: std::io::Error) -> Self {
        Self::StdIo(value)
    }
}

impl From<std::num::ParseFloatError> for IoError {
    fn from(value: std::num::ParseFloatError) -> Self {
        Self::ParseFloat(value)
    }
}

#[cfg(feature = "svg-io")]
impl From<::svg::parser::Error> for IoError {
    fn from(value: ::svg::parser::Error) -> Self {
        Self::SvgParsing(value)
    }
}

#[cfg(feature = "obj-io")]
impl From<String> for IoError {
    fn from(value: String) -> Self {
        Self::ObjParsing(value)
    }
}

// Re-export for use in WASM bindings
pub use gltf::UpAxis;
