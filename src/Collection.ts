/**
 *  Collection.ts
 *      a collection of multiple Mesh or Curve instances
 *      Provides methods to manage, order and query the collection
 *      
 */

import type { Axis, PointLike } from "./types";

import { Mesh } from "./Mesh";
import { Curve } from "./Curve";
import { Point } from "./Point";
import { Vector } from "./Vector";

import { toBase64, fromBase64 } from "./utils";

// ── Projection types (defined here to avoid circular imports via types.ts) ────

/** Plane specification for projection and section operations. */
export interface PlaneSpec {
  origin: [number, number, number];
  normal: [number, number, number];
}

/** Options for `Mesh.projectEdges` / `MeshCollection.projectEdges`. */
export interface ProjectionOptions {
  viewDirection: [number, number, number];
  plane: PlaneSpec;
  /** Minimum crease angle in degrees. @default 15 */
  featureAngle?: number;
  /** HLR ray samples per edge. @default 8 */
  samples?: number;
}

/** Options for `Mesh.projectSection` / `MeshCollection.projectSection`. */
export interface SectionOptions extends ProjectionOptions {
  sectionPlane: PlaneSpec;
}

/** Result of an edge projection with hidden-line removal. */
export interface EdgeProjectionResult {
  /** Curves visible from the view direction. */
  visible: CurveCollection;
  /** Occluded curves. */
  hidden: CurveCollection;
}

/** Combined section + edge-projection result. */
export interface SectionElevationResult extends EdgeProjectionResult {
  cut: import('./Sketch').Sketch;
}
import { ANGLE_COMPARE_TOLERANCE } from "./constants";

