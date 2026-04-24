import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { SceneNode } from '../../src/SceneNode';
import { computeEdgeVisibilityBitfield, GLTFBuilder } from '../../src/GLTFBuilder';

beforeAll(async () =>
{
    await initAsync();
});

// ─── computeEdgeVisibilityBitfield ────────────────────────────────────────────

describe('computeEdgeVisibilityBitfield: hand-crafted triangles', () =>
{
    // Two coplanar triangles sharing a diagonal (same face of a quad).
    // Both face normals should be identical → interior edge is SMOOTH (0).
    // The four outer edges are boundary (only one adjacent tri) → HARD (2).
    //
    //   (0,0,0) --- (1,0,0)
    //     |       / |
    //   (0,1,0) --- (1,1,0)
    //
    // tri 0: v0,v1,v2 = 0,1,2   (lower-left triangle)
    // tri 1: v3,v4,v5 = 1,3,2   (upper-right triangle)
    // Positions are unindexed (each triangle has its own vertex copies),
    // mimicking OpenCASCADE-style output where no indices are shared.

    const positions = new Float32Array([
        // tri 0
        0, 0, 0,   // v0
        1, 0, 0,   // v1
        0, 1, 0,   // v2
        // tri 1  (shares the edge v1=(1,0,0)–v2=(0,1,0) with tri 0)
        1, 0, 0,   // v3  ← same position as v1
        1, 1, 0,   // v4
        0, 1, 0,   // v5  ← same position as v2
    ]);

    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);

    it('bitfield has the right length (2 tris × 3 edges × 2 bits = 12 bits → 2 bytes)', () =>
    {
        const bf = computeEdgeVisibilityBitfield(positions, indices, 10);
        expect(bf.byteLength).toBe(2);
    });

    it('exactly 4 out of 6 edge slots are hard (boundary edges)', () =>
    {
        const bf = computeEdgeVisibilityBitfield(positions, indices, 10);
        let hardCount = 0;
        for (let edgeIdx = 0; edgeIdx < 6; edgeIdx++)
        {
            const byteIdx = Math.floor(edgeIdx * 2 / 8);
            const bitOff  = (edgeIdx * 2) % 8;
            const val     = (bf[byteIdx] >> bitOff) & 0x3;
            if (val === 2) hardCount++;
        }
        // 4 boundary edges (one from each outer side) + 0 for the shared diagonal
        expect(hardCount).toBe(4);
    });

    it('the shared diagonal edge is smooth (value 0) from both triangle sides', () =>
    {
        const bf = computeEdgeVisibilityBitfield(positions, indices, 10);

        // Tri 0 slot 1 = edge v1–v2 = (1,0,0)–(0,1,0)  [shared diagonal]
        const slot0_1 = (bf[Math.floor(1 * 2 / 8)] >> ((1 * 2) % 8)) & 0x3;
        expect(slot0_1).toBe(0);

        // Tri 1 slot 2 = edge v5–v3 = (0,1,0)–(1,0,0)  [same diagonal, other tri]
        const slot1_2 = (bf[Math.floor(5 * 2 / 8)] >> ((5 * 2) % 8)) & 0x3;
        expect(slot1_2).toBe(0);
    });
});

