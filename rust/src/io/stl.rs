use crate::triangulated::Triangulated3D;
use std::fmt::Debug;
use core2::io::Cursor;
use stl_io;

/// Export to ASCII STL
/// Convert this Mesh to an **ASCII STL** string with the given `name`.
///
/// ```rust
/// # use meshup::mesh::Mesh;
/// # use std::error::Error;
/// # fn main() -> Result<(), Box<dyn Error>> {
/// let mesh  = Mesh::<()>::cube(1.0, None);
/// let bytes = mesh.to_stl_ascii("my_solid");
/// std::fs::write("stl/my_solid.stl", bytes)?;
/// # Ok(())
/// # }
/// ```
pub fn to_stl_ascii<T: Triangulated3D>(
	shape: &T,
	name: &str,
) -> String {
	let mut out = String::new();
	out.push_str(&format!("solid {name}\n"));

	shape.visit_triangles(|tri| {
		let n = tri[0].normal; // or recompute if you want per-facet normals
		out.push_str(&format!(
			"  facet normal {:.6} {:.6} {:.6}\n",
			n.x, n.y, n.z
		));
		out.push_str("    outer loop\n");
		for v in &tri {
			let p = v.position;
			out.push_str(&format!(
				"      vertex {:.6} {:.6} {:.6}\n",
				p.x, p.y, p.z
			));
		}
		out.push_str("    endloop\n");
		out.push_str("  endfacet\n");
	});

	out.push_str(&format!("endsolid {name}\n"));
	out
}

/// Export to BINARY STL (returns `Vec<u8>`)
///
/// Convert this Mesh to a **binary STL** byte vector with the given `name`.
///
/// The resulting `Vec<u8>` can then be written to a file or handled in memory:
///
/// ```rust
/// # use meshup::mesh::Mesh;
/// # use std::error::Error;
/// # fn main() -> Result<(), Box<dyn Error>> {
/// let object = Mesh::<()>::cube(1.0, None);
/// let bytes  = object.to_stl_binary("my_solid")?;
/// std::fs::write("stl/my_solid.stl", bytes)?;
/// # Ok(())
/// # }
/// ```
pub fn to_stl_binary<T: Triangulated3D>(
	shape: &T,
	_name: &str,
) -> std::io::Result<Vec<u8>> {
	use stl_io::{Normal, Triangle, Vertex, write_stl};

	let mut triangles = Vec::<Triangle>::new();

	shape.visit_triangles(|tri| {
		let n = tri[0].normal;
		#[allow(clippy::unnecessary_cast)]
		{
			triangles.push(Triangle {
				normal: Normal::new([n.x as f32, n.y as f32, n.z as f32]),
				vertices: tri.map(|v| {
					let p = v.position;
					Vertex::new([p.x as f32, p.y as f32, p.z as f32])
				}),
			});
		}
	});

	let mut cursor = Cursor::new(Vec::new());
	write_stl(&mut cursor, triangles.iter())?;
	Ok(cursor.into_inner())
}

impl<S: Clone + Debug + Send + Sync> crate::mesh::Mesh<S> {
    pub fn to_stl_ascii(&self, name: &str) -> String {
        self::to_stl_ascii(self, name)
    }
    pub fn to_stl_binary(&self, name: &str) -> std::io::Result<Vec<u8>> {
        self::to_stl_binary(self, name)
    }
}

impl<S: Clone + Debug + Send + Sync> crate::sketch::Sketch<S> {
    pub fn to_stl_ascii(&self, name: &str) -> String {
        self::to_stl_ascii(self, name)
    }
    pub fn to_stl_binary(&self, name: &str) -> std::io::Result<Vec<u8>> {
        self::to_stl_binary(self, name)
    }
}

impl<S: Clone + Debug + Send + Sync> crate::bmesh::BMesh<S> {
    pub fn to_stl_ascii(&self, name: &str) -> String {
        self::to_stl_ascii(self, name)
    }
    pub fn to_stl_binary(&self, name: &str) -> std::io::Result<Vec<u8>> {
        self::to_stl_binary(self, name)
    }
}

impl<S: Clone + Debug + Send + Sync> crate::mesh::Mesh<S> {
    /// Import a Mesh from **binary or ASCII** STL data.
    ///
    /// `stl_io::read_stl` auto-detects the encoding. Each STL facet becomes a
    /// triangular `Polygon`; the facet normal is attached to all three
    /// vertices. `metadata` (if any) is attached to every polygon.
    pub fn from_stl(stl_data: &[u8], metadata: Option<S>) -> std::io::Result<crate::mesh::Mesh<S>> {
        use crate::float_types::Real;
        use crate::polygon::Polygon;
        use crate::vertex::Vertex;
        use nalgebra::{Point3, Vector3};

        let mut cursor = Cursor::new(stl_data);
        let stl = stl_io::read_stl(&mut cursor).map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("STL parse error: {e:?}"),
            )
        })?;

        let polygons: Vec<Polygon<S>> = stl
            .faces
            .iter()
            .map(|face| {
                let n = Vector3::new(
                    face.normal[0] as Real,
                    face.normal[1] as Real,
                    face.normal[2] as Real,
                );
                let verts: Vec<Vertex> = face
                    .vertices
                    .iter()
                    .map(|&vi| {
                        let v = &stl.vertices[vi];
                        Vertex::new(
                            Point3::new(v[0] as Real, v[1] as Real, v[2] as Real),
                            n,
                        )
                    })
                    .collect();
                Polygon::new(verts, metadata.clone())
            })
            .collect();

        Ok(crate::mesh::Mesh::from_polygons(&polygons, metadata))
    }
}
