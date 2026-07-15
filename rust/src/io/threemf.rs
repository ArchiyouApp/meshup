//! 3MF (3D Manufacturing Format) import.
//!
//! A `.3mf` is a ZIP (OPC) package whose `3D/3dmodel.model` part is XML with
//! `<mesh><vertices><vertex x y z/></vertices><triangles><triangle v1 v2 v3/></triangles>`.
//! All objects' meshes are merged; build-item transforms, components, colors and
//! materials are not applied (geometry-only import for now).

use crate::float_types::Real;
use nalgebra::Point3;
use std::fmt::Debug;

impl<S: Clone + Send + Sync + Debug> crate::mesh::Mesh<S> {
    /// Import a Mesh from a **3MF** package (geometry only).
    pub fn from_3mf(data: &[u8], metadata: Option<S>) -> Result<crate::mesh::Mesh<S>, String> {
        let xml = crate::io::unzip_or_text(data, ".model")?;
        let doc =
            roxmltree::Document::parse(&xml).map_err(|e| format!("3MF XML parse error: {e}"))?;

        let mut verts: Vec<Point3<Real>> = Vec::new();
        let mut tris: Vec<[usize; 3]> = Vec::new();

        for mesh in doc.descendants().filter(|n| n.tag_name().name() == "mesh") {
            let base = verts.len();
            for v in mesh.descendants().filter(|n| n.tag_name().name() == "vertex") {
                let get = |a: &str| v.attribute(a).and_then(|s| s.trim().parse::<Real>().ok());
                if let (Some(x), Some(y), Some(z)) = (get("x"), get("y"), get("z")) {
                    verts.push(Point3::new(x, y, z));
                }
            }
            for tri in mesh.descendants().filter(|n| n.tag_name().name() == "triangle") {
                let get = |a: &str| tri.attribute(a).and_then(|s| s.trim().parse::<usize>().ok());
                if let (Some(a), Some(b), Some(c)) = (get("v1"), get("v2"), get("v3")) {
                    tris.push([base + a, base + b, base + c]);
                }
            }
        }

        Ok(crate::io::build_tri_mesh(&verts, &tris, metadata))
    }
}
