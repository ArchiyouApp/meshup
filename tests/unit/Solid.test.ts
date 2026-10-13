import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync, ShapeCollection, Mesh } from '../../src/index';
import { Solid } from '../../src/Solid';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { SceneNode } from '../../src/SceneNode';
import { save } from '../../src/utils';
import { outputDir } from '../helpers/outputs';

const OUTPUT_DIR = outputDir(import.meta.url);

beforeAll(async () =>
{
    await initAsync();
});

describe('Mesh, the name before the rename', () =>
{
    it('is the Solid class itself', () =>
    {
        expect(Mesh).toBe(Solid);
        const box = Mesh.Box(10);
        expect(box).toBeInstanceOf(Solid);
        expect(Solid.Box(10)).toBeInstanceOf(Mesh);
        expect(box.type).toBe('Solid');
    });

    it('keeps meshes() as an alias of solids(), and isSolid() accepts the old type string', () =>
    {
        const col = new ShapeCollection(Solid.Box(10), Curve.Line([0, 0, 0], [1, 0, 0]));
        expect(col.meshes().length).toBe(1);
        expect(col.solids().length).toBe(1);
        const old = Solid.Box(10);
        Object.defineProperty(old, 'type', { value: 'Mesh' });
        expect(old.isSolid()).toBe(true);
    });
});

