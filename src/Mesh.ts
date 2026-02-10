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

import { getCsgrs } from './index';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { Vector } from './Vector'

import { MeshJs, PolygonJs, PlaneJs, Vector3Js } from './wasm/csgrs';

// Settings
import { SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT, 
    SHAPES_CYLINDER_SEGMENTS_RADIAL } from './constants';
import { MeshCollection } from './MeshCollection';

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

    /** Get all positions of vertices of Mesh as an iterable */
    *_positionsIter(): IterableIterator<Point>
    {
        const buffer = this._mesh?.positions() || [];   
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
        const buffer = this._mesh?.normals() || [];
        for (let i = 0; i < buffer.length; i += 3)
        {
            yield new Vector(buffer[i], buffer[i + 1], buffer[i + 2]);
        }
    }

    /** Get polygons of the Mesh */
    polygons(): undefined|Array<PolygonJs>
    {
        return this?._mesh?.polygons();
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
        console.log(this._mesh?.massProperties(1));
        return new Point(this._mesh?.massProperties(1)?.centerOfMass);
    }

    /** Volume */
    volume(): number|undefined
    {
        return this._mesh?.massProperties(1)?.mass;
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
        const c = this?._mesh?.clone();
        return c ? Mesh.from(c) : undefined; 
    }

    //// TRANSLATE/ROTATE/SCALE OPERATIONS ////

    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        const vec = (isPointLike(vecOrX)) 
                        ? Point.from(vecOrX)
                        : Point.from(vecOrX, dy || 0, dz || 0);
        if(!vec){ throw new Error('Mesh.translate(): Invalid translation input. Please use PointLike or valid offset coordinates.'); }
        this._mesh = this._mesh?.translate(vec.toVector3Js());
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
        this._mesh = this._mesh?.rotate(ax, ay, az);
        return this;
    }

    /** Scale Mesh with factor alongs X, Y, and Z axes */
    scale(sx: number, sy: number, sz: number): this
    {
        this._mesh = this._mesh?.scale(sx, sy, sz);
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

        this._mesh = this._mesh?.mirror(offsettedPlane);
        return this;
    }

    /** Centers Mesh with center of mass at origin ([0,0,0]) */
    moveToCenter():this
    {
        this._mesh = this._mesh?.center();
        return this;
    }

    /** Place Mesh on a given height, by default at 0 
     *  Used to place Meshes on a XY plane
    */
    place(z:number=0)
    {
        this._mesh = this._mesh?.float();
        if(z)
        {
            this._mesh = this._mesh?.translate(new Vector3Js(0, 0, z));
        }
        return this;
    }
    

    /** Recompute normals of polygons of this mesh */
    renormalize(): this
    {
        this._mesh = this._mesh?.renormalize();
        return this;
    }

    /** Turn all polygons of this Mesh into triangles */
    triangulate(): this
    {
        this._mesh = this._mesh?.triangulate();
        return this;
    }

    /** Return new Mesh that is convex hull of current Mesh  */
    hull(): undefined|Mesh
    {
        const ch = this._mesh?.convexHull();
        return ch ? Mesh.from(ch) : undefined;
    }

    smooth(lambda: number, mu:number, iterations:number, preserveBoundaries:boolean): this
    {
        this._mesh = this._mesh?.taubinSmooth(lambda, mu, iterations, preserveBoundaries);
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
        this._mesh = this._mesh?.union(other._mesh as MeshJs);
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
        this._mesh = this._mesh?.difference(other._mesh as MeshJs);
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
        this._mesh = this._mesh?.intersection(other._mesh as MeshJs);
        return this;
    }

    //// CREATING MESH COLLECTIONS ////

    /** Create a series of new Meshes along a given Vector and given distance from pivots 
     *  We don't use csgrs distribute_linear() because it merges meshes into one
     *  We want to output a collection of individual meshes
    */
    row(count:number, spacing:number, direction:PointLike|Axis='x'):MeshCollection
    {
        const meshes = new MeshCollection();
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

    grid(cx:number=2, cy:number=2, cz:number=1, spacing:number=2):MeshCollection
    {
        if(typeof cx !== 'number' || typeof cy !== 'number' || typeof cz !== 'number' || typeof spacing !== 'number')
        {
            throw new Error("Mesh::grid(): Please supply valid numbers for counts along each axes!");
        }
        const meshes = new MeshCollection();
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
        return this._mesh?.toSTLBinary();
    }

    toSTLAscii(): string | undefined
    {
        return this._mesh?.toSTLASCII();
    }

    /** Export Mesh to GLTF format
     *  @param up Up axis of the model (default Z)
     */
    toGLTF(up:Axis='z'): string | undefined
    {
        // TODO: GLTF has up = Y instead of Z
        return this._mesh?.toGLTF('model', up);
    }
    toAMF(): string | undefined
    {
        return this._mesh?.toAMF('model', 'mm');
    }
}