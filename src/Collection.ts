/**
 *  Collection.ts
 *      a collection of multiple Mesh or Curve instances
 *      Provides methods to manage, order and query the collection
 *      
 */

import type { Axis } from "./types";

import { Mesh } from "./Mesh";
import { Curve } from "./Curve";
import { toBase64, fromBase64 } from "./utils";

export class Collection
{
    private _shapes = new Array<Mesh|Curve>();

    constructor(...args: Array<Mesh|Curve>)
    {
        args.forEach(arg => {
            if(arg instanceof Mesh || arg instanceof Curve)
            {
                this._shapes.push(arg);
            }
            else
            {
                console.warn(`Collection::constructor(): Invalid argument. Only Mesh or Curve instances are allowed. Skipping:`, arg);
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
        return this._shapes[index] as Mesh | undefined;
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

    length(): number
    {
        return this._shapes.length;
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