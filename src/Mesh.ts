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

import type { CsgrsModule, Axis, PointLike } from './types';
import { isPointLike } from './types';

import { Curve, getCsgrs } from './index';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { Vector } from './Vector'
import { rad } from './utils';

import { MeshJs, PolygonJs, PlaneJs, Vector3Js, NurbsCurve3DJs, CompoundCurve3DJs } from './wasm/csgrs';

// Settings
import { SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT, 
    SHAPES_CYLINDER_SEGMENTS_RADIAL } from './constants';
import { Collection } from './Collection';

export class Mesh
{
    _mesh: MeshJs | undefined;

    metadata: Record<string, any> = {};

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

    /** Create new Mesh instance from different other types */
    static from(mesh: MeshJs): Mesh
    {
        if(!mesh) { throw new Error('Mesh::from(): Invalid mesh'); }

        if(mesh instanceof MeshJs)
        {
            const newMesh = new Mesh();
            newMesh._mesh = mesh;
            return newMesh;
        }
        else {
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
        for (let i = 0; i < buffer.length; i += 3)
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
        for (let i = 0; i < buffer.length; i += 3)
        {
            yield new Vector(buffer[i], buffer[i + 1], buffer[i + 2]);
        }
    }

    /** Get polygons of the Mesh */
    polygons(): undefined|Array<PolygonJs>
    {
        return this.inner()?.polygons();

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
        const outerFlat: number[] = [];
        for (const p of outerPoints) {
            const pt = Point.from(p);
            outerFlat.push(pt.x, pt.y, pt.z);
        }
        const outerFloat64 = new Float64Array(outerFlat);

        // Flatten each hole to Float64Array
        const holeArrays: Float64Array[] = [];
        for (const hole of (holes || [])) {
            const holeFlat: number[] = [];
            for (const p of hole) {
                const pt = Point.from(p);
                holeFlat.push(pt.x, pt.y, pt.z);
            }
            holeArrays.push(new Float64Array(holeFlat));
        }

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
            else {
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

    /** Copy current Mesh into a new one 
     *  NOTE: We use copy here instead of clone
     *  conventionally cloning is used for operations involving references to previous data
    */
    copy():undefined|Mesh
    {
        const c = this?.inner()?.clone();
        return c ? Mesh.from(c) : undefined; 
    }

    //// TRANSLATE/ROTATE/SCALE OPERATIONS ////

    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (isPointLike(vecOrX)) 
                        ? Point.from(vecOrX)
                        : Point.from(vecOrX, dy || 0, dz || 0);
        if(!vec){ throw new Error('Mesh.translate(): Invalid translation input. Please use PointLike or valid offset coordinates.'); }
        this._mesh = this.inner()?.translate(vec.toVector3Js());
        return this;
    }

    /** Alias for translate */
    move(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        return this.translate(vecOrX, dy, dz);
    }

    /** Rotate Mesh givens angles (rad) around the X, Y, and Z axes */
    rotate(ax: number, ay: number, az: number): this
    {
        this._mesh = this.inner()?.rotate(ax, ay, az);
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
        // Translate pivot to origin
        this.translate(-p.x, -p.y, -p.z);

        if (typeof axis === 'string')
        {
            // Named axis — map to Euler angles
            const a = rad(angleDeg);
            this.rotate(
                axis === 'x' ? a : 0,
                axis === 'y' ? a : 0,
                axis === 'z' ? a : 0,
            );
        }
        else
        {
            // Arbitrary axis — Rodrigues rotation on every vertex via two helper rotations:
            // align arbitrary axis to Z, rotate, unalign
            const axVec = Point.from(axis).toVector().normalize();
            const theta = rad(angleDeg);
            const cos = Math.cos(theta), sin = Math.sin(theta), t = 1 - cos;
            const { x: ux, y: uy, z: uz } = axVec;
            // Rodrigues rotation matrix rows applied via translate trick:
            // We decompose to Euler using the rotation matrix R:
            //   R = [[t*ux²+cos,  t*ux*uy−sin*uz,  t*ux*uz+sin*uy],
            //        [t*ux*uy+sin*uz, t*uy²+cos,   t*uy*uz−sin*ux],
            //        [t*ux*uz−sin*uy, t*uy*uz+sin*ux, t*uz²+cos  ]]
            // Extract Euler ZYX: ay = asin(-R[2][0]), az = atan2(R[1][0],R[0][0]), ax = atan2(R[2][1],R[2][2])
            const R20 = t * ux * uz - sin * uy;
            const R21 = t * uy * uz + sin * ux;
            const R22 = t * uz * uz + cos;
            const R10 = t * ux * uy + sin * uz;
            const R00 = t * ux * ux + cos;
            const ay2 = Math.asin(Math.max(-1, Math.min(1, -R20)));
            const ax2 = Math.atan2(R21, R22);
            const az2 = Math.atan2(R10, R00);
            this.rotate(ax2, ay2, az2);
        }

        // Translate back
        this.translate(p.x, p.y, p.z);
        return this;
    }

    /** Scale Mesh with factor alongs X, Y, and Z axes */
    scale(sx: number, sy: number, sz: number): this
    {
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

        this._mesh = this.inner()?.mirror(offsettedPlane);
        return this;
    }

    /** Centers Mesh with center of mass at origin ([0,0,0]) */
    moveToCenter():this
    {
        this._mesh = this.inner()?.center();
        return this;
    }

    /** Place Mesh on a given height, by default at 0 
     *  Used to place Meshes on a XY plane
    */
    place(z:number=0)
    {
        this._mesh = this.inner()?.float();
        if(z)
        {
            this._mesh = this.inner()?.translate(new Vector3Js(0, 0, z));
        }
        return this;
    }
    

    /** Recompute normals of polygons of this mesh */
    renormalize(): this
    {
        this._mesh = this.inner()?.renormalize();
        return this;
    }

    /** Turn all polygons of this Mesh into triangles */
    triangulate(): this
    {
        this._mesh = this.inner()?.triangulate();
        return this;
    }

    /** Return new Mesh that is convex hull of current Mesh  */
    hull(): undefined|Mesh
    {
        const ch = this.inner()?.convexHull();
        return ch ? Mesh.from(ch) : undefined;
    }

    smooth(lambda: number, mu:number, iterations:number, preserveBoundaries:boolean): this
    {
        this._mesh = this.inner()?.taubinSmooth(lambda, mu, iterations, preserveBoundaries);
        return this;
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
        this._mesh = this.inner()?.union(other.inner() as MeshJs);
        return this;
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
        this._mesh = this.inner()?.difference(other.inner() as MeshJs);
        return this;
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
        this._mesh = this.inner()?.intersection(other.inner() as MeshJs);
        return this;
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

    //// EXPORT ////

    toSTLBinary(): Uint8Array | undefined
    {
        return this.inner()?.toSTLBinary();
    }

    toSTLAscii(): string | undefined
    {
        return this.inner()?.toSTLASCII();
    }

    /** Export Mesh to GLTF format
     *  @param up Up axis of the model (default Z)
     */
    toGLTF(up:Axis='z'): string | undefined
    {
        // TODO: GLTF has up = Y instead of Z
        return this.inner()?.toGLTF('model', up);
    }
    toAMF(): string | undefined
    {
        return this.inner()?.toAMF('model', 'mm');
    }
}