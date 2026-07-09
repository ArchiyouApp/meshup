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

import type { CsgrsModule, Axis, BasePlane, PointLike, RaycastHit, ClosestPointResult, SdfSample, ProjectEdgeOptions } from './types';
import { isAxis, isBasePlane, isPointLike } from './types';

import { Curve, getCsgrs } from './index';
import { Shape } from './Shape';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Vector } from './Vector'
import { rad, deg } from './utils';
import { Style } from './Style';
import { GLTFBuilder } from './GLTFBuilder';

import { MeshJs, PolygonJs, PlaneJs, Vector3Js, NurbsCurve3DJs, CompoundCurve3DJs } from './wasm/csgrs';
import { Polygon } from './Polygon';
import { ShapeCollection } from './ShapeCollection';
import { Vertex } from './Vertex';

import { Selector } from './Selector';

// Settings
import { TOLERANCE, SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT,
    SHAPES_CYLINDER_SEGMENTS_RADIAL, EDGE_PROJECTION_DEFAULTS, EDGE_PROJECTION_LIMITS, BASE_PLANE_NAME_TO_PLANE } from './constants';

    

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

    /** Get polygons (faces) of the Mesh as a ShapeCollection of wrapped Polygon instances */
    polygons(): ShapeCollection<Polygon>
    {
        return new ShapeCollection<Polygon>(
            (this.inner()?.polygons() ?? []).map(p => Polygon.from(p)),
        );
    }

    /** Get faces of the Mesh as a ShapeCollection of Polygons (alias of polygons()) */
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
                polygons.push(new PolygonJs(polyVerts, {}));
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

    /** Returns the outline edges of this mesh as Curves
     *  TODO: implement proper edge extraction via CSGRS
     */
    edges(): ShapeCollection<Curve>
    {
        throw new Error('Mesh.edges(): not yet implemented — requires CSGRS edge extraction');
    }

    /** Store annotations on this mesh — placeholder for old-API compat */
    addAnnotations(_annotations: any[]): this
    {
        // TODO: implement when annotation storage is added to geometry classes
        return this;
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
    override copy(): this
    {
        const c = this?.inner()?.clone();
        if (!c) return new Mesh() as this;
        
        const m = Mesh.from(c);

        m.style.merge(this.style.explicitData() as any); // copy only explicit style properties so layer colors can cascade
        m.metadata = { ...this.metadata }; // copy metadata

        // if original shape is tied to scene: add copy too, as sibling
        // TODO: keep this structural and put in Shape
        if (this.node())
        {
            const parent = this.node()?.parent() || this.node(); 
            if (parent)
            {
                parent.addShape(m); // TODO: name with 'copy'
            };
        }

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
            // Step 1: translate so p1 → q1
            this.translate(q1.subtract(p1));

            // Step 2: optional uniform scale (before rotation, centered at q1)
            if (withScale)
            {
                const srcLen = p2.subtract(p1).length();
                const tgtLen = q2.subtract(q1).length();

                if (srcLen > TOLERANCE)
                {
                    this.translate(q1.reverse()); // move to origin for scaling
                    this.scale(tgtLen / srcLen);
                    this.translate(q1); // move back
                }
            }
            // Step 3: rotate around q1 to align p2 → q2, keeping world z as up
            const srcDir = p2.subtract(p1).normalize();
            const tgtDir = q2.subtract(q1).normalize();
            this.rotateSwing(srcDir, tgtDir, [0,0,1]);

            return this;
        }

        else 
        {

            // Three point alignment

            // Step 1: translate so p1 → q1
            this.translate(q1.subtract(p1));

            // Edge vectors (source and target)
            const srcEdge = p2.subtract(p1);
            const tgtEdge = q2.subtract(q1);

            // Step 2: optional uniform scale (before rotation, centered at q1)
            let scaleFactor = 1;
            if (withScale)
            {
                const srcLen = srcEdge.length();
                const tgtLen = tgtEdge.length();
                if (srcLen > 1e-10)
                {
                    scaleFactor = tgtLen / srcLen;
                    this.translate(q1.copy().reverse()); // move to origin for scaling
                    this.scale(scaleFactor);
                    this.translate(q1);
                }
            }

            // Step 3: rotate around q1 to align srcEdge → tgtEdge
            const R1 = srcEdge.rotationBetween(tgtEdge);
            this.translate(q1.copy().reverse()); // move to origin for rotation
            this.rotateQuaternion(R1.w, R1.x, R1.y, R1.z);
            this.translate(q1);

            // Step 4: twist around the now-aligned edge axis to place p3 → q3
            const p3 = Vector.from(sourcePoints[2]);
            const q3 = Vector.from(targetPoints[2]!); // we know this exists because of the earlier length check

            // Where p3 ended up after translate + scale + R1 (relative to q1):
            const rel = Vector.from(p3.subtract(p1))
                            .scale(scaleFactor)
                            .rotateQuaternion(R1.w, R1.x, R1.y, R1.z);

            // Where q3 sits relative to q1:
            const goal = Vector.from(q3.subtract(q1));

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
                        const half = angle / 2;
                        const sh = Math.sin(half);
                        this.translate(-q1.x, -q1.y, -q1.z);
                        this.rotateQuaternion(Math.cos(half), axis.x * sh, axis.y * sh, axis.z * sh);
                        this.translate(q1.x, q1.y, q1.z);
                    }
                }
            }

            return this;
        }
    }

    /** Scale Mesh with a uniform factor or per-axis [sx, sy, sz]. Optionally around an origin point. */
    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number') ? [factor, factor, factor] : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];
        if (origin)
        {
            const o = Point.from(origin);
            this.translate(-o.x, -o.y, -o.z);
            this._mesh = this.inner()?.scale(sx, sy, sz);
            this.translate(o.x, o.y, o.z);
            return this;
        }
        this._mesh = this.inner()?.scale(sx, sy, sz);
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

    /** Add given Mesh to the current (Alias for union) */
    add(other:Mesh): this
    {
        return this.union(other);
    }

    /** Subtract a Mesh — or every Mesh in a ShapeCollection — from the current */
    difference(other:Mesh|ShapeCollection<Mesh>): this
    {
        if(ShapeCollection.isShapeCollection(other))
        {
            other.meshes().toArray().forEach(mesh => this.difference(mesh));
            return this;
        }
        if(!other || !(other instanceof Mesh))
        {
            throw new Error("Mesh::difference(): Please supply a valid Mesh instance or ShapeCollection<Mesh>!");
        }
        return this.update(this.inner()?.difference(other.inner() as MeshJs));
    }

    /** Subtract one or more Meshes (or ShapeCollections) from the current */
    subtract(...others: (Mesh|ShapeCollection<Mesh>)[]): this
    {
        others.forEach(other => this.difference(other));
        return this;
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

    /**
     * Cut this mesh by `other` and keep one of the resulting pieces.
     * By default keeps the largest piece; set `keepSmallest=true` to keep the smallest.
     *
     * For Mesh and Polygon cutters, warns and returns `this` unchanged when `other`
     * does not intersect this mesh. PlaneJs cutters always proceed (planes are infinite).
     */
    cutoffBy(other: Mesh | Polygon | PlaneJs, keepSmallest = false): this
    {
        // Touch detection only makes sense for finite cutters
        if (!(other instanceof PlaneJs))
        {
            const otherMesh = other instanceof Polygon ? other.toMesh() : other;
            if (!this.hits(otherMesh))
            {
                console.warn('Mesh.cutoffBy(): the cutter does not intersect this mesh — no cut performed.');
                return this;
            }
        }

        const parts = this.split(other);

        if (parts.count() < 2)
        {
            console.warn('Mesh.cutoffBy(): split produced fewer than 2 pieces — no cut performed.');
            return this;
        }

        const sized = parts.toArray().map(m => ({
            mesh: m,
            size: m.volume() ?? m.inner().triangleCount(),
        }));
        sized.sort((a, b) => a.size - b.size);

        const picked = keepSmallest ? sized[0].mesh : sized[sized.length - 1].mesh;
        return this.update(picked);
    }

    /** Cut off Mesh by a plane defined by axisNormal and coordinate.
     *  `box(10).cutoff('x', 5)` keeps the half where x > 5 (positive-normal side).
     *  `box(10).cutoff('x', 5, true)` keeps the half where x < 5 (negative-normal side).
     */
    cutoff(at: Axis, coord: number = 0, smallest: boolean = false): this
    {
        if(!isAxis(at)){ throw new Error(`Mesh.cutoff(): Invalid axis '${at}'. Use 'x', 'y', or 'z'.`); }

        const normals: Record<Axis, [number, number, number]> = {
            x: [1, 0, 0],
            y: [0, 1, 0],
            z: [0, 0, 1],
        };
        const [nx, ny, nz] = normals[at];
        const plane = PlaneJs.fromNormalComponents(nx, ny, nz, coord);
        const parts = this.split(plane);

        if (parts.count() === 0)
        {
            console.warn('Mesh.cutoff(): plane does not intersect this mesh — nothing kept.');
            return this;
        }

        if (parts.count() === 1)
        {
            console.warn('Mesh.cutoff(): plane does not split this mesh — nothing cut off.');
            return this;
        }

        const partsArr = parts.toArray().sort((a, b) => (b.volume() ?? b.area()) - (a.volume() ?? a.area()));
        const picked = smallest ? partsArr[partsArr.length - 1] : partsArr[0];

        return this.update(picked!);
    }

    /**
     * Detect geometrically isolated "islands" in this Mesh and return each as its own Mesh.
     * Useful after a subtract boolean that splits the mesh into disconnected parts.
     * Returns a ShapeCollection<Mesh> with one entry per isolated component.
     * If the mesh is fully connected, returns a collection containing only this mesh.
     */
    separateIsolated(): ShapeCollection<Mesh>
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
            Mesh.from(getCsgrs().MeshJs.fromPolygons(polys, {}))
        );
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
    split(other: Mesh | Polygon | PlaneJs): ShapeCollection<Mesh>
    {
        if (other instanceof Mesh)
        {
            const remainder = this.copy().difference(other);
            if (remainder.inner().triangleCount() === 0)
            {
                return new ShapeCollection<Mesh>();
            }

            const parts = remainder
                .separateIsolated()
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
            const pts = (curve.isCompound())
                ? this.inner()?.intersectCompoundCurve(curve.inner() as CompoundCurve3DJs, tolerance)
                : this.inner()?.intersectCurve(curve.inner() as NurbsCurve3DJs, tolerance);

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
        
        return meshes;
    }

    grid(cx:number=2, cy:number=2, cz:number=1, spacing:number|PointLike=2):ShapeCollection
    {
        if(typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number')
        {
            throw new Error("Mesh::grid(): Please supply valid numbers for counts along each axes!");
        }
        const spacingVector = (typeof spacing === 'number')
            ? new Vector(spacing, spacing, spacing)
            : Vector.from(spacing)

        const meshes = new ShapeCollection();
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
        return meshes;
    }

    //// SELECT ////

    select(what:string)
    {
        return new Selector(what).execute(this);
    }


    //// OUTPUT ////

    toString(): string
    {
        return `<Mesh id=${this.id()} vertices=${this.vertices().length} polygons=${this.polygons().length}>`;
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
    
    toAMF(): string | undefined
    {
        return this.inner()?.toAMF('model', 'mm');
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
            const overlappingMesh = this.copy().intersection(other);
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
     *  Aligns the thinnest OBB axis (least-variance = dominant face normal) with world +Z
     *  using a shortest-arc rotation so the in-plane orientation is never disturbed.
     *  This avoids the instability of toOrthoQuaternion() on symmetric plates where the
     *  two largest PCA eigenvalues are equal and their eigenvectors are numerically arbitrary.
     *
     *  Fast path: if Z is already clearly the shortest AABB dimension, the mesh is already
     *  flat — skip the O(n·50) PCA and only translate to Z = 0.
     */
    layflat(): this
    {
        const bb = this.bbox();
        const xSpan = bb.maxX() - bb.minX();
        const ySpan = bb.maxY() - bb.minY();
        const zSpan = bb.maxZ() - bb.minZ();

        // Fast path: Z is unambiguously the thinnest dimension (< half of both X and Y
        // spans), so the mesh is already lying flat — no rotation needed.
        if (zSpan <= xSpan && zSpan <= ySpan && zSpan < Math.min(xSpan, ySpan) * 0.5)
            return Math.abs(bb.minZ()) > 1e-10 ? this.translate(0, 0, -bb.minZ()) : this;

        // Full path: find the thin axis via OBB and rotate it to +Z.
        // axes()[2] is the axis of least variance — the thickness / face-normal direction.
        let thinAxis = this.obbox().axes()[2].copy();
        if (thinAxis.dot(Vector.from(0, 0, 1)) < 0) thinAxis.reverse();

        const dot = thinAxis.dot(Vector.from(0, 0, 1));
        let q: { x: number; y: number; z: number; w: number };
        if (dot >= 1 - 1e-10)
        {
            q = { x: 0, y: 0, z: 0, w: 1 };
        }
        else if (dot <= -1 + 1e-10)
        {
            q = { x: 1, y: 0, z: 0, w: 0 };              // upside-down: flip around X
        }
        else
        {
            const cr = thinAxis.copy().cross(Vector.from(0, 0, 1));
            const qw = 1 + dot;
            const len = Math.hypot(cr.x, cr.y, cr.z, qw) || 1;
            q = { x: cr.x / len, y: cr.y / len, z: cr.z / len, w: qw / len };
        }

        this.rotateQuaternion(q);
        return this.translate(0, 0, -this.bbox().minZ());
    }

    /** Flatten a 3D mesh to its bottom-facing polygons projected onto the XY plane.
     *  Finds all polygons whose normal is most aligned with -Z (or a given `axis`),
     *  collapses them to Z = 0 and returns a new Mesh composed of those faces.
     *
     *  @param axis  Optional axis keyword ('x' | 'y' | 'z'). Selects polygons whose
     *               normal is parallel to that axis.  Defaults to 'z' (bottom face).
     */
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
     */
    isometry(
        cam:PointLike = [-1,-1,1],
        hiddenLines:boolean=false,
        includeHiddenShapes:boolean=false,
        samples: number = 16,
        featureAngle: number=10,
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
    ):ShapeCollection<Shape>
    {
        return this.isometry(cam, hiddenLines, includeHiddenShapes, samples, featureAngle);
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
        const r = this.inner()?.projectEdges(vx, vy, vz || 0, ox, oy, oz || 0, nx, ny, nz || 0, fa, ns, occJs);
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
    elevation(
        from: PointLike | BasePlane = 'front',
        hiddenLines: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
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
    section(
        pivot: PointLike,
        normal: PointLike | BasePlane = [0, 0, 1],
        hiddenLines: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
    ): ShapeCollection<Shape>
    {
        const sectionNormal = Mesh._resolveViewDirection(normal);
        const pivotPoint    = Point.from(pivot);

        const result = this._projectEdgesSection(
            { pivot: pivotPoint, normal: sectionNormal, featureAngle, samples });

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
            fa, ns, occJs,
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
