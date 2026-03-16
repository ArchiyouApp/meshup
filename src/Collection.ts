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

export class Collection
{
    private _shapes = new Array<Mesh|Curve>();

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

    add(shape: Mesh|Curve): void
    {
        if(!(shape instanceof Mesh) && !(shape instanceof Curve))
        {
            console.error(`Collection::add(): Invalid shape. Supply something [<Mesh>|<Curve>]`);
            return;
        }
        this._shapes.push(shape);
    }

    remove(shape: Mesh|Curve): void
    {
        this._shapes = this._shapes.filter(s => s !== shape);
    }

    get(index: number): Mesh | Curve | undefined
    {
        return this._shapes[index] as Mesh | Curve | undefined;
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

    forEach(callback: (shape: Mesh|Curve, index: number, array: (Mesh|Curve)[]) => void): void
    {
        this._shapes.forEach(callback);
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
}


//// TYPED COLLECTIONS ////

/** A Collection that only holds Mesh instances. */
export class MeshCollection extends Collection
{
    constructor(...args: Array<Mesh|Array<any>|Collection|MeshCollection>)
    {
        super(...args);
    }

    add(shape: Mesh | Curve): void
    {
        if (!(shape instanceof Mesh))
        {
            console.error(`MeshCollection::add(): Only Mesh instances are allowed.`);
            return;
        }
        super.add(shape);
    }

    shapes(): Array<Mesh>  { return super.meshes(); }
    get(index: number): Mesh | undefined { return super.meshes()[index]; }
    first(): Mesh|undefined
    {
        return super.meshes()[0];
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
}


/** A Collection that only holds Curve instances. */
export class CurveCollection extends Collection
{
    constructor(...args: Array<Curve|Array<any>|Collection|CurveCollection>)
    {
        super(...args);
    }

    add(shape: Mesh | Curve): void
    {
        if (!(shape instanceof Curve))
        {
            console.error(`CurveCollection::add(): Only Curve instances are allowed.`);
            return;
        }
        super.add(shape);
    }

    /** Alias for add (like an Array) */
    push(shape:Mesh|Curve): void
    {
        this.add(shape);
    }

    shapes(): Array<Curve>  { return super.curves(); }
    get(index: number): Curve | undefined { return super.curves()[index]; }
    first(): Curve|undefined
    {
        return super.curves()[0];
    }

    /** If single Curve in the collection, return it. Otherwise, return collection. */
    checkSingle(): Curve | this
    {
        if(this.curves().length === 1){ return this.curves()[0];}
        return this;
    }

    forEach(callback: (shape: Curve, index: number, array: Curve[]) => void): void
    {
        super.curves().forEach(callback);
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
        else if(args.every(c => c instanceof Curve))
        {
            return new CurveCollection(...args);
        }
        else {
            throw new Error('CurveCollection.from(): Invalid input. Please provide a Collection or an array of Curves.');
        }
    }

    //// COMBINED CURVE OPERATIONS ////

    /** 
     *  Combine all Curves into the minimal set of curves:
     *   - Consecutive collinear degree-1 segments are merged into single polylines
     *   - All remaining connected segments become CompoundCurves
     *   - Disconnected groups stay as separate curves
     */
    combine(): CurveCollection
    {
        const curves = this.curves();
        if(curves.length <= 1) return this;

        const chains = this._buildChains(curves.map(c => [c])); // start with each curve as its own chain
        const combined = chains.map(chain => this._chainToCurve(chain));
        return new CurveCollection(...combined);
    }

    /**
     *  Group curves into ordered end-to-start connected chains.
     *  Tries both orientations of each candidate.
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
            // newChains.forEach((c,i) => { console.log(i); c.forEach(curve => console.log(curve.points())); });
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
}