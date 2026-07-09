import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { GLTFBuilder } from '../../src/GLTFBuilder';

beforeAll(async () => { await initAsync(); });

// 1x1 red PNG (base64) — smallest valid embeddable image.
const RED_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

describe('material PBR + texture reaches the GLB', () =>
{
    it('applies pbr metallic/roughness/color from a threaded render spec', async () =>
    {
        const box = Mesh.Box(100, 100, 2000);
        box.style.material = { name: 'douglas', pbr: { color: '#c08a4a', metallic: 0.1, roughness: 0.72 } };

        const builder = new GLTFBuilder().add(box).applyExtensions();
        const doc = (builder as any)._doc;
        const mat = doc.getRoot().listMaterials()[0];
        expect(mat.getRoughnessFactor()).toBeCloseTo(0.72, 3);
        expect(mat.getMetallicFactor()).toBeCloseTo(0.1, 3);
        const [r, g, b] = mat.getBaseColorFactor();
        expect(r).toBeCloseTo(0xc0 / 255, 2);
        expect(g).toBeCloseTo(0x8a / 255, 2);
        expect(b).toBeCloseTo(0x4a / 255, 2);
    });

    it('embeds a base-color texture with UVs when texture data is present', async () =>
    {
        const box = Mesh.Box(100, 100, 2000);
        box.style.material = {
            name: 'douglas',
            pbr: { color: '#c08a4a', metallic: 0, roughness: 0.7 },
            modelUnitMM: 1,
            textures: { sides: { image: 'x.png', realWidth: 100, realHeight: 100, data: `data:image/png;base64,${RED_PNG}` } },
        };

        const builder = new GLTFBuilder().add(box).applyExtensions();
        const doc = (builder as any)._doc;
        expect(doc.getRoot().listTextures().length).toBe(1);
        const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
        expect(prim.getAttribute('TEXCOORD_0')).toBeTruthy();
        expect(prim.getMaterial()!.getBaseColorTexture()).toBeTruthy();
    });

    it('splits a beam into section (2 end faces) + sides (4 long faces) primitives', async () =>
    {
        // Beam: longest axis is Y (2000) → the two 20×100 end faces are `section`.
        const box = Mesh.Box(20, 2000, 100);
        box.style.material = {
            name: 'hardwood',
            pbr: { color: '#8a5a2b', metallic: 0, roughness: 0.7 },
            modelUnitMM: 1,
            textures: {
                sides:   { image: 's.png', realWidth: 300, realHeight: 300, data: `data:image/png;base64,${RED_PNG}` },
                section: { image: 'x.png', realWidth: 150, realHeight: 150, repeat: false, data: `data:image/png;base64,${RED_PNG}` },
            },
        };

        const builder = new GLTFBuilder().add(box).applyExtensions();
        const doc = (builder as any)._doc;
        const prims = doc.getRoot().listMeshes()[0].listPrimitives();
        expect(prims.length).toBe(2); // sides + section
        for (const p of prims) expect(p.getMaterial().getBaseColorTexture()).toBeTruthy();

        const wraps = prims.map((p: any) => p.getMaterial().getBaseColorTextureInfo().getWrapS());
        expect(wraps).toContain(10497); // sides → REPEAT
        expect(wraps).toContain(33071); // section → CLAMP_TO_EDGE

        // section covers only the 2 end faces (2 triangles each → 12 indices); sides the other 8 → 24
        const counts = prims.map((p: any) => p.getIndices().getCount()).sort((a: number, b: number) => a - b);
        expect(counts).toEqual([12, 24]);
    });
});
