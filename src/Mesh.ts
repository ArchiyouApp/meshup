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

import type { CsgrsModule, Axis, PointLike, RaycastHit, ClosestPointResult, SdfSample, ProjectEdgeOptions } from './types';
import type { Container } from './Container';
import { isPointLike } from './types';

import { Curve, getCsgrs } from './index';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { Vector } from './Vector'
import { rad, deg, remapAxis } from './utils';
import { Document, NodeIO, Accessor, Primitive, Node as GltfNode } from '@gltf-transform/core';
import { Style } from './Style';

import { MeshJs, PolygonJs, PlaneJs, Vector3Js, NurbsCurve3DJs, CompoundCurve3DJs } from './wasm/csgrs';
import { Polygon } from './Polygon';
import { Collection, CurveCollection, MeshCollection } from './Collection';

// Settings
import { TOLERANCE, SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT, 
    SHAPES_CYLINDER_SEGMENTS_RADIAL,EDGE_PROJECTION_DEFAULTS } from './constants';

    

export class Mesh
{
    _mesh: MeshJs | undefined;

    metadata: Record<string, any> = {};

    style: Style = new Style();

    /** The Container this mesh belongs to, or null if not in a container. */
    _container: Container | null = null;

    /** Return the Container this mesh belongs to, or null. */
    container(): Container | null { return this._container; }

