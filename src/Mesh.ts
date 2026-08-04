/**
 * 
 *  Mesh.ts 
 *   Create and manage 2D/3D Meshes.
 *   Lightweight wrapper around csgrs functionality.
 *   - Has some abstractions specialized for TS/JS usage.
 *   - But also provides a layer with which to prototype added functions,
 *       that can be later implemented into the Rust layer (in WASM bindings or main library).
 * 
 */

import type { CsgrsModule, Axis, BasePlane, OrientationXY, PointLike, RaycastHit, ClosestPointResult, SdfSample, ProjectEdgeOptions, HlrStrategy, ProjectionViewOptions } from './types';
import { isAxis, isBasePlane, isPointLike } from './types';

import { Curve, getCsgrs } from './index';
import { Shape } from './Shape';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Vector } from './Vector'
import { rad, deg, shortestArcAxisAngle, primaryOrthoXYAngle } from './utils';
import { Style } from './Style';
import { sceneReplace, sceneLayer, sceneCarry, sceneReplaceOrKeep, replaceInScene } from './sceneDecorators';
import { GLTFBuilder } from './GLTFBuilder';

import { MeshJs, PolygonJs, PlaneJs, Vector3Js, VertexJs } from './wasm/meshup';
import { Polygon } from './Polygon';
import { ShapeCollection } from './ShapeCollection';
import { Vertex } from './Vertex';

import { Selector } from './Selector';

// Settings
import { TOLERANCE, SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT,
    SHAPES_CYLINDER_SEGMENTS_RADIAL, EDGE_PROJECTION_DEFAULTS, EDGE_PROJECTION_LIMITS, HLR_STRATEGY_DEFAULT, BASE_PLANE_NAME_TO_PLANE } from './constants';

    

export class Mesh extends Shape
{
    // inherits: _id, type, _node, style, metadata from Shape

    _mesh: MeshJs | undefined; // Underlying MeshJs geometry

    override readonly type = 'Mesh' as const;

    constructor()
    {
        super();
        if (!this._csgrs) 
        {
            throw new Error('Mesh::constructor(): WASM module not initialized. Call init() or await initAsync() first.');
        }
        this._mesh = new this._csgrs.MeshJs(); // create empty mesh
    }

    /** Manual empty Csgrs reference 
     *  NOTE: Only use if to quickly want to clear memory
     *  Garbage collection should do this automatically (after some time)
     * */
    dispose()
    {
        if(this._mesh)
        {
            this._mesh.free();
            this._mesh = undefined;
        }
    }

    // Add a getter that always references the global state
    // NOTE: use getCsgrs directly in static methods
    get _csgrs(): CsgrsModule
    {
        return getCsgrs(); // Always gets the current global instance
    }

    /** Get MeshJs with checking */
    inner(): MeshJs
    {
        if (!this._mesh)
        {
            throw new Error('Mesh::inner(): Mesh not initialized');
        }
        
        return this._mesh;
    }

    /** Update internal mesh */
    update(mesh: MeshJs|Mesh): this
    {
        if(mesh instanceof Mesh)
        {
            this._mesh = mesh._mesh;
        }
        else
        {
            this._mesh = mesh;
        }
        return this;
    }

    /** Create new Mesh instance from different other types */
    static from(mesh: MeshJs|Mesh): Mesh
    {
        if(!mesh) { throw new Error('Mesh::from(): Invalid mesh'); }

        if(mesh instanceof MeshJs)
        {
            const newMesh = new Mesh();
            newMesh._mesh = mesh;
            return newMesh;
        }
        else if(mesh instanceof Mesh)
        {
            const newMesh = new Mesh();
            newMesh._mesh = mesh._mesh;
            return newMesh;
        }
        else
        {
            throw new Error('Mesh::from(): Unsupported mesh type');
        }
    }

    //// BASIC DATA ////

    /** Get all positions of vertices of Mesh */
    positions(): Array<Point>
    {
        // TODO CSGRS: Return Point3 instead of flat buffer
        return Array.from(this._positionsIter());
    }

    /** Get Vertices of Mesh. Alias for positions */
    vertices(): Array<Point>
    {
        return this.positions();
    }

    /** Get all positions of vertices of Mesh as an iterable */
    *_positionsIter(): IterableIterator<Point>
    {
        const buffer = this.inner()?.positions() || [];
        for (let i = 0; i < buffer.length; i += 3) // perf: keep as loop
        {
            yield new Point(buffer[i], buffer[i + 1], buffer[i + 2]);
        }
    }

    /** Get normals of vertices of Mesh */
    normals():Array<Vector>
    {
        // TODO CSGRS: Return Vector3 instead of flat buffer
        return Array.from(this._normalsIter());
    }

    *_normalsIter(): IterableIterator<Vector>
    {
        const buffer = this.inner()?.normals() || [];
        for (let i = 0; i < buffer.length; i += 3) // perf: keep as loop
        {
            yield Vector.from(buffer[i], buffer[i + 1], buffer[i + 2]);
        }
    }

    /** A Mesh is already a mesh — returns itself (parity with Curve/Polygon toMesh(), and
     *  used by the GLTF export which calls toMesh() on every scene shape). */
    toMesh(): this
    {
        return this;
    }

    /** Get polygons (faces) of the Mesh as a ShapeCollection of wrapped Polygon instances */
    @sceneCarry
    polygons(): ShapeCollection<Polygon>
    {
        return new ShapeCollection<Polygon>(
            (this.inner()?.polygons() ?? []).map(p => Polygon.from(p)),
        );
    }

    /** Get faces of the Mesh as a ShapeCollection of Polygons (alias of polygons()) */
    @sceneCarry
    faces(): ShapeCollection<Polygon>
    {
        return this.polygons();
    }

    
    //// META DATA ////

    setMetaData(data: Record<string, any>): Record<string, any>
    {
        this.metadata = data;
        return this.metadata;
    }

    addMetaData(key: string , value: any): Record<string, any>
    {
        this.metadata[key] = value;
        return this.metadata;
    }

    //// MESH CREATION ////
    /*  
        We use static class methods / factory methods for cleaner syntax 
        Example:
            cube = Mesh.makeCube(10); // instead of new Mesh().makeCube(10);

        NOTE: We use getCsgrs() because there is no this available in static methods
    
    */

    /* Make a Mesh from points that span one Polygon */
    static fromPoints(points: Array<PointLike>): Mesh
    {
        if(!Array.isArray(points) || points.length === 0 || !points.every(p => isPointLike(p)))
        {
            throw new Error(`Mesh::fromPoints(): Invalid points array. Supply something [<PointLike>, <PointLike>, ...]`);
        }

        return this.fromPolygons([points]);
    }

    /** Create a Mesh from an outer boundary polygon with optional interior holes.
     *  Each hole is an array of PointLike defining an interior boundary.
     *  The polygon is triangulated (including proper hole subtraction) and returned as a Mesh.
     */
    static fromPointsWithHoles(outerPoints: Array<PointLike>, holes: Array<Array<PointLike>>): Mesh
    {
        if(!Array.isArray(outerPoints) || outerPoints.length < 3 || !outerPoints.every(p => isPointLike(p)))
        {
            throw new Error(`Mesh::fromPointsWithHoles(): Invalid outer points array.`);
        }

        // Flatten outer points to Float64Array [x, y, z, x, y, z, ...]
        const outerFlat = outerPoints.flatMap(p => { const pt = Point.from(p); return [pt.x, pt.y, pt.z]; });
        const outerFloat64 = new Float64Array(outerFlat);

        // Flatten each hole to Float64Array
        const holeArrays = (holes || []).map(hole =>
        {
            const holeFlat = hole.flatMap(p => { const pt = Point.from(p); return [pt.x, pt.y, pt.z]; });
            return new Float64Array(holeFlat);
        });

        const meshJs = getCsgrs().MeshJs.fromPointsWithHoles(outerFloat64, holeArrays, {});

        return this.from(meshJs);
    }

    // MESH FROM DATA

    /** Create Mesh directly from planar polygons defined by (N >= 3) vertices
     *  For some export formats (like STL) polygons are triangulated first
     *
     *  Only positions are given here, so every vertex would be born with a ZERO normal:
     *  Point.toVertexJs() defaults to (0,0,0). That is not a cosmetic detail — a
     *  zero-normal surface takes no light, so the mesh renders flat grey in any PBR
     *  viewer however it is coloured (and exports a useless NORMAL buffer to glTF). Each
     *  polygon therefore gets its own plane normal assigned to its vertices, i.e. these
     *  meshes are flat-shaded. Callers that have real per-vertex normals (a tessellated
     *  curved surface, say) should build their own PolygonJs with them — see
     *  Point.toVertexJs(normal) — and go through Mesh.from(MeshJs.fromPolygons(...)).
    */
    static fromPolygons(verts: Array<Array<PointLike|PointLike|PointLike>>):Mesh
    {
        if(!Array.isArray(verts) || verts.length === 0)
        {
            throw new Error(`Mesh::fromVertices(): Invalid vertices array. Supply something [[<PointLike>,<PointLike>,<PointLike>]]`);
        }

        const polygons: Array<PolygonJs> = [];
        verts.forEach((poly, i) =>
        {
            if (!Array.isArray(poly) || poly.length < 3)
            {
                console.warn(`Mesh::fromVertices(): Invalid polygon at index ${i}. Supply something [<PointLike>,<PointLike>,<PointLike>]`);
            }
            else
            {
                const polyVerts = poly.map(v => Point.from(v).toVertexJs());
                const polygon = new PolygonJs(polyVerts, {});
                polygon.setNewNormal(); // flat normal from the polygon plane - see above
                polygons.push(polygon);
            }
        });

        return this.from(getCsgrs().MeshJs.fromPolygons(polygons, {}));
    }

    //// FILE IMPORT ////
    /* Thin static factories over the Rust/WASM importers. Binary formats take
       Uint8Array|ArrayBuffer; OBJ takes text. See also the Importer class. */

    /** Import a Wavefront OBJ mesh from its text content.
     *  NOTE: requires a WASM build that exposes MeshJs.fromOBJ (cast to any to
     *  decouple from the generated csgrs.d.ts — see Importer). */
    static fromOBJ(obj: string, metadata: any = null): Mesh
    {
        if(typeof obj !== 'string' || obj.trim().length === 0)
        {
            throw new Error('Mesh.fromOBJ(): expected a non-empty OBJ string.');
        }
        return this.from((getCsgrs().MeshJs as any).fromOBJ(obj, metadata));
    }

    /** Import a binary or ASCII STL mesh. Accepts raw bytes or ASCII text. */
    static fromSTL(data: string|Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        const bytes = Mesh._toBytes(data);
        if(bytes.length === 0){ throw new Error('Mesh.fromSTL(): empty STL data.'); }
        return this.from((getCsgrs().MeshJs as any).fromSTL(bytes, metadata));
    }

    /** Import a DXF drawing as a Mesh. Accepts raw bytes or ASCII text. Only
     *  closed polylines / circles become faces (open line-art is dropped) — for
     *  2-D DXF curves use the planned Sketch.fromDXF instead. */
    static fromDXF(data: string|Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        const bytes = Mesh._toBytes(data);
        if(bytes.length === 0){ throw new Error('Mesh.fromDXF(): empty DXF data.'); }
        return this.from((getCsgrs().MeshJs as any).fromDXF(bytes, metadata));
    }

    /** Import a glTF 2.0 model (.glb or .gltf) as a single merged Mesh.
     *  Materials + node hierarchy are flattened; converts glTF Y-up → Z-up.
     *  Self-contained .glb / base64 .gltf only (no Draco / external buffers). */
    static fromGLTF(data: string|Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        const bytes = Mesh._toBytes(data);
        if(bytes.length === 0){ throw new Error('Mesh.fromGLTF(): empty glTF data.'); }
        return this.from((getCsgrs().MeshJs as any).fromGLTF(bytes, metadata));
    }

    /** Import a binary glTF (.glb). Alias for {@link Mesh.fromGLTF}. */
    static fromGLB(data: Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        return this.fromGLTF(data, metadata);
    }

    /** Import an AMF model (plain XML or zipped) as a merged Mesh. */
    static fromAMF(data: string|Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        const bytes = Mesh._toBytes(data);
        if(bytes.length === 0){ throw new Error('Mesh.fromAMF(): empty AMF data.'); }
        return this.from((getCsgrs().MeshJs as any).fromAMF(bytes, metadata));
    }

    /** Import a 3MF package as a merged Mesh (geometry only). */
    static from3MF(data: Uint8Array|ArrayBuffer, metadata: any = null): Mesh
    {
        const bytes = Mesh._toBytes(data);
        if(bytes.length === 0){ throw new Error('Mesh.from3MF(): empty 3MF data.'); }
        return this.from((getCsgrs().MeshJs as any).from3MF(bytes, metadata));
    }

    /** Coerce string (UTF-8) / ArrayBuffer / Uint8Array input to bytes. */
    private static _toBytes(data: string|Uint8Array|ArrayBuffer): Uint8Array
    {
        if(typeof data === 'string'){ return new TextEncoder().encode(data); }
        return data instanceof Uint8Array ? data : new Uint8Array(data);
    }


    // MESH PRIMITIVES

    /** Make a cube of given size with center at origin ([0,0,0]) */
    static Cube(size: number): Mesh
    {
        const mesh = this.from(
            getCsgrs().MeshJs.cube(size, {}));
        // NOTE: CSGRS created boxes from [0,0,0] to [size,size,size]
        // But create at center here, following defaults of many other software
        mesh.metadata.subtype = 'Box';
        return mesh.moveToCenter();
    }

    /** Make a cuboid
     *  @param w Width
     *  @param h Height
     *  @param d Depth
     *  with center at the origin
     */
    static Cuboid(w: number, d?: number, h?: number): Mesh
    {
        if (d === undefined) d = w;
        if (h === undefined) h = w;
        const mesh = this.from(getCsgrs().MeshJs.cuboid(w, d, h, {}));
        mesh.metadata.subtype = 'Box';
        return mesh.moveToCenter();
    }

