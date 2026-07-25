/**
 *  Importer.ts
 *
 *  Entry point for importing external files into Meshup.
 *
 *  Geometry parsing happens in the Rust/WASM kernel (csgrs); this module
 *  detects the format, routes the bytes/text to the right WASM entry, and
 *  assembles the result into native meshup objects (Curve / Mesh wrapped in a
 *  ShapeCollection, or a SceneNode for hierarchical scenes).
 *
 *  Supported:
 *    - SVG      → ShapeCollection<Curve>   via SketchJs.fromSVG
 *    - GeoJSON  → ShapeCollection<Curve>   via SketchJs.fromGeo (through a
 *                 standard-GeoJSON → geo-native shim; see _geometryToGeoNative)
 *    - OBJ      → ShapeCollection<Mesh>    via MeshJs.fromOBJ
 *    - STL      → ShapeCollection<Mesh>    via MeshJs.fromSTL (binary + ASCII)
 *    - DXF      → ShapeCollection<Curve>   via SketchJs.fromDXF (2-D curves;
 *                 use Mesh.fromDXF for DXF solids as a mesh)
 *    - glTF/GLB → ShapeCollection<Mesh>    via MeshJs.fromGLTF (merged mesh;
 *                 materials/hierarchy flattened, Y-up→Z-up)
 *    - AMF      → ShapeCollection<Mesh>    via MeshJs.fromAMF (plain or zipped)
 *    - 3MF      → ShapeCollection<Mesh>    via MeshJs.from3MF (geometry only)
 *
 *  Reserved (throw until the Rust importers land — see the Importer plan):
 *    - PLY   (3D → Mesh)
 */

import { getCsgrs, ShapeCollection, Curve, Mesh } from './index';
import type { SketchJs } from './wasm/meshup';

export type ImportFormat =
    | 'svg' | 'geojson' | 'dxf'                         // 2D
    | 'stl' | 'obj' | 'ply' | 'amf' | '3mf' | 'gltf' | 'glb'; // 3D

export interface ImportOptions
{
    /** Force a format instead of auto-detecting. */
    format?: ImportFormat;
    /** Optional source name (e.g. the file name) — reserved for metadata. */
    name?: string;
}

/** Formats detectable/routable but not yet implemented (pending Rust importers). */
const NOT_YET_IMPLEMENTED: ReadonlyArray<ImportFormat> =
    ['ply'];

export class Importer
{
    //// PUBLIC ENTRY ////

    /** Auto-detect the file format and import it.
     *  Returns a `ShapeCollection` (2-D curves / mesh soup). Pass
     *  `opts.format` to skip detection. */
    static load(data: string | Uint8Array | ArrayBuffer, opts: ImportOptions = {}): ShapeCollection
    {
        const format = opts.format ?? Importer.detectFormat(data);

        switch(format)
        {
            case 'svg':     return Importer.fromSVG(Importer._toText(data), opts);
            case 'geojson': return Importer.fromGeoJSON(Importer._toText(data), opts);
            case 'obj':     return Importer.fromOBJ(Importer._toText(data), opts);
            case 'stl':     return Importer.fromSTL(data, opts);
            case 'dxf':     return Importer.fromDXF(data, opts);
            case 'glb':
            case 'gltf':    return Importer.fromGLTF(data, opts);
            case 'amf':     return Importer.fromAMF(data, opts);
            case '3mf':     return Importer.from3MF(data, opts);
            default:
                if(NOT_YET_IMPLEMENTED.includes(format as ImportFormat))
                {
                    throw new Error(
                        `Importer.load(): '${format}' import is not implemented yet ` +
                        `(pending Rust importer). Supported: svg, geojson, obj, stl, dxf.`);
                }
                throw new Error(
                    'Importer.load(): could not detect a supported file format. ' +
                    'Pass opts.format explicitly. Supported: svg, geojson, obj, stl, dxf.');
        }
    }

    //// SVG ////

    /** Import an SVG document into a `ShapeCollection<Curve>` (XY plane, z=0).
     *  Parses via hypercurve: `<path>` lines and circular arcs stay exact, Béziers
     *  are flattened to line segments, and `<circle>/<ellipse>/<rect>/<polygon>/
     *  <polyline>/<line>` become native curves. Unsupported path commands
     *  (elliptical/rotated arcs, …) are skipped and reported via console warnings.
     *  Coordinates are kept in SVG space (y-down); no y-flip. */
    static fromSVG(svg: string, _opts: ImportOptions = {}): ShapeCollection<Curve>
    {
        if(typeof svg !== 'string' || svg.trim().length === 0)
        {
            throw new Error('Importer.fromSVG(): expected a non-empty SVG string.');
        }

        let result: any;
        try
        {
            result = (getCsgrs() as any).importSvgCurves(svg);
        }
        catch(e)
        {
            throw new Error(`Importer.fromSVG(): SVG import failed: ${(e as Error)?.message ?? e}`);
        }

        (result.warnings ?? []).forEach((w: string) => console.warn(`Importer.fromSVG(): ${w}`));

        const out = new ShapeCollection<Curve>();
        const curve3ds = result.takeCurves();
        for(const c of curve3ds)
        {
            out.add(Curve.fromCurve3D(c));
        }
        return out;
    }