describe('computeEdgeVisibilityBitfield: two orthogonal triangles', () =>
{
    // Shared edge is the crease between two perpendicular faces.
    // Face normals are orthogonal (dot = 0), far below cos(10°) → HARD (2).
    //
    // tri 0 in XY plane: (0,0,0),(1,0,0),(0,1,0)  normal ≈ (0,0,1)
    // tri 1 in XZ plane: shares edge (0,0,0)–(1,0,0), normal ≈ (0,-1,0)
    //   vertices: (1,0,0),(1,0,1),(0,0,0)

    const positions = new Float32Array([
        0, 0, 0,   1, 0, 0,   0, 1, 0,   // tri 0
        1, 0, 0,   1, 0, 1,   0, 0, 0,   // tri 1 — shares (0,0,0)–(1,0,0)
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);

    it('shared crease edge is hard from both triangle sides', () =>
    {
        const bf = computeEdgeVisibilityBitfield(positions, indices, 10);

        // Tri 0 slot 0 = edge v0–v1 = (0,0,0)–(1,0,0)  [shared crease]
        const slot0_0 = (bf[Math.floor(0 * 2 / 8)] >> ((0 * 2) % 8)) & 0x3;
        expect(slot0_0).toBe(2);

        // Tri 1 slot 2 = edge v5–v3 = (0,0,0)–(1,0,0)  [same crease, other tri]
        const slot1_2 = (bf[Math.floor(5 * 2 / 8)] >> ((5 * 2) % 8)) & 0x3;
        expect(slot1_2).toBe(2);
    });
});

// ─── Full GLTFBuilder pipeline with Mesh.Cube ────────────────────────────────

describe('GLTFBuilder: box mesh edge extension', () =>
{
    it('toGLB() resolves to a non-empty Uint8Array', async () =>
    {
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        expect(glb).toBeInstanceOf(Uint8Array);
        expect(glb.byteLength).toBeGreaterThan(0);
    });

    it('GLB binary starts with the glTF magic bytes (0x676C5446)', async () =>
    {
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        const magic = (glb[0] << 24) | (glb[1] << 16) | (glb[2] << 8) | glb[3];
        expect(magic >>> 0).toBe(0x676C5446);
    });

    it('EXT_mesh_primitive_edge_visibility is listed in extensionsUsed', async () =>
    {
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        const json = extractGLTFJson(glb);
        expect(json.extensionsUsed).toContain('EXT_mesh_primitive_edge_visibility');
    });

    it('at least one primitive carries the EXT_mesh_primitive_edge_visibility extension', async () =>
    {
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        const json = extractGLTFJson(glb);
        const allPrimitives = (json.meshes ?? []).flatMap((m: any) => m.primitives ?? []);
        const withExt = allPrimitives.filter(
            (p: any) => p.extensions?.['EXT_mesh_primitive_edge_visibility'] !== undefined,
        );
        expect(withExt.length).toBeGreaterThan(0);
    });

    it('bitfield is not all-hard (0xAA) — smooth interior edges are 0', async () =>
    {
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        const json   = extractGLTFJson(glb);
        const bufBin = extractGLTFBin(glb);

        // Find the visibility accessor index from the first mesh primitive
        const prim = json.meshes[0].primitives[0];
        const visIdx: number = prim.extensions['EXT_mesh_primitive_edge_visibility'].visibility;
        const acc    = json.accessors[visIdx];
        const bv     = json.bufferViews[acc.bufferView];
        const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const visBytes = new Uint8Array(bufBin, offset, bv.byteLength);

        // At least one byte must differ from 0xAA (the all-hard sentinel)
        const allHard = Array.from(visBytes).every(b => b === 0xAA);
        expect(allHard).toBe(false);
    });

    it('exactly 12 hard edges (24 hard slots) and 6 smooth diagonal slots for a cube', async () =>
    {
        // A cube has:
        //   6 faces × 2 triangles = 12 triangles → 36 edge slots total
        //   12 box edges (90° creases, well above 30° threshold) × 2 adjacent slots = 24 hard
        //    6 face-interior diagonals (0° angle, coplanar)    × 2 adjacent slots = 12 smooth
        const scene = SceneNode.root();
        scene.add(Mesh.Cube(1));
        const glb = await new GLTFBuilder('z', 'test').addSceneNode(scene).applyExtensions().toGLB();
        const json   = extractGLTFJson(glb);
        const bufBin = extractGLTFBin(glb);

        const prim   = json.meshes[0].primitives[0];
        const visIdx = prim.extensions['EXT_mesh_primitive_edge_visibility'].visibility;
        const acc    = json.accessors[visIdx];
        const bv     = json.bufferViews[acc.bufferView];
        const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const visBytes = new Uint8Array(bufBin, offset, bv.byteLength);

        const idxAcc     = json.accessors[prim.indices];
        const totalSlots = idxAcc.count; // 36 for a cube

        let hardSlots = 0;
        let smoothSlots = 0;
        for (let e = 0; e < totalSlots; e++)
        {
            const byteIdx = Math.floor(e * 2 / 8);
            const bitOff  = (e * 2) % 8;
            const val     = (visBytes[byteIdx] >> bitOff) & 0x3;
            if (val === 2) hardSlots++;
            else           smoothSlots++;
        }

        expect(totalSlots).toBe(36);    // 12 tris × 3 edge slots
        expect(hardSlots).toBe(24);     // 12 box edges × 2 adjacent tris
        expect(smoothSlots).toBe(12);   // 6 face diagonals × 2 adjacent tris
    });
});

describe('computeEdgeVisibilityBitfield: sphere with 30° threshold', () =>
{
    // A UV sphere with 32×16 segments has adjacent face normals differing by
    // ≈11.25° (360°/32). With the 30° crease threshold, every shared edge is
    // smooth.  Only boundary edges (open mesh — none for a closed sphere)
    // would be hard.  Expected: 0 hard slots.
    it('smooth sphere produces 0 hard edge slots at 30° threshold', () =>
    {
        const sphere = Mesh.Sphere(1);
        const buf    = sphere.toBuffer();
        const posF32 = new Float32Array(buf.positions);
        const bf     = computeEdgeVisibilityBitfield(posF32, buf.indices, 30);

        let hardSlots = 0;
        for (let e = 0; e < buf.indices.length; e++)
        {
            const val = (bf[Math.floor(e * 2 / 8)] >> ((e * 2) % 8)) & 0x3;
            if (val === 2) hardSlots++;
        }
        expect(hardSlots).toBe(0);
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the JSON chunk from a GLB binary. */
function extractGLTFJson(glb: Uint8Array): any
{
    const dv = new DataView(glb.buffer, glb.byteOffset);
    const jsonLength = dv.getUint32(12, true);
    const jsonBytes = glb.slice(20, 20 + jsonLength);
    return JSON.parse(new TextDecoder().decode(jsonBytes));
}

/** Extract the BIN chunk ArrayBuffer from a GLB binary. */
function extractGLTFBin(glb: Uint8Array): ArrayBuffer
{
    const dv = new DataView(glb.buffer, glb.byteOffset);
    const jsonLength = dv.getUint32(12, true);
    const binStart = 20 + jsonLength + 8; // skip JSON chunk header
    return glb.buffer.slice(glb.byteOffset + binStart);
}