    /** Alias for makeCuboid */
    static Box(w: number, d?: number, h?: number): Mesh
    {
        return this.Cuboid(w, d, h);
    }

    /** Make Box between two points */
    static BoxBetween(from: PointLike, to: PointLike): Mesh
    {
        const fromPoint = new Point(from);
        const toPoint = new Point(to);

        const width = Math.abs(toPoint.x - fromPoint.x);
        const height = Math.abs(toPoint.y - fromPoint.y);
        const depth = Math.abs(toPoint.z - fromPoint.z);
        const center = new Point(
            (fromPoint.x + toPoint.x) / 2,
            (fromPoint.y + toPoint.y) / 2,
            (fromPoint.z + toPoint.z) / 2,
        );
        const mesh = getCsgrs()?.MeshJs.cuboid(width, height, depth, {})
                        .center() // center at origin
                        .translate(center.toVector3Js()); // move to center point
        return this.from(mesh);
    }

    /** Make a planar Mesh surface between two corner Points.
     *  Automatically picks the base plane whose normal axis varies least between the corners.
     */
    static planeBetween(from: PointLike, to: PointLike): Mesh
    {
        // Delegate the base-plane selection + rect construction to Polygon.planeBetween(),
        // then convert to a Mesh — keeps the geometry logic in one place.
        return Polygon.planeBetween(from, to).toMesh();
    }

    static Sphere(radius: number): Mesh
    {
        const meshJs = getCsgrs()?.MeshJs.sphere(radius, 
            SHAPES_SPHERE_SEGMENTS_WIDTH, 
            SHAPES_SPHERE_SEGMENTS_HEIGHT, {});
        const mesh = this.from(meshJs);
        mesh.metadata.subtype = 'Sphere';
        return mesh;
    }

    static Cylinder(radius: number, height: number): Mesh
    {
        const meshJs = getCsgrs()?.MeshJs.cylinder(radius, height, 
            SHAPES_CYLINDER_SEGMENTS_RADIAL, {});
        const mesh = this.from(meshJs);
        mesh.metadata.subtype = 'Cylinder';
        return mesh;
    }

    //// CALCULATED PROPERTIES ////

    /** Center of mass */
    center(): Point
    {
        // ...existing code...
        return new Point(this.inner()?.massProperties(1)?.centerOfMass);
    }

    

    /** Surface area — sum of all polygon face areas */
    area(): number
    {
        return this.polygons().toArray().reduce((sum, poly) => sum + poly.area(), 0);
    }

    /** Volume */
    volume(): number|undefined
    {
        return this.inner()?.massProperties(1)?.mass;
    }

    /** Meshes have no single length — returns undefined */
    length(): undefined
    {
        console.warn('Mesh.length(): a solid mesh has no single length; use bbox().diagonal(), perimeter of an edge, or a curve length instead.');
        return undefined;
    }

    /** Calculate outer bounding box of current Mesh.
     *  The optional arg is ignored — kept for old-API compatibility.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    bbox(_includeAnnotations?: boolean): Bbox
    {
        return Bbox.fromMesh(this);
    }

    /** Whether this mesh's bounding box has zero extent on one axis */
    is2D(): boolean
    {
        const bb = this.bbox();
        return bb.width() === 0 || bb.depth() === 0 || bb.height() === 0;
    }

    /** Merge coplanar, edge-adjacent faces back into n-gons.
     *  Booleans and triangulation leave a face split into many coplanar triangles; this
     *  rebuilds the original faces, so edges() reports real model edges rather than
     *  triangulation diagonals. */
    @sceneReplace
    reconstructNgons(): Mesh
    {
        return Mesh.from(this.inner().reconstructNgons());
    }

    /** The edges of this mesh as Curves, each unique edge returned once.
     *
     *  Derived from the face rings: every consecutive vertex pair of every polygon
     *  (outer boundary and holes) is an edge, deduplicated by position. Endpoints are
     *  quantised to a 1e-6 grid before keying, mirroring the kernel's own edge
     *  extraction, so the two faces meeting at an edge agree on it.
     *
     *  The result is grouped by how many faces meet at the edge and how sharply:
     *    - 'boundary' — exactly one adjacent face (a naked/open edge)
     *    - 'crease'   — two faces meeting at more than `featureAngle` degrees
     *    - 'flat'     — two near-coplanar faces (usually a triangulation diagonal)
     *
     *  @param featureAngle  Dihedral angle in degrees above which an edge counts as a
     *                       crease. Default 10, matching the projection pipeline.
     *  @param all           Return every edge including 'flat' ones. By default flat
     *                       edges are left out, since they are triangulation artefacts
     *                       rather than model edges. Call reconstructNgons() first to
     *                       remove most of them at the source.
     */
    @sceneCarry
    edges(featureAngle: number = 10, all: boolean = false): ShapeCollection<Curve>
    {
        const QUANT = 1e6; // 1e-6 grid, same as the kernel's edge key
        const key = (p: Point) =>
            `${Math.round(p.x * QUANT)},${Math.round(p.y * QUANT)},${Math.round(p.z * QUANT)}`;

        type EdgeRecord = { a: Point, b: Point, normals: Array<Vector> };
        const found = new Map<string, EdgeRecord>();

        const addRing = (ring: Array<Point>, normal: Vector) =>
        {
            const n = ring.length;
            if (n < 2) { return; }

            for (let i = 0; i < n; i++)
            {
                const a = ring[i];
                const b = ring[(i + 1) % n];
                const [ka, kb] = [key(a), key(b)];
                if (ka === kb) { continue; } // degenerate

                // Canonical direction-independent key: the two faces sharing this edge
                // walk it in opposite directions.
                const id = (ka < kb) ? `${ka}|${kb}` : `${kb}|${ka}`;
                const existing = found.get(id);
                if (existing) { existing.normals.push(normal); }
                else { found.set(id, { a, b, normals: [normal] }); }
            }
        };

        this.polygons().toArray().forEach(poly =>
        {
            const normal = poly.normal();

            // vertices() sometimes repeats the first vertex at the end; the modulo wrap in
            // addRing already closes the ring, so drop it to avoid a zero-length edge.
            const verts = poly.vertices().toArray().map(v => new Point(v));
            if (verts.length > 1 && verts[0].distance(verts[verts.length - 1]) < TOLERANCE)
            {
                verts.pop();
            }
            addRing(verts, normal);

            // Hole rings bound the face too, so their edges are real edges.
            const holes = (poly.inner()?.holes() ?? []) as Array<Array<VertexJs>>;
            holes.forEach(hole => addRing(hole.map(v => new Point(Vertex.from(v))), normal));
        });

        const edges: Array<Curve> = [];
        const groups: Record<string, Array<Curve>> = { boundary: [], crease: [], flat: [] };

        found.forEach(rec =>
        {
            let group: 'boundary'|'crease'|'flat';
            if (rec.normals.length === 1) { group = 'boundary'; }
            else
            {
                // Sharpest pair wins: a non-manifold edge with >2 faces counts as a crease
                // if any two of them disagree.
                let maxAngle = 0;
                for (let i = 0; i < rec.normals.length; i++)
                {
                    for (let j = i + 1; j < rec.normals.length; j++)
                    {
                        maxAngle = Math.max(maxAngle, rec.normals[i].angle(rec.normals[j]));
                    }
                }
                group = (maxAngle > featureAngle) ? 'crease' : 'flat';
            }

            if (group === 'flat' && !all) { return; }

            try
            {
                const edge = Curve.Line(rec.a, rec.b);
                edges.push(edge);
                groups[group].push(edge);
            }
            catch (e) { /* zero-length after quantisation — skip */ }
        });

        const collection = new ShapeCollection<Curve>(...edges);
        Object.entries(groups).forEach(([name, shapes]) =>
        {
            if (shapes.length) { collection.tagGroup(name, new ShapeCollection<Curve>(...shapes)); }
        });

        return collection;
    }

    /** Turn this Mesh into a plain wireframe: its edges as Curves, no hidden-line removal.
     *  Same edges as edges() (see there for the parameters and grouping), but this REPLACES
     *  the Mesh in the scene, so `box(100).wireframe()` shows the wireframe, not the box. */
    @sceneReplace
    wireframe(featureAngle: number = 10, all: boolean = false): ShapeCollection<Curve>
    {
        const wires = this.edges(featureAngle, all);
        const from = this.name() ?? this._node?.name;
        if (from) { wires.name(`${from}_wireframe`); }
        return wires;
    }

    /** Calculate oriented bounding box of current Mesh using PCA */
    obbox(): OBbox
    {
        return OBbox.fromMesh(this);
    }

    /** Whether this Mesh is essentially a cuboid (box / rectangular plate).
     *
     *  Builds the PCA-based OBB and checks every unique vertex against the box
     *  surface in OBB-local coords: each vertex must lie within ±halfExtent on
     *  every non-zero axis AND touch (within `tolerance`) at least one face
     *  along a non-zero axis. Tessellated boxes (mid-edge / face-centre verts)
     *  still pass; curved surfaces do not.
     *
     *  Pure 1D / point OBBs return false — neither is a box. */
    isCuboid(tolerance: number = 0.5): boolean
    {
        const obb = this.obbox();
        if (obb.is1D()) return false;
        const halfExtents = obb.halfExtents();
        const axes        = obb.axes();
        const c           = obb.center();
        const activeAxis: Array<0|1|2> = [0,1,2].filter(i => halfExtents[i] > tolerance) as Array<0|1|2>;
        if (activeAxis.length < 2) return false;

        // Use unique-rounded vertices to avoid wasting checks on duplicates.
        const unique = new Map<string, Point>();
        this.vertices().forEach(v =>
        {
            const r = new Point(v).round(tolerance);
            unique.set(`${r.x},${r.y},${r.z}`, new Point(v));
        });
        if (unique.size === 0) return false;

        for (const v of unique.values())
        {
            const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
            let onAFace = false;
            for (const i of activeAxis)
            {
                const a = axes[i];
                const proj = dx * a.x + dy * a.y + dz * a.z;
                if (Math.abs(proj) > halfExtents[i] + tolerance) return false; // outside box
                if (Math.abs(Math.abs(proj) - halfExtents[i]) < tolerance) onAFace = true;
            }
            if (!onAFace) return false;
        }
        return true;
    }

    /** Copy current Mesh into a new one 
     *  NOTE: We use copy here instead of clone
     *  conventionally cloning is used for operations involving references to previous data
    */
    override _copy(): this
    {
        const c = this?.inner()?.clone();
        if (!c) return new Mesh() as this;

        const m = Mesh.from(c);

        m.style.merge(this.style.explicitData() as any); // copy only explicit style properties so layer colors can cascade
        m.metadata = { ...this.metadata }; // copy metadata

        // Scene registration is handled by Shape.copy() — _copy() is the pure clone.
        return m as this;
    }

    /** Replicate this Mesh a given number of times and return in a ShapeCollection<Mesh> */
    replicate(num: number, transform: (mesh: Mesh, index: number, prev: Mesh | undefined) => Mesh): ShapeCollection<Mesh>
    {
        const newMeshes = new ShapeCollection<Mesh>();
        new Array(num).fill(0).map((_, i) =>
        {
            const newMesh = transform(
                                this.copy() as Mesh,
                                i,
                                i > 0 ? newMeshes.get(i - 1) as Mesh : undefined);
            if (newMesh) newMeshes.add(newMesh);
        });
        return newMeshes;
    }

    /** Check if the Mesh is valid (has vertices) */
    validate(): boolean
    {
        const v = !!this._mesh && this.vertices().length > 0;
        if(!v){ console.warn('Mesh::validate(): Invalid Mesh!'); }
        return v;
    }

    //// TRANSLATE/ROTATE/SCALE OPERATIONS ////

    override translate(px: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (typeof dy === 'number' && (typeof dz === 'number' || dz === undefined)) 
                        ? Point.from(px, dy || 0, dz || 0) 
                        : Point.from(px); // throws is px is invalid Point

        return this.update(this.inner()?.translate(vec.toVector3Js()));
    }

    /** Move the mesh so its bbox center lands at the given point */
    moveTo(target: PointLike, py?: number, pz?: number): this
    {
        const c = this.bbox().center();
        const t = Point.from(target, py, pz);
        return this.translate(t.x - c.x, t.y - c.y, t.z - c.z);
    }

    moveToX(x: number): this { return this.translate(x - this.bbox().center().x, 0, 0); }
    moveToY(y: number): this { return this.translate(0, y - this.bbox().center().y, 0); }
    moveToZ(z: number): this { return this.translate(0, 0, z - this.bbox().center().z); }

    /** Rotate Mesh by angle (degrees) around an axis through the world origin */
    override rotate(angle: number, axis: Axis | PointLike = 'z'): this
    {
        if (typeof axis === 'string')
        {
            this._mesh = this.inner()?.rotate(
                axis === 'x' ? angle : 0,
                axis === 'y' ? angle : 0,
                axis === 'z' ? angle : 0,
            );
        }
        else
        {
            const a = rad(angle);
            const axVec = Point.from(axis).toVector().normalize();
            const cos = Math.cos(a), sin = Math.sin(a), t = 1 - cos;
            const { x: ux, y: uy, z: uz } = axVec;
            const R20 = t * ux * uz - sin * uy;
            const R21 = t * uy * uz + sin * ux;
            const R22 = t * uz * uz + cos;
            const R10 = t * ux * uy + sin * uz;
            const R00 = t * ux * ux + cos;
            const ay2 = Math.asin(Math.max(-1, Math.min(1, -R20)));
            const ax2 = Math.atan2(R21, R22);
            const az2 = Math.atan2(R10, R00);
            this._mesh = this.inner()?.rotate(deg(ax2), deg(ay2), deg(az2));
        }
        return this;
    }

