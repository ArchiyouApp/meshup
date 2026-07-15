use crate::mesh::Mesh;
use crate::triangulated::Triangulated3D;
use crate::vertex::Vertex;

impl<S: Clone + Send + Sync + std::fmt::Debug> Triangulated3D for Mesh<S> {
    fn visit_triangles<F>(&self, mut f: F)
    where
        F: FnMut([Vertex; 3]),
    {
        for poly in &self.polygons {
            for tri in poly.triangulate() {
                f(tri);
            }
        }
    }
}
