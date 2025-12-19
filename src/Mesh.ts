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

import { getCsgrs, Point, Bbox } from './internal';
import type { CsgrsModule, PointLike } from './internal';

import { MeshJs, Vector3Js } from './wasm/csgrs';

// Settings
import { SHAPES_SPHERE_SEGMENTS_WIDTH, SHAPES_SPHERE_SEGMENTS_HEIGHT, 
    SHAPES_CYLINDER_SEGMENTS_RADIAL } from './constants';
import { get } from 'node:http';

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
    /* We use static class methods / factory methods for cleaner syntax 
        Example:
            cube = Mesh.makeCube(10); // instead of new Mesh().makeCube(10);
    */

    static makeCube(size: number): Mesh
    {
        return this.fromCsgrs(getCsgrs().MeshJs.cube(size, {}));
    }

    /** Make a cuboid
     *  @param w Width
     *  @param h Height
     *  @param d Depth
     */
    static makeCuboid(w: number, d: number, h: number): Mesh
    {
        return this.fromCsgrs(getCsgrs().MeshJs.cuboid(w, d, h, {}));
    }

    /** Alias for makeCuboid */
    static makeBox(w: number, d: number, h: number): Mesh
    {
        return this.fromCsgrs(getCsgrs().MeshJs.cuboid(
            w, d, h, {}
        ));
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

    position(): Point
    {
        return this.bbox().center();
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

    rotate(rx: number, ry: number, rz: number): this
    {
        this._mesh = this._mesh?.rotate(rx, ry, rz);
        return this;
    }

    scale(sx: number, sy: number, sz: number): this
    {
        this._mesh = this._mesh?.scale(sx, sy, sz);
        return this;
    }

    moveToCenter():this
    {
        this._mesh = this._mesh?.center();
        return this;
    }

    //// BOOLEAN OPERATIONS ////
}