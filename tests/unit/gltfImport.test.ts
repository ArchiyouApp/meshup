/**
 * glTF import: buffers must resolve, and the axis convention must survive a round trip.
 *
 * `Mesh.fromGLTF` used to lean on the `gltf` crate's `import_slice`, which resolves buffers
 * *and* decodes every texture — so the wasm binary carried the whole `image` crate (JPEG,
 * PNG, TIFF, WebP, OpenEXR, GIF: ~1.5 MB) to produce images the importer immediately threw
 * away. `io/gltf.rs` now resolves buffers itself and the decoders are gone from the build.
 *
 * The two sources a self-contained file can use are structurally different and were
 * previously handled by crate code:
 *   - `.glb`  → the buffer is the binary BIN chunk    (`buffer::Source::Bin`)
 *   - `.gltf` → the buffer is a base64 `data:` URI    (`buffer::Source::Uri`)
 * A regression in either one silently yields an empty mesh rather than an error, so each
 * round trip asserts the geometry actually survived.
 *
 * AXIS CONVENTION. `up` names the up axis **inside the file**, on export and import alike,
 * so `fromGLTF(toGLB(m, up), up)` is the identity for every `up`. It has to be said out
 * loud because meshup's default is not the spec's: glTF nominally means Y-up, but the
 * Archiyou stack carries the kernel's native Z-up through to a Z-up viewer, so meshup
 * writes — and by default reads — Z-up. Import previously hard-coded the spec's Y-up while
 * export wrote Z-up, which transposed two axes on every round trip.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Mesh, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** Per-axis extents — the whole point here is *which* axis each one lands on. */
function extentsOf(m: Mesh): [number, number, number]
{
    const bb = m.bbox()!;
    return [bb.width(), bb.depth(), bb.height()];
}

/** A box whose three extents are all different, so every axis is identifiable. */
const box = () => Mesh.Cuboid(10, 20, 30);

describe('Mesh.fromGLTF()', () =>
{
    it('reads geometry back from a .glb binary chunk', async () =>
    {
        const cube = box();
        const glb = await cube.toGLB();
        expect(glb).toBeTruthy();

        const back = Mesh.fromGLTF(glb!);

        // A buffer that failed to resolve reads as zero primitives, not as an error.
        expect(back.inner().triangleCount()).toBe(cube.inner().triangleCount());
        expect(extentsOf(back)).toEqual(extentsOf(cube));
    });

    it('reads geometry back from a base64 data: URI in .gltf JSON', async () =>
    {
        const cube = box();
        const json = await cube.toGLTF();
        expect(json).toBeTruthy();
        // Guard the premise: this test is only meaningful if the buffer really is inline.
        expect(json!).toContain('base64,');

        const back = Mesh.fromGLTF(json!);

        expect(back.inner().triangleCount()).toBe(cube.inner().triangleCount());
        expect(extentsOf(back)).toEqual(extentsOf(cube));
    });

    it('rejects a buffer that points at an external file, rather than importing nothing', async () =>
    {
        const json = await box().toGLTF();
        // Repoint the buffer at a sibling .bin, which meshup does not fetch.
        const external = json!.replace(/"uri"\s*:\s*"data:[^"]*"/, '"uri":"geometry.bin"');
        expect(external).toContain('geometry.bin');

        expect(() => Mesh.fromGLTF(external)).toThrow(/external buffer/i);
    });
});

describe('glTF axis convention', () =>
{
    it('round-trips a box onto the same axes it was exported from', async () =>
    {
        const cube = box();
        const back = Mesh.fromGLTF((await cube.toGLB())!);

        // The regression this pins: depth and height came back transposed (10 x 30 x 20).
        expect(extentsOf(back)).toEqual([10, 20, 30]);
        expect(extentsOf(back)).toEqual(extentsOf(cube));
    });

    it("round-trips through a conforming Y-up file when told up:'y'", async () =>
    {
        const cube = box();
        const json = (await cube.toGLTF('y'))!;

        // Prove the file really is Y-up, so this exercises the conversion rather than
        // an accidental identity: a 30-tall box must carry its 30 on glTF's Y.
        const doc = JSON.parse(json);
        const acc = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
        const fileExtents = acc.max.map((v: number, i: number) => Math.round(v - acc.min[i]));
        expect(fileExtents).toEqual([10, 30, 20]);

        expect(extentsOf(Mesh.fromGLTF(json, null, 'y'))).toEqual([10, 20, 30]);
    });

    it('lands a Y-up file on its side when read with the default — hence the parameter', async () =>
    {
        // Not desirable, just undetectable: nothing in a glTF says which convention it
        // used, so a file from Blender/three.js has to be imported with up:'y'.
        const yUp = (await box().toGLTF('y'))!;
        expect(extentsOf(Mesh.fromGLTF(yUp))).toEqual([10, 30, 20]);
    });
});
