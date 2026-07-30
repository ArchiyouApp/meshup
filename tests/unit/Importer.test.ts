/**
 * tests/unit/Importer.test.ts
 *
 * Phase 0A: SVG + GeoJSON import through the already-compiled WASM.
 */
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { Importer, Sketch, Curve, Mesh, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** CRC-32 (IEEE) for the stored-ZIP builder below. */
const crc32 = (bytes: Uint8Array): number =>
{
    let crc = 0xFFFFFFFF;
    for(let i = 0; i < bytes.length; i++)
    {
        crc ^= bytes[i];
        for(let j = 0; j < 8; j++) { crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
};

/** Build a minimal single-entry STORED (uncompressed) ZIP — enough for a 3MF. */
const makeStoredZip = (name: string, content: string): Uint8Array =>
{
    const enc = new TextEncoder();
    const nb = enc.encode(name), data = enc.encode(content);
    const crc = crc32(data), n = data.length, fn = nb.length;
    const b: number[] = [];
    const u16 = (v: number) => b.push(v & 0xff, (v >>> 8) & 0xff);
    const u32 = (v: number) => b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0); u32(crc); u32(n); u32(n); u16(fn); u16(0);
    nb.forEach(x => b.push(x)); data.forEach(x => b.push(x));
    const cStart = b.length;
    u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0); u32(crc); u32(n); u32(n);
    u16(fn); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0); nb.forEach(x => b.push(x));
    const cEnd = b.length;
    u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(cEnd - cStart); u32(cStart); u16(0);
    return new Uint8Array(b);
};

const TETRA_3MF_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh>
    <vertices>
      <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/>
      <vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
    </vertices>
    <triangles>
      <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>
      <triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>
    </triangles>
  </mesh></object></resources>
  <build><item objectid="1"/></build>
