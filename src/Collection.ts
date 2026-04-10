/**
 *  Collection.ts
 *      a collection of multiple Mesh or Curve instances
 *      Provides methods to manage, order and query the collection
 *      
 */

import type { Axis, BasePlane, PointLike, ProjectEdgeOptions, RaycastHit } from "./types";

import { Mesh } from "./Mesh";
import { Curve } from "./Curve";
import { Point } from "./Point";
import { Vector } from "./Vector";
import { Bbox } from "./Bbox";

import { MeshJs, PolygonJs } from "./wasm/csgrs";

import { Document } from '@gltf-transform/core';
import { createNodeIO } from './GLTFExtensions';
import { GLTFJsonDocumentToString } from './utils';

export class Collection
{
    _shapes = new Array<Mesh|Curve>();
    // We can have multiple groups in a collection, each group is a named subset of shapes. Shapes can belong to multiple groups.
    _groups = new Map<string, Collection>(); 

    constructor(...args: Array<Mesh|Curve|Array<any>|Collection>)
    {
        args.forEach(arg => 
        {
            this.add(arg)
        });
    }

    static isCollection(obj: any): obj is Collection
    {
        return obj instanceof Collection;
    }

    /** Replace the current shapes with new ones */
    update(shapes: Array<Mesh|Curve>|Collection|MeshCollection|CurveCollection): void
    {
        this._shapes = Collection.isCollection(shapes) ? shapes.toArray() : shapes as Array<Mesh|Curve>;
    }

    /** Add shapes to the collection */
    add(shapes: Mesh|Curve|Collection|CurveCollection|MeshCollection|Array<Mesh|Curve>): Collection
    {
        if (shapes instanceof Mesh || shapes instanceof Curve)
        {
            this._shapes.push(shapes);
        }
        else if (Array.isArray(shapes) || Collection.isCollection(shapes))
        {
            const addShapes = (Collection.isCollection(shapes) 
                                    ? shapes.toArray() : 
                                    shapes.filter(s => s instanceof Mesh || s instanceof Curve) as Array<Mesh|Curve>);
            this._shapes.push(...addShapes);
        }
        else
        {
            console.error(`Collection::add(): Invalid shape(s). Supply something [<Mesh>|<Curve>|<Collection>|<CurveCollection>|<MeshCollection>|Array<Mesh|Curve>]. Skipping it!:`, shapes);
        }
        return this;
    }

    //// STATIC FACTORY METHODS ////

    static generate(count: number, generator: (index: number) => Mesh|Curve): Collection
    {
        const shapes = new Array(count).fill(null).map((_, i) => generator(i));
        return new Collection(...shapes);
    }

    //// GROUPS ////
    /** One can have subgroups within the Collection */

    /** Add Shape (Mesh or Curve) to Collection under a group 
     *  @returns the added shape(s) as a new Collection for chaining
    */
    addGroup(groupName: string, shapes: Mesh|Curve|Collection|CurveCollection|MeshCollection ): Collection
    {
        this.add(shapes);
        
        if(!this._groups.has(groupName))
        {
            this._groups.set(groupName, new Collection());
        }
        const group = this._groups.get(groupName);
        
        if(group)
        {
            group.add(shapes);
        }
        return this;
    }

    removeGroup(groupName: string): void
    {
        const groupedShapes = this._groups.get(groupName);
        if(!groupedShapes){ console.error(`Collection::removeGroup(): No group with name '${groupName}' found. Available groups:`, Array.from(this._groups.keys())); return; }
        this.remove(groupedShapes);
        this._groups.delete(groupName); // remove group in map
    }

    group(groupName: string): Collection | undefined
    {
        const groupColl = this._groups.get(groupName);
        if(!groupColl)
        {
            console.error(`Collection::group(): No group with name '${groupName}' found. Available groups:`, Array.from(this._groups.keys())); 
            return undefined; 
        }
        return groupColl;
    }

    /** Return a deep copy of this Collection (all members are independently copied) */
    copy(): Collection|MeshCollection|CurveCollection
    {
        return new Collection(...this._shapes.map(s => s.copy() as Mesh|Curve));
    }

    /** Return a shallow copy of this Collection (new container, same member references) */
    clone(): Collection|MeshCollection|CurveCollection
    {
        return new Collection(...this._shapes);
    }

    remove(shape: Mesh|Curve|Collection|MeshCollection|CurveCollection): void
    {
        if(Collection.isCollection(shape))
        {
            shape.shapes().forEach(s => this.remove(s));   
        }
        else if(shape instanceof Mesh || shape instanceof Curve)
        {
            this._shapes = this._shapes.filter(s => s !== shape);
        }
    }

    /** Get a shape by its index */
    get(index: number): Mesh | Curve | undefined
    {
        return this._shapes[index] as Mesh | Curve | undefined;
    }

    /** Alias for get */
    at(index: number): Mesh | Curve | undefined
    {
        return this.get(index);
    }

