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

//// SCENE DEBUGGING ////

/** Debug label for a Shape's scene membership, used by every Shape.toString() in both
 *  kernels: the node holding the Shape, or that it is not in the scene at all — usually
 *  the thing you want to know when a Shape does not show up.
 *
 *  NOTE: lives here, not in SceneNode.ts, on purpose. Shape.ts only ever needed SceneNode
 *  as a *type*, so that import gets erased at runtime; importing a value from it would
 *  make Shape <-> SceneNode a real cycle and leave `Polygon extends Shape` undefined.
 *  utils.ts imports nothing, so it is always safe to import from. */
export function nodeToString(node: { name: string, id(): string } | null | undefined): string
{
    return (node) ? `node={ name: '${node.name}', id: '${node.id()}' }` : 'node=<not in scene>';
}

//// ORTHO ALIGNMENT ////

/** A bare direction with a weight, as fed to primaryOrthoXYAngle() */
export interface DirWithLength { x: number, y: number, z: number, length: number }

/** Shortest-arc rotation that brings direction `from` onto direction `to`, as an
 *  axis + angle (degrees) pair that can be handed straight to rotateAround().
 *
 *  Degenerate inputs are handled explicitly instead of producing NaN:
 *    - a zero-length input or already-parallel directions give angle 0
 *    - anti-parallel directions give 180 degrees around an arbitrary perpendicular axis
 */
export function shortestArcAxisAngle(
    from: { x: number, y: number, z: number },
    to: { x: number, y: number, z: number },
): { axis: [number, number, number], angle: number }
{
    const NONE = { axis: [0, 0, 1] as [number, number, number], angle: 0 };

    const lf = Math.hypot(from.x, from.y, from.z);
    const lt = Math.hypot(to.x, to.y, to.z);
    if (lf < 1e-12 || lt < 1e-12) { return NONE; }

    const f = { x: from.x / lf, y: from.y / lf, z: from.z / lf };
    const t = { x: to.x / lt,   y: to.y / lt,   z: to.z / lt };

    const dot = Math.max(-1, Math.min(1, f.x * t.x + f.y * t.y + f.z * t.z));
    if (dot >= 1 - 1e-12) { return NONE; } // already aligned

    if (dot <= -1 + 1e-12)
    {
        // Anti-parallel: any perpendicular axis does. Cross with the world axis that
        // is least aligned with f, so the cross product never collapses to zero.
        const alt = (Math.abs(f.x) < 0.9) ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        const cx = f.y * alt.z - f.z * alt.y;
        const cy = f.z * alt.x - f.x * alt.z;
        const cz = f.x * alt.y - f.y * alt.x;
        const l  = Math.hypot(cx, cy, cz);
        return { axis: [cx / l, cy / l, cz / l], angle: 180 };
    }

    const cx = f.y * t.z - f.z * t.y;
    const cy = f.z * t.x - f.x * t.z;
    const cz = f.x * t.y - f.y * t.x;
    const l  = Math.hypot(cx, cy, cz);

    return { axis: [cx / l, cy / l, cz / l], angle: deg(Math.acos(dot)) };
}

/** Determine the dominant in-plane (XY) direction of a set of edges and return the
 *  rotation around Z (in degrees) that brings it onto the X axis ('horizontal') or
 *  the Y axis ('vertical') by the shortest possible turn.
 *
 *  Edges are grouped by their XY direction, folded into a half plane so that an edge
 *  and its reverse count as the same line. Each group is scored `count * maxLength`
 *  (the same simple heuristic as the brep kernel): the direction shared by the most —
 *  and longest — edges wins. Length is weighted by how much of the edge actually lies
 *  in the XY plane, so near-vertical edges cannot dominate with a direction that is
 *  mostly noise.
 *
 *  The returned angle is always within [-90, 90): aligning a *line* to an axis never
 *  needs more than a quarter turn, so the shape is nudged into place rather than flipped.
 */
export function primaryOrthoXYAngle(
    edges: Array<DirWithLength>,
    orientation: 'horizontal'|'vertical' = 'vertical',
    tolerance: number = 1e-6,
): number
{
    const QUANT = 1e4; // ~0.006 degrees of direction resolution when grouping

    interface DirGroup { x: number, y: number, count: number, maxLength: number }
    const groups = new Map<string, DirGroup>();

    edges.forEach(e =>
    {
        const xyLen  = Math.hypot(e.x, e.y);
        const dirLen = Math.hypot(e.x, e.y, e.z);
        if (xyLen < tolerance || dirLen < tolerance) { return; } // no usable XY direction

        // Fold onto the +X half plane so opposite directions share a group
        const flip = (Math.abs(e.x) > tolerance) ? (e.x < 0) : (e.y < 0);
        const ux = (flip ? -e.x : e.x) / xyLen;
        const uy = (flip ? -e.y : e.y) / xyLen;

        // Only the part of the edge lying in the XY plane counts towards its weight
        const weight = (e.length || dirLen) * (xyLen / dirLen);

        const key   = `${Math.round(ux * QUANT)},${Math.round(uy * QUANT)}`;
        const group = groups.get(key);
        if (group)
        {
            group.count += 1;
            group.maxLength = Math.max(group.maxLength, weight);
        }
        else { groups.set(key, { x: ux, y: uy, count: 1, maxLength: weight }); }
    });

    if (groups.size === 0) { return 0; }

    const primary = Array.from(groups.values())
                        .sort((a, b) => (b.count * b.maxLength) - (a.count * a.maxLength))[0];

    const current = deg(Math.atan2(primary.y, primary.x));
    const target  = (orientation === 'horizontal') ? 0 : 90;

    // Wrap into [-90, 90): a direction and its reverse are the same line
    return ((((target - current) % 180) + 270) % 180) - 90;
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