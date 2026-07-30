export function rad(degrees: number): number
{
   return degrees * Math.PI / 180;
}

export function deg(radians: number): number
{
  return radians * 180 / Math.PI;
}

/**
 * Remap a 3-D point/vector from the kernel's native Z-up space to the
 * requested output coordinate system (`up` = desired up-axis).
 *
 *   up='z'  (default) : identity — kernel Z-up output, no conversion
 *   up='y'            : [x,  z, -y]  — Z-up → standard GLTF Y-up
 *   up='x'            : [y,  x,  z]  — Z-up → X-up
 */
export function remapAxis(x: number, y: number, z: number, up: 'x' | 'y' | 'z' = 'z'): [number, number, number] {
    if (up === 'y') return [x,  z, -y];
    if (up === 'x') return [y,  x,  z];
    return [x, y,  z];
}

//// UUID ////

/** Byte → two lowercase hex chars, precomputed. */
const HEX_BYTE: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Buffer of random bytes, refilled in bulk and drained 16 at a time. */
const UUID_POOL = new Uint8Array(16 * 256);
let uuidPoolAt = UUID_POOL.length;

/** RFC 4122 version-4 UUID.
 *
 *  Draws from a bulk-filled entropy pool: the previous implementation called
 *  `crypto.getRandomValues` once **per character** (32 calls and 32 allocations per id), which
 *  is ~100x slower and showed up as seconds of overhead when building large scenes, since every
 *  `Shape` mints one on construction. */
export function uuid(): string
{
    if (uuidPoolAt + 16 > UUID_POOL.length)
    {
        crypto.getRandomValues(UUID_POOL);
        uuidPoolAt = 0;
    }
    const o = uuidPoolAt;
    uuidPoolAt += 16;

    const b6 = (UUID_POOL[o + 6] & 0x0f) | 0x40; // version 4
    const b8 = (UUID_POOL[o + 8] & 0x3f) | 0x80; // variant 10xx

    return HEX_BYTE[UUID_POOL[o]] + HEX_BYTE[UUID_POOL[o + 1]]
         + HEX_BYTE[UUID_POOL[o + 2]] + HEX_BYTE[UUID_POOL[o + 3]] + '-'
         + HEX_BYTE[UUID_POOL[o + 4]] + HEX_BYTE[UUID_POOL[o + 5]] + '-'
         + HEX_BYTE[b6] + HEX_BYTE[UUID_POOL[o + 7]] + '-'
         + HEX_BYTE[b8] + HEX_BYTE[UUID_POOL[o + 9]] + '-'
         + HEX_BYTE[UUID_POOL[o + 10]] + HEX_BYTE[UUID_POOL[o + 11]]
         + HEX_BYTE[UUID_POOL[o + 12]] + HEX_BYTE[UUID_POOL[o + 13]]
         + HEX_BYTE[UUID_POOL[o + 14]] + HEX_BYTE[UUID_POOL[o + 15]];
}

//// FILE UTILS ////