    first(): Mesh | Curve
    {
        if(this._shapes.length === 0){ throw new Error(`Collection::first(): Collection is empty.`); }
        return this._shapes[0] as Mesh | Curve;
    }

    last(): Mesh | Curve
    {
        if(this._shapes.length === 0){ throw new Error(`Collection::last(): Collection is empty.`); }
        return this._shapes[this._shapes.length - 1] as Mesh | Curve;
    }

    /** If single shape in the collection, return it. Otherwise, return collection. */
    checkSingle(): Mesh | Curve | this
    {
        if(this._shapes.length === 1){ return this._shapes[0]; }
        return this;
    }

    shapes():Array<Mesh|Curve>
    {
        return this._shapes;
    }

    /** Get all meshes in the collection as a MeshCollection 
     *  NOTE: Use toArray() if you want a plain array instead of a MeshCollection wrapper
    */
    meshes(): MeshCollection
    {
        return new MeshCollection(
                    ...this._shapes.filter(shape => shape instanceof Mesh) as Array<Mesh>);
    }

    /** Get all curves in the collection as a CurveCollection */
    curves(): CurveCollection
    {
        return new CurveCollection(...this._shapes.filter(shape => shape instanceof Curve) as Array<Curve>);
    }

    count()
    {
        return  this._shapes.length;
    }

    /** Collection.length for Array compatibility */
    get length(): number
    {
        return this._shapes.length ?? 0;
    }


    //// ITERATOR METHODS ////

    forEach(callback: (shape: Mesh|Curve, index: number, array: (Mesh|Curve)[]) => void): this
    {
        this._shapes.forEach(callback);
        return this;
    }

    filter(callback: (shape: Mesh|Curve, index: number, array: (Mesh|Curve)[]) => boolean): Collection
    {
        const filtered = this._shapes.filter(callback);
        return new Collection(...filtered);
    }

    map<T>(callback: (shape: Mesh|Curve, index: number, array: (Mesh|Curve)[]) => T): T[]
    {
        return this._shapes.map(callback);
    }

    //// BASIC TRANSFORMATIONS ////