</model>`;

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

    // Regression: the old polyline parser threw Unimplemented("elliptical arc by")
    // on this real-world sample (poi.svg). hypercurve imports its circular arcs.
    it('imports a path with circular arcs (poi.svg) as a closed curve with native arcs', () =>
    {
        const poi = `<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'>
          <path d="M65,20a15,15,0,1,1,15,15h-60a15,15,0,1,1,15-15v60a15,15,0,1,1-15-15h60a15,15,0,1,1-15,15z" fill="none"/>
        </svg>`;
        const curves = Importer.fromSVG(poi).toArray();
        expect(curves.length).toBe(1);
        expect(curves[0].isClosed()).toBe(true);
        // The arcs are preserved as native circular-arc segments (not a flat polyline).
        expect((curves[0].inner() as any).hasArcs()).toBe(true);
    });

    it('imports a path with cubic Béziers (flattened to line segments)', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 C 20,20 40,20 50,10 L 50,40 Z"/></svg>`;
        const curves = Importer.fromSVG(svg).toArray();
        expect(curves.length).toBe(1);
        expect(curves[0].isClosed()).toBe(true);
        // A flattened cubic yields several segments (not just the 2 lines).
        expect((curves[0].inner() as any).segmentCount()).toBeGreaterThan(3);
    });

    it('imports a circle element as a native closed curve', () =>
    {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="20"/></svg>`;
        const curves = Importer.fromSVG(svg).toArray();
        expect(curves.length).toBe(1);
        expect(curves[0].isClosed()).toBe(true);
    });

    it('skips an unsupported elliptical arc and warns (partial import)', () =>
    {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try
        {
            // rx != ry → elliptical → hypercurve reports unsupported → skipped.
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10,10 A 30,15 0 0 1 60,10"/></svg>`;
            const col = Importer.fromSVG(svg);
            expect(col.toArray().length).toBe(0);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unsupported commands|elliptical/i));
        }
        finally { warn.mockRestore(); }
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

    it('attaches feature properties to each produced curve metadata', () =>
    {
        const fc = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: { name: 'Main St', highway: 'residential' },
                  geometry: { type: 'LineString', coordinates: [[0, 0], [50, 50]] } },
                { type: 'Feature', properties: { name: 'Plot A', height: 12 },
                  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
            ],
        };
        const curves = Importer.fromGeoJSON(fc).toArray();
        expect(curves.length).toBe(2);
        const street = curves.find(c => !c.isClosed())!;
        const plot = curves.find(c => c.isClosed())!;
        expect(street.metadata.name).toBe('Main St');
        expect(street.metadata.highway).toBe('residential');
        expect(plot.metadata.name).toBe('Plot A');
        expect(plot.metadata.height).toBe(12);
    });

    it('leaves metadata empty for bare geometry without properties', () =>
    {
        const curves = Importer.fromGeoJSON(GEOJSON_POLY_HOLE).toArray();
        expect(curves.every(c => Object.keys(c.metadata).length === 0)).toBe(true);
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

    it('reports a still-unimplemented format (PLY) as not-yet-implemented', () =>
    {
        const ply = 'ply\nformat ascii 1.0\nelement vertex 0\nend_header\n';
        expect(Importer.detectFormat(ply)).toBe('ply');
        expect(() => Importer.load(ply)).toThrow(/not implemented yet/);
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
    it('imports an OBJ tetrahedron', () =>
    {
        const mesh = Mesh.fromOBJ(OBJ_TETRA);
        expect(mesh).toBeInstanceOf(Mesh);
        const bbox = mesh.bbox()!;
        expect(bbox.width()).toBeCloseTo(10, 3);
        expect(bbox.depth()).toBeCloseTo(10, 3);
        expect(bbox.height()).toBeCloseTo(10, 3);
    });

    it('Importer.load auto-detects OBJ', () =>
    {
        expect(Importer.detectFormat(OBJ_TETRA)).toBe('obj');
        const col = Importer.load(OBJ_TETRA);
        expect(col.toArray().length).toBe(1);
        expect(col.toArray()[0]).toBeInstanceOf(Mesh);
    });
});

describe('Importer: STL (round-trip)', () =>
{
    it('exports a cube to binary STL and re-imports it', () =>
    {
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

    it('re-imports ASCII STL and auto-detects it', () =>
    {
        const cube = Mesh.Cube(20);
        const ascii = cube.toSTLAscii()!;
        expect(Importer.detectFormat(ascii)).toBe('stl');
        const imported = Importer.load(ascii).toArray()[0] as Mesh;
        expect(imported.bbox()!.width()).toBeCloseTo(20, 2);
    });
});

describe('Importer: DXF (mesh)', () =>
{
    it('imports a DXF circle as a flat mesh', () =>
    {
        const mesh = Mesh.fromDXF(DXF_CIRCLE);
        const bbox = mesh.bbox()!;
        expect(bbox.width()).toBeCloseTo(10, 1);   // diameter = 2*r
        expect(bbox.depth()).toBeCloseTo(10, 1);
        expect(bbox.height()).toBeCloseTo(0, 3);   // flat on XY
    });
});

describe('Importer: glTF/GLB (round-trip)', () =>
{
    it('exports a cube to GLB and re-imports it', async () =>
    {
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

describe('Importer: AMF (round-trip)', () =>
{
    it('exports a cube to AMF and re-imports it', () =>
    {
        const cube = Mesh.Cube(10);
        const amf = cube.toAMF()!;
        expect(typeof amf).toBe('string');
        const imported = Mesh.fromAMF(amf);
        const bb = imported.bbox()!;
        expect(bb.width()).toBeCloseTo(10, 2);
        expect(bb.depth()).toBeCloseTo(10, 2);
        expect(bb.height()).toBeCloseTo(10, 2);
        expect(imported.toBuffer()!.indices.length).toBeGreaterThan(0);
    });
});

describe('Importer: 3MF', () =>
{
    it('imports a tetrahedron from a minimal 3MF package', () =>
    {
        const zip = makeStoredZip('3D/3dmodel.model', TETRA_3MF_MODEL);
        expect(Importer.detectFormat(zip)).toBe('3mf');
        const mesh = Mesh.from3MF(zip);
        const bb = mesh.bbox()!;
        expect(bb.width()).toBeCloseTo(10, 2);
        expect(bb.depth()).toBeCloseTo(10, 2);
        expect(bb.height()).toBeCloseTo(10, 2);
        expect(mesh.toBuffer()!.indices.length).toBe(12); // 4 triangles
    });
});

describe('Importer: DXF (2D curves)', () =>
{
    it('imports a DXF circle as a closed 2D curve', () =>
    {
        const curves = Sketch.fromDXF(DXF_CIRCLE).toArray();
        expect(curves.length).toBe(1);
        expect(curves[0]).toBeInstanceOf(Curve);
        expect(curves[0].isClosed()).toBe(true);
        const bb = curves[0].bbox()!;
        expect(bb.width()).toBeCloseTo(10, 1);   // X = diameter
        expect(bb.depth()).toBeCloseTo(10, 1);   // Y = diameter
        expect(bb.height()).toBeCloseTo(0, 3);   // flat on XY
    });

    it('Importer.load auto-detects DXF and returns curves', () =>
    {
        expect(Importer.detectFormat(DXF_CIRCLE)).toBe('dxf');
        const col = Importer.load(DXF_CIRCLE);
        expect(col.toArray()[0]).toBeInstanceOf(Curve);
    });
});