export class Collection
{
    _shapes = new Array<Mesh|Curve>();

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
    add(shapes: Mesh|Curve|Collection|CurveCollection|MeshCollection|Array<Mesh|Curve>): void
    {
        if(!(shapes instanceof Mesh) && !(shapes instanceof Curve) 
                && !(Collection.isCollection(shapes)) 
                && !(Array.isArray(shapes) && shapes.every(s => s instanceof Mesh || s instanceof Curve)))
        {
            console.error(`Collection::add(): Invalid shape(s). Supply something [<Mesh>|<Curve>|<Collection>|<CurveCollection>|<MeshCollection>|Array<Mesh|Curve>]. Skipping it!:`, shapes);
            return;
        }
        
        if (shapes instanceof Mesh || shapes instanceof Curve)
        {
            this._shapes.push(shapes);
        }
        else
        {
            this._shapes.push(
                ...(Collection.isCollection(shapes) ? shapes.toArray() : shapes as Array<Mesh|Curve>)
            );
        }

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

    remove(shape: Mesh|Curve): void
    {
        this._shapes = this._shapes.filter(s => s !== shape);
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

    meshes(): Array<Mesh>
    {
        return this._shapes.filter(shape => shape instanceof Mesh) as Array<Mesh>;
    }

    curves(): Array<Curve>
    {
        return this._shapes.filter(shape => shape instanceof Curve) as Array<Curve>;
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

    rotate(angleDeg: number, axis: Axis = 'z', origin: PointLike = {x:0,y:0,z:0}): this
    {
        this._shapes.forEach(
            shape => shape.rotate(angleDeg, axis, origin));
        return this;
    }

    scale(factor: number, origin: PointLike = {x:0,y:0,z:0}): this
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

    /** Reorient all shapes in the collection from their current plane onto the plane defined by `normal` and `offset` */
    reorient(normal: PointLike, offset: PointLike = [0,0,0]): this
    {
        this.curves()
            .forEach((shape,i) => {
                return shape.reorient(normal, offset)
            });
        return this;
    }

    //// BOOLEAN OPERATIONS ////

    /** Union all shapes into one shape or collection 
     *  NOTE: For now only Meshes can be unioned
    */
    union(other?: Mesh|Collection): Mesh
    {
        // We can only union meshes for now, so we filter out curves and other non-mesh shapes
        const meshesToUnion = this.meshes();

        if(other instanceof Mesh)
        {
            meshesToUnion.push(other);
        }
        else if(other instanceof Collection)
        {
            meshesToUnion.push(...other.meshes());
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

                gltfMeshes.push({
                    name: `mesh_${i}`,
                    primitives: [{ attributes: { POSITION: posAcc, NORMAL: normAcc }, indices: idxAcc, mode: 4 }]
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

                gltfMeshes.push({
                    name: `curve_${i}`,
                    primitives: [{ attributes: { POSITION: posAcc }, mode: 3 }] // LINE_STRIP
                });
                gltfNodes.push({ mesh: gltfMeshes.length - 1, name: `curve_${i}` });

                // Also export interior hole curves as separate line strips
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
                            primitives: [{ attributes: { POSITION: holeAcc }, mode: 3 }]
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

        const gltf = {
            asset: { version: "2.0" },
            scene: 0,
            scenes: [{ nodes: gltfNodes.map((_, idx) => idx) }],
            nodes: gltfNodes,
            meshes: gltfMeshes,
            accessors: gltfAccessors,
            bufferViews: gltfBufferViews,
            buffers: [{ byteLength: totalByteLength, uri: `data:application/octet-stream;base64,${toBase64(combined)}` }]
        };

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
        super(args);
    }

    add(shape: Mesh|MeshCollection|Array<Mesh>): void
    {
        if (!(shape instanceof Mesh) && !(shape instanceof MeshCollection) && !(Array.isArray(shape) && shape.every(s => s instanceof Mesh)))
        {
            console.error(`MeshCollection::add(): Only Mesh instances are allowed.`);
            return;
        }
        super.add(shape);
    }

    /** Return a deep copy of this MeshCollection (all members are independently copied) */
    copy(): MeshCollection
    {
        return new MeshCollection(...super.meshes().map(m => m.copy() as Mesh));
    }

    /** Return a shallow copy of this MeshCollection (new container, same member references) */
    clone(): MeshCollection
    {
        return new MeshCollection(...super.meshes());
    }

    shapes(): Array<Mesh>  { return super.meshes(); }
    get(index: number): Mesh | undefined { return super.meshes()[index]; }
    at(index: number): Mesh | undefined { return this.get(index); }
    first(): Mesh
    {
        const m = super.meshes()[0];
        if (!m) throw new Error('MeshCollection::first(): Collection is empty.');
        return m;
    }

    last(): Mesh 
    {
        return super.meshes()[super.meshes().length - 1];
    }


    /** If single Mesh in the collection, return it. Otherwise, return collection. */
    checkSingle(): Mesh | this
    {
        if(this.meshes().length === 1){ return this.meshes()[0];}
        return this;
    }

    forEach(callback: (shape: Mesh, index: number, array: Mesh[]) => void): void
    {
        super.meshes().forEach(callback);
    }

    filter(callback: (shape: Mesh, index: number, array: Mesh[]) => boolean): MeshCollection
    {
        return new MeshCollection(...super.meshes().filter(callback));
    }

    /** Union all meshes into one */
    unionAll(): Mesh { return super.union(); }

    /** Create a MeshCollection from the Mesh members of a general Collection */
    static from(collection: Collection): MeshCollection
    {
        return new MeshCollection(...collection.meshes());
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
    projectEdges(options: ProjectionOptions): EdgeProjectionResult {
        const meshes = this.shapes();
        const merged: EdgeProjectionResult = { visible: new CurveCollection(), hidden: new CurveCollection() };
        for (const mesh of meshes) {
            const other = meshes.filter(m => m !== mesh);
            const r = mesh.projectEdges(options, other);
            r.visible.curves().forEach(c => merged.visible.add(c));
            r.hidden.curves().forEach(c => merged.hidden.add(c));
        }
        return merged;
    }

    /**
     * Slice each mesh at the section plane and project visible/hidden edges,
     * using all meshes in the collection as mutual occluders.
     *
     * @returns Merged `{ visible, hidden }` polylines and the per-mesh cut
     *          sketches in `cuts`.
     */
    projectSection(options: SectionOptions): EdgeProjectionResult & { cuts: any[] } {
        const meshes = this.shapes();
        const merged: EdgeProjectionResult & { cuts: any[] } = { visible: new CurveCollection(), hidden: new CurveCollection(), cuts: [] };
        for (const mesh of meshes) {
            const other = meshes.filter(m => m !== mesh);
            const r = mesh.projectSection(options, other);
            r.visible.curves().forEach(c => merged.visible.add(c));
            r.hidden.curves().forEach(c => merged.hidden.add(c));
            if (r.cutJs) merged.cuts.push(r.cutJs);
        }
        return merged;
    }
}


/** A Collection that only holds Curve instances. */
export class CurveCollection extends Collection
{
    constructor(...args: Array<Curve|Array<any>|Collection|CurveCollection>)
    {
        super(args);
    }

    /** Create a CurveCollection from from array of Curves or the curves of a Collection */
    static from(...args: Array<Curve|Array<any>|Collection|CurveCollection>): CurveCollection
    {
        if(args.length === 1 && args[0] instanceof Collection)
        {
            return new CurveCollection(...args[0].curves());
        }
        else if(Array.isArray(args[0]) && args[0].every(c => c instanceof Curve))
        {
            return new CurveCollection(...args[0]);
        }
        else if(args.every(c => c instanceof Curve || c instanceof Collection)) // also allow multiple Curve or Collection arguments, which are flattened
        {
            return new CurveCollection(...args.flatMap(arg => arg instanceof Collection ? arg.curves() : (arg instanceof Curve ? [arg] : [])));
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
        return new CurveCollection(...super.curves().map(c => c.copy()));
    }

    /** Return a shallow copy of this CurveCollection (new container, same member references) */
    clone(): CurveCollection
    {
        return new CurveCollection(...super.curves());
    }

    add(shapes: Curve|CurveCollection): void
    {
        if (!(shapes instanceof Curve) && !(shapes instanceof CurveCollection))
        {
            console.error(`CurveCollection::add(): Only Curve(Collection) instances are allowed.`);
            return;
        }
        
        super.add(shapes);
    }

    /** Alias for add (like an Array) */
    push(shapes:Curve|CurveCollection): void
    {
        this.add(shapes);
    }

    shapes(): Array<Curve>  { return super.curves(); }
    get(index: number): Curve | undefined { return super.curves()[index]; }
    at(index: number): Curve | undefined { return this.get(index); }
    first(): Curve
    {
        const c = super.curves()[0];
        if (!c) throw new Error('CurveCollection::first(): Collection is empty.');
        return c;
    }
    last(): Curve
    {
        const curves = super.curves();
        const c = curves[curves.length - 1];
        if (!c) throw new Error('CurveCollection::last(): Collection is empty.');
        return c;
    }

    /** If single Curve in the collection, return it. Otherwise, return collection. */
    checkSingle(): Curve | this
    {
        if(this.curves().length === 1){ return this.curves()[0];}
        return this;
    }

    forEach(callback: (shape: Curve, index: number, array: Curve[]) => void): CurveCollection
    {
        super.curves().forEach(callback);
        return this;
    }

    filter(callback: (shape: Curve, index: number, array: Curve[]) => boolean): CurveCollection
    {
        return new CurveCollection(...super.curves().filter(callback));
    }

    /** Boolean-union all curves sequentially, returning the result curves */
    unionAll(): Array<Curve> | null
    {
        const curves = super.curves();
        if (curves.length === 0) return null;
        let result: Array<Curve> = [curves[0]];
        for (let i = 1; i < curves.length; i++)
        {
            const next = result[0]?.union(curves[i]) as Array<Curve> | null;
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

        const chains = this._buildChains(curves.map(c => [c])); // start with each curve as its own chain
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
        const endpoints = this.curves().flatMap(curve => {
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
                            ...this.curves(), 
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

    toArray(): Array<Curve>
    {
        return this.curves();
    }

    toMesh(): MeshCollection
    {
        const meshes = this.curves()
                .map(curve => curve.toMesh())
                .filter(mesh => mesh?.validate()) as Mesh[]; // filter out empty meshes
        return new MeshCollection(...meshes);
    }
}