    /** Rotate Mesh by a quaternion given as components `(w, x, y, z)`.
     *  The quaternion is normalized internally, so non-unit input is safe.
     *  NOTE: We guarantee the center is always to origin one
     */
    override rotateQuaternion(wOrObj: number | { w: number; x: number; y: number; z: number }, x?: number, y?: number, z?: number): this
    {
        const originalCenter = this.bbox().center();
        const w = typeof wOrObj === 'object' ? wOrObj.w : wOrObj;
        const xv = typeof wOrObj === 'object' ? wOrObj.x : (x ?? 0);
        const yv = typeof wOrObj === 'object' ? wOrObj.y : (y ?? 0);
        const zv = typeof wOrObj === 'object' ? wOrObj.z : (z ?? 0);
        this._mesh = this.inner()?.rotateQuaternion(w, xv, yv, zv);
        // Make sure we keep the center the same
        this.moveTo(originalCenter);

        return this;
    }

    /** Rotate Mesh by angleDeg around an axis through a pivot point.
     *  @param angleDeg - rotation angle in degrees
     *  @param axis     - 'x' | 'y' | 'z' or an arbitrary direction vector (PointLike)
     *  @param pivot    - point the axis passes through (default: world origin)
     */
    override rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot?: PointLike): this
    {
        // if pivot not provided, rotate around center of mesh by default
        const p = (!pivot) ? this.center() : Point.from(pivot);
        this.translate(-p.x, -p.y, -p.z);
        this.rotate(angleDeg, axis);
        this.translate(p.x, p.y, p.z);
        return this;
    }

    /** Rotate so `fromDir` maps to `toDir`, with no roll (up stays stable).
     *  @param up  The world direction that should remain as "upright" as possible after rotation (default [0,0,1]).
     */
    rotateSwing(fromDir: PointLike, toDir: PointLike, up: PointLike = [0, 0, 1]): this
    {
        const from = Vector.from(fromDir).normalize();
        const to   = Vector.from(toDir).normalize();
        const upV  = Vector.from(up).normalize();

        // Step 1: shortest-arc rotation from→to
        const q    = from.rotationBetween(to);
        const qVec = Vector.from(q.x, q.y, q.z);

        // Step 2: find where `up` ends up after the shortest-arc rotation
        const mappedUp = upV.rotateQuaternion(q);

        // Step 3: project both mappedUp and desired up onto the plane ⊥ to `to`
        const mappedUpPerp = mappedUp.subtract(to.scale(mappedUp.dot(to)));
        const upPerp       = upV.subtract(to.scale(upV.dot(to)));

        if (upPerp.length() < 1e-10 || mappedUpPerp.length() < 1e-10)
        {
            // `up` is parallel to `to` — no twist correction possible
            return this.rotateQuaternion(q.w, q.x, q.y, q.z);
        }

        // Step 4: twist around `to` to align mappedUpPerp → upPerp
        const twist = mappedUpPerp.normalize().rotationBetween(upPerp.normalize());
        const tVec  = Vector.from(twist.x, twist.y, twist.z);

        // Step 5: compose twist * q  (Hamilton product, q applied first)
        const swingVec = qVec.scale(twist.w).add(tVec.scale(q.w)).add(tVec.cross(qVec));
        return this.rotateQuaternion(
            twist.w * q.w - tVec.dot(qVec),
            swingVec.x, swingVec.y, swingVec.z,
        );
    }

    /** Align this Mesh by mapping 3 source points onto 3 target points.
     *
     *  - **withScale:** if true, apply a uniform scale (centered at q1) so edge lengths match.
     *
     *  @param sourcePoints - 2 or 3 reference points on the mesh (current space)
     *  @param targetPoints - 2 or 3 corresponding destination points
     *  @param withScale    - optionally scale uniformly to match first-edge length
     */
    alignByPoints(
        sourcePoints: [PointLike, PointLike] | [PointLike, PointLike, PointLike],
        targetPoints: [PointLike, PointLike] | [PointLike, PointLike, PointLike],
        withScale = false
    ): this
    {
        if( !Array.isArray(sourcePoints) || sourcePoints.length < 2 || sourcePoints.length > 3 || !sourcePoints.every(p => isPointLike(p)) )
        {
            throw new Error('Mesh.alignByPoints(): sourcePoints must be an array of 2 or 3 PointLike objects');
        }

        if (sourcePoints.length !== targetPoints.length)
        {
            throw new Error('Mesh.alignByPoints(): sourcePoints and targetPoints must have the same length.');
        }

        const p1 = Vector.from(sourcePoints[0]);
        const p2 = Vector.from(sourcePoints[1]);
        const q1 = Vector.from(targetPoints[0]);
        const q2 = Vector.from(targetPoints[1]);

        /* Align by two points: This is underconstrained, but we keep the same up direction
             (world z) to avoid unexpected twisting. */
        if(sourcePoints.length === 2)
        {
            // NOTE: Vector math mutates in place, so always work on copies here
            // Step 1: translate so p1 → q1
            this.translate(q1.copy().subtract(p1));

            // Step 2: optional uniform scale (before rotation, centered at q1)
            if (withScale)
            {
                const srcLen = p2.copy().subtract(p1).length();
                const tgtLen = q2.copy().subtract(q1).length();

                if (srcLen > TOLERANCE)
                {
                    this.scale(tgtLen / srcLen, q1.toPoint());
                }
            }
            // Step 3: rotate around q1 to align p2 → q2, keeping world z as up
            const srcDir = p2.copy().subtract(p1).normalize();
            const tgtDir = q2.copy().subtract(q1).normalize();
            this.rotateSwing(srcDir, tgtDir, [0,0,1]);

            return this;
        }

        else 
        {

            // Three point alignment

            // NOTE: Vector math mutates in place, so always work on copies here
            // Step 1: translate so p1 → q1
            this.translate(q1.copy().subtract(p1));

            // Edge vectors (source and target)
            const srcEdge = p2.copy().subtract(p1);
            const tgtEdge = q2.copy().subtract(q1);

            // Step 2: optional uniform scale (before rotation, centered at q1)
            let scaleFactor = 1;
            if (withScale)
            {
                const srcLen = srcEdge.length();
                const tgtLen = tgtEdge.length();
                if (srcLen > 1e-10)
                {
                    scaleFactor = tgtLen / srcLen;
                    this.scale(scaleFactor, q1.toPoint());
                }
            }

            /* Step 3: rotate around q1 to align srcEdge → tgtEdge
                NOTE: rotateQuaternion() re-centers the Mesh on its own bbox center, so wrapping it
                in translate(-q1)/translate(q1) does not pivot around q1. Feed the same rotation to
                rotateAround() instead, which does rotate about a real pivot. */
            const R1 = srcEdge.copy().rotationBetween(tgtEdge);
            const sinHalf1 = Math.sqrt(Math.max(0, 1 - R1.w * R1.w));
            if (sinHalf1 > 1e-10)
            {
                const angle1 = 2 * Math.acos(Math.max(-1, Math.min(1, R1.w)));
                this.rotateAround(deg(angle1), [R1.x / sinHalf1, R1.y / sinHalf1, R1.z / sinHalf1], q1.toPoint());
            }

            // Step 4: twist around the now-aligned edge axis to place p3 → q3
            const p3 = Vector.from(sourcePoints[2]);
            const q3 = Vector.from(targetPoints[2]!); // we know this exists because of the earlier length check

            // Where p3 ended up after translate + scale + R1 (relative to q1):
            const rel = p3.copy().subtract(p1)
                            .scale(scaleFactor)
                            .rotateQuaternion(R1.w, R1.x, R1.y, R1.z);

            // Where q3 sits relative to q1:
            const goal = q3.copy().subtract(q1);

            // Twist axis = the aligned first edge (unit)
            const axLen = tgtEdge.length();
            if (axLen > 1e-10)
            {
                const axis = tgtEdge.copy().scale(1 / axLen);

                // Project both vectors onto the plane perpendicular to axis
                // Use axis.copy() so axis is not mutated before crossVec.dot(axis)
                const d1 = rel.dot(axis);
                const d2 = goal.dot(axis);
                const u1 = rel.subtract(axis.copy().scale(d1));
                const u2 = goal.subtract(axis.copy().scale(d2));

                const len1 = u1.length(), len2 = u2.length();
                if (len1 > 1e-10 && len2 > 1e-10)
                {
                    const cosA = Math.max(-1, Math.min(1, u1.dot(u2) / (len1 * len2)));
                    const crossVec = u1.cross(u2);
                    const sinA = crossVec.dot(axis) / (len1 * len2);
                    const angle = Math.atan2(sinA, cosA);

                    if (Math.abs(angle) > 1e-10)
                    {
                        // pivot around q1 (see the note at step 3)
                        this.rotateAround(deg(angle), [axis.x, axis.y, axis.z], q1.toPoint());
                    }
                }
            }

            return this;
        }
    }

    /** Scale Mesh with a uniform factor or per-axis [sx, sy, sz] around an origin point (default: center of this Mesh) */
    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number') ? [factor, factor, factor] : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];
        const o = origin ? Point.from(origin) : this.center();
        this.translate(-o.x, -o.y, -o.z);
        this._mesh = this.inner()?.scale(sx, sy, sz);
        this.translate(o.x, o.y, o.z);
        return this;
    }

    /** Mirror Mesh along a plane defined by a normal and a position
     *  @param dir - normal vector of the mirror plane, or an axis ('x', 'y', 'z') to mirror across the corresponding world plane
     *  @param pos - a coord (in case of axis) or point the mirror plane passes through (default: center of mass)
     */
    override mirror(dir: Axis | PointLike, pos?: number|PointLike): this
    {
        const planeNormal = isPointLike(dir) 
                                ? Point.from(dir as PointLike).toVector()
                                : Vector.from(dir as Axis) ; // converts axis to Vector

        let planePosition:Point;

        // If the normal is not a unit vector the vector itself encodes both plane position and normal
        if((planeNormal.length() - 1) > TOLERANCE && pos === undefined) 
        {
            planePosition = Point.from(planeNormal.toArray() as PointLike); // position is the end-point of the vector
            planeNormal.normalize();
        }
        else {
            // Either we have an axis, then coord is given, or we have a normal with a position, otherwise use center of shape
            planeNormal.normalize();
            planePosition = pos ? (isAxis(dir) && typeof pos === 'number') 
                                        ? new Point(0,0,0).setComponent(dir, pos)
                                        : Point.from(pos) 
                                : this.center();
        }
        
        // TODO CSGRS: Plane could use some work for ease of use
        const plane = PlaneJs.fromNormal(planeNormal.toVector3Js(), 0);

        const offsettedPlanePoints = plane
                                    .points()
                                    .map( p => Vector.from(p).add(planePosition).toPoint().toPoint3Js());
        
        const offsettedPlane = PlaneJs.fromPoints(
                                offsettedPlanePoints[0],
                                offsettedPlanePoints[1],
                                offsettedPlanePoints[2]
                            );

        this.update(this.inner()?.mirror(offsettedPlane));
        return this;
    }

    /** Mirror at x coordinate (YZ plane) */
    mirrorX(x:number)
    {
        return this.mirror('x', [x, 0, 0]);
    }

    mirrorY(y?: number): this {
        return this.mirror('y', [0, y || 0, 0]);
    }

    mirrorZ(z?: number): this {
        return this.mirror('z', [0, 0, z || 0]);
    }

    /** Centers Mesh with center of mass at origin ([0,0,0]) */
    moveToCenter():this
    {
        return this.update(this.inner()?.center());
    }

    /** Place Mesh on a given height based on bbox, by default at 0 
     *  Used to place Meshes on a XY plane
    */
    place(z:number=0)
    {
        this._mesh = this.inner()?.float();
        if(z)
        {
            this.update(this.inner()?.translate(new Vector3Js(0, 0, z)));
        }
        return this;
    }
    

    /** Flip all polygon normals (reverses winding order) */
    inverse(): this
    {
        return this.update(this.inner()?.inverse());
    }

    /** Recompute normals of polygons of this mesh */
    renormalize(): this
    {
        return this.update(this.inner()?.renormalize());
    }

    /** Turn all polygons of this Mesh into triangles */
    triangulate(): this
    {
        return this.update(this.inner()?.triangulate());
    }

    /** Return new Mesh that is convex hull of current Mesh  */
    @sceneReplace
    hull(): undefined|Mesh
    {
        const ch = this.inner()?.convexHull();
        return ch ? Mesh.from(ch) : undefined;
    }

    /*
    // TODO
    smooth(lambda: number, mu:number, iterations:number, preserveBoundaries:boolean): this
    {
        return this.update(this.inner()?.taubinSmooth(lambda, mu, iterations, preserveBoundaries));
    }
    */

    //// BOOLEAN OPERATIONS ////
    /*
        NOTES:
            - CSGRS always returns a new Mesh after operation: but we do override by default
                This is more in line with script cad conventions
            - Overriding CSGRS references will set it up for automatic garbage collection
    */

    /** Add given Mesh to the current */
    union(other:Mesh): this
    {
        if(!other || !(other instanceof Mesh))
        {
            throw new Error("Mesh::union(): Please supply a valid Mesh instance!");
        }
        return this.update(this.inner()?.union(other.inner() as MeshJs));
    }

    /**
     * Sweep this mesh along a direction to make a solid — the last step of the classic
     * vertex → line → face → solid chain, here for a *surface* built from several faces
     * (a lofted roof, a folded plate).
     *
     * The solid is built directly: this surface is the bottom cap, a translated copy the top
     * cap, and every boundary edge is swept into a side wall. That keeps a folded surface (two
     * roof planes meeting at a ridge) as one watertight solid without any boolean work.
     *
     * @param length     Distance to sweep.
     * @param direction  Direction to sweep in. Defaults to +Z.
     * @returns A new solid Mesh, or null when there is nothing to sweep.
     */
    @sceneReplace
    extrude(length: number, direction: PointLike = [0, 0, 1]): Mesh | null
    {
        const faceVerts = this.polygons().toArray().map(poly => poly.vertices().toArray().map(v => new Point(v.x, v.y, v.z)));
        if (faceVerts.length === 0)
        {
            console.warn('Mesh.extrude(): the mesh has no faces to sweep. Returning null.');
            return null;
        }

        if ((this.volume() ?? 0) > TOLERANCE)
        {
            console.warn('Mesh.extrude(): this mesh is already a closed solid — sweeping it makes a solid of its '
                       + 'whole hull. Extrude the surface or face you meant to sweep instead.');
        }

        const d = Vector.from(direction).normalize().scale(length);
        const moved = (p: Point) => new Point(p.x + d.x, p.y + d.y, p.z + d.z);

        // Boundary edges are the ones used by a single face; interior edges are shared by two.
        // Same 1e-6 quantisation as edges() so coincident vertices match up.
        const QUANT = 1e6;
        const key = (p: Point) => `${Math.round(p.x * QUANT)},${Math.round(p.y * QUANT)},${Math.round(p.z * QUANT)}`;
        const edgeUse = new Map<string, { a: Point, b: Point, count: number }>();

        faceVerts.forEach(verts =>
        {
            for (let i = 0; i < verts.length; i++)
            {
                const a = verts[i];
                const b = verts[(i + 1) % verts.length];
                const ka = key(a), kb = key(b);
                if (ka === kb) { continue; } // zero-length edge
                const undirected = (ka < kb) ? `${ka}|${kb}` : `${kb}|${ka}`;
                const seen = edgeUse.get(undirected);
                if (seen) { seen.count++; }
                else { edgeUse.set(undirected, { a, b, count: 1 }); } // keep this face's direction
            }
        });

        const faces: Array<Array<PointLike>> = [];
        faceVerts.forEach(verts =>
        {
            faces.push([...verts].reverse());       // bottom cap, flipped to face away from the sweep
            faces.push(verts.map(moved));           // top cap
        });
        edgeUse.forEach(({ a, b, count }) =>
        {
            if (count !== 1) { return; }            // interior edge: no wall there
            faces.push([a, b, moved(b), moved(a)]);
        });

        // Winding above only faces outward when sweeping along the surface normal. Sweeping the
        // other way turns the whole solid inside out (see Polygon.extrude), so flip every face.
        const avgNormal = this.polygons().toArray().reduce(
            (acc, poly) => acc.add(poly.normal()), Vector.from(0, 0, 0));
        const along = (avgNormal.length() > TOLERANCE)
            ? avgNormal.normalize().dot(Vector.from(direction).normalize())
            : 1;
        const oriented = (along < 0) ? faces.map(f => [...f].reverse()) : faces;

        return Mesh.fromPolygons(oriented);
    }

    /** Add given Mesh to the current (Alias for union) */
    add(other:Mesh): this
    {
        return this.union(other);
    }

    /** Subtract a Mesh — or every Mesh in a ShapeCollection — from the current.
     *
     *  Auto-separates: when the cut passes through and splits the solid into genuinely-separate
     *  parts, the original is replaced in the scene by one Mesh per part and a ShapeCollection is
     *  returned. A cut that only hollows out the solid (an internal cavity) is cavity-aware and
     *  kept as a single Mesh. See {@link separateIsolated}. */
    @sceneReplaceOrKeep
    difference(other:Mesh|ShapeCollection<Mesh>): this | ShapeCollection<Mesh>
    {
        this._difference(other);
        const parts = this._separateSolids();
        return parts.length > 1 ? parts : this;
    }

    /** Internal in-place boolean difference — skips scene management (no @scene* decorators
     *  fire), so it's safe to compose inside other ops without leaking intermediate geometry
     *  into the scene. Used by cutoff/split/difference-collection where a single Mesh result is
     *  required; the public difference()/subtract() wrap this and handle scene bookkeeping. */
    private _difference(other:Mesh|ShapeCollection<Mesh>): this
    {
        if(ShapeCollection.isShapeCollection(other))
        {
            other.meshes().toArray().forEach(mesh => this._difference(mesh));
            return this;
        }
        if(!other || !(other instanceof Mesh))
        {
            throw new Error("Mesh::difference(): Please supply a valid Mesh instance or ShapeCollection<Mesh>!");
        }
        return this.update(this.inner()?.difference(other.inner() as MeshJs));
    }

    /** Subtract one or more Meshes (or ShapeCollections) from the current. Like difference(),
     *  a cut that splits the solid into genuinely-separate parts auto-separates into one Mesh per
     *  part (returned as a ShapeCollection); an internal cavity is kept as a single Mesh. */
    @sceneReplaceOrKeep
    subtract(...others: (Mesh|ShapeCollection<Mesh>)[]): this | ShapeCollection<Mesh>
    {
        others.forEach(other => this._difference(other));
        const parts = this._separateSolids();
        return parts.length > 1 ? parts : this;
    }

    /** Keep only intersection of the current Mesh with another */
    intersection(other:Mesh): this
    {
        if(!other || !(other instanceof Mesh))
        {
            throw new Error("Mesh::intersection(): Please supply a valid Mesh instance!");
        }
        return this.update(this.inner()?.intersection(other.inner() as MeshJs));
    }

    /** General size estimate: the solid volume when it is meaningfully positive, otherwise the
     *  surface area. A flat (2D) mesh has zero volume, so callers that rank meshes by size (e.g.
     *  cutoff()/cutoffBy()) get area as the right discriminator there instead of tying at 0. */
    size(): number
    {
        const v = this.volume();
        return (v !== undefined && v > TOLERANCE) ? v : this.area();
    }

    /** A scene-free clone of this mesh (unlike copy(), never attaches to the scene graph). */
    private _detachedClone(): Mesh
    {
        return Mesh.from(this.inner().clone());
    }

    /** From the two boolean sides of a cut (`a`, `b`), keep the single largest connected piece
     *  by size() (smallest when `keepSmallest`), applying it in place.
     *
     *  A boolean side is not necessarily one connected piece: a cutter that slices across the
     *  mesh can leave one side as several disconnected chunks (e.g. cutting a long bar with a
     *  diagonal block). Ranking whole sides by total size would then keep those chunks together,
     *  leaving a stray small fragment behind. So each side is first broken into its connected
     *  components (separateIsolated), and the best *single* component is kept.
     *
     *  Determinism: components are ranked with a stable descending sort and `a`'s components are
     *  listed before `b`'s, so on a tie the largest keeps `a` (e.g. cutoff() passes the
     *  positive-normal side as `a`) and the smallest keeps `b`. Returns `this` unchanged with a
     *  warning if the cut degenerated (either side is empty). */
    private _keepBySize(a: Mesh, b: Mesh, keepSmallest: boolean, warning: string): this
    {
        if (a.inner().triangleCount() === 0 || b.inner().triangleCount() === 0)
        {
            console.warn(warning);
            return this;
        }
        // Connected components of each side (a's first) — these are the true "pieces" of the cut.
        const pieces = [a, b]
            .flatMap(side => side._isolatedParts().toArray())
            .filter(p => p.inner().triangleCount() > 0);
        if (pieces.length === 0)
        {
            console.warn(warning);
            return this;
        }
        pieces.sort((x, y) => y.size() - x.size()); // stable, descending by size
        const picked = keepSmallest ? pieces[pieces.length - 1] : pieces[0];
        return this.update(picked);
    }

    /** Build a large solid box filling one half-space of a plane (normal·x = offset), on the
     *  `side` (+1 = normal side, -1 = opposite) of it. Sized to fully cover this mesh so that
     *  subtracting it cleanly removes everything on that side. */
    private _halfSpaceBox(normal: Vector, offset: number, side: number, size: number): Mesh
    {
        const n = normal.copy().normalize();
        const box = Mesh.Cube(size); // centred at origin, spans -size/2..size/2
        // Orient the box's local +z axis onto the plane normal, then shift it so one face lies
        // on the plane and the box extends `size` along `side * n` — covering that half-space.
        const q = Vector.from(0, 0, 1).rotationBetween(n.toArray() as any);
        box.rotateQuaternion(q.w, q.x, q.y, q.z);
        const half = (size / 2) * side;
        box.translate(
            n.x * offset + n.x * half,
            n.y * offset + n.y * half,
            n.z * offset + n.z * half,
        );
        return box;
    }

    /** Diagonal-plus-margin length large enough to build cutter boxes that fully span this mesh. */
    private _coverSize(): number
    {
        const s = this.bbox().size();
        return (Math.hypot(s.x, s.y, s.z) || 1) * 4 + 1;
    }

    /**
     * Cut this mesh by `other` and keep one of the resulting pieces.
     * By default keeps the largest piece (by size()); set `keepSmallest=true` to keep the
     * smallest. Cutting is done with boolean ops rather than a split: a Mesh/Polygon cutter
     * yields the outside piece (this − cutter) and the inside piece (this ∩ cutter); a PlaneJs
     * cutter yields the two half-spaces via boolean subtraction of a solid half-space box.
     *
     * For Mesh and Polygon cutters, warns and returns `this` unchanged when `other`
     * does not intersect this mesh. PlaneJs cutters always proceed (planes are infinite).
     */
    cutoffBy(other: Mesh | Polygon | PlaneJs, keepSmallest = false): this
    {
        if (this.is2D())
        {
            console.warn('Mesh.cutoffBy(): boolean cutting needs a solid (closed) mesh; this mesh is flat/2D. For flat shapes use Polygon.cutoffBy(). No cut performed.');
            return this;
        }
        if (other instanceof PlaneJs)
        {
            const size = this._coverSize();
            const normal = Vector.from(other.normal());
            const offset = other.offset();
            // Subtract the box on each side to obtain the two half-space pieces.
            const keepNormalSide  = this._detachedClone()._difference(this._halfSpaceBox(normal, offset, -1, size));
            const keepOppositeSide = this._detachedClone()._difference(this._halfSpaceBox(normal, offset, +1, size));
            return this._keepBySize(
                keepNormalSide, keepOppositeSide, keepSmallest,
                'Mesh.cutoffBy(): the plane does not split this mesh — no cut performed.');
        }

        const cutter = other instanceof Polygon ? other.toMesh() : other;
        if (!this.hits(cutter))
        {
            console.warn('Mesh.cutoffBy(): the cutter does not intersect this mesh — no cut performed.');
            return this;
        }

        const outside = this._detachedClone()._difference(cutter);   // part of this outside the cutter
        const inside  = this._detachedClone().intersection(cutter);  // part of this inside the cutter
        return this._keepBySize(
            outside, inside, keepSmallest,
            'Mesh.cutoffBy(): the cutter does not split this mesh — no cut performed.');
    }

    /** Cut off Mesh by an axis-aligned plane at `coord` and keep one piece.
     *  Keeps the larger piece by default (by size()); the smaller piece when `smallest=true`.
     *  For a symmetric cut the positive-normal side is kept by default. Uses boolean
     *  subtraction of half-space boxes rather than a mesh split.
     */
    cutoff(at: Axis, coord: number = 0, smallest: boolean = false): this
    {
        if(!isAxis(at)){ throw new Error(`Mesh.cutoff(): Invalid axis '${at}'. Use 'x', 'y', or 'z'.`); }

        if (this.is2D())
        {
            console.warn('Mesh.cutoff(): boolean cutting needs a solid (closed) mesh; this mesh is flat/2D. For flat shapes use Polygon.cutoff(). No cut performed.');
            return this;
        }

        const bb = this.bbox();
        const lo = bb.min()[at], hi = bb.max()[at];
        if (coord <= lo || coord >= hi)
        {
            console.warn(`Mesh.cutoff(): plane '${at}=${coord}' does not split this mesh — nothing cut off.`);
            return this;
        }

        // Half-space cutter boxes: enlarge the bbox so the boxes fully cover the mesh cross-section.
        const big  = bb.enlarged(this._coverSize());
        const bmin = big.min(), bmax = big.max();
        const posBox = Mesh.BoxBetween(bmin.copy().setComponent(at, coord), bmax); // region at > coord
        const negBox = Mesh.BoxBetween(bmin, bmax.copy().setComponent(at, coord)); // region at < coord

        const posPiece = this._detachedClone()._difference(negBox); // keep at > coord (positive side)
        const negPiece = this._detachedClone()._difference(posBox); // keep at < coord (negative side)

        return this._keepBySize(
            posPiece, negPiece, smallest,
            `Mesh.cutoff(): plane '${at}=${coord}' does not split this mesh — nothing cut off.`);
    }

    /**
     * Separate this Mesh into its genuinely-separate solid parts (e.g. after a subtract whose
     * cut passes through and splits the solid). Returns a ShapeCollection<Mesh> with one entry
     * per part; a solid that is still one piece returns a collection containing only this mesh.
     *
     * Cavity-aware: connectivity is by shared surface vertices, so a solid with a fully-internal
     * cavity (a blind hole / void) has a disconnected inner shell — but that shell is spatially
     * contained within the outer shell, so it is recognised as a cavity and kept together with
     * its solid rather than split off. Only non-nested components are returned as separate parts.
     *
     * Scene: when this mesh is in the scene and it does split into several parts, the original is
     * replaced by the parts on its layer; a still-single solid is left in place.
     */
    separateIsolated(): ShapeCollection<Mesh>
    {
        const parts = this._separateSolids();
        const items = parts.toArray();

        // One piece is this mesh itself → keep in place.
        if (items.length === 1 && items[0] === this) return parts;

        // Genuinely split: replace this mesh in the scene with the separate parts (grouped).
        if (this._node && !this._suppressScene)
        {
            replaceInScene(this, parts);
        }
        return parts;
    }

    /** Cavity-aware separation (geometry only, no scene): groups the raw vertex-connected
     *  components by spatial containment so that a component wholly inside another (a cavity) is
     *  merged back into its solid. Returns [this] when everything belongs to one solid, else one
     *  Mesh per genuinely-separate solid (each carrying its own cavities). */
    private _separateSolids(): ShapeCollection<Mesh>
    {
        const raw = this._isolatedParts().toArray();
        if (raw.length <= 1) return new ShapeCollection<Mesh>([this]);

        const bboxes = raw.map(m => m.bbox());
        const bboxVol = (b: any): number => b ? b.width() * b.depth() * b.height() : Infinity;
        const contains = (outer: any, inner: any): boolean =>
            !!outer && !!inner
            && outer.min().x - TOLERANCE <= inner.min().x && inner.max().x <= outer.max().x + TOLERANCE
            && outer.min().y - TOLERANCE <= inner.min().y && inner.max().y <= outer.max().y + TOLERANCE
            && outer.min().z - TOLERANCE <= inner.min().z && inner.max().z <= outer.max().z + TOLERANCE;

        // For each component, its owner = the SMALLEST other component strictly containing it (a
        // cavity's owner is its solid); -1 when top-level (a genuine separate part).
        const ownerOf = (i: number): number =>
        {
            let best = -1, bestVol = Infinity;
            for (let j = 0; j < raw.length; j++)
            {
                if (i === j) continue;
                const vi = bboxVol(bboxes[i]), vj = bboxVol(bboxes[j]);
                if (vj > vi && contains(bboxes[j], bboxes[i]) && vj < bestVol) { best = j; bestVol = vj; }
            }
            return best;
        };
        const topOf = (i: number): number =>
        {
            let t = i, guard = 0;
            while (ownerOf(t) !== -1 && guard++ < raw.length) t = ownerOf(t);
            return t;
        };

        // Bucket every component under its top-level solid.
        const byTop = new Map<number, Mesh[]>();
        raw.forEach((m, i) =>
        {
            const t = topOf(i);
            if (!byTop.has(t)) byTop.set(t, []);
            byTop.get(t)!.push(m);
        });

        if (byTop.size <= 1) return new ShapeCollection<Mesh>([this]); // all one solid (with cavities)

        const meshes = [...byTop.values()].map(group =>
        {
            if (group.length === 1) return group[0]; // a plain part, no cavities
            // A part plus its cavities → recombine their polygons into one mesh.
            const polys = group.flatMap(m => m.inner().polygons());
            const mm = Mesh.from(getCsgrs().MeshJs.fromPolygons(polys, {}));
            mm.style.merge(this.style.explicitData() as any);
            mm.metadata = { ...this.metadata };
            return mm;
        });
        return new ShapeCollection<Mesh>(meshes);
    }

    /** Geometry-only isolation (no scene bookkeeping): returns a collection with [this] when
     *  the mesh is fully connected, or one new Mesh per isolated component (style/metadata
     *  copied) when it is disconnected. Used by difference()/subtract() and split(). */
    private _isolatedParts(): ShapeCollection<Mesh>
    {
        const rawPolys = this.inner().polygons();
        const n = rawPolys.length;
        if (n === 0) return new ShapeCollection<Mesh>([this]);

        // Union-Find
        const parent = Array.from({ length: n }, (_, i) => i);
        const find = (i: number): number =>
        {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        };
        const union = (a: number, b: number) => { parent[find(a)] = find(b); };

        // Map vertex position key → first polygon index that owns it
        const vertexOwner = new Map<string, number>();
        const PREC = 6;
        for (let pi = 0; pi < n; pi++)
        {
            const arr = rawPolys[pi].toArray(); // [x,y,z,nx,ny,nz, ...]
            for (let vi = 0; vi < arr.length; vi += 6)
            {
                const key = `${arr[vi].toFixed(PREC)},${arr[vi + 1].toFixed(PREC)},${arr[vi + 2].toFixed(PREC)}`;
                if (vertexOwner.has(key)) union(pi, vertexOwner.get(key)!);
                else vertexOwner.set(key, pi);
            }
        }

        // Group raw PolygonJs instances by component root
        const groups = new Map<number, PolygonJs[]>();
        for (let pi = 0; pi < n; pi++)
        {
            const root = find(pi);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root)!.push(rawPolys[pi]);
        }

        if (groups.size === 1) return new ShapeCollection<Mesh>([this]);

        const meshes = [...groups.values()].map(polys =>
        {
            const m = Mesh.from(getCsgrs().MeshJs.fromPolygons(polys, {}));
            m.style.merge(this.style.explicitData() as any); // pieces inherit the source style
            m.metadata = { ...this.metadata };
            return m;
        });
        return new ShapeCollection<Mesh>(meshes);
    }

    /**
     * Split this mesh into two pieces using a cutting `other`.
     *
     * - `Mesh`    — the cutter volume is removed and the remaining isolated pieces are returned.
     * - `Polygon` — the polygon's plane is used as the cutting plane.
     * - `PlaneJs` — the plane is used directly (front side = direction the normal points).
     *
     * Returns a `ShapeCollection<Mesh>` with one entry per remaining piece. For plane-based
     * splits this is typically up to two entries (front/positive side first, back/negative
     * side second). Empty results are omitted.
     */
    @sceneReplace
    split(other: Mesh | Polygon | PlaneJs): ShapeCollection<Mesh>
    {
        if (other instanceof Mesh)
        {
            const remainder = this._copy()._difference(other);
            if (remainder.inner().triangleCount() === 0)
            {
                return new ShapeCollection<Mesh>();
            }

            const parts = remainder
                ._isolatedParts()
                .toArray()
                .filter(mesh => mesh.inner().triangleCount() > 0);

            return new ShapeCollection<Mesh>(parts);
        }

        // Resolve cutting plane
        let plane: PlaneJs;
        if (other instanceof Polygon)
        {
            plane = other.inner().plane();
        }
        else
        {
            plane = other; // PlaneJs passed directly
        }

        const halves = this.inner().splitByPlane(plane);
        const parts: Mesh[] = [];
        for (const half of halves)
        {
            if (half.triangleCount() > 0) parts.push(Mesh.from(half));
        }
        return new ShapeCollection<Mesh>(parts);
    }

    //// CURVE–MESH INTERSECTION ////

    /** Find intersection points between a Curve and this Mesh.
     *  The curve is tessellated into a polyline and each segment is tested
     *  against every triangle of the mesh surface.
     * 
     *  @param curve - A Curve instance (NurbsCurve or CompoundCurve)
     *  @param tolerance - Tessellation tolerance for the curve (default: 1e-4)
     *  @returns Array of intersection Points, in order along the curve. Empty array if none found.
     */
    intersectionPointsCurve(curve: Curve, tolerance?: number): Array<Point>
    {
        if(!curve || typeof curve.inner !== 'function')
        {
            throw new Error('Mesh::intersectionPointsCurve(): Please supply a valid Curve instance!');
        }

        try 
        {
            // Tessellate here and hand the mesh a plain polyline. The old path called
            // MeshJs.intersectCurve, which was typed for the curvo NurbsCurve3DJs and so
            // always threw once curves became hypercurve-backed — the catch below turned
            // that into a silent empty result.
            const pts = this.inner()?.intersectPolyline(curve.inner().tessellate(tolerance ?? 1e-4));

            return (pts || []).map(p => Point.from(p));
        }
        catch (e)
        {
            console.error('Mesh::intersectionPointsCurve(): Error:', e);
            return [];
        }
    }

    //// CREATING MESH COLLECTIONS ////

    /** Create a row of copies of this Mesh with specific spacing between them
     * 
     *  Spacing is measured from the bounding boxes of the meshes, so they are placed adjacent plus the specified spacing.
     * 
     *  @param count     - number of copies in the row (including the original)
     *  @param spacing   - distance between bounding boxes of copies (default: 10)
     *  @param direction - direction of the row (default: 'x')
     *  
     *  NOTE: We don't use csgrs distribute_linear() because it merges meshes into one
     *      We want to output a collection of individual meshes
    */
    row(count:number, spacing:number=10, direction:PointLike|Axis='x'):ShapeCollection<Mesh>
    {
        const dirVec = Vector.from(direction).normalize(); // auto converts Axis
        const bbox = this.bbox();
        const offsetSize = new Vector(bbox.width(), bbox.depth(), bbox.height())
                            .scale(dirVec)
                            .length();

        const meshes = new ShapeCollection<Mesh>();

        new Array(count).fill(0).forEach((_, i) =>
        {
            const mesh = (i === 0) ? this : this.copy();
            if(mesh)
            {
                mesh.move(dirVec.copy().scale(i * (offsetSize + spacing)));
                meshes.add(mesh);
            }
        });

        ShapeCollection._nameRow(meshes, this.name() as string | undefined);
        return meshes;
    }

    grid(cx:number=2, cy:number=2, cz:number=1, spacing:number|PointLike=2):ShapeCollection<Mesh>
    {
        if(typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number')
        {
            throw new Error("Mesh::grid(): Please supply valid numbers for counts along each axes!");
        }
        const spacingVector = (typeof spacing === 'number')
            ? new Vector(spacing, spacing, spacing)
            : Vector.from(spacing)

        const meshes = new ShapeCollection<Mesh>();
        for(let x=0; x<cx; x++)
        {
            for(let y=0; y<cy; y++)
            {
                for(let z=0; z<cz; z++)
                {
                    const mesh = this.copy();
                    if(mesh)
                    {
                        mesh.move(
                            x * spacingVector.x,
                            y * spacingVector.y,
                            z * spacingVector.z,
                        );
                        meshes.add(mesh);
                    }
                }
            }
        }
        ShapeCollection._nameGrid(meshes, this.name() as string | undefined, cx, cy, cz);
        return meshes;
    }

    /** Arrange copies of this Mesh in a 3-D array.
     *  @param sizes   Number of copies along [x, y, z] axes (default [2, 2, 1]).
     *                 Non-integer values are floored; values < 1 map to 1.
     *  @param offsets Distance between copy origins along [x, y, z].
     *                 Defaults to the bbox extent on each axis so copies are placed adjacent.
     *  @returns ShapeCollection<Mesh> containing all copies (the original sits at [0,0,0]).
     */
    array(sizes: PointLike = [2, 2, 1], offsets?: PointLike): ShapeCollection<Mesh>
    {
        const s = Point.from(sizes);
        const nx = Math.max(1, Math.floor(s.x));
        const ny = Math.max(1, Math.floor(s.y));
        const nz = Math.max(1, Math.floor(s.z));

        const bb = this.bbox();
        const defaultOff = new Vector(bb.width(), bb.depth(), bb.height());
        const off = offsets ? Vector.from(offsets) : defaultOff;

        const meshes = new ShapeCollection<Mesh>();
        for (let x = 0; x < nx; x++)
        {
            for (let y = 0; y < ny; y++)
            {
                for (let z = 0; z < nz; z++)
                {
                    const mesh = this.copy();
                    mesh.translate(x * off.x, y * off.y, z * off.z);
                    meshes.add(mesh);
                }
            }
        }
        ShapeCollection._nameGrid(meshes, this.name() as string | undefined, nx, ny, nz);
        return meshes;
    }

    //// SELECT ////

    /** Select (sub)shapes with a selector string (see Selector.ts).
     *  Selectors are greedy: an underspecified selector returns every match.
     *  A ShapeCollection result is collapsed to the single shape when there is
     *  exactly one match (checkSingle), and an empty result warns.
     *  Selecting does not add anything to the scene - it hands back a reference to
     *  geometry that is already there. `select(…).copy()` is what puts a new shape in. */
    @sceneCarry
    select(what:string)
    {
        const result = new Selector(what).execute(this);
        Selector.warnIfEmpty(what, result);
        return (result instanceof ShapeCollection) ? result.checkSingle() : result;
    }


    //// OUTPUT ////

    toString(): string
    {
        return `<Mesh id=${this.id()} vertices=${this.vertices().length} polygons=${this.polygons().length} ${this.nodeString()}>`;
    }

    toPolygons(): undefined|Array<PolygonJs>
    {
        return this.inner()?.polygons();
    }

    toSTLBinary(): Uint8Array | undefined
    {
        return this.inner()?.toSTLBinary();
    }

    toSTLAscii(): string | undefined
    {
        return this.inner()?.toSTLASCII();
    }

    /** Return raw mesh geometry buffers for GLTF assembly by GLTFBuilder. */
    toBuffer(): { positions: Float64Array; normals: Float64Array; indices: Uint32Array }
    {
        return {
            positions: this._mesh?.positions() ?? new Float64Array(0),
            normals:   this._mesh?.normals()   ?? new Float64Array(0),
            indices:   new Uint32Array(this._mesh?.indices() ?? new Uint32Array(0)),
        };
    }

    /** Export Mesh to GLTF JSON string.
     *  @param up Up axis of the model (default Z)
     */
    async toGLTF(up: Axis = 'z'): Promise<string | undefined>
    {
        if (!this._mesh) return undefined;
        return new GLTFBuilder(up).add(this).applyExtensions().toGLTF();
    }

    /** Export Mesh to GLB binary (Uint8Array).
     *  @param up Up axis of the model (default Z)
     */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array | undefined>
    {
        if (!this._mesh) return undefined;
        return new GLTFBuilder(up).add(this).applyExtensions().toGLB();
    }
    
    /** Export Mesh to an AMF document (XML string).
     *  @param name   Object name (also used as the object id in the document)
     *  @param units  AMF unit name: millimeter, inch, feet, meter or micron */
    toAMF(name: string = 'model', units: string = 'millimeter'): string | undefined
    {
        return this.inner()?.toAMF(name, units);
    }

    // ── BVH Spatial Queries ─────────────────────────────────────────────────

    /**
     * BVH-accelerated raycast against this mesh.
     *
     * @param origin      Ray origin `[x, y, z]`.
     * @param direction   Ray direction (normalised internally).
     * @param maxDist     Maximum travel distance (default `Infinity`).
     * @param all         When `true` (default) returns every triangle hit,
     *                    sorted by distance.  When `false` returns only the
     *                    closest hit.
     */
    raycast(origin: [number, number, number], direction: [number, number, number], maxDist?: number, all?: true): RaycastHit[];
    raycast(origin: [number, number, number], direction: [number, number, number], maxDist?: number, all?: false): RaycastHit | null;
    raycast(
        origin: [number, number, number],
        direction: [number, number, number],
        maxDist = Infinity,
        all = true,
    ): RaycastHit[] | RaycastHit | null {
        if (all)
        {
            const hits = this.inner()?.raycastAll(
                origin[0], origin[1], origin[2],
                direction[0], direction[1], direction[2],
                maxDist,
            ) ?? [];
            return hits.map(hit =>
            {
                const result: RaycastHit = {
                    pointX: hit.pointX, pointY: hit.pointY, pointZ: hit.pointZ,
                    normalX: hit.normalX, normalY: hit.normalY, normalZ: hit.normalZ,
                    distance: hit.distance,
                    triangleIndex: hit.triangleIndex,
                };
                hit.free?.();
                return result;
            });
        }
        else
        {
            const hit = this.inner()?.raycastFirst(
                origin[0], origin[1], origin[2],
                direction[0], direction[1], direction[2],
                maxDist,
            );
            if (!hit) return null;
            const result: RaycastHit = {
                pointX: hit.pointX, pointY: hit.pointY, pointZ: hit.pointZ,
                normalX: hit.normalX, normalY: hit.normalY, normalZ: hit.normalZ,
                distance: hit.distance,
                triangleIndex: hit.triangleIndex,
            };
            hit.free?.();
            return result;
        }
    }

    /**
     * Project a query point onto the nearest mesh surface (BVH-accelerated).
     * @returns Closest-point result, or `null` if the mesh is empty.
     */
    closestPoint(x: number, y: number, z: number): ClosestPointResult | null {
        const r = this.inner()?.closestPoint(x, y, z);
        if (!r) return null;
        const result: ClosestPointResult = {
            pointX: r.pointX, pointY: r.pointY, pointZ: r.pointZ,
            normalX: r.normalX, normalY: r.normalY, normalZ: r.normalZ,
            distance: r.distance,
            isInside: r.isInside,
        };
        r.free?.();
        return result;
    }

    /**
     * Sample the signed distance field at a query point.
     * Negative distance = inside the mesh.
     * @returns SDF sample, or `null` if the mesh is empty.
     */
    sampleSDF(x: number, y: number, z: number): SdfSample | null {
        const s = this.inner()?.sampleSdf(x, y, z);
        if (!s) return null;
        const result: SdfSample = {
            distance: s.distance,
            isInside: s.isInside,
            closestX: s.closestX, closestY: s.closestY, closestZ: s.closestZ,
        };
        s.free?.();
        return result;
    }

    /**
     * Test whether this mesh physically overlaps another (BVH-accelerated).
     */
    hits(other: Mesh): boolean {
        const a = this.inner();
        const b = other.inner();
        if (!a || !b) return false;
        return a.hits(b);
    }

    /** Alias for hits(): do these two meshes physically overlap?
     *  More stable than comparing distances when you only need a yes/no. */
    intersects(other: Mesh): boolean
    {
        return this.hits(other);
    }

    /** Alias for hits() */
    overlaps(other: Mesh): boolean
    {
        return this.hits(other);
    }

    /**
     * Get amount of overlap [0-1] between this mesh and the given other mesh.
     *
     * Mirrors the old brep-kernel semantics: the overlap is measured as
     * `intersectionVolume / this.volume()`. Returns `0` for non-overlapping,
     * invalid, or zero-volume meshes.
     */
    overlapPerc(other: Mesh): number
    {
        if (!other || !(other instanceof Mesh))
        {
            throw new Error('Mesh::overlapPerc(): Please supply a valid Mesh instance!');
        }

        const thisVolume = this.volume();
        if (thisVolume == null || thisVolume <= 0)
        {
            return 0.0;
        }

        if (!this.hits(other))
        {
            return 0.0;
        }

        try
        {
            const overlappingMesh = this._copy().intersection(other);
            const overlappingVolume = overlappingMesh.volume();
            return (overlappingVolume != null && overlappingVolume > 0)
                ? overlappingVolume / thisVolume
                : 0.0;
        }
        catch (e)
        {
            console.warn('Mesh::overlapPerc(): Failed to calculate overlap percentage.', e);
            return 0.0;
        }
    }

    /** Legacy uncached mesh-to-mesh distance path for side-by-side comparisons. */
    distanceToLegacy(other: Mesh): number
    {
        const a = this.inner();
        const b = other.inner();
        if (!a || !b) return Infinity;
        return a.distanceToLegacy(b);
    }

    /**
     * Minimum separating distance to another Mesh, Curve, Point, Vertex, or Polygon.
     * For Curves the curve is tessellated and the minimum closestPoint distance
     * across all samples is returned. Returns `0` if they intersect.
     * For Points the distance is measured from the point position to the
     * closest point on the mesh surface.
     * For Vertices the distance is measured from the vertex position to the
     * closest point on the mesh surface.
     * For Polygons the polygon is converted to a mesh first.
     */
    distanceTo(other: Mesh | Curve | Point | Vertex | Polygon): number
    {
        if (other instanceof Point)
        {
            const r = this.closestPoint(other.x, other.y, other.z);
            return r ? r.distance : Infinity;
        }

        if (other instanceof Vertex)
        {
            const r = this.closestPoint(other.x, other.y, other.z);
            return r ? r.distance : Infinity;
        }

        if (other instanceof Polygon)
        {
            return this.distanceTo(other.toMesh());
        }

        if (other instanceof Curve)
        {
            return this._distanceToCurve(other);
        }

        if(other instanceof Mesh)
        {
            const a = this.inner();
            const b = (other as Mesh).inner();
            if (!a || !b) return Infinity;
            return a.distanceTo(b);
        }

        throw new Error('Mesh.distanceTo(): Unsupported type. Expected Mesh, Curve, Point, Vertex, or Polygon.');
    }

    /** Alias for distanceTo */
    distance(other: Mesh | Curve | Point | Vertex | Polygon): number
    {
        return this.distanceTo(other);
    }

    /**
     * Minimum distance between this mesh surface and a Curve.
     *
     * A polyline's tessellation only yields its corner points, so sampling those
     * alone misses a segment that passes through (or alongside) the mesh — that was
     * the "95 instead of 0" bug. Instead we walk every tessellated segment:
     *   1. Raycast along the segment (bounded by its length) → an exact 0 when the
     *      segment crosses the surface transversally.
     *   2. Densely sample the segment and take the min surface closest-point
     *      distance → handles coplanar overlap and the true gap when apart.
     * Sampling density is scale-aware, derived from the mesh's size.
     */
    private _distanceToCurve(curve: Curve): number
    {
        const pts = curve.tessellate();
        if (!pts || pts.length === 0) return Infinity;

        if (pts.length === 1)
        {
            const r = this.closestPoint(pts[0].x, pts[0].y, pts[0].z);
            return r ? r.distance : Infinity;
        }

        const extent = this.bbox()?.maxSize() ?? 0;
        const spacing = (extent > 0 ? extent : 1) / 50; // ~50 samples across the mesh extent

        let minD = Infinity;
        for (let i = 0; i < pts.length - 1 && minD > 0; i++)
        {
            const a = pts[i], b = pts[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // 1. Exact 0 on a transversal crossing.
            if (segLen > 0)
            {
                const inv = 1 / segLen;
                const hit = this.raycast([a.x, a.y, a.z], [dx * inv, dy * inv, dz * inv], segLen, false);
                if (hit) return 0;
            }

            // 2. Dense point sampling (covers coplanar overlap and the apart case).
            const steps = Math.min(Math.max(1, Math.ceil(segLen / spacing)), 4096);
            for (let s = 0; s <= steps; s++)
            {
                const t = s / steps;
                const r = this.closestPoint(a.x + dx * t, a.y + dy * t, a.z + dz * t);
                if (r && r.distance < minD)
                {
                    minD = r.distance;
                    if (minD === 0) return 0;
                }
            }
        }
        return minD;
    }

    /**
     * Orthographically project all vertices of this mesh onto a plane.
     * @param planeOrigin A point on the plane `[x, y, z]`.
     * @param planeNormal The plane normal `[x, y, z]`.
     */
    @sceneReplace
    projectToPlane(
        planeOrigin: [number, number, number],
        planeNormal: [number, number, number],
    ): Mesh {
        const m = this.inner()?.projectToPlane(
            planeOrigin[0], planeOrigin[1], planeOrigin[2],
            planeNormal[0], planeNormal[1], planeNormal[2],
        );
        if (!m) return new Mesh();
        return Mesh.from(m);
    }

    /**
     * Minimum absolute distance from any vertex to a plane.
     */
    distanceToPlane(
        planeOrigin: [number, number, number],
        planeNormal: [number, number, number],
    ): number {
        return this.inner()?.distanceToPlane(
            planeOrigin[0], planeOrigin[1], planeOrigin[2],
            planeNormal[0], planeNormal[1], planeNormal[2],
        ) ?? Infinity;
    }

    /**
     * Create a `Mesh` from a signed distance field by pre-sampling the SDF
     * on the TypeScript side and passing the resulting grid to the WASM layer.
     *
     * @param sdfFn      Function `(x, y, z) => signedDistance`.
     * @param bounds     Bounding box as `{ min: [x,y,z], ls: [x,y,z] }`.
     * @param resolution Grid resolution as `[nx, ny, nz]` (default `[30,30,30]`).
     * @param isoValue   Isosurface threshold (default `0.0`).
     */
    static fromSDF(
        sdfFn: (x: number, y: number, z: number) => number,
        bounds: { min: [number, number, number]; max: [number, number, number] },
        resolution: [number, number, number] = [30, 30, 30],
        isoValue = 0.0,
    ): Mesh {
        const [nx, ny, nz] = resolution;
        const [minX, minY, minZ] = bounds.min;
        const [maxX, maxY, maxZ] = bounds.max;
        const dx = (maxX - minX) / (Math.max(nx, 2) - 1);
        const dy = (maxY - minY) / (Math.max(ny, 2) - 1);
        const dz = (maxZ - minZ) / (Math.max(nz, 2) - 1);
        const total = nx * ny * nz;
        const values = new Float64Array(total);
        for (let iz = 0; iz < nz; iz++) // perf: keep as loop
        {
            for (let iy = 0; iy < ny; iy++) // perf: keep as loop
            {
                for (let ix = 0; ix < nx; ix++) // perf: keep as loop
                {
                    values[iz * ny * nx + iy * nx + ix] = sdfFn(
                        minX + ix * dx,
                        minY + iy * dy,
                        minZ + iz * dz,
                    );
                }
            }
        }
        const meshJs = MeshJs.fromSdfValues(
            values, nx, ny, nz,
            minX, minY, minZ,
            maxX, maxY, maxZ,
            isoValue,
        );
        return Mesh.from(meshJs);
    }

    //// LAYOUT & ALIGNMENT ////

    /** Rotate the mesh to lay flat on the XY plane, then drop it so its bottom sits at Z = 0.
     *  Aligns the dominant face direction — the normal carrying the largest total face area —
     *  with world Z, along the shortest arc, so the in-plane orientation is never disturbed.
     *  A mesh whose dominant face is already parallel to XY is therefore only translated.
     *
     *  NOT the OBB's thinnest axis: that is a PCA direction of least variance and only lines
     *  up with a real face on plate-like shapes. On a sheared loft or a blocky part it points
     *  nowhere near a face, and layflat() would leave the shape tilted with nothing at all
     *  resting on Z = 0. Going by face area is also what keeps degenerate plates (equal X/Y
     *  eigenvalues, arbitrary eigenvectors) stable — their two big faces group together
     *  regardless of how the PCA in-plane axes happen to fall.
     */
    layflat(): this
    {
        this.rotateToAlignLargestFaceToZ();
        const minZ = this.bbox().minZ();
        return (Math.abs(minZ) > 1e-10) ? this.translate(0, 0, -minZ) : this;
    }

    /** Rotate this Mesh so that direction `from` ends up pointing along `to`, using the
     *  shortest arc between the two.
     *  @param pivot  point the rotation turns around (default: this Mesh's center)
     */
    rotateVecToVec(from: PointLike, to: PointLike, pivot?: PointLike): this
    {
        const f = Vector.from(from as any);
        const t = Vector.from(to as any);
        const { axis, angle } = shortestArcAxisAngle(f, t);
        if (angle === 0) { return this; }
        return this.rotateAround(angle, axis, pivot ?? this.center());
    }

    /** Rotate this Mesh so its oriented bounding box lines up with the world axes:
     *  the OBB's thinnest axis onto +Z first, then its longest axis onto +X.
     *  Position of the center is kept.
     */
    rotateToAxesOBbox(): this
    {
        const center = this.center();
        // axes()[2] = least variance (thickness), axes()[0] = greatest (length)
        this.rotateVecToVec(this.obbox().axes()[2], [0, 0, 1], center);
        // NOTE: the OBB is recomputed — its axes turned with the mesh in the step above
        this.rotateVecToVec(this.obbox().axes()[0], [1, 0, 0], center);
        return this;
    }

    /** Rotate this Mesh so the normal of its dominant face direction is parallel to the Z axis.
     *
     *  Faces are grouped by normal (opposite normals count as one direction) and the group
     *  with the largest *total* area wins. Grouping matters here: a tessellated mesh has its
     *  faces split into many triangles, so the single largest polygon is a poor proxy for the
     *  face that actually dominates the shape.
     */
    rotateToAlignLargestFaceToZ(): this
    {
        const QUANT = 1e4;
        interface NormalGroup { x: number, y: number, z: number, area: number }
        const groups = new Map<string, NormalGroup>();

        this.polygons().toArray().forEach(poly =>
        {
            const area = poly.area();
            if (!area || area < TOLERANCE) { return; }
            const n = poly.normal().normalize();
            // Fold onto one hemisphere so a face and its backface share a group
            const flip = (Math.abs(n.z) > TOLERANCE) ? (n.z < 0)
                       : (Math.abs(n.y) > TOLERANCE) ? (n.y < 0) : (n.x < 0);
            const [nx, ny, nz] = flip ? [-n.x, -n.y, -n.z] : [n.x, n.y, n.z];

            const key   = `${Math.round(nx * QUANT)},${Math.round(ny * QUANT)},${Math.round(nz * QUANT)}`;
            const group = groups.get(key);
            if (group) { group.area += area; }
            else { groups.set(key, { x: nx, y: ny, z: nz, area }); }
        });

        if (groups.size === 0) { return this; }

        const dominant = Array.from(groups.values()).sort((a, b) => b.area - a.area)[0];
        return this.rotateVecToVec([dominant.x, dominant.y, dominant.z], [0, 0, 1], this.center());
    }

    /** Rotate this Mesh to align it with the world axes as much as possible.
     *
     *  Runs in three steps:
     *    1. `rotateToAxesOBbox()` — get the shape roughly flat on the XY plane
     *    2. `rotateToAlignLargestFaceToZ()` — make the dominant face parallel to XY
     *    3. turn around Z so the dominant edge direction lands on the X or Y axis
     *
     *  Step 3 only ever turns around Z (by at most a quarter turn), so it can never
     *  undo the flat alignment of the first two steps.
     *
     *  @param o  'vertical' (default) puts the dominant edge direction on the Y axis,
     *            'horizontal' puts it on the X axis
     */
    rotateToOrtho(o: OrientationXY = 'vertical'): this
    {
        this.rotateToAxesOBbox();
        this.rotateToAlignLargestFaceToZ();

        const edges = this.edges().toArray().map(e =>
        {
            const d = e.direction();
            return { x: d.x, y: d.y, z: d.z, length: e.length() };
        });

        const angle = primaryOrthoXYAngle(edges, o);
        return (angle === 0) ? this : this.rotateZ(angle, this.center());
    }

    /** Rotate this Mesh to align as much as possible to the world axes.
     *  Alias for rotateToOrtho() */
    autoRotate(o: OrientationXY = 'vertical'): this
    {
        return this.rotateToOrtho(o);
    }

    /** Flatten a 3D mesh to its bottom-facing polygons projected onto the XY plane.
     *  Finds all polygons whose normal is most aligned with -Z (or a given `axis`),
     *  collapses them to Z = 0 and returns a new Mesh composed of those faces.
     *
     *  @param axis  Optional axis keyword ('x' | 'y' | 'z'). Selects polygons whose
     *               normal is parallel to that axis.  Defaults to 'z' (bottom face).
     */
    @sceneReplace
    flatten(axis: Axis = 'z'): Mesh
    {
        const axisVec = axis === 'x' ? Vector.from(1, 0, 0)
                      : axis === 'y' ? Vector.from(0, 1, 0)
                      :                Vector.from(0, 0, 1);

        const flatPolys = this.polygons()
            .filter(poly =>
            {
                const n = poly.normal();
                const angle = Math.min(
                    n.angle(axisVec),
                    n.angle(axisVec.copy().reverse()),
                );
                return angle < TOLERANCE * 10;
            })
            .map(poly => poly.vertices().map(pt => new Point(pt.x, pt.y, 0)));

        if (flatPolys.length === 0)
        {
            console.warn('Mesh.flatten(): no polygons found aligned with axis', axis, '— returning empty Mesh');
            return new Mesh();
        }

        return Mesh.fromPolygons(flatPolys);
    }

    //// EDGE PROJECTION AND SECTIONING ////


    /** Isometric projection with optional hidden lines
     *
     * @param cam normalizaed 3D position of the camera (default: [-1,-1,1], a common isometric view direction)
     * @param hiddenLines Whether to keep hidden projected edges in the result (default: false)
     * @param includeHiddenShapes Single meshes have no hidden-shape filtering; accepted for API consistency and ignored.
     * @param samples Number of samples of edges to determine visibility (default: 16)
     * @param featureAngle Minimum dihedral angle (degrees) at which an edge is treated
     *   as a feature crease and kept. Range `[0, 180]`, monotonic — higher values drop
     *   more edges. Default 10° keeps almost every triangle edge on smooth tessellated
     *   surfaces (spheres, cylinders), which makes the HLR ray-cast pass the dominant
     *   cost; raise it for large curved meshes.
     *
     * @return ShapeCollection with groups:
     *   - `'visible'`: unoccluded projected edges
     *   - `'hidden'`: occluded edges (only present when `hiddenLines=true`)
     *   - `'silhouette'`: subset of `'visible'` forming the outer contour
     *     (silhouette + open-mesh boundary edges) as classified by the Rust HLR
     *
     * @param view Trailing options, chiefly `strategy` — which HLR algorithm to
     *   run. Defaults to `'raycast'`, the original sampling solver. A single
     *   mesh has no shapes to order, so the per-shape strategies `'clip'` and
     *   `'painter'` reduce to `'exact'` here.
     */
    @sceneLayer('iso')
    isometry(
        cam:PointLike = [-1,-1,1],
        hiddenLines:boolean=false,
        includeHiddenShapes:boolean=false,
        samples: number = 16,
        featureAngle: number=10,
        view: ProjectionViewOptions = {},
    ):ShapeCollection<Shape>
    {
        void includeHiddenShapes;
        // from cam position to origin
        const camDirVec = (isPointLike(cam))
                        ? Point.from(cam).toVector().normalize()
                        : Vector.from([-1,-1,1]).normalize();
        const planeNormal = camDirVec.copy().reverse();

        const iso = this._projectEdges(
            {
                viewDirection: camDirVec.toArray(),
                planeNormal: planeNormal.toArray(),
                planeOrigin: [0, 0, 0],
                featureAngle: featureAngle,
                samples: samples,
                strategy: Mesh._singleMeshStrategy(view.strategy),
            } as ProjectEdgeOptions);

        if(!hiddenLines){ iso.removeGroup('hidden'); }

        return Mesh._flattenProjectionToScreen(iso, planeNormal);
    }

    /** Shorthand alias for {@link isometry}. */
    iso(
        cam:PointLike = [-1,-1,1],
        hiddenLines:boolean=false,
        includeHiddenShapes:boolean=false,
        samples: number = 16,
        featureAngle: number=10,
        view: ProjectionViewOptions = {},
    ):ShapeCollection<Shape>
    {
        return this.isometry(cam, hiddenLines, includeHiddenShapes, samples, featureAngle, view);
    }

    /** Map a requested strategy onto one a single mesh can actually run.
     *
     *  `'clip'` and `'painter'` are about ordering separate shapes against each
     *  other. With one mesh there is nothing to order, and what remains of both
     *  is exact self-occlusion — so they resolve to `'exact'` rather than
     *  failing. A collection of several meshes handles them properly.
     */
    static _singleMeshStrategy(strategy: HlrStrategy | undefined): HlrStrategy
    {
        if (!strategy) return HLR_STRATEGY_DEFAULT;
        return (strategy === 'clip' || strategy === 'painter') ? 'exact' : strategy;
    }

    /**
     * Project visible and hidden edges of this mesh onto a plane.
     *
     * @param options  View direction, projection plane, optional feature angle and sample count.
     * @param occluders Other meshes that may occlude this mesh's edges. Their
     *   inner MeshJs handles are **cloned** before being passed to WASM, so the
     *   original `Mesh` wrappers remain usable after this call (the cloned
     *   handles are consumed by the WASM bridge — `Vec<MeshJs>` takes ownership).
     * @returns ShapeCollection<Curve> with two groups: 'visible' and 'hidden', containing the respective projected edges as Curves.
     */
    _projectEdges(options: ProjectEdgeOptions, occluders: ShapeCollection<Mesh> = new ShapeCollection<Mesh>()): ShapeCollection<Shape>
    {
        const optionsWithDefaults = { 
            ...EDGE_PROJECTION_DEFAULTS, 
            ...((options instanceof Object) ? options: {}) };

        const [ vx, vy, vz ] = Point.from(optionsWithDefaults.viewDirection).toArray();
        const [ ox, oy, oz ] = Point.from(optionsWithDefaults.planeOrigin!).toArray();
        const [ nx, ny, nz ] = Point.from(optionsWithDefaults.planeNormal).toArray();
        const rawFeatureAngle = Number(optionsWithDefaults.featureAngle);
        const rawSamples = Number(optionsWithDefaults.samples);
        const fa = Number.isFinite(rawFeatureAngle)
            ? Math.min(
                EDGE_PROJECTION_LIMITS.featureAngleMax,
                Math.max(EDGE_PROJECTION_LIMITS.featureAngleMin, rawFeatureAngle),
            )
            : EDGE_PROJECTION_DEFAULTS.featureAngle;
        const ns = Number.isFinite(rawSamples)
            ? Math.min(
                EDGE_PROJECTION_LIMITS.maxSamples,
                Math.max(EDGE_PROJECTION_LIMITS.minSamples, Math.round(rawSamples)),
            )
            : EDGE_PROJECTION_DEFAULTS.samples;

        // WASM `projectEdges` takes `Vec<MeshJs>` (by value), which consumes
        // each handle as wasm-bindgen reconstructs Rust values from the JS
        // pointers. Cloning the inner MeshJs before passing keeps the
        // caller's Mesh wrappers alive for further use across multiple
        // projection calls (e.g. front+side+top of the same scene).
        const occJs = occluders
            .map(m => m.inner()?.clone?.())
            .filter((m): m is MeshJs => m != null);
        const strategy = optionsWithDefaults.strategy ?? HLR_STRATEGY_DEFAULT;
        const r = this.inner()?.projectEdges(vx, vy, vz || 0, ox, oy, oz || 0, nx, ny, nz || 0, fa, ns, occJs, strategy);
        if (!r)
        {
            console.error(`Mesh::_projectEdges(): Projection failed. Check if the mesh is valid and the options are correct.`);
            return new ShapeCollection<Shape>(); // empty result on failure
        }

        const result = new ShapeCollection<Shape>();
        // First add hidden edges, so they are rendered below visible ones by default
        result.addGroup('hidden',  this._projectedPolylinesToShapeCollection(r.hiddenPolylines()));
        const visibleCurves = this._projectedPolylinesToShapeCollection(r.visiblePolylines());
        result.addGroup('visible', visibleCurves);
        // Tag the silhouette subset (outer contour). Rust returns indices into
        // the visible polylines so we can register the same Curve instances
        // under a second group label without inflating the shape count.
        Mesh._tagSilhouetteFromIndices(result, visibleCurves, r.silhouetteIndices?.());

        r.free?.();
        return result;
    }

    /** Register a subset of the just-added visible Curves under the
     *  'silhouette' group, where the subset is given as indices into the
     *  visible polyline array returned by the Rust HLR. No-op when the
     *  WASM build doesn't expose `silhouetteIndices()` or it returns empty.
     */
    static _tagSilhouetteFromIndices(
        target: ShapeCollection<Shape>,
        visibleCurves: ShapeCollection<Shape>,
        indices: Uint32Array | number[] | undefined,
    ): void
    {
        if (!indices || indices.length === 0) return;
        const visibleArr = visibleCurves.toArray() as Shape[];
        const silhouette = new ShapeCollection<Shape>();
        for (let i = 0; i < indices.length; i++)
        {
            const idx = indices[i];
            if (idx < visibleArr.length) silhouette.add(visibleArr[idx]);
        }
        if (silhouette.length) target.tagGroup('silhouette', silhouette);
    }

    _projectedPolylinesToShapeCollection(polylines: Array<[number, number, number][]>): ShapeCollection<Shape>
    {
        return Mesh.projectedPolylinesToShapeCollection(polylines);
    }

    /** Turn raw projected polylines into Curves.
     *
     *  Static because the conversion depends on nothing but the polylines, and
     *  the linear-shape projection in ShapeCollection needs it without having a
     *  Mesh to hand. The instance method above stays as the existing spelling.
     */
    static projectedPolylinesToShapeCollection(polylines: Array<[number, number, number][]>): ShapeCollection<Shape>
    {
        const curves = new ShapeCollection<Shape>();
        polylines.forEach(points =>
        {
            // HLR projection can emit degenerate polylines (an edge seen head-on collapses
            // to coincident points). Skip those — Curve.Line/Polyline reject zero-length input.
            if (!Mesh._polylineHasLength(points)) return;
            curves.add(
                (points.length === 2)
                    ? Curve.Line(points[0], points[1])
                    : Curve.Polyline(points)
                )
        });
        return curves;
    }

    /** True when a raw polyline spans a non-zero distance (has at least two points
     *  that are not coincident within Curve.ZERO_LENGTH_TOLERANCE). */
    static _polylineHasLength(points: Array<[number, number, number]>): boolean
    {
        if (points.length < 2) return false;
        let total = 0;
        for (let i = 1; i < points.length; i++)
        {
            const [ax, ay, az] = points[i - 1];
            const [bx, by, bz] = points[i];
            total += Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
            if (total >= Curve.ZERO_LENGTH_TOLERANCE) return true;
        }
        return false;
    }

    /** Flatten a 3D projection onto the XY plane and orient so world-up maps
     *  to screen-up [0,1,0]. Shared by isometry(), elevation(), section().
     *
     *  `planeNormal` is the projection plane normal in 3D (pointing toward the
     *  viewer). After this, the result lies on Z=0, centered at the origin.
     */
    static _flattenProjectionToScreen<T extends {
        rotateQuaternion(q: any): T;
        moveTo(x: number, y: number, z: number): T;
    }>(projection: T, planeNormal: Vector): T
    {
        // Flatten onto XY plane (Z = [0,0,1]) via shortest-arc rotation
        const flattened = projection.rotateQuaternion(
            planeNormal.rotationBetween(Vector.from(0, 0, 1)));

        // Where the original 3D Up [0,0,1] landed: the shortest-arc rotation
        // maps the original Z-axis to (-nx, -ny) in the XY plane.
        const mappedUpVec = planeNormal.copy().reverse().setZ(0);

        // Fallback: looking straight down/up — XY components are 0, already oriented.
        if (mappedUpVec.x * mappedUpVec.x + mappedUpVec.y * mappedUpVec.y < TOLERANCE)
        {
            mappedUpVec.setX(0);
            mappedUpVec.setY(1);
        }

        // Twist so mapped-up aligns with screen-up [0,1,0].
        // When mappedUpVec is anti-parallel to [0,1,0] (dot ≈ -1), rotationBetween
        // picks an arbitrary perpendicular axis. Using the Z-axis there would flip
        // screen-X, so we explicitly use a 180° rotation around X instead.
        const dotUp = mappedUpVec.dot(Vector.from(0, 1, 0));
        const twistRot = dotUp < -(1 - TOLERANCE)
            ? { x: 1, y: 0, z: 0, w: 0 }   // 180° around X — preserves screen-X
            : mappedUpVec.rotationBetween(Vector.from(0, 1, 0));
        return flattened.rotateQuaternion(twistRot).moveTo(0, 0, 0);
    }

    /** Resolve a BasePlane name or PointLike direction into a normalized
     *  camera-side direction vector (pointing from origin toward viewer).
     *  For BasePlane, returns the plane's outward normal.
     */
    static _resolveViewDirection(from: PointLike | BasePlane): Vector
    {
        if (isBasePlane(from))
        {
            const n = BASE_PLANE_NAME_TO_PLANE[from].normal;
            return Vector.from(n[0], n[1], n[2]).normalize();
        }
        return Point.from(from as PointLike).toVector().normalize();
    }

    /** Orthographic elevation projection with hidden-line removal.
     *
     *  Renders the mesh as seen from `from`, projected onto the plane through
     *  the origin perpendicular to `from`. Same pipeline as {@link isometry}
     *  but with a domain-friendly direction argument (BasePlane name or Vector).
     *
     *  @param from  Camera-side direction. Either a `BasePlane` name
     *               ('front', 'back', 'left', 'right', 'top', 'bottom',
     *               'xy', 'xz', 'yz') or a `PointLike` direction.
     *  @param hiddenLines Keep hidden projected edges (default false).
     *  @param samples HLR ray samples per edge (default 16).
     *  @param featureAngle Min crease angle in degrees to keep an edge (default 10).
     *    Range `[0, 180]`; monotonic. Increase on smooth tessellated geometry to
     *    drop near-flat triangle edges before HLR sampling.
     *  @returns ShapeCollection with groups 'visible', 'silhouette' (outer
     *    contour, subset of 'visible'), and 'hidden' (only if requested).
     */
    @sceneLayer('elevation')
    elevation(
        from: PointLike | BasePlane = 'front',
        hiddenLines: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
        view: ProjectionViewOptions = {},
    ): ShapeCollection<Shape>
    {
        const camDirVec = Mesh._resolveViewDirection(from);
        const planeNormal = camDirVec.copy().reverse();

        const elev = this._projectEdges(
            {
                viewDirection: camDirVec.toArray(),
                planeNormal:   planeNormal.toArray(),
                planeOrigin:   [0, 0, 0],
                featureAngle:  featureAngle,
                samples:       samples,
                strategy:      Mesh._singleMeshStrategy(view.strategy),
            } as ProjectEdgeOptions);

        if (!hiddenLines) elev.removeGroup('hidden');

        return Mesh._flattenProjectionToScreen(elev, planeNormal);
    }

    /** Architectural section: cut the mesh with a plane and project the
     *  geometry beyond the cut onto that same plane with HLR.
     *
     *  The viewer looks along `-normal` (so for the default normal=[0,0,1]
     *  the camera is above, looking down — the standard floor-plan setup).
     *
     *  @param pivot Any point on the section plane.
     *  @param normal Section plane normal (BasePlane name or PointLike).
     *                Default `[0,0,1]` (horizontal cut).
     *  @param hiddenLines Keep hidden projected edges (default false).
     *  @param samples HLR ray samples per edge (default 16).
     *  @param featureAngle Min crease angle in degrees (default 10). Range `[0, 180]`,
     *    monotonic; raise to drop near-flat tessellation edges on smooth surfaces.
     *  @returns ShapeCollection with groups 'cut', 'visible', 'silhouette'
     *    (outer contour, subset of 'visible'), and 'hidden' (if requested).
     *
     *  @remarks The underlying csgrs `slice()` drops Z when building the cut
     *           sketch; this works correctly for cuts whose normal has a
     *           non-trivial Z component. Vertical sections (normal in XY
     *           plane) currently produce a degenerate cut profile.
     */
    @sceneLayer('section')
    section(
        pivot: PointLike,
        normal: PointLike | BasePlane = [0, 0, 1],
        hiddenLines: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
        view: ProjectionViewOptions = {},
    ): ShapeCollection<Shape>
    {
        const sectionNormal = Mesh._resolveViewDirection(normal);
        const pivotPoint    = Point.from(pivot);

        const result = this._projectEdgesSection(
            {
                pivot: pivotPoint,
                normal: sectionNormal,
                featureAngle,
                samples,
                strategy: Mesh._singleMeshStrategy(view.strategy),
            });

        if (!hiddenLines) result.removeGroup('hidden');

        // Projection plane faces the viewer (= -sectionNormal). Flatten using
        // that as planeNormal so the result lands on XY screen-oriented.
        const planeNormal = sectionNormal.copy().reverse();
        return Mesh._flattenProjectionToScreen(result, planeNormal);
    }

    /** Slice + project edges through a section plane.
     *
     *  Calls into MeshJs.projectEdgesSection() and returns a ShapeCollection
     *  with three groups: 'cut' (the cross-section polylines), 'visible' and
     *  'hidden' (edges of the mesh beyond the cut, projected onto the section
     *  plane with HLR). Output is in world 3D — caller is responsible for
     *  flattening to a 2D frame if needed.
     */
    _projectEdgesSection(
        options: {
            pivot: Point,
            normal: Vector,
            featureAngle?: number,
            samples?: number,
            strategy?: HlrStrategy,
        },
        occluders: ShapeCollection<Mesh> = new ShapeCollection<Mesh>(),
    ): ShapeCollection<Shape>
    {
        const { pivot, normal } = options;
        const fa = options.featureAngle ?? EDGE_PROJECTION_DEFAULTS.featureAngle;
        const ns = options.samples ?? EDGE_PROJECTION_DEFAULTS.samples;

        // Section plane: normal . X = section_offset
        const sectionOffset = normal.x * pivot.x + normal.y * pivot.y + normal.z * pivot.z;

        // Camera sits on the +normal side, looking along -normal (e.g. floor
        // plan: above, looking down). The WASM `view_normal` is the direction
        // *toward the viewer* (matches Mesh.isometry()'s convention where
        // viewDirection = cam-position direction). The projection-plane
        // normal faces away from the viewer, into the scene (= -normal).
        const view   = normal.copy();
        const planeN = normal.copy().reverse();

        // Same ownership note as in _projectEdges: clone occluders before
        // passing so reusing the same MeshJs across multiple section/iso
        // calls stays safe.
        const occJs = occluders
            .map(m => m.inner()?.clone?.())
            .filter((m): m is MeshJs => m != null);

        const inner = this.inner();
        if (!inner)
        {
            console.error('Mesh::_projectEdgesSection(): mesh is empty');
            return new ShapeCollection<Shape>();
        }

        // projectEdgesSection is feature-gated as "sketch" in csgrs; the
        // optional-chaining call lets us fail soft if the WASM build was
        // produced without that feature.
        const r = (inner as any).projectEdgesSection?.(
            normal.x, normal.y, normal.z, sectionOffset,
            view.x, view.y, view.z,
            pivot.x, pivot.y, pivot.z,
            planeN.x, planeN.y, planeN.z,
            fa, ns, occJs, options.strategy ?? HLR_STRATEGY_DEFAULT,
        );
        if (!r)
        {
            console.error(`Mesh::_projectEdgesSection(): projectEdgesSection unavailable or failed.`);
            return new ShapeCollection<Shape>();
        }

        const result = new ShapeCollection<Shape>();
        result.addGroup('hidden',  this._projectedPolylinesToShapeCollection(r.hiddenPolylines()));
        const visibleCurves = this._projectedPolylinesToShapeCollection(r.visiblePolylines());
        result.addGroup('visible', visibleCurves);
        Mesh._tagSilhouetteFromIndices(result, visibleCurves, r.silhouetteIndices?.());

        // Cut sketch: pull rings as typed coordinate buffers and lift back to
        // 3D using the section plane equation. `rings()` is the strongly-typed
        // path (Float64Array per ring + closed flag) and is preferred; older
        // WASM builds without it fall back to parsing the human-readable
        // `debugGeometry()` text. (toArrays() returns triangulated geometry
        // and toMultiPolygon() drops open chains, so neither suffices here.)
        const cut = r.cutSketch?.();
        if (cut)
        {
            const rings = Mesh._extractSketchRings(cut);
            const cutCurves = new ShapeCollection<Shape>();
            for (const ring of rings)
            {
                const pts3 = Mesh._liftPointsToSectionPlane(ring.points, normal, sectionOffset);
                if (ring.closed && pts3.length >= 2)
                {
                    // Ensure ring is explicitly closed
                    const [fx, fy, fz] = pts3[0];
                    const [lx, ly, lz] = pts3[pts3.length - 1];
                    if (fx !== lx || fy !== ly || fz !== lz) pts3.push([fx, fy, fz]);
                }
                cutCurves.add(
                    (pts3.length === 2)
                        ? Curve.Line(pts3[0], pts3[1])
                        : Curve.Polyline(pts3),
                );
            }
            if (cutCurves.length) result.addGroup('cut', cutCurves);
            cut.free?.();
        }

        r.free?.();
        return result;
    }

    /** Extract `{ points, closed }` rings from a `SketchJs`.
     *  Prefers the typed `rings()` accessor (Float64Array buffers, exact
     *  precision). Falls back to parsing `debugGeometry()` for older WASM
     *  builds that predate `rings()` — in that fallback path coordinates are
     *  rounded to 4 decimals (~0.0001 unit), so prefer keeping the WASM bundle
     *  up to date.
     */
    static _extractSketchRings(sketch: any): Array<{ points: Array<[number, number]>, closed: boolean }>
    {
        const typedFn = sketch?.rings;
        if (typeof typedFn === 'function')
        {
            const raw = typedFn.call(sketch) as Array<{ points: Float64Array, closed: boolean }>;
            const out: Array<{ points: Array<[number, number]>, closed: boolean }> = [];
            for (const ring of raw ?? [])
            {
                const flat = ring.points;
                if (!flat || flat.length < 4) continue; // need at least 2 points
                const pts: Array<[number, number]> = new Array(flat.length / 2);
                for (let i = 0, j = 0; i < flat.length; i += 2, j++) // perf: keep as loop
                {
                    pts[j] = [flat[i], flat[i + 1]];
                }
                out.push({ points: pts, closed: !!ring.closed });
            }
            return out;
        }
        const debug: string = sketch?.debugGeometry?.() ?? '';
        return Mesh._parseSketchDebugRings(debug);
    }

    /** Parse SketchJs.debugGeometry() output into a list of rings. Each ring
     *  is `{ points, closed }` where closed=true for Polygon exteriors/holes
     *  and closed=false for LineStrings/Lines. Coordinates are at the format's
     *  4-decimal precision (~0.0001 unit).
     *
     *  Retained as a compatibility fallback for WASM builds that predate the
     *  typed `SketchJs.rings()` accessor used by {@link _extractSketchRings}.
     */
    static _parseSketchDebugRings(debug: string): Array<{ points: Array<[number, number]>, closed: boolean }>
    {
        const rings: Array<{ points: Array<[number, number]>, closed: boolean }> = [];
        const pointRe = /\[(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?),(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\]/g;

        for (const rawLine of debug.split('\n'))
        {
            const line = rawLine.trim();
            const isExterior   = /exterior\s*\(\d+\s+pts\)/.test(line);
            const isHole       = /hole\[\d+\]\s*\(\d+\s+pts\)/.test(line);
            const isLineString = /^Geometry\[\d+\]\s+LineString\s*\(\d+\s+pts\)/.test(line);
            const isLine       = /^Geometry\[\d+\]\s+Line\s/.test(line);

            if (!isExterior && !isHole && !isLineString && !isLine) continue;

            const points: Array<[number, number]> = [];
            const re = new RegExp(pointRe.source, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(line)) !== null)
            {
                points.push([parseFloat(m[1]), parseFloat(m[2])]);
            }
            if (points.length < 2) continue;

            rings.push({ points, closed: isExterior || isHole });
        }
        return rings;
    }

    /** Lift 2D cut-sketch points (which come back in world XY with Z dropped)
     *  back onto the section plane using `n · X = sectionOffset`.
     *
     *  When the plane is near-vertical (`|n.z| < TOLERANCE`) the section
     *  profile is unrecoverable from the X/Y projection csgrs returns, so
     *  this falls back to Z=0 and emits a one-shot console warning per
     *  process. See {@link section} for the upstream limitation.
     */
    static _liftPointsToSectionPlane(
        points: Array<[number, number]>,
        normal: Vector,
        sectionOffset: number,
    ): Array<[number, number, number]>
    {
        if (Math.abs(normal.z) < TOLERANCE)
        {
            Mesh._warnVerticalSectionOnce();
            return points.map(([x, y]) => [x, y, 0] as [number, number, number]);
        }
        return points.map(([x, y]) =>
        {
            const z = (sectionOffset - normal.x * x - normal.y * y) / normal.z;
            return [x, y, z] as [number, number, number];
        });
    }

    private static _verticalSectionWarned = false;
    private static _warnVerticalSectionOnce(): void
    {
        if (Mesh._verticalSectionWarned) return;
        Mesh._verticalSectionWarned = true;
        console.warn(
            'Mesh.section(): the cut plane is near-vertical (|normal.z| < TOLERANCE). ' +
            'csgrs `slice()` drops Z when building the cut sketch, so the cut profile ' +
            'is collapsed to Z=0 and is geometrically degenerate. ' +
            'Visible/hidden projected edges remain correct.',
        );
    }


}