    /** Translate all shapes in Collection */
    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        
        this._shapes.forEach(
            shape => shape.translate(vecOrX as any, dy as any, dz as any));   
        return this;
    }

    /** Alias for translate */
    move(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        return this.translate(vecOrX as any, dy as any, dz as any);
    }

    moveX(dx: number): this { return this.translate(dx, 0, 0); }
    moveY(dy: number): this { return this.translate(0, dy, 0); }
    moveZ(dz: number): this { return this.translate(0, 0, dz); }

    /** Compute the union bounding box over all shapes in this collection, or undefined if empty */
    bbox(): Bbox | undefined
    {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        this._shapes.forEach(shape =>
        {
            const bb = shape instanceof Mesh ? shape.bbox() : (shape as Curve).bbox();
            if (!bb) return;
            const mn = bb.min(), mx = bb.max();
            if (mn.x < minX) minX = mn.x;  if (mx.x > maxX) maxX = mx.x;
            if (mn.y < minY) minY = mn.y;  if (mx.y > maxY) maxY = mx.y;
            if (mn.z < minZ) minZ = mn.z;  if (mx.z > maxZ) maxZ = mx.z;
        });
        if (!isFinite(minX)) return undefined;
        return new Bbox([minX, minY, minZ], [maxX, maxY, maxZ]);
    }

    /** Move the collection so its bbox center lands at the given point */
    moveTo(...args: any[]): this
    {
        const target = Point.from(args);

        const bb = this.bbox();
        if (!bb) return this;
        const c = bb.center();
        const t = Point.from(target);
        return this.translate(t.x - c.x, t.y - c.y, t.z - c.z);
    }

    moveToX(x: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(x - bb.center().x, 0, 0) : this;
    }

    moveToY(y: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(0, y - bb.center().y, 0) : this;
    }

    moveToZ(z: number): this
    {
        const bb = this.bbox();
        return bb ? this.translate(0, 0, z - bb.center().z) : this;
    }

    rotateX(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'x', origin); }
    rotateY(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'y', origin); }
    rotateZ(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'z', origin); }

    rotate(angleDeg: number, axis: Axis = 'z', origin: PointLike = {x:0,y:0,z:0}): this
    {
        this._shapes.forEach(
            shape => shape.rotate(angleDeg, axis, origin));
        return this;
    }

    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = {x:0,y:0,z:0}): this
    {
        this._shapes.forEach(
            shape => shape.rotateAround(angleDeg, axis, pivot));
        return this;
    }

    rotateQuaternion(wOrObj: number | {w: number, x: number, y: number, z: number}, x?: number, y?: number, z?: number): this
    {
        this.forEach(shape => shape.rotateQuaternion(wOrObj as any, x as any, y as any, z as any));
        return this;
    }

    scale(factor: number|PointLike, origin: PointLike = {x:0,y:0,z:0}): this
    {
        this._shapes.forEach(
            shape => shape.scale(factor, origin));
        return this;
    }

    mirror(dir:Axis|PointLike, pos?:PointLike): this
    {
        this._shapes.forEach(
            shape => shape.mirror(dir, pos));
        return this;
    }

    /** Shortcut for `style.color` on every shape. Sets both fill and stroke color. */
    color(c: string | [number, number, number]): this
    {
        this._shapes.forEach(shape => shape.color(c as any));
        return this;
    }

    /** Shortcut for `style.opacity` on every shape. Value between 0 (transparent) and 1 (opaque). */
    opacity(opacity: number): this
    {
        this._shapes.forEach(shape => shape.opacity(opacity));
        return this;
    }

    /** Alias for `opacity()`. */
    alpha(a: number): this { return this.opacity(a); }

    /** Merge all Meshes in this collection into a single Mesh by concatenating
    *  their polygon arrays */
    merge(): Mesh
    {
        const allPolygons: PolygonJs[] = this._shapes
            .filter(shape => shape instanceof Mesh)
            .flatMap(shape =>
            {
                const inner = (shape as Mesh).inner();
                return inner ? inner.polygons() : [];
            });
        if (allPolygons.length === 0)
        {
            console.error(`Collection::merge(): No meshes to merge. Returning empty mesh.`);
            return new Mesh();
        }
        return Mesh.from(MeshJs.fromPolygons(allPolygons, {}));
    }

    //// BOOLEAN OPERATIONS ////

    /** Union all shapes into one shape or collection 
     *  NOTE: For now only Meshes can be unioned
    */
    union(other?: Mesh|Collection): Mesh
    {
        // We can only union meshes for now, so we filter out curves and other non-mesh shapes
        const meshesToUnion = this.meshes().toArray();

        if(other instanceof Mesh)
        {
            meshesToUnion.push(other);
        }
        else if(other instanceof Collection)
        {
            meshesToUnion.push(...other.meshes().toArray());
        }
        else if(other !== undefined)
        {
            console.warn(`Collection::union(): Invalid argument. Only Mesh or Collection instances are allowed. Ignoring:`, other);
        }

        if(meshesToUnion.length === 0)
        {
            console.warn(`Collection::union(): No meshes to union. Returning empty mesh.`);
            return new Mesh();
        }

        // Perform union operation on all meshes
        return meshesToUnion.slice(1).reduce((acc, mesh) => acc.union(mesh), meshesToUnion[0]);
    }

    /** Subtract all meshes in the other collection from this collection */
    subtract(other: Mesh|Collection): this
    {
        const otherMeshes = (other instanceof Collection) 
            ? other.meshes() 
            : (other instanceof Mesh)
                ? [other]
                : [];

        if(otherMeshes.length === 0)
        {
            console.warn(`MeshCollection::subtract(): No valid meshes to subtract. Returning original collection.`);
            return this;
        }

        this.forEach( shape =>
        {
            if (!(shape instanceof Mesh)) return;
            otherMeshes.forEach(otherMesh =>
            {
                (shape as Mesh).subtract(otherMesh);
            });
        });

        return this;
    }

    //// EDGE PROJECTION AND SECTIONING ////

    /** Isometric projection with hidden lines
     *  
     * @param cam normalizaed 3D position of the camera (default: [-1,-1,1], a common isometric view direction) 
     * @param includeHidden Whether to include hidden edges (default: true)
     * @return CurveColection with groups 'visible' and 'hidden' for the respective edges
     *   use isometryResult.group('visible') and isometryResult.group('hidden') to access each separately
     */
    isometry(cam:PointLike = [-1,-1,1], includeHidden:boolean=true):CurveCollection
    {
        // Just simple merge all meshes and project the resulting mesh.
        const mergedMesh = this.merge();
        return mergedMesh.isometry(cam, includeHidden);
    }


    //// EXPORT ////

    toSVG(): string|null
    {
        if(this.meshes().length === 0)
        {
            console.warn(`Collection::toSVG(): Exporting a (mixed) collection with ${this.meshes().length} meshes and ${this.curves().length} curves. Only curves will be exported to SVG.`);
        }

        return this.curves().toSVG();

    }

    /** Export the entire collection to a single GLTF file (JSON) or GLB binary using gltf-transform.
     *  Each Mesh becomes a TRIANGLES node; each Curve becomes a LINE_STRIP node.
     *
     *  @param binary  true → GLB (Uint8Array), false → GLTF JSON string
     *  @param up      Source up-axis ('z' default, 'y', 'x'). Remapped to GLTF Y-up.
     */
    private async _toGLTF(binary: boolean, up: Axis = 'z'): Promise<string | Uint8Array>
    {
        const doc = new Document();
        const scene = doc.createScene('scene');

        this._shapes.forEach((shape, i) =>
        {
            if (shape instanceof Mesh)
            {
                if (!shape._mesh || shape.vertices().length === 0) return;
                const node = shape._buildGLTFNode(doc, up, `mesh_${i}`);
                scene.addChild(node);
            }
            else if (shape instanceof Curve)
            {
                const node = shape._buildGLTFNode(doc, up, `curve_${i}`);
                scene.addChild(node);

                if (shape.hasHoles())
                {
                    shape.holes().forEach((holeCurve, h) =>
                    {
                        const holeNode = holeCurve._buildGLTFNode(doc, up, `curve_${i}_hole_${h}`);
                        scene.addChild(holeNode);
                    });
                }
            }
        });

        if (scene.listChildren().length === 0)
        {
            console.warn('Collection::toGLTF(): No exportable shapes found.');
        }

        doc.getRoot().setDefaultScene(scene);
        const io = createNodeIO();
        return binary ? io.writeBinary(doc) : io.writeJSON(doc).then(GLTFJsonDocumentToString);
    }

    /** Export the collection to a GLTF JSON string.
     *  @param up Source up-axis ('z' default, 'y', 'x'). Remapped to GLTF Y-up.
     */
    async toGLTF(up: Axis = 'z'): Promise<string>
    {
        return this._toGLTF(false, up) as Promise<string>;
    }

    /** Export the collection to a GLB binary (Uint8Array).
     *  @param up Source up-axis ('z' default, 'y', 'x'). Remapped to GLTF Y-up.
     */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array>
    {
        return this._toGLTF(true, up) as Promise<Uint8Array>;
    }

    /** Output Shapes as an array */
    toArray(): Array<Mesh|Curve>
    {
        return this.shapes();
    }
}


