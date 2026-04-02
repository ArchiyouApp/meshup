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
import { toBase64, fromBase64 } from "./utils";

export class Collection
{
    _shapes = new Array<Mesh|Curve>();
    // We can have multiple groups in a collection, each group is a named subset of shapes. Shapes can belong to multiple groups.
    _groups = new Map<string, Collection>(); 

    constructor(...args: Array<Mesh|Curve|Array<any>|Collection>)
    {
        args.forEach(arg => 
        {
            if(arg instanceof Mesh || arg instanceof Curve)
            {
                this._shapes.push(arg);
            }
            else if(arg instanceof Collection)
            {
                this._shapes.push(...arg.shapes());
            }
            else if(Array.isArray(arg))
            {
                this._shapes.push(...arg.flat());
            }
            else
            {
                console.warn(`Collection::constructor(): Given Shape is not a Mesh or Curve. Skipping it!:`, arg);
            }
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
            return new Collection(shapes);
        }
        else if (Array.isArray(shapes) || Collection.isCollection(shapes))
        {
            const addShapes = (Collection.isCollection(shapes) 
                                    ? shapes.toArray() : 
                                    shapes.filter(s => s instanceof Mesh || s instanceof Curve) as Array<Mesh|Curve>);
            this._shapes.push(...addShapes);
            return new Collection(addShapes);
        }
        else
        {
            console.error(`Collection::add(): Invalid shape(s). Supply something [<Mesh>|<Curve>|<Collection>|<CurveCollection>|<MeshCollection>|Array<Mesh|Curve>]. Skipping it!:`, shapes);
            return new Collection();
        }
    }

    /** Add Shape (Mesh or Curve) to Collection under a group 
     *  @returns the added shape(s) as a new Collection for chaining
    */
    addGroup(groupName: string, shapes: Mesh|Curve|Collection|CurveCollection|MeshCollection ): Collection
    {
        console.log('==== ADD GROUP ====', groupName, (shapes as Collection)?.length);
        const addedShapes = this.add(shapes);
        console.log(addedShapes.length);
        
        if(!this._groups.has(groupName))
        {
            this._groups.set(groupName, new Collection());
        }
        const group = this._groups.get(groupName);
        
        if(group)
        {
            group.add(addedShapes);
        }
        return addedShapes;
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
        if(!groupColl){ 
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
        for (const shape of this._shapes)
        {
            const bb = shape instanceof Mesh ? shape.bbox() : (shape as Curve).bbox();
            if (!bb) continue;
            const mn = bb.min(), mx = bb.max();
            if (mn.x < minX) minX = mn.x;  if (mx.x > maxX) maxX = mx.x;
            if (mn.y < minY) minY = mn.y;  if (mx.y > maxY) maxY = mx.y;
            if (mn.z < minZ) minZ = mn.z;  if (mx.z > maxZ) maxZ = mx.z;
        }
        if (!isFinite(minX)) return undefined;
        return new Bbox([minX, minY, minZ], [maxX, maxY, maxZ]);
    }

    /** Move the collection so its bbox center lands at the given point */
    moveTo(...args: any[]): this
    {
        const target = Point.from(args);
        console.log('MOVE TO ===')
        console.log(target);

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

    //// BOOLEAN OPERATIONS ////

    /** Merge all Meshes in this collection into a single Mesh by concatenating
     *  their polygon arrays.  No CSG boolean is performed — the result is just
     *  one mesh whose polygon list is the union of all input polygon lists.
     *  Curves are silently skipped.
     */
    merge(): Mesh
    {
        const allPolygons: PolygonJs[] = [];
        for (const shape of this._shapes) {
            if (shape instanceof Mesh) {
                const inner = shape.inner();
                if (inner) {
                    allPolygons.push(...inner.polygons());
                }
            }
        }
        if (allPolygons.length === 0)
        {
            console.error(`Collection::merge(): No meshes to merge. Returning empty mesh.`);
            return new Mesh();
        }
        return Mesh.from(MeshJs.fromPolygons(allPolygons, {}));
    }

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
        let resultMesh = meshesToUnion[0];
        for(let i = 1; i < meshesToUnion.length; i++)
        {
            resultMesh = resultMesh.union(meshesToUnion[i]);
        }
        return resultMesh;
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

        this.forEach( shape => {
            if (!(shape instanceof Mesh)) return;
            otherMeshes.forEach(otherMesh => {
                (shape as Mesh).subtract(otherMesh);
            });
        });

        return this;
    }



    //// EXPORT ////

    /** Export the entire collection to a single GLTF file.
     *  Each Mesh becomes a TRIANGLES node; each Curve becomes a LINE_STRIP node.
     *  All shapes share one binary buffer, with a separate buffer view per node.
     *
     *  @param up - Source up-axis ('z' default, 'y', 'x'). Remapped to GLTF Y-up.
     */
    toGLTF(up: Axis = 'z'): string
    {
        const chunks: Uint8Array[] = [];
        let byteOffset = 0;

        const gltfMeshes:      any[] = [];
        const gltfNodes:       any[] = [];
        const gltfAccessors:   any[] = [];
        const gltfBufferViews: any[] = [];
        const gltfMaterials:   any[] = [];

        /** Append a typed-array chunk, adding 4-byte padding if needed, return buffer-view index */
        const addChunk = (data: Uint8Array, target: number): number =>
        {
            const padding = byteOffset % 4 === 0 ? 0 : 4 - (byteOffset % 4);
            if (padding > 0) { chunks.push(new Uint8Array(padding)); byteOffset += padding; }
            const viewIdx = gltfBufferViews.length;
            gltfBufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target });
            chunks.push(data);
            byteOffset += data.byteLength;
            return viewIdx;
        };

        /** Append an accessor and return its index */
        const addAccessor = (viewIdx: number, componentType: number, count: number,
            type: string, min?: number[], max?: number[]): number =>
        {
            const idx = gltfAccessors.length;
            const acc: any = { bufferView: viewIdx, byteOffset: 0, componentType, count, type };
            if (min) acc.min = min;
            if (max) acc.max = max;
            gltfAccessors.push(acc);
            return idx;
        };

        /** Remap from source coordinate space to GLTF Y-up */
        const remap = (x: number, y: number, z: number): [number, number, number] =>
        {
            if (up === 'z') return [x,  z, -y];
            if (up === 'x') return [y,  x,  z];
            return [x, z,  y]; // already y-up
        };

        for (let i = 0; i < this._shapes.length; i++)
        {
            const shape = this._shapes[i];

            if (shape instanceof Mesh)
            {
                // Raw WASM buffers: positions/normals are Float64, indices are Uint32
                const posRaw  = shape._mesh?.positions() ?? new Float64Array(0);
                const normRaw = shape._mesh?.normals()   ?? new Float64Array(0);
                const idxRaw  = shape._mesh?.indices()   ?? new Uint32Array(0);

                const vertexCount = posRaw.length / 3;
                const indexCount  = idxRaw.length;
                if (vertexCount === 0) continue;

                // Convert positions: Float64 → Float32, remap axis, compute bbox
                const posF32 = new Float32Array(posRaw.length);
                const posMin = [Infinity,  Infinity,  Infinity];
                const posMax = [-Infinity, -Infinity, -Infinity];
                for (let v = 0; v < vertexCount; v++)
                {
                    const [rx, ry, rz] = remap(posRaw[v*3], posRaw[v*3+1], posRaw[v*3+2]);
                    posF32[v*3] = rx; posF32[v*3+1] = ry; posF32[v*3+2] = rz;
                    if (rx < posMin[0]) posMin[0] = rx;  if (rx > posMax[0]) posMax[0] = rx;
                    if (ry < posMin[1]) posMin[1] = ry;  if (ry > posMax[1]) posMax[1] = ry;
                    if (rz < posMin[2]) posMin[2] = rz;  if (rz > posMax[2]) posMax[2] = rz;
                }

                // Convert normals: Float64 → Float32, remap axis
                const normF32 = new Float32Array(normRaw.length);
                for (let v = 0; v < vertexCount; v++)
                {
                    const [rx, ry, rz] = remap(normRaw[v*3], normRaw[v*3+1], normRaw[v*3+2]);
                    normF32[v*3] = rx; normF32[v*3+1] = ry; normF32[v*3+2] = rz;
                }

                // Copy Uint32 indices into a fresh buffer (avoids WASM-memory aliasing)
                const idxCopy  = new Uint32Array(indexCount);
                idxCopy.set(idxRaw);

                const posView  = addChunk(new Uint8Array(posF32.buffer),   34962); // ARRAY_BUFFER
                const normView = addChunk(new Uint8Array(normF32.buffer),  34962);
                const idxView  = addChunk(new Uint8Array(idxCopy.buffer),  34963); // ELEMENT_ARRAY_BUFFER

                const posAcc  = addAccessor(posView,  5126, vertexCount, "VEC3",   posMin, posMax);
                const normAcc = addAccessor(normView, 5126, vertexCount, "VEC3");
                const idxAcc  = addAccessor(idxView,  5125, indexCount,  "SCALAR");

                const meshMatIdx = gltfMaterials.length;
                gltfMaterials.push(shape.style.toGltfMaterial(`mesh_${i}_material`, false));
                gltfMeshes.push({
                    name: `mesh_${i}`,
                    primitives: [{ attributes: { POSITION: posAcc, NORMAL: normAcc }, indices: idxAcc, mode: 4, material: meshMatIdx }]
                });
            }
            else if (shape instanceof Curve)
            {
                // toGLTFBuffer already gives us a Y-up-remapped Float32 buffer as base64
                const buf     = shape.toGLTFBuffer(up);
                if (buf.count < 2) continue;
                const bytes   = fromBase64(buf.data);
                const viewIdx = addChunk(bytes, 34962); // ARRAY_BUFFER

                const minArr = buf.min ? [buf.min.x, buf.min.y, buf.min.z] : undefined;
                const maxArr = buf.max ? [buf.max.x, buf.max.y, buf.max.z] : undefined;
                const posAcc = addAccessor(viewIdx, 5126, buf.count, "VEC3", minArr, maxArr);

                const curveMatIdx = gltfMaterials.length;
                gltfMaterials.push(shape.style.toGltfMaterial(`curve_${i}_material`, true));
                gltfMeshes.push({
                    name: `curve_${i}`,
                    primitives: [{ attributes: { POSITION: posAcc }, mode: 3, material: curveMatIdx }] // LINE_STRIP
                });
                gltfNodes.push({ mesh: gltfMeshes.length - 1, name: `curve_${i}` });

                // Also export interior hole curves as separate line strips (share parent material)
                if (shape.hasHoles())
                {
                    for (let h = 0; h < shape.holes().length; h++)
                    {
                        const holeCurve = shape.holes()[h];
                        const holeBuf = holeCurve.toGLTFBuffer(up);
                        if (holeBuf.count < 2) continue;
                        const holeBytes = fromBase64(holeBuf.data);
                        const holeViewIdx = addChunk(holeBytes, 34962);
                        const holeMinArr = holeBuf.min ? [holeBuf.min.x, holeBuf.min.y, holeBuf.min.z] : undefined;
                        const holeMaxArr = holeBuf.max ? [holeBuf.max.x, holeBuf.max.y, holeBuf.max.z] : undefined;
                        const holeAcc = addAccessor(holeViewIdx, 5126, holeBuf.count, "VEC3", holeMinArr, holeMaxArr);
                        gltfMeshes.push({
                            name: `curve_${i}_hole_${h}`,
                            primitives: [{ attributes: { POSITION: holeAcc }, mode: 3, material: curveMatIdx }]
                        });
                        gltfNodes.push({ mesh: gltfMeshes.length - 1, name: `curve_${i}_hole_${h}` });
                    }
                }

                continue; // skip the generic node push below
            }
            else
            {
                continue;
            }

            gltfNodes.push({ mesh: gltfMeshes.length - 1, name: `${shape instanceof Mesh ? 'mesh' : 'curve'}_${i}` });
        }

        if (gltfNodes.length === 0)
        {
            console.warn('Collection::toGLTF(): No exportable shapes found.');
        }

        // Pack all chunks into one binary buffer
        const totalByteLength = chunks.reduce((s, c) => s + c.byteLength, 0);
        const combined = new Uint8Array(totalByteLength);
        let pos = 0;
        for (const chunk of chunks) { combined.set(chunk, pos); pos += chunk.byteLength; }

        const gltf: Record<string, any> = {
            asset: { version: "2.0" },
            scene: 0,
            scenes: [{ nodes: gltfNodes.map((_, idx) => idx) }],
            nodes: gltfNodes,
            meshes: gltfMeshes,
            accessors: gltfAccessors,
            bufferViews: gltfBufferViews,
            buffers: [{ byteLength: totalByteLength, uri: `data:application/octet-stream;base64,${toBase64(combined)}` }]
        };
        if (gltfMaterials.length > 0) gltf.materials = gltfMaterials;

        return JSON.stringify(gltf);
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
    hits(other: Mesh | MeshCollection): Array<[Mesh, Mesh]> {
        const aList = this.shapes();
        const bList = other instanceof Mesh ? [other] : other.shapes();
        const pairs: Array<[Mesh, Mesh]> = [];
        for (const a of aList) {
            for (const b of bList) {
                if (a.hits(b)) pairs.push([a, b]);
            }
        }
        return pairs;
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
    ): Array<{ mesh: Mesh; hit: RaycastHit }> | { mesh: Mesh; hit: RaycastHit } | null {
        const results: Array<{ mesh: Mesh; hit: RaycastHit }> = [];
        for (const mesh of this.shapes()) {
            const hit = mesh.raycast(origin, direction, maxDist, false);
            if (hit) results.push({ mesh, hit });
        }
        results.sort((a, b) => a.hit.distance - b.hit.distance);
        if (all) return results;
        return results[0] ?? null;
    }

    /**
     * Minimum separating distance between any mesh in this collection and
     * any mesh in `other` (or a single Mesh).
     *
     * Returns `0` if any meshes intersect, `Infinity` if either side is empty.
     */
    distanceTo(other: Mesh | MeshCollection): number {
        const aList = this.shapes();
        const bList = other instanceof Mesh ? [other] : other.shapes();
        let min = Infinity;
        for (const a of aList) {
            for (const b of bList) {
                const d = a.distanceTo(b);
                if (d < min) min = d;
                if (min === 0) return 0;
            }
        }
        return min;
    }

    /**
     * Find the closest pair of meshes between this collection and `other`.
     *
     * @returns `{ mesh1, mesh2, distance }` for the closest pair, or `null`
     *          if either collection is empty.
     */
    closestPair(other: MeshCollection): { mesh1: Mesh; mesh2: Mesh; distance: number } | null {
        const aList = this.shapes();
        const bList = other.shapes();
        if (aList.length === 0 || bList.length === 0) return null;
        let best: { mesh1: Mesh; mesh2: Mesh; distance: number } | null = null;
        for (const a of aList) {
            for (const b of bList) {
                const d = a.distanceTo(b);
                if (best === null || d < best.distance) {
                    best = { mesh1: a, mesh2: b, distance: d };
                }
            }
        }
        return best;
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
        else {
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

    /** Add Curves or CurveCollections to this collection
     *  @returns a new CurveCollection with the added curves (does not modify original collection)
     */
    add(shapes: Curve|CurveCollection): CurveCollection
    {
        if (!(shapes instanceof Curve) && !(shapes instanceof CurveCollection))
        {
            console.error(`CurveCollection::add(): Only Curve(Collection) instances are allowed.`);
            return new CurveCollection();
        }   
        
        const addedCurves = super.add(shapes);
        return new CurveCollection(addedCurves);
    }

    /** Alias for add (like an Array) */
    push(shapes:Curve|CurveCollection): void
    {
        this.add(shapes);
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
        const results: Curve[] = [];
        let prev: CurveCollection | undefined;
        for (let i = 0; i < num; i++)
        {
            const copy = this.copy();
            const transformed = transform(copy, i, prev);
            results.push(...transformed.curves().toArray());
            prev = transformed;
        }
        return new CurveCollection(...results);
    }

    /** Boolean-union all curves sequentially, returning the result curves */
    unionAll(): Array<Curve> | null
    {
        const curves = super.curves();
        if (curves.length === 0) return null;
        let result: Array<Curve> = [curves.get(0)!];
        for (let i = 1; i < curves.length; i++)
        {
            const next = result[0]?.union(curves.get(i)!) as Array<Curve> | null;
            if (next) result = next;
        }
        return result;
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
        const endpoints = this.curves().toArray().flatMap(curve => {
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
                    else {
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

        const flushRun = () => {
            if(run.length >= 2)
            {
                result.push(Curve.Polyline(run));
            }
            run = [];
        };

        for(const curve of chain)
        {
            if(!curve.isCompound() && curve.degree() === 1)
            {
                // Get all control points — handles polylines with 3+ vertices
                const cps = curve.controlPoints();
                // Process each consecutive pair of control points as a sub-segment
                for(let k = 0; k < cps.length - 1; k++)
                {
                    const segStart = cps[k];
                    const segEnd   = cps[k + 1];
                    const dx = segEnd.x - segStart.x;
                    const dy = segEnd.y - segStart.y;
                    const dz = segEnd.z - segStart.z;
                    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    if(len < TOLERANCE) continue;  // skip zero-length
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
                }
            }
            else
            {
                // Non-linear or compound curve — flush any pending polyline run
                flushRun();
                result.push(curve);
            }
        }
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
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`;
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
