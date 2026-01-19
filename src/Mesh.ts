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

import { getCsgrs } from './index';
import { Point } from './Point';
import { Bbox } from './Bbox';
import { Vector } from './Vector'

import type { CsgrsModule, PointLike } from './types';


import { MeshJs, PolygonJs, Vector3Js } from './wasm/csgrs';

// Settings
import { SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT, 
    SHAPES_CYLINDER_SEGMENTS_RADIAL } from './constants';

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

    static fromCsgrs(mesh: MeshJs): Mesh
    {
        if(!mesh) { throw new Error('Mesh::fromCsgrs(): Invalid mesh'); }
        const newMesh = new Mesh();
        newMesh._mesh = mesh;
        return newMesh;
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

    /** Create Mesh directly from polygons defined vertices (N > 2) */
    static fromPolygons(verts: Array<Array<PointLike|PointLike|PointLike>>):Mesh
    {
        if(!Array.isArray(verts) || verts.length === 0)
        {
            throw new Error(`Mesh::fromVertices(): Invalid vertices array. Supply something [[<PointLike>,<PointLike>,<PointLike>]]`);
        }

        const polygons: Array<PolygonJs> = [];
        verts.forEach((tri, i) => 
        {
            if (!Array.isArray(tri) || tri.length < 3) 
            {
                console.warn(`Mesh::fromVertices(): Invalid triangle at index ${i}. Supply something [<PointLike>,<PointLike>,<PointLike>]`);
            }
            else {
                const polyVerts = tri.map(v => new Point(v).toVertex());
                polygons.push(new PolygonJs(polyVerts, {}));
            }
        });

        return this.fromCsgrs(getCsgrs().MeshJs.fromPolygons(polygons, {}));
    }


    // MESH PRIMITIVES

    /** Make a cube of given size with center at origin ([0,0,0]) */
    static makeCube(size: number): Mesh
    {
        const mesh = this.fromCsgrs(
            getCsgrs().MeshJs.cube(size, {}));
        // NOTE: CSGRS created boxes from [0,0,0] to [size,size,size]
        // But create at center here, following defaults of many other software
        return mesh.moveToCenter();
    }

    /** Make a cuboid
     *  @param w Width
     *  @param h Height
     *  @param d Depth
     */
    static makeCuboid(w: number, d?: number, h?: number): Mesh
    {
        if (d === undefined) d = w;
        if (h === undefined) h = w;
        return this.fromCsgrs(getCsgrs().MeshJs.cuboid(w, d, h, {}));
    }

    /** Alias for makeCuboid */
    static makeBox(w: number, d?: number, h?: number): Mesh
    {
        return this.makeCuboid(w, d, h);
    }

    /** Make Box between two points */
    static makeBoxBetween(from: PointLike, to: PointLike): Mesh
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
        return this.fromCsgrs(mesh);
    }

    static makeSphere(radius: number): Mesh
    {
        const mesh = getCsgrs()?.MeshJs.sphere(radius, 
            SHAPES_SPHERE_SEGMENTS_WIDTH, 
            SHAPES_SPHERE_SEGMENTS_HEIGHT, {});
        return this.fromCsgrs(mesh);
    }

    static makeCylinder(radius: number, height: number): Mesh
    {
        const mesh = getCsgrs()?.MeshJs.cylinder(radius, height, 
            SHAPES_CYLINDER_SEGMENTS_RADIAL, {});
        return this.fromCsgrs(mesh);
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

    //// TRANSLATE/ROTATE/SCALE OPERATIONS ////

    translate(vecOrX: Vector3Js | number, dy?: number, dz?: number): this
    {
        const vec = (typeof vecOrX === 'number') 
                        ? new Vector3Js(vecOrX, dy || 0, dz || 0) : vecOrX as Vector3Js;
        this._mesh = this._mesh?.translate(vec);
        return this;
    }

    /** Alias for translate */
    move(vecOrX: Vector3Js | number, dy?: number, dz?: number): this
    {
        return this.translate(vecOrX, dy, dz);
    }

    /** Rotate Mesh around the X, Y, and Z axes */
    rotate(rx: number, ry: number, rz: number): this
    {
        this._mesh = this._mesh?.rotate(rx, ry, rz);
        return this;
    }

    /** Scale Mesh with factor alongs X, Y, and Z axes */
    scale(sx: number, sy: number, sz: number): this
    {
        this._mesh = this._mesh?.scale(sx, sy, sz);
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

    //// EXPORT ////

    toSTLBinary(): Uint8Array | undefined
    {
        return this._mesh?.toSTLBinary();
    }

    toSTLAscii(): string | undefined
    {
        return this._mesh?.toSTLASCII();
    }

    toGLTF(): string | undefined
    {
        return this._mesh?.toGLTF('model');
    }

    toAMF(): string | undefined
    {
        return this._mesh?.toAMF('model', 'mm');
    }
}