//// TYPED COLLECTIONS ////

/** A Collection that only holds Mesh instances. */
export class MeshCollection extends Collection
{
    constructor(...args: Array<Mesh|Array<any>|Collection|MeshCollection>)
    {
        super(...(args as Array<Mesh|Array<any>|Collection>));
    }

    add(shapes: Mesh|MeshCollection|Array<Mesh>): Collection
    {
        if (!(shapes instanceof Mesh) && !(shapes instanceof MeshCollection) && !(Array.isArray(shapes) && shapes.every(s => s instanceof Mesh)))
        {
            console.error(`MeshCollection::add(): Only Mesh instances are allowed.`);
            return this;
        }
        return super.add(shapes as any);
    }

    /** Return a deep copy of this MeshCollection (all members are independently copied) */
    copy(): MeshCollection
    {
        return new MeshCollection(...(this._shapes as Array<Mesh>).map(m => m.copy() as Mesh));
    }

    /** Return a shallow copy of this MeshCollection (new container, same member references) */
    clone(): MeshCollection
    {
        return new MeshCollection(...this._shapes as Array<Mesh>);
    }

    /** Override to return a typed MeshCollection for the named group. */
    group(groupName: string): MeshCollection | undefined
    {
        const g = super.group(groupName);
        return g ? new MeshCollection(...g.meshes().toArray()) : undefined;
    }

    shapes(): Array<Mesh>  { return this._shapes as Array<Mesh>; }
    get(index: number): Mesh | undefined { return this._shapes[index] as Mesh | undefined; }
    at(index: number): Mesh | undefined { return this.get(index); }
    first(): Mesh
    {
        const m = this._shapes[0] as Mesh;
        if (!m) throw new Error('MeshCollection::first(): Collection is empty.');
        return m;
    }

    last(): Mesh 
    {
        const m = this._shapes[this._shapes.length - 1] as Mesh;
        if (!m) throw new Error('MeshCollection::last(): Collection is empty.');
        return m;
    }


    /** If single Mesh in the collection, return it. Otherwise, return collection. */
    checkSingle(): Mesh | this
    {
        if(this._shapes.length === 1){ return this.first();}
        return this;
    }

    forEach(callback: (shape: Mesh, index: number, array: Mesh[]) => void): this
    {
        (this._shapes as Array<Mesh>).forEach(callback);
        return this;
    }

    filter(callback: (shape: Mesh, index: number, array: Mesh[]) => boolean): MeshCollection
    {
        return new MeshCollection(...(this._shapes as Array<Mesh>).filter(callback));
    }

    /** Union all meshes into one */
    unionAll(): Mesh { return super.union(); }

    /** Create a MeshCollection from the Mesh members of a general Collection */
    static from(collection: Collection): MeshCollection
    {
        return new MeshCollection(collection.meshes());
    }

    // ── BVH Spatial Queries ────────────────────────────────────────────────

    /**
     * Find all pairs of meshes (one from `this`, one from `other`) that overlap.
     *
     * Performs a coarse axis-aligned-box check, then a precise BVH hit test.
     *
     * @returns Array of `[meshFromThis, meshFromOther]` overlap pairs.
     */
    hits(other: Mesh | MeshCollection): Array<[Mesh, Mesh]>
    {
        const aList = this.shapes();
        const bList = other instanceof Mesh ? [other] : other.shapes();
        return aList.flatMap(a =>
            bList.filter(b => a.hits(b)).map(b => [a, b] as [Mesh, Mesh])
        );
    }