    constructor()
    {
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
            yield new Vector(buffer[i], buffer[i + 1], buffer[i + 2]);
        }
    }

    /** Get polygons of the Mesh as wrapped Polygon instances */
    polygons(): Array<Polygon>
    {
        return (this.inner()?.polygons() ?? []).map(p => Polygon.from(p));
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
                const polyVerts = poly.map(v => Point.from(v).toVertex());
                polygons.push(new PolygonJs(polyVerts, {}));
            }
        });

        return this.from(getCsgrs().MeshJs.fromPolygons(polygons, {}));
    }


    // MESH PRIMITIVES

    /** Make a cube of given size with center at origin ([0,0,0]) */
    static Cube(size: number): Mesh
    {
        const mesh = this.from(
            getCsgrs().MeshJs.cube(size, {}));
        // NOTE: CSGRS created boxes from [0,0,0] to [size,size,size]
        // But create at center here, following defaults of many other software
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

    static Sphere(radius: number): Mesh
    {
        const mesh = getCsgrs()?.MeshJs.sphere(radius, 
            SHAPES_SPHERE_SEGMENTS_WIDTH, 
            SHAPES_SPHERE_SEGMENTS_HEIGHT, {});
        return this.from(mesh);
    }

    static Cylinder(radius: number, height: number): Mesh
    {
        const mesh = getCsgrs()?.MeshJs.cylinder(radius, height, 
            SHAPES_CYLINDER_SEGMENTS_RADIAL, {});
        return this.from(mesh);
    }

    //// CALCULATED PROPERTIES ////

    /** Center of mass */
    center(): Point
    {
        // ...existing code...
        return new Point(this.inner()?.massProperties(1)?.centerOfMass);
    }

    /** Volume */
    volume(): number|undefined
    {
        return this.inner()?.massProperties(1)?.mass;
    }

    /** Calculate outer bounding box of current Mesh */
    bbox(): Bbox
    {
        return Bbox.fromMesh(this);
    }

    /** Calculate oriented bounding box of current Mesh using PCA */
    obbox(): OBbox
    {
        return OBbox.fromMesh(this);
    }

    /** Copy current Mesh into a new one 
     *  NOTE: We use copy here instead of clone
     *  conventionally cloning is used for operations involving references to previous data
    */
    copy():undefined|Mesh
    {
        const c = this?.inner()?.clone();
        if (!c) return undefined;
        const m = Mesh.from(c);
        m.style.merge(this.style.toData());
        return m;
    }

    /** Check if the Mesh is valid (has vertices) */
    validate(): boolean
    {
        const v = !!this._mesh && this.vertices().length > 0;
        if(!v){ console.warn('Mesh::validate(): Invalid Mesh!'); }
        return v;
    }

    //// TRANSLATE/ROTATE/SCALE OPERATIONS ////

    translate(px: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (isPointLike(px)) 
                        ? Point.from(px) 
                        : Point.from(px, dy || 0, dz || 0); // throws is px is invalid Point

        return this.update(this.inner()?.translate(vec.toVector3Js()));
    }

    /** Alias for translate */
    move(px: PointLike | number, dy?: number, dz?: number): this
    {
        const mv = (isPointLike(px)) 
                        ? Point.from(px) 
                        : Point.from(px, dy || 0, dz || 0); // throws is px is invalid Point
        
        return this.translate(mv);
    }

    moveX(dx: number): this { return this.translate(dx, 0, 0); }
    moveY(dy: number): this { return this.translate(0, dy, 0); }
    moveZ(dz: number): this { return this.translate(0, 0, dz); }

    /** Move the mesh so its bbox center lands at the given point */
    moveTo(target: PointLike): this
    {
        const c = this.bbox().center();
        const t = Point.from(target);
        return this.translate(t.x - c.x, t.y - c.y, t.z - c.z);
    }

    moveToX(x: number): this { return this.translate(x - this.bbox().center().x, 0, 0); }
    moveToY(y: number): this { return this.translate(0, y - this.bbox().center().y, 0); }
    moveToZ(z: number): this { return this.translate(0, 0, z - this.bbox().center().z); }

    /** Rotate Mesh by angle (degrees) around an axis through the world origin */
    rotate(angle: number, axis: Axis | PointLike = 'z'): this
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

    /** Rotate Mesh by angle (degrees) around X axis */
    rotateX(angle: number): this
    {
        return this.rotate(angle, 'x');
    }

    /** Rotate Mesh by angle (degrees) around Y axis */
    rotateY(angle: number): this
    {
        return this.rotate(angle, 'y');
    }

    /** Rotate Mesh by angle (degrees) around Z axis */
    rotateZ(angle: number): this
    {
        return this.rotate(angle, 'z');
    }

    /** Rotate Mesh by a quaternion given as components `(w, x, y, z)`.
     *  The quaternion is normalized internally, so non-unit input is safe.
     */
    rotateQuaternion(w: number, x: number, y: number, z: number): this
    {
        this._mesh = this.inner()?.rotateQuaternion(w, x, y, z);
        return this;
    }

    /** Rotate Mesh by angleDeg around an axis through a pivot point.
     *  @param angleDeg - rotation angle in degrees
     *  @param axis     - 'x' | 'y' | 'z' or an arbitrary direction vector (PointLike)
     *  @param pivot    - point the axis passes through (default: world origin)
     */
    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = [0, 0, 0]): this
    {
        const p = Point.from(pivot);
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
        const qVec = new Vector(q.x, q.y, q.z);

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
        const tVec  = new Vector(twist.x, twist.y, twist.z);

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
                    this.translate(q1.reverse()); // move to origin for scaling
                    this.scale(scaleFactor);
                    this.translate(q1);
                }
            }

            // Step 3: rotate around q1 to align srcEdge → tgtEdge
            const R1 = srcEdge.rotationBetween(tgtEdge);
            this.translate(q1.reverse()); // move to origin for rotation
            this.rotateQuaternion(R1.w, R1.x, R1.y, R1.z);
            this.translate(q1);

            // Step 4: twist around the now-aligned edge axis to place p3 → q3
            const p3 = Vector.from(sourcePoints[2]);
            const q3 = Vector.from(targetPoints[2]!); // we know this exists because of the earlier length check

            // Where p3 ended up after translate + scale + R1 (relative to q1):
            const rel = new Vector(p3.subtract(p1))
                            .scale(scaleFactor)
                            .rotateQuaternion(R1.w, R1.x, R1.y, R1.z);

            // Where q3 sits relative to q1:
            const goal = new Vector(q3.subtract(q1));

            // Twist axis = the aligned first edge (unit)
            const axLen = tgtEdge.length();
            if (axLen > 1e-10)
            {
                const axis = tgtEdge.scale(1 / axLen);

                // Project both vectors onto the plane perpendicular to axis
                const u1 = rel.subtract(axis.scale(rel.dot(axis)));
                const u2 = goal.subtract(axis.scale(goal.dot(axis)));

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
    scale(factor: number | PointLike, origin?: PointLike): this
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

    mirror(dir:Axis|PointLike, pos?:PointLike): this
    {
        const planeNormal = isPointLike(dir) 
                                ? Point.from(dir).toVector()
                                : Vector.from(dir); // converts axis to Vector
        // If position is not given use center of mass of Mesh
        const planePosition = pos ? Point.from(pos) : this.center();
        // TODO CSGRS: Plane could use some work for ease of use
        const plane = PlaneJs.fromNormal(
                planeNormal.toVector3Js(), 10.0);
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

    /** Centers Mesh with center of mass at origin ([0,0,0]) */
    moveToCenter():this
    {
        return this.update(this.inner()?.center());
    }

    /** Place Mesh on a given height, by default at 0 
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

    smooth(lambda: number, mu:number, iterations:number, preserveBoundaries:boolean): this
    {
        return this.update(this.inner()?.taubinSmooth(lambda, mu, iterations, preserveBoundaries));
    }

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

    /** Subtract given Mesh from the current */
    difference(other:Mesh): this
    {
        if(!other || !(other instanceof Mesh))
        {
            throw new Error("Mesh::difference(): Please supply a valid Mesh instance!");
        }
        return this.update(this.inner()?.difference(other.inner() as MeshJs));
    }

    /** Subtract given Mesh from the current (alias for difference) */
    subtract(other:Mesh): this
    {
        return this.difference(other);
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

    /** Create a series of new Meshes along a given Vector and given distance from pivots 
     *  We don't use csgrs distribute_linear() because it merges meshes into one
     *  We want to output a collection of individual meshes
    */
    row(count:number, spacing:number, direction:PointLike|Axis='x'):Collection
    {
        const meshes = new Collection();
        const dirVec = Vector.from(direction).normalize(); // auto converts Axis
        for(let i=0; i<count; i++)
        {
            const mesh = this.copy();
            if(mesh)
            {
                mesh.move(dirVec.scale(i * spacing));
                meshes.add(mesh);
            }
        }
        return meshes;
    }

    grid(cx:number=2, cy:number=2, cz:number=1, spacing:number=2):Collection
    {
        if(typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number' || typeof spacing !== 'number')
        {
            throw new Error("Mesh::grid(): Please supply valid numbers for counts along each axes!");
        }
        const meshes = new Collection();
        for(let x=0; x<cx; x++)
        {
            for(let y=0; y<cy; y++)
            {
                for(let z=0; z<cz; z++)
                {
                    const mesh = this.copy();
                    if(mesh)
                    {
                        mesh.move(x * spacing, y * spacing, z * spacing);
                        meshes.add(mesh);
                    }
                }
            }
        }
        return meshes;
    }

    //// STYLE ////

    /** Shortcut for `Mesh.style.color`. Accepts `'red'`, `'#ff0000'`, or `r, g, b` (0–255). */
    color(color: number | string, g?: number, b?: number): this
    {
        if (typeof color === 'number' && typeof g === 'number' && typeof b === 'number')
        {
            this.style.color = [color, g, b];
        }
        else
        {
            this.style.color = color as string;
        }
        return this;
    }

    /** Shortcut for `Mesh.style.opacity`. Value between 0 (transparent) and 1 (opaque). */
    opacity(opacity: number): this
    {
        this.style.opacity = opacity;
        return this;
    }

    /** Alias for `opacity()`. */
    alpha(a: number): this { return this.opacity(a); }

    //// OUTPUT ////

    toPolygons(): undefined|Array<PolygonJs>
    {
        return this.inner()?.polygons();
    }

    //// EXPORT ////

    toSTLBinary(): Uint8Array | undefined
    {
        return this.inner()?.toSTLBinary();
    }

    toSTLAscii(): string | undefined
    {
        return this.inner()?.toSTLASCII();
    }

    /**
     * Build a gltf-transform Node for this mesh within an existing Document.
     * Used by Container.toGLTF() for composing hierarchical scenes.
     * @internal
     */
    _buildGLTFNode(doc: Document, up: Axis = 'z', name = 'mesh'): GltfNode
    {
        const posRaw  = this._mesh?.positions() ?? new Float64Array(0);
        const normRaw = this._mesh?.normals()   ?? new Float64Array(0);
        const idxRaw  = this._mesh?.indices()   ?? new Uint32Array(0);

        const vertexCount = posRaw.length / 3;

        const posF32 = new Float32Array(posRaw.length);
        for (let v = 0; v < vertexCount; v++) // perf: keep as loop
        {
            const [rx, ry, rz] = remapAxis(posRaw[v*3], posRaw[v*3+1], posRaw[v*3+2], up);
            posF32[v*3] = rx; posF32[v*3+1] = ry; posF32[v*3+2] = rz;
        }

        const normVertexCount = normRaw.length / 3;
        const normF32 = new Float32Array(normRaw.length);
        for (let v = 0; v < normVertexCount; v++) // perf: keep as loop
        {
            const [rx, ry, rz] = remapAxis(normRaw[v*3], normRaw[v*3+1], normRaw[v*3+2], up);
            normF32[v*3] = rx; normF32[v*3+1] = ry; normF32[v*3+2] = rz;
        }

        const idxCopy = new Uint32Array(idxRaw.length);
        idxCopy.set(idxRaw);

        const gtBuf = doc.createBuffer();

        const posAcc = doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(posF32)
            .setBuffer(gtBuf);

        const normAcc = doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(normF32)
            .setBuffer(gtBuf);

        const idxAcc = doc.createAccessor()
            .setType(Accessor.Type.SCALAR)
            .setArray(idxCopy)
            .setBuffer(gtBuf);

        const matDef = this.style.toGltfMaterial('mesh_material', false) as any;
        const [r, g, b, a] = matDef.pbrMetallicRoughness.baseColorFactor;
        const material = doc.createMaterial('mesh_material')
            .setBaseColorFactor([r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const prim = doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setAttribute('NORMAL', normAcc)
            .setIndices(idxAcc)
            .setMode(Primitive.Mode.TRIANGLES)
            .setMaterial(material);

        const gltfMesh = doc.createMesh(name).addPrimitive(prim);
        return doc.createNode(name).setMesh(gltfMesh);
    }

    /** Export Mesh to GLTF JSON (binary=false) or GLB binary (binary=true) using gltf-transform.
     *  @param binary  true → GLB (Uint8Array), false → GLTF JSON string
     *  @param up      Up axis of the source model (default Z)
     */
    private async _toGLTF(binary: boolean, up: Axis = 'z'): Promise<string | Uint8Array>
    {
        const posRaw  = this._mesh?.positions() ?? new Float64Array(0);
        const normRaw = this._mesh?.normals()   ?? new Float64Array(0);
        const idxRaw  = this._mesh?.indices()   ?? new Uint32Array(0);

        const vertexCount = posRaw.length / 3;
        if (vertexCount === 0) throw new Error('Mesh::_toGLTF(): No geometry to export!');

        const posF32 = new Float32Array(posRaw.length);
        for (let v = 0; v < vertexCount; v++) // perf: keep as loop
        {
            const [rx, ry, rz] = remapAxis(posRaw[v*3], posRaw[v*3+1], posRaw[v*3+2], up);
            posF32[v*3] = rx; posF32[v*3+1] = ry; posF32[v*3+2] = rz;
        }

        const normF32 = new Float32Array(normRaw.length);
        const normVertexCount = normRaw.length / 3;
        for (let v = 0; v < normVertexCount; v++) // perf: keep as loop
        {
            const [rx, ry, rz] = remapAxis(normRaw[v*3], normRaw[v*3+1], normRaw[v*3+2], up);
            normF32[v*3] = rx; normF32[v*3+1] = ry; normF32[v*3+2] = rz;
        }

        const idxCopy = new Uint32Array(idxRaw.length);
        idxCopy.set(idxRaw);

        // Build gltf-transform Document
        const doc = new Document();
        const gtBuf = doc.createBuffer();

        const posAcc = doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(posF32)
            .setBuffer(gtBuf);

        const normAcc = doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(normF32)
            .setBuffer(gtBuf);

        const idxAcc = doc.createAccessor()
            .setType(Accessor.Type.SCALAR)
            .setArray(idxCopy)
            .setBuffer(gtBuf);

        const matDef = this.style.toGltfMaterial('mesh_material', false) as any;
        const [r, g, b, a] = matDef.pbrMetallicRoughness.baseColorFactor;
        const material = doc.createMaterial('mesh_material')
            .setBaseColorFactor([r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const prim = doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setAttribute('NORMAL', normAcc)
            .setIndices(idxAcc)
            .setMode(Primitive.Mode.TRIANGLES)
            .setMaterial(material);

        const mesh = doc.createMesh('mesh').addPrimitive(prim);
        const node = doc.createNode('node').setMesh(mesh);
        const scene = doc.createScene('scene').addChild(node);
        doc.getRoot().setDefaultScene(scene);

        const io = new NodeIO();
        return binary ? io.writeBinary(doc) : io.writeJSON(doc).then(d => JSON.stringify(d.json));
    }

    /** Export Mesh to GLTF JSON string.
     *  @param up Up axis of the model (default Z)
     */
    async toGLTF(up: Axis = 'z'): Promise<string | undefined>
    {
        if (!this._mesh) return undefined;
        return this._toGLTF(false, up) as Promise<string>;
    }

    /** Export Mesh to GLB binary (Uint8Array).
     *  @param up Up axis of the model (default Z)
     */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array | undefined>
    {
        if (!this._mesh) return undefined;
        return this._toGLTF(true, up) as Promise<Uint8Array>;
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
     * Minimum separating distance to another mesh.  Returns `0` if they intersect.
     */
    distanceTo(other: Mesh): number {
        const a = this.inner();
        const b = other.inner();
        if (!a || !b) return Infinity;
        return a.distanceTo(b);
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
     * @param bounds     Bounding box as `{ min: [x,y,z], max: [x,y,z] }`.
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

    //// EDGE PROJECTION AND SECTIONING ////


    /** Isometric projection with hidden lines
     *  
     * @param cam normalizaed 3D position of the camera (default: [-1,-1,1], a common isometric view direction) 
     * @param all Whether to include hidden edges (default: true)
     * @param samples Number of samples of edges to determine visibility (default: 16)
     * @param featureAngle Optional angle threshold to treat edges as "features" and always show them
     * 
     * @return CurveColection with groups 'visible' and 'hidden' for the respective edges
     *   use isometryResult.group('visible') and isometryResult.group('hidden') to access each separately
     */
    isometry(cam:PointLike = [-1,-1,1], all:boolean=true, samples: number = 16, featureAngle: number=10):CurveCollection
    {
        // from cam position to origin
        const camDirVec = (isPointLike(cam))
                        ? Point.from(cam).toVector().normalize()// .reverse()
                        : Vector.from([-1,-1,1]).normalize() // .reverse(); // default direction
        const planeNormal = camDirVec.copy().reverse();

        const iso = this._projectEdges(
            { 
                // NOTE: why is it called viewDirection - you would expect -cam? TODO: check in Rust layer
                viewDirection: camDirVec.toArray(),
                planeNormal: planeNormal.toArray(),
                planeOrigin: [0, 0, 0],
                featureAngle: featureAngle,
                samples: samples,
            } as ProjectEdgeOptions);

        if(!all){ iso.removeGroup('hidden'); }

        // Isometric projection result is on plane normal: place on XY plane

        // Flatten the 3D projection onto the 2D XY plane (Z = [0,0,1])
        const flattenedIso = iso.rotateQuaternion(
                planeNormal.rotationBetween(new Vector(0, 0, 1)));
        
        // Find where the original 3D UP [0,0,1] landed after flattening.
        // A shortest arc rotation to [0,0,1] geometrically forces the original Z-axis 
        // to map exactly to the inverted X and Y components of the original normal!
        const mappedUpVec = planeNormal.copy().reverse().setZ(0);
        
        // Fallback: If looking perfectly straight down/up, X and Y are 0.
        // In that case, we can assume it's already oriented properly.
        if (mappedUpVec.x * mappedUpVec.x + mappedUpVec.y * mappedUpVec.y < TOLERANCE)
        {
            mappedUpVec.setX(0);
            mappedUpVec.setY(1);
        }

        // Twist the flattened curves so the 3D Up aligns perfectly with 2D Screen Up [0,1,0]
        const twistRot = mappedUpVec.rotationBetween(new Vector(0, 1, 0));
        
        return flattenedIso.rotateQuaternion(twistRot)
                .moveTo(0,0,0); // ensure centered at origin
        
    }

    /**
     * Project visible and hidden edges of this mesh onto a plane.
     *
     * @param options  View direction, projection plane, optional feature angle and sample count.
     * @param occluders Other meshes that may occlude this mesh's edges.
     * @returns CurveCollection with two groups: 'visible' and 'hidden', containing the respective projected edges as Curves.
     */
    _projectEdges(options: ProjectEdgeOptions, occluders: MeshCollection = new MeshCollection()): CurveCollection
    {
        const optionsWithDefaults = { 
            ...EDGE_PROJECTION_DEFAULTS, 
            ...((options instanceof Object) ? options: {}) };

        const [ vx, vy, vz ] = Point.from(optionsWithDefaults.viewDirection).toArray();
        const [ ox, oy, oz ] = Point.from(optionsWithDefaults.planeOrigin!).toArray();
        const [ nx, ny, nz ] = Point.from(optionsWithDefaults.planeNormal).toArray();
        const fa = optionsWithDefaults.featureAngle;
        const ns = optionsWithDefaults.samples;

        const occJs = occluders.map(m => m.inner()).filter((m): m is MeshJs => m !== undefined);
        const r = this.inner()?.projectEdges(vx, vy, vz || 0, ox, oy, oz || 0, nx, ny, nz || 0, fa, ns, occJs);
        if (!r)
        {
            console.error(`Mesh::_projectEdges(): Projection failed. Check if the mesh is valid and the options are correct.`);
            return new CurveCollection(); // empty result on failure
        }
        
        const result = new CurveCollection();
        // First add hidden edges, so they are rendered below visible ones by default
        result.addGroup('hidden',  this._projectedPolylinesToCurveCollection(r.hiddenPolylines()));
        result.addGroup('visible', this._projectedPolylinesToCurveCollection(r.visiblePolylines()));
        

        r.free?.();
        return result;
    }

    _projectedPolylinesToCurveCollection(polylines: Array<[number, number, number][]>): CurveCollection
    {
        const curves = new CurveCollection();
        polylines.forEach(points =>
        {
            curves.add(
                (points.length === 2) 
                    ? Curve.Line(points[0], points[1]) 
                    : Curve.Polyline(points)
                )
        });
        return curves;
    }

    // TODO: projectEdgesSection



}