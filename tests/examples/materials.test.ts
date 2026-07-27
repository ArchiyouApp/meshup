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
        // glTF baseColorFactor is LINEAR; CSS/material colours are sRGB. Writing sRGB
        // straight in made everything render far too light (#808080 concrete showed as
        // #e0e0e0), because three.js applies the transfer function again on output.
        const srgbToLinear = (c: number) =>
            c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

        const [r, g, b] = mat.getBaseColorFactor();
        expect(r).toBeCloseTo(srgbToLinear(0xc0 / 255), 4);
        expect(g).toBeCloseTo(srgbToLinear(0x8a / 255), 4);
        expect(b).toBeCloseTo(srgbToLinear(0x4a / 255), 4);
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

/** A max-extent `sides` texture: repeat:false, big enough to contain a normal part. */
const bigSides = {
    image: 's.png', realWidth: 500, realHeight: 889, repeat: false,
    data: `data:image/png;base64,${RED_PNG}`,
};

/** Build a materialized box and return its GLTF document. */
function build(box: any, material: any)
{
    box.style.material = material;
    return (new GLTFBuilder().add(box).applyExtensions() as any)._doc;
}

describe('non-repeating, randomly aligned sides UVs', () =>
{
    const spec = (extra: any = {}) => ({
        name: 'douglas', modelUnitMM: 1,
        textures: { sides: bigSides }, ...extra,
    });

    /** The TEXCOORD_0 array of the first primitive. */
    const uvs = (doc: any) =>
        doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_0').getArray();

    it('clamps when the part fits inside one tile', () =>
    {
        // 100×100×400 mm fits inside the 500×889 mm tile.
        const doc = build(Mesh.Box(100, 400, 100), spec());
        const info = doc.getRoot().listMeshes()[0].listPrimitives()[0]
            .getMaterial().getBaseColorTextureInfo();
        expect(info.getWrapS()).toBe(33071); // CLAMP_TO_EDGE — no repeat needed
    });

    it('falls back to REPEAT when the part overruns its tile', () =>
    {
        // A 4 m beam is longer than the 889 mm tile; clamping would smear the edge
        // pixel down the whole length, so it must tile instead.
        const doc = build(Mesh.Box(100, 4000, 100), spec());
        const info = doc.getRoot().listMeshes()[0].listPrimitives()[0]
            .getMaterial().getBaseColorTextureInfo();
        expect(info.getWrapS()).toBe(10497); // REPEAT
    });

    it('keeps UVs inside 0..1 for a part that fits', () =>
    {
        const uv = uvs(build(Mesh.Box(100, 400, 100), spec()));
        for (const v of uv)
        {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('is deterministic — the same shape twice gives identical UVs', () =>
    {
        const a = uvs(build(Mesh.Box(100, 400, 100), spec()));
        const b = uvs(build(Mesh.Box(100, 400, 100), spec()));
        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('gives two identical parts at different positions a different crop', () =>
    {
        const a = uvs(build(Mesh.Box(100, 400, 100), spec()));
        const moved = Mesh.Box(100, 400, 100);
        moved.move(1000, 0, 0);
        const b = uvs(build(moved, spec()));
        // same size → same span, but a different random offset
        expect(Array.from(a)).not.toEqual(Array.from(b));
    });
});

describe('material edge outline', () =>
{
    const edge = { color: '#000000', opacity: 0.8, width: 1 };

    it('creates a black 80% edge material from the render spec alone', () =>
    {
        const doc = build(Mesh.Box(100, 100, 100), { name: 'steel', edge });
        const mat = doc.getRoot().listMaterials().find((m: any) => m.getName() === 'material_edge');
        expect(mat).toBeTruthy();
        const [r, g, b, a] = mat.getBaseColorFactor();
        expect([r, g, b]).toEqual([0, 0, 0]);
        expect(a).toBeCloseTo(0.8, 6);
        expect(mat.getAlphaMode()).toBe('BLEND');
    });

    it('honours a custom edge color and opacity', () =>
    {
        const doc = build(Mesh.Box(100, 100, 100),
            { name: 'steel', edge: { color: '#ff0000', opacity: 0.5, width: 2 } });
        const mat = doc.getRoot().listMaterials().find((m: any) => m.getName() === 'material_edge');
        const [r, , , a] = mat.getBaseColorFactor();
        expect(r).toBeCloseTo(1, 6);
        expect(a).toBeCloseTo(0.5, 6);
        expect(mat.getExtension('BENTLEY_materials_line_style').width).toBe(2);
    });

    it('still wins when the style came through merge() — the real pipeline', () =>
    {
        // REGRESSION: the first implementation asked `explicitData().stroke !== undefined`.
        // Style.merge() runs the stroke setter, which marks it explicit, and every style
        // cascaded from SHAPE_DEFAULT_STYLE goes through merge — so in the app every shape
        // looked like it had a deliberate stroke and the material outline never applied.
        // A bare Mesh.Box never merges, which is exactly why the other tests missed it.
        const box = Mesh.Box(100, 100, 100);
        box.style.merge({
            color: undefined, opacity: 1,
            fill: { color: 'red', opacity: 1 },
            stroke: { color: 'red', opacity: 1, width: 1, dash: [] },
        } as any);

        const doc = build(box, { name: 'steel', edge });
        const mat = doc.getRoot().listMaterials().find((m: any) => m.getName() === 'material_edge');
        expect(mat, 'material outline must survive a default stroke arriving via merge()').toBeTruthy();
        const [r, g, b] = mat.getBaseColorFactor();
        expect([r, g, b]).toEqual([0, 0, 0]);
    });

    it('does not let the material pbr colour bleed into an explicit stroke', () =>
    {
        // REGRESSION: Style.toGltfMaterial applied material.pbr.color even when isLine,
        // so every edge came out the same colour as the surface it sat on — invisible.
        const box = Mesh.Box(100, 100, 100);
        box.style.stroke = { color: '#00ff00' };
        box.style.strokeWidth = 3;

        const doc = build(box, { name: 'douglas', pbr: { color: '#c08a4a' }, edge });
        const mat = doc.getRoot().listMaterials().find((m: any) => m.getName() === 'edge_material');
        const [r, g, b] = mat.getBaseColorFactor();
        expect(g).toBeCloseTo(1, 3);     // the stroke's green
        expect(r).toBeCloseTo(0, 3);
        expect(b).toBeCloseTo(0, 3);
    });

    it('lets an explicit user stroke win over the material outline', () =>
    {
        const box = Mesh.Box(100, 100, 100);
        box.style.stroke = { color: '#00ff00' };
        box.style.strokeWidth = 3;
        const doc = build(box, { name: 'steel', edge });

        // the stroke path names its material 'edge_material', not 'material_edge'
        const names = doc.getRoot().listMaterials().map((m: any) => m.getName());
        expect(names).toContain('edge_material');
        expect(names).not.toContain('material_edge');
    });

    it('leaves an unmaterialized shape on the default stroke outline', () =>
    {
        // strokeWidth is 1 by default, so every mesh already gets an edge material —
        // applying a material changes its colour/opacity, it does not switch edges on.
        const doc = (new GLTFBuilder().add(Mesh.Box(100, 100, 100)).applyExtensions() as any)._doc;
        const names = doc.getRoot().listMaterials().map((m: any) => m.getName());
        expect(names).toContain('edge_material');
        expect(names).not.toContain('material_edge');
    });
});