    /**
     * Fire a ray against every mesh in this collection.
     *
     * When `all` is `true` (default) returns every mesh that is hit, each
     * with its closest-hit result, sorted by distance (nearest first).
     * When `all` is `false` returns only the single nearest-hit mesh entry,
     * or `null` if nothing is hit.
     *
     * @param origin    Ray origin `[x, y, z]`.
     * @param direction Ray direction (need not be normalised).
     * @param maxDist   Maximum ray length (default `Infinity`).
     * @param all       Return all hits (`true`, default) or only the first (`false`).
     */
    raycast(
        origin: [number, number, number],
        direction: [number, number, number],
        maxDist = Infinity,
        all = true,
    ): Array<{ mesh: Mesh; hit: RaycastHit }> | { mesh: Mesh; hit: RaycastHit } | null
    {
        const results = this.shapes()
            .map(mesh => ({ mesh, hit: mesh.raycast(origin, direction, maxDist, false) }))
            .filter((r): r is { mesh: Mesh; hit: RaycastHit } => r.hit !== null)
            .sort((a, b) => a.hit.distance - b.hit.distance);
        if (all) return results;
        return results[0] ?? null;
    }

    /**
     * Minimum separating distance between any mesh in this collection and
     * any mesh in `other` (or a single Mesh).
     *
     * Returns `0` if any meshes intersect, `Infinity` if either side is empty.
     */
    distanceTo(other: Mesh | MeshCollection): number
    {
        const aList = this.shapes();
        const bList = other instanceof Mesh ? [other] : other.shapes();
        return aList.reduce((minSoFar, a) =>
        {
            if (minSoFar === 0) return 0;
            return bList.reduce((m, b) =>
            {
                if (m === 0) return 0;
                return Math.min(m, a.distanceTo(b));
            }, minSoFar);
        }, Infinity);
    }

    /**
     * Find the closest pair of meshes between this collection and `other`.
     *
     * @returns `{ mesh1, mesh2, distance }` for the closest pair, or `null`
     *          if either collection is empty.
     */
    closestPair(other: MeshCollection): { mesh1: Mesh; mesh2: Mesh; distance: number } | null
    {
        const aList = this.shapes();
        const bList = other.shapes();
        if (aList.length === 0 || bList.length === 0) return null;
        return aList.flatMap(a => bList.map(b => ({ mesh1: a, mesh2: b, distance: a.distanceTo(b) })))
            .reduce((best, pair) => best === null || pair.distance < best.distance ? pair : best, null as { mesh1: Mesh; mesh2: Mesh; distance: number } | null);
    }

    // ── Edge Projection (HLR) ────────────────────────────────────────────────

    /**
     * Project the visible and hidden edges of every mesh in this collection
     * onto a plane, using all meshes in the collection as mutual occluders.
     *
     * The results from individual meshes are merged into a single
     * `EdgeProjectionResult`.
     *
     * @param options  View direction, projection plane, feature angle, samples.
     * @returns Merged `{ visible, hidden }` polyline arrays.
     */
    _projectEdges(options: ProjectEdgeOptions) // CurveCollection
    {
        // TODO
    }

    //// OUTPUTS ////

    /** Output Shapes as an array */
    toArray(): Array<Mesh>
    {
        return this._shapes as Array<Mesh>;
    }

}


/** A Collection that only holds Curve instances. */
export class CurveCollection extends Collection
{
    constructor(...args: Array<Curve|Array<any>|Collection|CurveCollection>)
    {
        super(...args);
    }

    /** Create a CurveCollection from from array of Curves or the curves of a Collection */
    static from(...args: Array<Curve|Array<any>|Collection|CurveCollection>): CurveCollection
    {
        if(args.length === 1 && args[0] instanceof Collection)
        {
            return new CurveCollection(args[0].curves());
        }
        else if(Array.isArray(args[0]) && args[0].every(c => c instanceof Curve))
        {
            return new CurveCollection(...args[0]);
        }
        else if(args.every(c => c instanceof Curve || c instanceof Collection)) // also allow multiple Curve or Collection arguments, which are flattened
        {
            return new CurveCollection(...args.flatMap(arg => arg instanceof Collection ? arg.curves().toArray() as Curve[] : (arg instanceof Curve ? [arg] : [])));
        }
        else
        {
            throw new Error(`CurveCollection.from(): Invalid input: "${args.map(a => a.toString()).join(', ')}". Please provide a Collection or an array of Curves.`);
        }
    }