/** Save data to file (works in Node.js and browser) */
export async function save(filepath: string, 
    data?: string | Buffer | Uint8Array | Float16Array | Float32Array | ArrayBuffer): Promise<void>
{
    if(data == null)
    {
        console.warn(`utils::save(): No data provided. Please supply a file as string or Buffer.`);
        return;
    }
    // Detect environment
    if (typeof window === 'undefined')
    {
        // Node.js
        const fs = await import('fs');
        const path = await import('path');
        
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir))
        {
            fs.mkdirSync(dir, { recursive: true });
        }

        await fs.promises.writeFile(filepath, data as any);
        const fullPath = path.resolve(filepath);
        console.info(`utils::save(): File saved to "${fullPath}"`);
    } 
    else
    {
        // Browser
        let blob: Blob;
        
        if (data instanceof Blob)
        {
            blob = data;
        } else if (data instanceof ArrayBuffer || data instanceof Uint8Array)
        {
            blob = new Blob([data as any]); // NOTE: suppress type warning TODO: fix
        }
        else
        {
            blob = new Blob([data as any], { type: 'text/plain' });
        }
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filepath.split('/').pop() || 'download';
        
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

/** Encode string or typed array to base64 */
export function toBase64(data: string | Uint8Array | Float32Array | Float64Array | ArrayBuffer): string
{
    let bytes: Uint8Array;
    
    if (typeof data === 'string')
    {
        bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer)
    {
        bytes = new Uint8Array(data);
    } else if (data instanceof Uint8Array)
    {
        bytes = data;
    }
    else
    {
        // Float32Array, Float64Array, etc. - get underlying bytes
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    
    if (typeof Buffer !== 'undefined')
    {
        return Buffer.from(bytes).toString('base64');
    }
    return btoa(String.fromCharCode(...bytes));
}

/** Decode a base64 string back to a Uint8Array */
export function fromBase64(b64: string): Uint8Array
{
    if (typeof Buffer !== 'undefined')
    {
        // Buffer.from().buffer returns the shared pool ArrayBuffer (wrong size).
        // Copy into a plain Uint8Array so .buffer is exactly the decoded bytes.
        const buf = Buffer.from(b64, 'base64');
        const result = new Uint8Array(buf.length);
        result.set(buf);
        return result;
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    Array.from({ length: bin.length }, (_, i) => { bytes[i] = bin.charCodeAt(i); });
    return bytes;
}

/**
 * Serialize a gltf-transform JSONDocument to a self-contained GLTF JSON string.
 * Converts all external buffer resources (e.g. "buffer.bin") to inline base64 data URIs
 * so the result can be used standalone without companion binary files.
 */
export function GLTFJsonDocumentToString(jsonDoc: { json: any; resources: Record<string, Uint8Array> }): string
{
    const json = jsonDoc.json;
    if (Array.isArray(json.buffers))
    {
        json.buffers.forEach((bufDef: any) =>
        {
            const data = jsonDoc.resources[bufDef.uri];
            if (data)
            {
                bufDef.uri = `data:application/octet-stream;base64,${toBase64(data)}`;
            }
        });
    }
    return JSON.stringify(json);
}

/**
 * Debug helper: decode all base64 buffers embedded in a GLTF JSON string and return
 * them as raw Uint8Arrays, one per entry in the GLTF `buffers` array.
 */
export function debugGLTFBuffers(gltfJson: string): Uint8Array[]
{
    const gltf = JSON.parse(gltfJson);
    if (!Array.isArray(gltf.buffers)) return [];
    return gltf.buffers.map((buf: { uri?: string }) =>
    {
        if (!buf.uri) return new Uint8Array(0);
        const base64 = buf.uri.slice(buf.uri.indexOf(',') + 1);
        return fromBase64(base64);
    });
}

/**
 * Debug helper: extract the raw normal vectors from a GLTF JSON string.
 * Returns one Float32Array per mesh primitive that has a NORMAL attribute,
 * laid out as [x0,y0,z0, x1,y1,z1, ...].
 */
export function debugGLTFNormals(gltfJson: string): Float32Array[]
{
    const gltf = JSON.parse(gltfJson);

    // Decode all binary buffers up front
    const rawBuffers: Uint8Array[] = (gltf.buffers ?? []).map((buf: { uri?: string }) =>
    {
        if (!buf.uri) return new Uint8Array(0);
        const base64 = buf.uri.slice(buf.uri.indexOf(',') + 1);
        return fromBase64(base64);
    });

    const results: Float32Array[] = [];

    (gltf.meshes ?? []).forEach((mesh: any) =>
    {
        (mesh.primitives ?? []).forEach((prim: any) =>
        {
            const normalAccIdx = prim.attributes?.NORMAL;
            if (normalAccIdx == null) return;

            const acc        = gltf.accessors[normalAccIdx];
            const bufView    = gltf.bufferViews[acc.bufferView];
            const raw        = rawBuffers[bufView.buffer];

            const byteOffset = (bufView.byteOffset ?? 0) + (acc.byteOffset ?? 0);
            const byteLength = acc.count * 3 * 4; // VEC3 of FLOAT (4 bytes each)

            results.push(new Float32Array(raw.buffer, raw.byteOffset + byteOffset, acc.count * 3));
        });
    });

    return results;
}