    //// GeoJSON ////

    /** Import GeoJSON (a Geometry, Feature, FeatureCollection or
     *  GeometryCollection) into a `ShapeCollection<Curve>`.
     *
     *  INTERIM: the shipped WASM `SketchJs.fromGeo` only accepts geo-types
     *  *native* serde JSON and a single geometry per call, so we normalise
     *  standard GeoJSON here and merge the rings. This TS shim is planned to be
     *  replaced by a proper Rust `from_geojson` (geojson crate) in a later
     *  phase — at which point this method just forwards the raw string. */
    static fromGeoJSON(json: string | object, _opts: ImportOptions = {}): ShapeCollection<Curve>
    {
        let parsed: any;
        try { parsed = typeof json === 'string' ? JSON.parse(json) : json; }
        catch(e){ throw new Error(`Importer.fromGeoJSON(): invalid JSON: ${(e as Error)?.message ?? e}`); }
        if(!parsed || typeof parsed !== 'object')
        {
            throw new Error('Importer.fromGeoJSON(): expected a GeoJSON object or string.');
        }

        const SketchJsCls = getCsgrs().SketchJs;
        const out = new ShapeCollection<Curve>();

        Importer._featuresOf(parsed).forEach(({ geometry, properties }) =>
        {
            const native = Importer._geometryToGeoNative(geometry);
            if(!native) { return; } // unsupported / empty geometry — skip

            let sketch: SketchJs | undefined;
            try
            {
                sketch = SketchJsCls.fromGeo(JSON.stringify(native), null);
                const hasProps = properties && typeof properties === 'object' && Object.keys(properties).length > 0;
                Curve.fromSketchJs(sketch).forEach((c) =>
                {
                    // Attach the feature's properties to each produced curve so scripts can
                    // read them off shape.metadata (e.g. building height, street name).
                    if(hasProps) { c.metadata = { ...properties }; }
                    out.add(c);
                });
            }
            catch(e){ console.warn(`Importer.fromGeoJSON(): skipped a ${geometry?.type} geometry:`, (e as Error)?.message); }
            finally { (sketch as any)?.free?.(); }
        });

        return out;
    }

    //// MESH FORMATS ////