    update(shapes: Array<Curve|Mesh>|Collection|MeshCollection|CurveCollection): void
    {
        if(!Array.isArray(shapes) && !Collection.isCollection(shapes) 
                && !(shapes as any instanceof MeshCollection) && !(shapes as any instanceof CurveCollection))
        {
            console.error(`CurveCollection::update(): Invalid input. Please provide an array of Curves or a Collection.`);
            return;
        }
        // Filter out any non-Curve shapes from the input
        const curves = Collection.isCollection(shapes) 
            ? shapes.curves() 
            : (Array.isArray(shapes) ? shapes.filter(s => s instanceof Curve) : []);   

        if(shapes.length !== curves.length)
        {
            console.warn(`CurveCollection::update(): ${shapes.length - curves.length} provided shapes were not Curves and have been ignored.`);
        }

        super.update(curves);
    }

    /** Return a deep copy of this CurveCollection (all members are independently copied) */
    copy(): CurveCollection
    {
        return new CurveCollection(...(this._shapes as Array<Curve>).map(c => c.copy()));
    }

    /** Return a shallow copy of this CurveCollection (new container, same member references) */
    clone(): CurveCollection
    {
        return new CurveCollection(...this._shapes as Array<Curve>);
    }

    /** Add Curves or CurveCollections to this collection. Mutates this collection in place.
     *  @returns this CurveCollection (for chaining)
     */
    add(shapes: Curve|CurveCollection): CurveCollection
    {
        if (!(shapes instanceof Curve) && !(shapes instanceof CurveCollection))
        {
            console.error(`CurveCollection::add(): Only Curve(Collection) instances are allowed.`);
            return this;
        }
        return super.add(shapes) as CurveCollection;
    }

    /** Alias for add (like an Array) */
    push(shapes:Curve|CurveCollection): void
    {
        this.add(shapes);
    }

    /** Override to return a typed CurveCollection for the named group. */
    group(groupName: string): CurveCollection | undefined
    {
        const g = super.group(groupName);
        return g ? new CurveCollection(...g.curves().toArray()) : undefined;
    }

    shapes(): Array<Curve>  { return this._shapes as Array<Curve>; }
    get(index: number): Curve | undefined { return this._shapes[index] as Curve | undefined; }
    at(index: number): Curve | undefined { return this.get(index); }
    first(): Curve
    {
        const c = this._shapes[0] as Curve;
        if (!c) throw new Error('CurveCollection::first(): Collection is empty.');
        return c;
    }
    last(): Curve
    {
        const c = this._shapes[this._shapes.length - 1] as Curve;
        if (!c) throw new Error('CurveCollection::last(): Collection is empty.');
        return c;
    }

    /** If single Curve in the collection, return it. Otherwise, return collection. */
    checkSingle(): Curve | this
    {
        if(this._shapes.length === 1){ return this.first();}
        return this;
    }

    forEach(callback: (shape: Curve, index: number, array: Curve[]) => void): this
    {
        this.shapes().forEach(callback);
        return this;
    }

    filter(callback: (shape: Curve, index: number, array: Curve[]) => boolean): CurveCollection
    {
        return new CurveCollection(...this.shapes().filter(callback));
    }

    /** Replicate this CurveCollection a given number of times, applying a transform to each copy */
    replicate(num: number, transform: (collection: CurveCollection, index: number, prev: CurveCollection | undefined) => CurveCollection): CurveCollection
    {
        const { curves } = Array.from({ length: num }, (_, i) => i).reduce<{ curves: Curve[]; prev: CurveCollection | undefined }>(
            ({ curves, prev }, i) =>
            {
                const transformed = transform(this.copy(), i, prev);
                return { curves: [...curves, ...transformed.curves().toArray()], prev: transformed };
            },
            { curves: [], prev: undefined }
        );
        return new CurveCollection(...curves);
    }

    /** Boolean-union all curves sequentially, returning the result curves */
    unionAll(): Array<Curve> | null
    {
        const curves = super.curves();
        if (curves.length === 0) return null;
        return curves.toArray().slice(1).reduce<Array<Curve>>(
            (acc, curve) =>
            {
                const next = acc[0]?.union(curve) as Array<Curve> | null;
                return next ?? acc;
            },
            [curves.get(0)!]
        );
    }

    /** Offset every curve in this collection by `distance`.
     *  Curves for which offset returns null are silently dropped.
     *  @returns a new CurveCollection with the offset results.
     */
    offset(distance: number, cornerType: 'sharp'|'round'|'smooth' = 'sharp'): CurveCollection
    {
        return new CurveCollection(
            ...(this._shapes as Curve[])
                .map(curve => curve.offset(distance, cornerType))
                .filter((r): r is Curve => r !== null && r !== undefined)
        );
    }

    /** Set stroke dash pattern on every curve in this collection. Defaults to [2, 2]. */
    dashed(dash: number[] = [2, 2]): this
    {
        (this._shapes as Curve[]).forEach(curve => curve.dashed(dash));
        return this;
    }

    //// COMBINED CURVE OPERATIONS ////

