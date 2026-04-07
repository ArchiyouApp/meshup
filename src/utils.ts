export function rad(degrees: number): number
{
   return degrees * Math.PI / 180;
}

export function deg(radians: number): number
{
  return radians * 180 / Math.PI;
}

/**
 * Remap a 3-D point/vector from the source coordinate space (where `up` is the
 * up-axis) to GLTF's Y-up convention.
 *
 *   up='z'  (default) : [x,  z, -y]
 *   up='x'            : [y,  x,  z]
 *   up='y'            : [x,  z,  y]  (already Y-up, just reorder)
 */
export function remapAxis(x: number, y: number, z: number, up: 'x' | 'y' | 'z' = 'z'): [number, number, number] {
    if (up === 'z') return [x,  z, -y];
    if (up === 'x') return [y,  x,  z];
    return [x, z,  y];
}

//// UUID ////

export function uuid(): string
{
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c =>
    {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
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
        return Buffer.from(b64, 'base64');
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    Array.from({ length: bin.length }, (_, i) => { bytes[i] = bin.charCodeAt(i); });
    return bytes;
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