    /** Import a Wavefront OBJ mesh. */
    static fromOBJ(data: string | Uint8Array | ArrayBuffer, _opts: ImportOptions = {}): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(Mesh.fromOBJ(Importer._toText(data)));
    }

    /** Import a binary or ASCII STL mesh. */
    static fromSTL(data: string | Uint8Array | ArrayBuffer, _opts: ImportOptions = {}): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(Mesh.fromSTL(Importer._toBytes(data)));
    }

    /** Import a DXF drawing as 2-D curves. LINE/ARC/open polylines → open
     *  curves; CIRCLE/closed polylines → closed curves. For DXF solids as a
     *  mesh, use {@link Mesh.fromDXF} instead. */
    static fromDXF(data: string | Uint8Array | ArrayBuffer, opts: ImportOptions = {}): ShapeCollection<Curve>
    {
        const bytes = Importer._toBytes(data);
        if(bytes.length === 0){ throw new Error('Importer.fromDXF(): empty DXF data.'); }

        const SketchJsCls = getCsgrs().SketchJs as any;
        let sketch: SketchJs | undefined;
        try
        {
            sketch = SketchJsCls.fromDXF(bytes, opts.name ? { name: opts.name } : null);
            return Curve.fromSketchJs(sketch!);
        }
        catch(e)
        {
            throw new Error(`Importer.fromDXF(): DXF import failed: ${(e as Error)?.message ?? e}`);
        }
        finally { (sketch as any)?.free?.(); }
    }

    /** Import a glTF 2.0 model (.glb or .gltf) as a merged Mesh. */
    static fromGLTF(data: string | Uint8Array | ArrayBuffer, _opts: ImportOptions = {}): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(Mesh.fromGLTF(Importer._toBytes(data)));
    }

    /** Import an AMF model (plain XML or zipped) as a merged Mesh. */
    static fromAMF(data: string | Uint8Array | ArrayBuffer, _opts: ImportOptions = {}): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(Mesh.fromAMF(Importer._toBytes(data)));
    }

    /** Import a 3MF package as a merged Mesh (geometry only). */
    static from3MF(data: string | Uint8Array | ArrayBuffer, _opts: ImportOptions = {}): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(Mesh.from3MF(Importer._toBytes(data)));
    }

    //// FORMAT DETECTION ////

    /** Best-effort format detection from magic bytes / content sniffing. */
    static detectFormat(data: string | Uint8Array | ArrayBuffer): ImportFormat | undefined
    {
        const bytes = Importer._toBytes(data);

        // glTF binary container: magic 'glTF' (0x46546C67 little-endian)
        if(bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6C && bytes[2] === 0x54 && bytes[3] === 0x46)
        {
            return 'glb';
        }
        // ZIP container (3MF / zipped assets): 'PK\x03\x04'
        if(bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04)
        {
            return '3mf';
        }

        const head = Importer._toText(bytes).slice(0, 1024);
        const trimmed = head.replace(/^﻿/, '').trimStart();

        if(/<svg[\s>]/i.test(head) || (/^<\?xml/i.test(trimmed) && /<svg[\s>]/i.test(head))) { return 'svg'; }
        if(/<amf[\s>]/i.test(head)) { return 'amf'; } // plain-XML AMF (zipped AMF looks like a ZIP)
        if(/"type"\s*:\s*"(FeatureCollection|Feature|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)"/.test(head)) { return 'geojson'; }
        if(/^solid\s/i.test(trimmed)) { return 'stl'; } // ASCII STL (binary STL has no reliable magic)
        if(/^ply\r?\n/i.test(trimmed)) { return 'ply'; }
        if(/^\s*0\r?\n\s*SECTION/i.test(head) || /AutoCAD/i.test(head)) { return 'dxf'; }
        if(/^gltf|"asset"\s*:\s*\{/i.test(trimmed) || /"asset"\s*:/.test(head)) { return 'gltf'; } // .gltf JSON
        if(/^(v|vn|vt|f|o|g)\s/m.test(head)) { return 'obj'; }

        return undefined;
    }

    //// GeoJSON → geo-types native serde helpers (interim) ////

    /** Flatten a GeoJSON container to (geometry, properties) pairs, carrying each
     *  feature's `properties` alongside its geometry so they can be attached to the
     *  resulting Curve's `metadata`. A Feature whose geometry is a GeometryCollection
     *  shares its properties across all sub-geometries. */
    private static _featuresOf(gj: any): Array<{ geometry: any; properties: Record<string, any> }>
    {
        const within = (geom: any, props: Record<string, any>): Array<{ geometry: any; properties: Record<string, any> }> =>
        {
            if(!geom) return [];
            if(geom.type === 'GeometryCollection')
            {
                return (geom.geometries ?? []).map((g: any) => ({ geometry: g, properties: props }));
            }
            return [{ geometry: geom, properties: props }];
        };

        switch(gj?.type)
        {
            case 'FeatureCollection': return (gj.features ?? []).flatMap((f: any) => within(f?.geometry, f?.properties ?? {}));
            case 'Feature':           return within(gj.geometry, gj.properties ?? {});
            case 'GeometryCollection':return (gj.geometries ?? []).map((g: any) => ({ geometry: g, properties: {} }));
            default:                  return gj?.type ? [{ geometry: gj, properties: {} }] : []; // bare geometry
        }
    }

    /** Convert one GeoJSON geometry to geo-types native serde JSON
     *  (externally-tagged enum). Returns undefined for unsupported types. */
    private static _geometryToGeoNative(g: any): any | undefined
    {
        const coord = (c: number[]) => ({ x: c[0], y: c[1] });
        const ring  = (r: number[][]) => r.map(coord);
        const poly  = (rings: number[][][]) => ({ exterior: ring(rings[0] ?? []), interiors: (rings.slice(1)).map(ring) });

        switch(g?.type)
        {
            case 'Point':           return { Point: coord(g.coordinates) };
            case 'MultiPoint':      return { MultiPoint: g.coordinates.map(coord) };
            case 'LineString':      return { LineString: ring(g.coordinates) };
            case 'MultiLineString': return { MultiLineString: g.coordinates.map(ring) };
            case 'Polygon':         return { Polygon: poly(g.coordinates) };
            case 'MultiPolygon':    return { MultiPolygon: g.coordinates.map(poly) };
            default:
                console.warn(`Importer.fromGeoJSON(): unsupported geometry type '${g?.type}' — skipped.`);
                return undefined;
        }
    }

    //// INPUT COERCION ////

    private static _toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array
    {
        if(typeof data === 'string') { return new TextEncoder().encode(data); }
        if(data instanceof Uint8Array) { return data; }
        return new Uint8Array(data);
    }

    private static _toText(data: string | Uint8Array | ArrayBuffer): string
    {
        if(typeof data === 'string') { return data; }
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        return new TextDecoder().decode(bytes);
    }
}