    /** 
     *  Combine all Curves into the minimal set of curves:
     *   - Consecutive collinear degree-1 segments are merged into single polylines
     *   - All remaining connected segments become CompoundCurves
     *   - Disconnected groups stay as separate curves
     * 
     *  // TODO: avoid combining curves that are the same
     */
    combine(): CurveCollection
    {
        const curves = this.curves();
        if(curves.length <= 1) return this;

        const chains = this._buildChains(curves.map(c => [c]) as Curve[][]); // start with each curve as its own chain
        const combined = chains.map(chain => this._chainToCurve(chain));
        this.update(new CurveCollection(...combined));
        // Try to combine Compound curves with line segments
        // this.curves().forEach(curve => curve.mergeColinearLines()); 

        return this;
    }

    /** Connect Curves in this collection by endpoints */
    connect(): CurveCollection
    {
        // First make sure already connected are merged
        this.combine();

        // Create a convenient list of endpoints with references to their curves
        const endpoints = this.curves().toArray().flatMap(curve =>
        {
            // NOTE: references need to be consistent (don't call start()/end() 
            const start = curve.start();
            const end = curve.end();
            return [ 
                { point: start, otherPoint: end, curve: curve }, 
                { point: end, otherPoint: start, curve: curve }
            ] as Array<{ point: Point, otherPoint: Point, curve: Curve }|null>;
        });

        const connectingLines: Array<Curve> = [];

        endpoints.forEach((curEndPoint, p) => 
        {   
            if(curEndPoint === null) return; // already connected

            const closest = { 
                endpoint: null, 
                dist: Infinity,
                index: undefined as number | undefined,
            } as { endpoint: { point: Point, curve: Curve } | null, dist: number, index: number | undefined };

            endpoints.forEach((ep, idx) => 
            {
                if(ep === null) return; // already connected

                if(curEndPoint.point !== ep.point && curEndPoint.otherPoint !== ep.point) // don't connect curve to itself
                {
                    const d1 = curEndPoint.point.distance(ep.point);
                    const d2 = curEndPoint.otherPoint.distance(ep.point); 
                    
                    if(d1 < closest.dist && d1 !== 0 && d1 < d2) 
                    // never connect to another point, if that's closer 
                    // to the other endpoint of the same curve (prevents loops)
                    {
                        // TODO: add tolerance threshold?
                        closest.dist = d1;
                        closest.endpoint = ep;
                        closest.index = idx;
                    }   
                }
            });
            // now we found closest endpoint, we connect them with a line
            if(closest.endpoint)
            {
                connectingLines.push(Curve.Line(curEndPoint.point, closest.endpoint.point));
                // make endpoints null that we just connected
                if(closest.index !== undefined)
                {
                    endpoints[p] = null; // curPoint
                    endpoints[closest.index] = null; // connect to closest endpoint   
                }
            }

        });

        console.info(`Connecting ${connectingLines.length} pairs of endpoints with lines.`);
        
        // add connecting lines to new collection
        const connCol = new CurveCollection(
                            ...this.curves().toArray(), 
                            ...connectingLines
                        ).combine(); // combine again to merge connected lines into curves
        this.update(connCol);
        return this;
    }

    /**
     *  Group curves into ordered end-to-start connected chains.
     *  Tries both orientations of each candidate.
     *  @param tolerance - distance threshold for considering endpoints as connected (default 1e-3)
     *  
     *  TODO: automatically fill gaps with line segments
     */
    private _buildChains(chains: Array<Array<Curve>>, tolerance: number = 1e-3): Array<Array<Curve>>
    {
        const startNumChains = chains.length;
        let newChains = [] as Array<Array<Curve>>;  

        chains.forEach((curChain, i) => 
        {
            if(curChain.length) // only go into it if still unattached
            {
                if(i === 0) newChains.push(curChain);
                chains[i] = []; // clear original chain to mark as processed

                const curChainStartPoint = curChain[0].start();
                const curChainEndPoint = curChain.at(-1)!.end();

                chains.forEach((otherChain, j) => 
                {
                    if(otherChain.length === 0 || otherChain === curChain) return; // skip empty or same chain

                    const otherChainStartPoint = otherChain[0].start();
                    const otherChainEndPoint = otherChain.at(-1)!.end();

                    chains[j] = []; // mark other chain as processed

                    // chains connect start to start - prepend to current chain in reverse
                    if(curChainStartPoint.distance(otherChainStartPoint) <= tolerance)
                    {
                        newChains[i]?.unshift(...(otherChain.map(curve => curve.reverse()).reverse()));
                    }
                    // start to end - prepend to current chain as-is
                    else if(curChainStartPoint.distance(otherChainEndPoint) <= tolerance)
                    {
                        newChains[i]?.unshift(...otherChain);
                    }
                    // end to start - append to current chain as-is
                    else if(curChainEndPoint.distance(otherChainStartPoint) <= tolerance)
                    {
                        newChains[i]?.push(...otherChain);
                    }   
                    // end to end - append to current chain in reverse
                    else if(curChainEndPoint.distance(otherChainEndPoint) <= tolerance)
                    {
                        newChains[i]?.push(...(otherChain.map(curve => curve.reverse()).reverse()));
                    }
                    else
                    {
                        // no connection: start new chain
                        newChains.push(otherChain);
                    }
                });
            }
        });
        // recursively process 
        if(newChains.length < startNumChains)
        {   
            // ...existing code...
            newChains = this._buildChains(newChains, tolerance);
        }
        return newChains;
    }