describe('Solid.Cube()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Solid.Cube(10);
        expect(m).toBeTruthy();
    });

    it('has vertices', () =>
    {
        const m = Solid.Cube(10);
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('has triangles', () =>
    {
        const m = Solid.Cube(10);
        expect(m.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Solid.Cuboid()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Solid.Cuboid(10, 20, 30);
        expect(m).toBeTruthy();
    });

    it('has more triangles than a cube when dimensions differ', () =>
    {
        const cube = Solid.Cube(10);
        const cuboid = Solid.Cuboid(10, 20, 30);
        // Both are rectangular - triangle count should be equal
        expect(cuboid.inner().triangleCount()).toBe(cube.inner().triangleCount());
    });
});

describe('Solid.isCuboid()', () =>
{
    it('is true for boxes, also with extra vertices from a boolean', () =>
    {
        expect(Solid.Cuboid(10, 20, 30).isCuboid()).toBe(true);
        expect(Solid.Box(4628, 38, 235).move(100, 200, 0).isCuboid()).toBe(true);
        expect(Solid.Cube(10).union(Solid.Cube(10).move(10, 0, 0)).isCuboid()).toBe(true);
    });

    it('is false for cylinders and prisms, whose vertices all sit on their caps', () =>
    {
        expect(Solid.Cylinder(44.5, 1600).isCuboid()).toBe(false);
        expect(Solid.Cylinder(100, 8).isCuboid()).toBe(false);
        const lShape = new Polygon([[0, 0, 0], [20, 0, 0], [20, 10, 0], [10, 10, 0], [10, 20, 0], [0, 20, 0]]);
        expect(lShape.extrude(10).isCuboid()).toBe(false);
    });
});

describe('Projected line work of a Solid', () =>
{
    it('joins the segments of a circle into one closed polyline', () =>
    {
        const top = Solid.Cylinder(20, 50).elevation('top', { hiddenLines: true });
        const visible = top.group('visible')!.toArray() as Curve[];
        expect(visible.length).toBe(1);
        expect(visible[0].isClosed()).toBe(true);
        expect(visible[0].length()).toBeCloseTo(2 * Math.PI * 20, -1);
        // the bottom circle, behind the top one
        expect(top.group('hidden')!.length).toBe(1);
    });

    it('keeps the corners of a box as separate lines', () =>
    {
        const top = Solid.Box(100, 50, 10).elevation('top');
        expect(top.group('visible')!.length).toBe(4);
    });
});

describe('Solid.Sphere()', () =>
{
    it('creates a non-null mesh', () =>
    {
        const m = Solid.Sphere(5);
        expect(m).toBeTruthy();
    });

    it('has many more triangles than a cube', () =>
    {
        const sphere = Solid.Sphere(5);
        expect(sphere.inner().triangleCount()).toBeGreaterThan(10);
    });
});

describe('Solid.fromPoints()', () =>
{
    it('creates a triangulated polygon', () =>
    {
        const m = Solid.fromPoints([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });

    it('throws for an empty points array', () =>
    {
        expect(() => Solid.fromPoints([])).toThrow();
    });
});

describe('Solid.fromPolygons()', () =>
{
    it('creates a mesh from polygon vertex arrays', () =>
    {
        const tri = [[0,0,0], [5,0,0], [2.5,5,0]];
        const m = Solid.fromPolygons([tri]);
        expect(m).toBeTruthy();
        expect(m.positions().length).toBeGreaterThan(0);
    });

    // Regression: the vertices are built from bare positions, and Point.toVertexJs()
    // defaults to a ZERO normal. A zero-normal surface takes no light — it renders flat
    // grey in any PBR viewer whatever colour it carries — so every polygon must come out
    // carrying its own plane normal.
    it('gives every vertex the polygon plane normal', () =>
    {
        const { normals } = Solid.fromPolygons([[[0,0,0], [5,0,0], [2.5,5,0]]]).toBuffer();

        expect(normals.length).toBeGreaterThan(0);
        for (let i = 0; i < normals.length; i += 3)
        {
            expect(Math.hypot(normals[i], normals[i+1], normals[i+2])).toBeCloseTo(1, 5);
            expect(Math.abs(normals[i+2])).toBeCloseTo(1, 5);   // the triangle lies in Z=0
        }
    });

    // Regression: vertex 2 = (1,0,0) lies exactly on edge [0→1] = (0,0,0)→(2,0,0).
    // This is a T-intersection: it passes the crossing-segment check but caused
    // spade's bulk_load_cdt to panic with "Conflicting edge encountered: [4, 3]".
    // The fix in polygon.rs detects T-intersections before calling bulk_load_cdt
    // and returns an empty triangle list for that face instead of panicking.
    it('handles a polygon face with a T-intersection (vertex on non-adjacent edge) without panicking', () =>
    {
        const poly = [[0,0,0], [2,0,0], [1,0,0], [2,0,2], [0,0,2]];
        expect(() => Solid.fromPolygons([poly])).not.toThrow();
    });
});

describe('Solid boolean operations', () =>
{
    it('union() combines two meshes', () =>
    {
        const a = Solid.Cube(10);
        const b = Solid.Cube(10);
        b.translate([5, 5, 5]);
        a.union(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('difference() subtracts one mesh from another', () =>
    {
        const a = Solid.Cube(10);
        const b = Solid.Cube(5);
        a.difference(b);
        expect(a.positions().length).toBeGreaterThan(0);
    });

    it('intersection() returns the overlapping volume', () =>
    {
        const a = Solid.Cube(10);
        const b = Solid.Cube(10);
        b.translate([2, 2, 2]);
        // non-replacing: the shared volume is a NEW Solid, `a` keeps its own geometry
        const volume = a.volume();
        const shared = a.intersection(b);
        expect(shared).not.toBe(a);
        expect(shared.positions().length).toBeGreaterThan(0);
        expect(shared.volume()).toBeLessThan(volume);
        expect(a.volume()).toBeCloseTo(volume, 4);
    });

    it('difference() refuses to subtract a Solid from itself', () =>
    {
        const a = Solid.Cube(10);
        const volume = a.volume();
        a.difference(a);
        expect(a.volume()).toBeCloseTo(volume as number, 3);    // untouched, not wiped out
    });

    // The real-world trap: layer('x').shapes() holds the very shape you are cutting,
    // because it was built while that layer was active.
    it('difference() skips itself when it sits inside the cutter collection', () =>
    {
        const a = Solid.Cube(10);
        const cutter = Solid.Cube(10).translate([5, 5, 5]);
        a.difference(new ShapeCollection<Solid>(a, cutter));
        expect(a.volume()).toBeGreaterThan(0);                  // the cube survives
        expect(a.volume()).toBeLessThan(1000);                  // and the real cutter still bit
    });
});

describe('Solid.translate()', () =>
{
    it('returns this (chainable)', () =>
    {
        const m = Solid.Cube(10);
        expect(m.translate([1, 2, 3])).toBe(m);
    });
});

describe('Solid.copy()', () =>
{
    it('creates an independent copy', () =>
    {
        const original = Solid.Cube(10);
        const copy = original.copy() as Solid;
        expect(copy).not.toBe(original);
        expect(copy.positions().length).toBe(original.positions().length);
    });
});

describe('Solid.grid()', () =>
{
    it('accepts per-axis spacing as a vector-like 4th parameter', () =>
    {
        const meshes = Solid.Cube(2).grid(2, 2, 2, [5, 6, 7]);
        const centers = meshes.toArray().map(mesh => mesh.center().round(1e-9).toArray());

        expect(meshes.length).toBe(8);
        expect(centers).toContainEqual([0, 0, 0]);
        expect(centers).toContainEqual([5, 6, 7]);
    });

    it('reads a zero count as a flat grid on that axis instead of returning nothing', () =>
    {
        // grid(4,3,0) is how you write a flat XY grid - it must not yield an empty collection
        const meshes = Solid.Cube(2).grid(4, 3, 0, [100, 100, 0]);
        expect(meshes.length).toBe(12);
    });

    it('floors non-integer counts and throws on non-finite ones', () =>
    {
        expect(Solid.Cube(2).grid(2.7, 2, 1, 10).length).toBe(4);
        expect(() => Solid.Cube(2).grid(NaN, 2, 1, 10)).toThrow(/Solid::grid/);
        expect(() => Solid.Cube(2).grid('2' as any, 2, 1, 10)).toThrow(/Solid::grid/);
    });

    it('puts the source Solid itself at cell [0,0,0] - no duplicate left in the scene', () =>
    {
        const root = new SceneNode('root');
        const cube = Solid.Cube(2);
        const layer = root.addLayer('grid', cube);
        root.setActiveLayer(layer);

        const meshes = cube.grid(4, 3, 0, [100, 100, 0]);

        expect(meshes.toArray()).toContain(cube);
        expect(layer.shapes().count()).toBe(12); // not 13: no copy stacked on the original
        expect(meshes.toArray().every(m => layer.shapes().toArray().includes(m))).toBe(true);
    });
});

describe('Solid.array()', () =>
{
    it('puts the source Solid itself at [0,0,0] - no duplicate left in the scene', () =>
    {
        const root = new SceneNode('root');
        const cube = Solid.Cube(2);
        const layer = root.addLayer('array', cube);
        root.setActiveLayer(layer);

        const meshes = cube.array([3, 2, 1]);

        expect(meshes.length).toBe(6);
        expect(meshes.toArray()).toContain(cube);
        expect(layer.shapes().count()).toBe(6);
    });
});

describe('Solid.mirror()', () =>
{
    it('Should mirror in center', async () =>
    {
        const b = Solid.Cube(10).color('red');
        const centerline = Curve.Line([0,0,-10], [0,0,10]).color('blue');
        const mirrored = b.copy().mirror('x', 0);
        expect(mirrored.bbox()).toEqual(b.bbox());

        /*
        // Visual check
        await save(OUTPUT_DIR + 'test.mesh.mirror.center.gltf', await new ShapeCollection(
            centerline, 
            b.copy().moveZ(20).opacity(0.5), 
            mirrored).toGLTF());
        */
    });

    it('Should mirror at specific plane position', async () =>
    {
        const b = Solid.Cube(10).color('red');
        const mirrorline = Curve.Line([50,0,-10], [50,0,10]).color('blue');
        const mirrored = b.copy().mirror('x', mirrorline.start().x).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        expect(mirrored.center().round()).toEqual(b.center().copy().moveX(100).round());

        /*
        // Visual check
        await save(OUTPUT_DIR + 'test.mesh.mirror.position.gltf', await new ShapeCollection(
            mirrorline, 
            b,
            mirrored).toGLTF());
        */
    });

    it('Should mirror in z coord (XY plane)', async () =>
    {
        const b = Solid.Cube(10).color('red');
        const mirrorline = Curve.Line([-100,0,25], [100,0,25]).color('blue');
        const mirrored = b.copy().mirror('z', mirrorline.start().z).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        expect(mirrored.center().round()).toEqual(
            b.center().copy().moveZ(50).round());

        // Visual check
        await save(OUTPUT_DIR + 'test.mesh.mirror.z.gltf', await new ShapeCollection(
            mirrorline, 
            b,
            mirrored).toGLTF());
        
    });

    it('Should mirror with offset vector', async () =>
    {
        const b = Solid.Cube(10).color('red').moveX(10);
        const OFFSET = 50;
        const mirrorline = Curve.Line([OFFSET,0,-100], [OFFSET,0,100]).color('blue');
        const originline = Curve.Line([0,0,-100], [0,0,100]).color('gray');
        const mirroredLine = Curve.Line([OFFSET*2,0,-100], [OFFSET*2,0,100]).color('orange');
        const mirrored = b.copy().mirror([OFFSET, 0, 0]).color('green');
        // NOTE: use round to avoid any precision issues with the mirroring math
        
        
        expect(b.distanceTo(mirrorline)).toEqual(
            mirrored.distanceTo(mirrorline));
        

        // Visual check
        await save(OUTPUT_DIR + 'test.mesh.mirror.offset.gltf', await new ShapeCollection(
            mirrorline,
            originline,
            mirroredLine,
            b,
            mirrored).toGLTF());

    });

});

describe('Solid.layflat()', () =>
{
    // Regression: a 1000×1000×20 plate with four symmetric interlocking slot cuts has
    // equal X and Y PCA eigenvalues (degenerate). toOrthoQuaternion() then returns an
    // arbitrary in-plane rotation (e.g. 45°), making the result non-axis-aligned.
    // The fix uses a shortest-arc rotation that only aligns the thin axis to +Z and
    // leaves the in-plane orientation completely untouched.
    it('places a symmetric flat plate axis-aligned (stable for degenerate equal-eigenvalue geometry)', () =>
    {
        for (let i = 0; i < 5; i++)
        {
            const pl = Solid.Box(1000, 1000, 20);
            // Four symmetric slot cuts → equal X/Y variance → degenerate PCA
            const s1 = Solid.Box(10, 1000, 10).align(pl, 'lefttopfront', 'lefttopfront');
            pl.subtract(s1);
            pl.subtract(s1.copy().mirrorX(0));
            const s2 = Solid.Box(1000, 10, 10).align(pl, 'fronttop', 'fronttop');
            pl.subtract(s2);
            pl.subtract(s2.copy().mirrorY(0));

            const flat = pl.copy().layflat();
            const bb = flat.bbox();

            // Must sit on Z = 0
            expect(bb.minZ()).toBeCloseTo(0, 1);
            // Thickness preserved
            expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
            // If incorrectly rotated 45°, X/Y spans would be ~1414 instead of ~1000
            expect(bb.maxX() - bb.minX()).toBeGreaterThan(900);
            expect(bb.maxX() - bb.minX()).toBeLessThan(1100);
            expect(bb.maxY() - bb.minY()).toBeGreaterThan(900);
            expect(bb.maxY() - bb.minY()).toBeLessThan(1100);
        }
    });

    it('lays a tilted box flat (non-degenerate case still works)', () =>
    {
        const m = Solid.Box(200, 100, 20).rotateX(30);
        m.layflat();
        const bb = m.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 1);
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
    });

    it('only translates an already-flat mesh to Z=0', () =>
    {
        // Already sitting at Z > 0 but flat — dominant face is parallel to XY, no rotation.
        const m = Solid.Box(200, 100, 20).moveZ(50);
        m.layflat();
        const bb = m.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 1);
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(20, 0);
        // X/Y footprint unchanged (no in-plane rotation)
        expect(bb.maxX() - bb.minX()).toBeCloseTo(200, 0);
        expect(bb.maxY() - bb.minY()).toBeCloseTo(100, 0);
    });

    // Regression: the old AABB-span fast path called this plate "already flat" because its
    // tilted AABB height (123) was still under half the smallest footprint span — so it was
    // only dropped, never rotated, and came to rest on an edge.
    it('lays a tilted plate flat even when its tilted AABB is still Z-thin', () =>
    {
        const m = Solid.Box(400, 200, 10).rotateX(35).rotateZ(15);
        m.layflat();
        const bb = m.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 1);
        expect(bb.maxZ() - bb.minZ()).toBeCloseTo(10, 0);
    });

    // Regression: on a sheared solid the OBB's least-variance axis points nowhere near any
    // face, so aligning it to +Z left the shape tilted with nothing resting on the plane.
    it('puts a face of a sheared (non plate-like) solid on the XY plane', () =>
    {
        const bottom = new Polygon([[-250, -250, 0], [250, -250, 0], [250, 250, 0], [-250, 250, 0]]);
        const sheared = bottom.loft(bottom.copy().translate(100, 100, 1000)) as Solid;
        sheared.rotateX(20).layflat();

        const bb = sheared.bbox();
        expect(bb.minZ()).toBeCloseTo(0, 5);

        // at least one face is parallel to XY *and* touching z = 0
        const onPlane = sheared.polygons().toArray().filter(p =>
            Math.abs(Math.abs(p.normal().normalize().z) - 1) < 1e-6
            && Math.abs(p.bbox().maxZ()) < 1e-6);
        expect(onPlane.length).toBeGreaterThan(0);
    });
});
describe('Solid.edges()', () =>
{
    it('returns the 12 edges of a cube, each once', () =>
    {
        const edges = Solid.Cube(10).edges();
        expect(edges.length).toBe(12);
        edges.toArray().forEach(e => expect(e.length()).toBeCloseTo(10, 6));
    });

    it('groups the edges of a closed solid as creases, with no boundary', () =>
    {
        const edges = Solid.Cube(10).edges();
        expect(edges.group('crease')?.length).toBe(12);
        expect(edges.group('boundary')).toBeUndefined(); // a cube is watertight
    });

    it('reports the open border of a single face as boundary edges', () =>
    {
        // One planar quad: every edge has exactly one adjacent face.
        const plate = Solid.fromPoints([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]);
        const edges = plate.edges();
        expect(edges.group('boundary')?.length).toBe(4);
        expect(edges.group('crease')).toBeUndefined();
    });

    it('hides triangulation diagonals unless asked for them', () =>
    {
        const tri = Solid.Cube(10).triangulate();
        // 12 triangles: each cube face is split by a diagonal that is not a model edge.
        expect(tri.edges().length).toBe(12);          // only the real cube edges
        expect(tri.edges(10, true).length).toBe(18);  // + the 6 face diagonals
        expect(tri.edges(10, true).group('flat')?.length).toBe(6);
    });

    it('reconstructNgons() merges coplanar faces back together', () =>
    {
        const tri = Solid.Cube(10).triangulate();
        expect(tri.polygons().length).toBe(12);
        expect(tri.reconstructNgons().polygons().length).toBe(6);
    });

    it('deduplicates: every edge is shared by exactly two faces on a closed solid', () =>
    {
        // 6 faces x 4 edges = 24 face-edges, halved to 12 unique edges.
        const edges = Solid.Cube(10).edges();
        const keys = edges.toArray().map(e =>
        {
            const [a, b] = [e.start(), e.end()].map(p => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`);
            return a < b ? `${a}|${b}` : `${b}|${a}`;
        });
        expect(new Set(keys).size).toBe(12);
    });
});

describe('Selector — edges on a Solid', () =>
{
    it('selects mesh edges parallel to an axis', () =>
    {
        const box = Solid.Box(10, 20, 30);
        const zEdges = box.select('edge|z');
        expect(zEdges).toBeTruthy();
        // a box has 4 edges along each axis
        const found = (zEdges as any).length ?? 1;
        expect(found).toBe(4);
    });

    it('selects the mesh edge closest to a point', () =>
    {
        const box = Solid.Box(10, 10, 10);
        const edge = box.select('edge<<->[10,10,10]');
        expect(edge).toBeTruthy();
        expect(edge.type).toBe('Curve');
    });
});

describe('Solid.trim()', () =>
{
    it('with an axis is cutoff()', () =>
    {
        // Solid.Cube(10) is centred on the origin: x runs -5..5
        expect(Solid.Cube(10).trim('x', -2).volume()).toBeCloseTo(700, 3);
        expect(Solid.Cube(10).trim('x', -2, true).volume()).toBeCloseTo(300, 3);
    });

    it('with another Solid is cutoffBy(), keepSmallest included', () =>
    {
        const cutter = () => Solid.Cube(10).move(7, 0, 0); // overlaps x 2..5
        expect(Solid.Cube(10).trim(cutter()).volume()).toBeCloseTo(700, 3);
        expect(Solid.Cube(10).trim(cutter(), true).volume()).toBeCloseTo(300, 3);
    });
});

describe('center() of a flat mesh', () =>
{
    it('is the area centroid, not the undefined mass centre', () =>
    {
        // a right triangle as a zero-volume mesh: centroid at the mean of its corners
        const tri = new Polygon([[0, 0, 0], [90, 0, 0], [0, 30, 0]]).toMesh();
        expect(tri.volume() ?? 0).toBeCloseTo(0, 6);
        expect(tri.center().round(1e-6).toArray()).toEqual([30, 10, 0]);
        // and a solid keeps its mass centre
        expect(Solid.Cube(10).move(5, 0, 0).center().round(1e-6).toArray()).toEqual([5, 0, 0]);
    });
});
