/**
 * tests/unit/Importer.test.ts
 *
 * Phase 0A: SVG + GeoJSON import through the already-compiled WASM.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { Importer, Sketch, Curve, Mesh, ShapeCollection, getCsgrs, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** The mesh importers (OBJ/STL/DXF) need a WASM build that exposes MeshJs.fromOBJ.
 *  The committed WASM predates them, so these tests auto-skip until csgrs is
 *  rebuilt from a source containing the fromOBJ/fromSTL/fromDXF bindings. */
const meshImportReady = (): boolean =>
{
    try { return typeof (getCsgrs() as any)?.MeshJs?.fromOBJ === 'function'; }
    catch { return false; }
};

const gltfReady = (): boolean =>
{
    try { return typeof (getCsgrs() as any)?.MeshJs?.fromGLTF === 'function'; }
    catch { return false; }
};

const SVG_RECT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="10" y="10" width="80" height="80" fill="red"/>
</svg>`;

const GEOJSON_POLY_HOLE = {
    type: 'Polygon',
    coordinates: [
        [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],   // exterior
        [[30, 30], [70, 30], [70, 70], [30, 70], [30, 30]], // hole
    ],
};

const GEOJSON_FC = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [50, 50]] } },
    ],
};

describe('Importer: SVG', () =>
{
    it('imports an SVG rect into a closed Curve', () =>
    {
        const col = Importer.fromSVG(SVG_RECT);
        expect(col).toBeInstanceOf(ShapeCollection);
        const curves = col.toArray();
        expect(curves.length).toBe(1);
        expect(curves[0]).toBeInstanceOf(Curve);
        expect(curves[0].isClosed()).toBe(true);
        const bbox = curves[0].bbox()!;
        expect(bbox.width()).toBeCloseTo(80, 3);  // X extent
        expect(bbox.depth()).toBeCloseTo(80, 3);  // Y extent
        expect(bbox.height()).toBeCloseTo(0, 3);  // flat on XY plane (Z=0)
    });

    it('Sketch.fromSVG delegates to the Importer', () =>
    {
        const col = Sketch.fromSVG(SVG_RECT);
        expect(col.toArray().length).toBe(1);
    });

    it('throws on empty SVG', () =>
    {
        expect(() => Importer.fromSVG('')).toThrow(/non-empty SVG/);
    });
});

describe('Importer: GeoJSON', () =>
{
    it('imports a Polygon with a hole as two closed rings', () =>
    {
        const curves = Importer.fromGeoJSON(GEOJSON_POLY_HOLE).toArray();
        expect(curves.length).toBe(2);
        expect(curves.every(c => c.isClosed())).toBe(true);
        // exterior is the larger 100x100 ring (X=width, Y=depth)
        const areas = curves.map(c => { const b = c.bbox()!; return b.width() * b.depth(); });
        expect(Math.max(...areas)).toBeCloseTo(100 * 100, 0);
    });

    it('imports a FeatureCollection (2 polygons + 1 line)', () =>
    {
        const curves = Importer.fromGeoJSON(GEOJSON_FC).toArray();
        expect(curves.length).toBe(3);
        expect(curves.filter(c => c.isClosed()).length).toBe(2);
        expect(curves.filter(c => !c.isClosed()).length).toBe(1);
    });

    it('accepts a GeoJSON string as well as an object', () =>
    {
        const curves = Importer.fromGeoJSON(JSON.stringify(GEOJSON_POLY_HOLE)).toArray();
        expect(curves.length).toBe(2);
    });
});

describe('Importer: load() auto-detect', () =>
{
    it('detects and routes SVG', () =>
    {
        expect(Importer.detectFormat(SVG_RECT)).toBe('svg');
        expect(Importer.load(SVG_RECT).toArray().length).toBe(1);
    });

    it('detects and routes GeoJSON', () =>
    {
        const str = JSON.stringify(GEOJSON_POLY_HOLE);
        expect(Importer.detectFormat(str)).toBe('geojson');
        expect(Importer.load(str).toArray().length).toBe(2);
    });

    it('detects a GLB magic header (glTF import is implemented)', () =>
    {
        const glb = new Uint8Array([0x67, 0x6C, 0x54, 0x46, 0x02, 0, 0, 0]); // 'glTF' + version
        expect(Importer.detectFormat(glb)).toBe('glb');
        // glTF is implemented now — a truncated GLB fails parsing, not "unimplemented".
        expect(() => Importer.load(glb)).toThrow(/glTF (import|parse) error/i);
    });

    it('reports a still-unimplemented format (3MF/ZIP) as not-yet-implemented', () =>
    {
        const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]); // 'PK..' → 3mf
        expect(Importer.detectFormat(zip)).toBe('3mf');
        expect(() => Importer.load(zip)).toThrow(/not implemented yet/);
    });

    it('throws on unknown content', () =>
    {
        expect(() => Importer.load('this is not a known format')).toThrow(/could not detect/);
    });
});

const OBJ_TETRA = `# tetra
v 0 0 0
v 10 0 0
v 0 10 0
v 0 0 10
f 1 2 3
f 1 2 4
f 1 3 4
f 2 3 4
`;

const DXF_CIRCLE = `0
SECTION
2
ENTITIES
0
CIRCLE
8
0
10
0.0
20
0.0
30
0.0
40
5.0
0
ENDSEC
0
EOF
`;

describe('Importer: OBJ', () =>
{
    it('imports an OBJ tetrahedron', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        const mesh = Mesh.fromOBJ(OBJ_TETRA);
        expect(mesh).toBeInstanceOf(Mesh);
        const bbox = mesh.bbox()!;
        expect(bbox.width()).toBeCloseTo(10, 3);
        expect(bbox.depth()).toBeCloseTo(10, 3);
        expect(bbox.height()).toBeCloseTo(10, 3);
    });

    it('Importer.load auto-detects OBJ', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        expect(Importer.detectFormat(OBJ_TETRA)).toBe('obj');
        const col = Importer.load(OBJ_TETRA);
        expect(col.toArray().length).toBe(1);
        expect(col.toArray()[0]).toBeInstanceOf(Mesh);
    });
});

describe('Importer: STL (round-trip)', () =>
{
    it('exports a cube to binary STL and re-imports it', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        const cube = Mesh.Cube(10);
        const stl = cube.toSTLBinary()!;
        expect(stl).toBeInstanceOf(Uint8Array);

        const imported = Mesh.fromSTL(stl);
        const bbox = imported.bbox()!;
        expect(bbox.width()).toBeCloseTo(10, 2);
        expect(bbox.depth()).toBeCloseTo(10, 2);
        expect(bbox.height()).toBeCloseTo(10, 2);
        // A cube is 12 triangles → indices length 36
        expect(imported.toBuffer()!.indices.length).toBe(36);
    });

    it('re-imports ASCII STL and auto-detects it', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        const cube = Mesh.Cube(20);
        const ascii = cube.toSTLAscii()!;
        expect(Importer.detectFormat(ascii)).toBe('stl');
        const imported = Importer.load(ascii).toArray()[0] as Mesh;
        expect(imported.bbox()!.width()).toBeCloseTo(20, 2);
    });
});

describe('Importer: DXF (mesh)', () =>
{
    it('imports a DXF circle as a flat mesh', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        const mesh = Mesh.fromDXF(DXF_CIRCLE);
        const bbox = mesh.bbox()!;
        expect(bbox.width()).toBeCloseTo(10, 1);   // diameter = 2*r
        expect(bbox.depth()).toBeCloseTo(10, 1);
        expect(bbox.height()).toBeCloseTo(0, 3);   // flat on XY
    });
});

describe('Importer: glTF/GLB (round-trip)', () =>
{
    it('exports a cube to GLB and re-imports it', async (ctx) =>
    {
        if(!gltfReady()){ ctx.skip(); return; }
        const cube = Mesh.Cube(10);
        const glb = await cube.toGLB();
        expect(glb).toBeInstanceOf(Uint8Array);

        const imported = Mesh.fromGLB(glb!);
        const bb = imported.bbox()!;
        // Cube dims are axis-invariant, so a 10-cube stays 10×10×10 whatever the up-axis.
        const dims = [bb.width(), bb.depth(), bb.height()].sort((a, b) => a - b);
        expect(dims[0]).toBeCloseTo(10, 1);
        expect(dims[2]).toBeCloseTo(10, 1);
        expect(imported.toBuffer()!.indices.length).toBeGreaterThan(0);
    });
});

describe('Importer: DXF (2D curves)', () =>
{
    it('imports a DXF circle as a closed 2D curve', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; } // SketchJs.fromDXF lands with fromOBJ
        const curves = Sketch.fromDXF(DXF_CIRCLE).toArray();
        expect(curves.length).toBe(1);
        expect(curves[0]).toBeInstanceOf(Curve);
        expect(curves[0].isClosed()).toBe(true);
        const bb = curves[0].bbox()!;
        expect(bb.width()).toBeCloseTo(10, 1);   // X = diameter
        expect(bb.depth()).toBeCloseTo(10, 1);   // Y = diameter
        expect(bb.height()).toBeCloseTo(0, 3);   // flat on XY
    });

    it('Importer.load auto-detects DXF and returns curves', (ctx) =>
    {
        if(!meshImportReady()){ ctx.skip(); return; }
        expect(Importer.detectFormat(DXF_CIRCLE)).toBe('dxf');
        const col = Importer.load(DXF_CIRCLE);
        expect(col.toArray()[0]).toBeInstanceOf(Curve);
    });
});