    /**
     *  Convert a connected chain into the simplest representation:
     *   - Single curve          → as-is
     *   - All collinear degree-1 → single Polyline
     *   - Mixed types           → CompoundCurve
     */
    private _chainToCurve(chain: Array<Curve>): Curve
    {
        if(chain.length === 1) return chain[0];

        const merged = this._mergeCollinearSegments(chain);
        if(merged.length === 1) return merged[0];

        return Curve.Compound(merged);
    }

    /**
     *  Walk a chain and merge consecutive collinear degree-1 segments
     *  into single polylines.  Non-linear curves pass through as-is.
     *
     *  Collinearity test:  |cross(dirA, dirB)| < tolerance
     */
    private _mergeCollinearSegments(chain: Array<Curve>): Array<Curve>
    {
        const TOLERANCE = 1e-6;
        const result: Array<Curve> = [];
        let run: Array<Point> = [];  // accumulated polyline points

        const flushRun = () =>
        {
            if(run.length >= 2)
            {
                result.push(Curve.Polyline(run));
            }
            run = [];
        };

        chain.forEach(curve =>
        {
            if(!curve.isCompound() && curve.degree() === 1)
            {
                // Get all control points — handles polylines with 3+ vertices
                const cps = curve.controlPoints();
                // Process each consecutive pair of control points as a sub-segment
                cps.slice(0, -1).forEach((segStart, k) =>
                {
                    const segEnd   = cps[k + 1];
                    const dx = segEnd.x - segStart.x;
                    const dy = segEnd.y - segStart.y;
                    const dz = segEnd.z - segStart.z;
                    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    if(len < TOLERANCE) return;  // skip zero-length
                    const segDir = new Vector(dx/len, dy/len, dz/len);

                    if(run.length === 0)
                    {
                        // Start a new run
                        run.push(segStart, segEnd);
                    }
                    else
                    {
                        // Check collinearity against last segment direction
                        const prev = run.at(-2)!;
                        const last = run.at(-1)!;
                        const px = last.x - prev.x;
                        const py = last.y - prev.y;
                        const pz = last.z - prev.z;
                        const plen = Math.sqrt(px*px + py*py + pz*pz);
                        const prevDir = plen > TOLERANCE
                            ? new Vector(px/plen, py/plen, pz/plen)
                            : segDir;

                        const cross = prevDir.cross(segDir);
                        if(cross.length() < TOLERANCE)
                        {
                            // Collinear — extend the run (shared endpoint already present)
                            run.push(segEnd);
                        }
                        else
                        {
                            // Direction change — flush and start new
                            flushRun();
                            run.push(segStart, segEnd);
                        }
                    }
                });
            }
            else
            {
                // Non-linear or compound curve — flush any pending polyline run
                flushRun();
                result.push(curve);
            }
        });
        flushRun();
        return result;
    }

    //// OUTPUTS ////

    /**
     * Export all curves in this collection as a single SVG string.
     * Each curve becomes a separate `<path>` element. The viewBox is the union
     * of all individual curve bounds.
     */
    toSVG(plane: BasePlane = 'xy'): string
    {
        const curves = this.curves();
        if (curves.length === 0)
        {
            console.warn('CurveCollection::toSVG(): No curves to export. Returned null');
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 20">
                            <text x="4" y="15" font-size="12" fill="red">CurveCollection::toSVG() — no curves</text></svg>`;
        }

        const paths: string[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        curves.forEach(curve =>
        {
            const svg = curve.toSVG(plane);
            const innerMatch = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
            const vbMatch = svg.match(/viewBox="([^"]*)"/)
            if (!innerMatch?.[1]) return;
            paths.push(innerMatch[1]);
            if (vbMatch)
            {
                const [vx, vy, vw, vh] = vbMatch[1].split(' ').map(Number);
                if (vx < minX) minX = vx;
                if (vy < minY) minY = vy;
                if (vx + vw > maxX) maxX = vx + vw;
                if (vy + vh > maxY) maxY = vy + vh;
            }
        });

        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
        const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${paths.join('')}</svg>`;
    }

    toArray(): Array<Curve>
    {
        return this._shapes as Array<Curve>;
    }

    toMesh(): MeshCollection
    {
        const meshes = this.curves().toArray()
                .map(curve => curve.toMesh())
                .filter(mesh => mesh?.validate()) as Mesh[]; // filter out empty meshes
        return new MeshCollection(...meshes);
    }
}
