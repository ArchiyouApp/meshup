/**
 *  GLTFBuilder.ts
 *
 *  All GLTF export machinery in one place:
 *    - Custom glTF extension definitions (EXT_mesh_primitive_edge_visibility,
 *      BENTLEY_materials_line_style) and their utility functions.
 *    - GLTFBuilder: two-pass export builder.
 *        Pass 1  add()             — writes base geometry into the Document
 *        Pass 2  applyExtensions() — wires the CAD-specific extensions
 *
 *  Usage:
 *    const glb = await new GLTFBuilder('z')
 *        .add(mesh)
 *        .add(curve)
 *        .applyExtensions()
 *        .toGLB();
 *
 *  Shapes (Mesh, Curve) and SceneNode can be passed to add() / addSceneNode().
 */

import
{
    Accessor,
    Document,
    Extension,
    ExtensionProperty,
    Material,
    NodeIO,
    Primitive,
    PropertyType,
    Scene as GltfScene,
    Node as GltfNode,
    Texture,
    type ReaderContext,
    type WriterContext,
} from '@gltf-transform/core';
import { Style, srgbToLinear } from './Style';
import { Color } from './Color';

import { GLTFJsonDocumentToString, remapAxis } from './utils';

/** Decode a base64 image (raw or `data:` URI) into bytes + mime type, in Node or the browser. */
function decodeImageData(data: string): { bytes: Uint8Array; mime: string }
{
    let mime = 'image/jpeg';
    let b64 = data;
    const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
    if (m) { mime = m[1]; b64 = m[2]; }
    let bytes: Uint8Array;
    if (typeof Buffer !== 'undefined') { bytes = new Uint8Array(Buffer.from(b64, 'base64')); }
    else
    {
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    return { bytes, mime };
}
import { EDGE_PROJECTION_DEFAULTS, SHAPE_DEFAULT_STYLE } from './constants';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Polygon } from './Polygon';
import { Vertex } from './Vertex';
import type { SceneNode } from './SceneNode';
import type { Axis, SceneNodeExport } from './types';

// ─── Utility: dash array → 16-bit repeating bitmask ──────────────────────────

/** FNV-1a string hash → 32-bit unsigned, used to seed per-shape texture randomisation. */
function hashSeed(s: string): number
{
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++)
    {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** mulberry32 PRNG — small, seedable, good enough for texture offsets. */
function mulberry32(seed: number): () => number
{
    let a = seed >>> 0;
    return () =>
    {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Parse a CSS color string to LINEAR 0..1 RGB, falling back to black.
 * glTF colour factors are linear; CSS colours are sRGB (see srgbToLinear in Style.ts).
 */
function rgbOf(color: string): [number, number, number]
{
    try { return new Color(color).toRgb().map(v => srgbToLinear(v / 255)) as [number, number, number]; }
    catch { return [0, 0, 0]; }
}

/**
 * Convert a strokeDash array (e.g. [5, 5]) to a 16-bit repeating bitmask.
 * Each bit represents one screen pixel: 1 = lit, 0 = dark.
 * Even-index segments are "on", odd-index segments are "off".
 *
 * Examples:
 *   [5, 5]  → 0b1111100000111110  (5 on, 5 off, wrapping at 16 bits)
 *   []      → 0xFFFF              (solid line)
 */
export function dashPatternToUint16(dash: number[]): number
{
    if (!dash.length) return 0xFFFF;
    const period = dash.reduce((a, b) => a + b, 0);
    if (period === 0) return 0xFFFF;

    let pattern = 0;
    for (let bit = 0; bit < 16; bit++)
    {
        const pos = bit % period;
        let cum = 0;
        for (let i = 0; i < dash.length; i++)
        {
            cum += dash[i];
            if (pos < cum)
            {
                if (i % 2 === 0) pattern |= (1 << bit);
                break;
            }
        }
    }
    return pattern;
}

// ─── Utility: edge visibility bitfield ───────────────────────────────────────

/**
 * Compute the 2-bit-per-edge visibility bitfield for EXT_mesh_primitive_edge_visibility.
 *
 * Encoding per edge:
 *   0 = hidden (smooth interior edge)
 *   2 = hard edge (crease or boundary)
 *
 * @param indices         Flat triangle index buffer (length = 3 × triCount)
 * @param positions       Flat vertex position buffer (length = 3 × vertexCount), F32 after axis remap
 * @param featureAngleDeg Crease angle threshold in degrees (e.g. 10)
 */
export function computeEdgeVisibilityBitfield(
    positions: Float32Array,
    indices: Uint32Array,
    featureAngleDeg: number,
): Uint8Array
{
    const triCount = indices.length / 3;
    const cosThreshold = Math.cos((featureAngleDeg * Math.PI) / 180);

    type EdgeRef = { tri: number; slot: number };
    const edgeMap = new Map<string, EdgeRef[]>();

    // Position-based edge key: unindexed meshes (OpenCASCADE style) assign each
    // triangle its own vertex copies, so two adjacent triangles share the same
    // edge *positions* but different *vertex indices*.  We must key on positions
    // to detect shared edges correctly.
    //
    // Use a fixed-grid quantization (1/QUANT per cell) to absorb the tiny
    // floating-point differences that arise when the WASM tessellator computes
    // shared-edge vertices independently for each triangle.  At 1e4 cells/unit,
    // float32 noise (~1e-7) maps to < 0.01 grid cells (safe margin), while
    // the minimum expected vertex spacing on a typical CAD mesh (>0.001 units)
    // maps to >10 grid cells (sufficient resolution).
    const QUANT = 1e4;
    const posKey = (v: number) => {
        const qx = Math.round(positions[v * 3]     * QUANT);
        const qy = Math.round(positions[v * 3 + 1] * QUANT);
        const qz = Math.round(positions[v * 3 + 2] * QUANT);
        return `${qx},${qy},${qz}`;
    };

    for (let tri = 0; tri < triCount; tri++)
    {
        const v0 = indices[tri * 3];
        const v1 = indices[tri * 3 + 1];
        const v2 = indices[tri * 3 + 2];
        const verts = [v0, v1, v2];

        for (let slot = 0; slot < 3; slot++)
        {
            const a = verts[slot];
            const b = verts[(slot + 1) % 3];
            const pA = posKey(a), pB = posKey(b);
            const key = pA < pB ? `${pA}|${pB}` : `${pB}|${pA}`;
            let refs = edgeMap.get(key);
            if (!refs) { refs = []; edgeMap.set(key, refs); }
            refs.push({ tri, slot });
        }
    }

    const totalEdges = triCount * 3;
    const bitfield = new Uint8Array(Math.ceil(totalEdges * 2 / 8));

    const setEdgeBits = (tri: number, slot: number, value: 0 | 2): void =>
    {
        if (value === 0) return;
        const edgeIndex = tri * 3 + slot;
        const byteIndex = Math.floor(edgeIndex * 2 / 8);
        const bitOffset = (edgeIndex * 2) % 8;
        bitfield[byteIndex] |= (value << bitOffset);
    };

    // Compute exact geometric face normal via cross product.
    // Averaging vertex normals is unreliable because vertices at sharp edges
    // carry blended normals from multiple faces, making two coplanar triangles
    // appear to have different normals and falsely classifying their shared
    // interior edge as a crease (showing tessellation triangles in the viewer).
    const triNormal = (tri: number): [number, number, number] =>
    {
        const i0 = indices[tri * 3];
        const i1 = indices[tri * 3 + 1];
        const i2 = indices[tri * 3 + 2];
        const ax = positions[i1 * 3]     - positions[i0 * 3];
        const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
        const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
        const bx = positions[i2 * 3]     - positions[i0 * 3];
        const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
        const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
        return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    };

    for (const adjacents of edgeMap.values())
    {
        let visibility: 0 | 2 = 0;

        if (adjacents.length === 1)
        {
            visibility = 2;
        }
        else
        {
            const [n0x, n0y, n0z] = triNormal(adjacents[0].tri);
            const [n1x, n1y, n1z] = triNormal(adjacents[1].tri);
            const len0 = Math.sqrt(n0x * n0x + n0y * n0y + n0z * n0z);
            const len1 = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z);
            if (len0 > 0 && len1 > 0)
            {
                const dot = (n0x * n1x + n0y * n1y + n0z * n1z) / (len0 * len1);
                if (dot < cosThreshold) visibility = 2;
            }
        }

        if (visibility !== 0)
        {
            for (const { tri, slot } of adjacents) setEdgeBits(tri, slot, visibility);
        }
    }

    return bitfield;
}

// ─── BENTLEY_materials_line_style ─────────────────────────────────────────────

/** ExtensionProperty for BENTLEY_materials_line_style. Attached to a Material. */
export class BentleyLineStyleProperty extends ExtensionProperty
{
    public static readonly EXTENSION_NAME = 'BENTLEY_materials_line_style';
    public readonly extensionName = 'BENTLEY_materials_line_style';
    public readonly propertyType = 'BentleyLineStyle';
    public readonly parentTypes = [PropertyType.MATERIAL];

    /** Line thickness in screen pixels (≥ 1). */
    public width = 1;

    /**
     * 16-bit repeating dash pattern bitmask (0–65535).
     * Each bit = one screen pixel: 1 = lit, 0 = dark.
     * Default 0xFFFF = solid line.
     */
    public pattern = 0xFFFF;

    protected init(): void {}
    protected getDefaults() { return super.getDefaults(); }
}

/** Extension class for BENTLEY_materials_line_style. */
export class BentleyLineStyleExtension extends Extension
{
    public static readonly EXTENSION_NAME = 'BENTLEY_materials_line_style';
    public readonly extensionName = 'BENTLEY_materials_line_style';

    createProperty(): BentleyLineStyleProperty
    {
        return new BentleyLineStyleProperty(this.document.getGraph());
    }

    read(context: ReaderContext): this
    {
        const json = context.jsonDoc.json as { materials?: any[] };
        if (!json.materials) return this;

        json.materials.forEach((matDef: any, matIdx: number) =>
        {
            const ext = matDef.extensions?.['BENTLEY_materials_line_style'];
            if (!ext) return;
            const material = context.materials[matIdx];
            if (!material) return;
            const prop = this.createProperty();
            if (ext.width   !== undefined) prop.width   = ext.width;
            if (ext.pattern !== undefined) prop.pattern = ext.pattern;
            material.setExtension('BENTLEY_materials_line_style', prop);
        });

        return this;
    }

    write(context: WriterContext): this
    {
        const json = context.jsonDoc.json as { materials?: any[] };
        if (!json.materials) return this;

        this.document.getRoot().listMaterials().forEach((material) =>
        {
            const prop = material.getExtension<BentleyLineStyleProperty>('BENTLEY_materials_line_style');
            if (!prop) return;

            const matIdx = context.materialIndexMap.get(material);
            if (matIdx === undefined) return;

            const matDef = json.materials![matIdx] as { extensions?: Record<string, unknown> };
            matDef.extensions = matDef.extensions ?? {};
            matDef.extensions['BENTLEY_materials_line_style'] = {
                width: prop.width,
                pattern: prop.pattern,
            };
        });

        return this;
    }
}

// ─── AY_materials_point_style ─────────────────────────────────────────────────

/** ExtensionProperty for AY_materials_point_style. Attached to a Material. */
export class PointStyleProperty extends ExtensionProperty
{
    public static readonly EXTENSION_NAME = 'AY_materials_point_style';
    public readonly extensionName = 'AY_materials_point_style';
    public readonly propertyType = 'PointStyle';
    public readonly parentTypes = [PropertyType.MATERIAL];

    /** Marker diameter in screen pixels (≥ 1). */
    public size = 5;

    /** Marker shape rendered by the viewer. */
    public shape: 'circle' | 'square' = 'circle';

    protected init(): void {}
    protected getDefaults() { return super.getDefaults(); }
}

/** Extension class for AY_materials_point_style. */
export class PointStyleExtension extends Extension
{
    public static readonly EXTENSION_NAME = 'AY_materials_point_style';
    public readonly extensionName = 'AY_materials_point_style';

    createProperty(): PointStyleProperty
    {
        return new PointStyleProperty(this.document.getGraph());
    }

    read(context: ReaderContext): this
    {
        const json = context.jsonDoc.json as { materials?: any[] };
        if (!json.materials) return this;

        json.materials.forEach((matDef: any, matIdx: number) =>
        {
            const ext = matDef.extensions?.['AY_materials_point_style'];
            if (!ext) return;
            const material = context.materials[matIdx];
            if (!material) return;
            const prop = this.createProperty();
            if (ext.size  !== undefined) prop.size  = ext.size;
            if (ext.shape !== undefined) prop.shape = ext.shape;
            material.setExtension('AY_materials_point_style', prop);
        });

        return this;
    }

    write(context: WriterContext): this
    {
        const json = context.jsonDoc.json as { materials?: any[] };
        if (!json.materials) return this;

        this.document.getRoot().listMaterials().forEach((material) =>
        {
            const prop = material.getExtension<PointStyleProperty>('AY_materials_point_style');
            if (!prop) return;

            const matIdx = context.materialIndexMap.get(material);
            if (matIdx === undefined) return;

            const matDef = json.materials![matIdx] as { extensions?: Record<string, unknown> };
            matDef.extensions = matDef.extensions ?? {};
            matDef.extensions['AY_materials_point_style'] = {
                size: prop.size,
                shape: prop.shape,
            };
        });

        return this;
    }
}

// ─── EXT_mesh_primitive_edge_visibility ───────────────────────────────────────

/** ExtensionProperty for EXT_mesh_primitive_edge_visibility. Attached to a Primitive. */
export class EdgeVisibilityProperty extends ExtensionProperty
{
    public static readonly EXTENSION_NAME = 'EXT_mesh_primitive_edge_visibility';
    public readonly extensionName = 'EXT_mesh_primitive_edge_visibility';
    public readonly propertyType = 'EdgeVisibility';
    public readonly parentTypes = [PropertyType.PRIMITIVE];

    /** Accessor containing the 2-bit-per-edge visibility bitfield. */
    public visibilityAccessor: Accessor | null = null;

    /** Optional material used for rendering the visible edges. */
    public edgeMaterial: Material | null = null;

    protected init(): void {}
    protected getDefaults() { return super.getDefaults(); }
}

/** Extension class for EXT_mesh_primitive_edge_visibility. */
export class EdgeVisibilityExtension extends Extension
{
    public static readonly EXTENSION_NAME = 'EXT_mesh_primitive_edge_visibility';
    public readonly extensionName = 'EXT_mesh_primitive_edge_visibility';

    createProperty(): EdgeVisibilityProperty
    {
        return new EdgeVisibilityProperty(this.document.getGraph());
    }

    read(context: ReaderContext): this
    {
        const json = context.jsonDoc.json as { meshes?: Array<{ primitives?: any[] }> };
        if (!json.meshes) return this;

        json.meshes.forEach((meshDef: any, meshIdx: number) =>
        {
            const mesh = context.meshes[meshIdx];
            if (!mesh) return;
            const primitives = mesh.listPrimitives();

            (meshDef.primitives ?? []).forEach((primDef: any, primIdx: number) =>
            {
                const ext = primDef.extensions?.['EXT_mesh_primitive_edge_visibility'];
                if (!ext) return;
                const prim = primitives[primIdx];
                if (!prim) return;
                const prop = this.createProperty();
                if (ext.visibility !== undefined) prop.visibilityAccessor = context.accessors[ext.visibility];
                if (ext.material   !== undefined) prop.edgeMaterial       = context.materials[ext.material];
                prim.setExtension('EXT_mesh_primitive_edge_visibility', prop);
            });
        });

        return this;
    }

    write(context: WriterContext): this
    {
        const json = context.jsonDoc.json as { meshes?: Array<{ primitives: any[] }> };
        if (!json.meshes) return this;

        this.document.getRoot().listMeshes().forEach((mesh) =>
        {
            const meshIdx = context.meshIndexMap.get(mesh);
            if (meshIdx === undefined) return;

            mesh.listPrimitives().forEach((prim, primIdx) =>
            {
                const prop = prim.getExtension<EdgeVisibilityProperty>('EXT_mesh_primitive_edge_visibility');
                if (!prop) return;

                const primDef = json.meshes![meshIdx].primitives[primIdx] as {
                    extensions?: Record<string, unknown>
                };
                primDef.extensions = primDef.extensions ?? {};

                const extData: Record<string, number> = {};

                if (prop.visibilityAccessor)
                {
                    const accIdx = context.accessorIndexMap.get(prop.visibilityAccessor);
                    if (accIdx !== undefined) extData['visibility'] = accIdx;
                }

                if (prop.edgeMaterial)
                {
                    const matIdx = context.materialIndexMap.get(prop.edgeMaterial);
                    if (matIdx !== undefined) extData['material'] = matIdx;
                }

                primDef.extensions['EXT_mesh_primitive_edge_visibility'] = extData;
            });
        });

        return this;
    }
}

// ─── NodeIO factory ───────────────────────────────────────────────────────────

/** Create a NodeIO with both custom extensions registered. */
export function createNodeIO(): NodeIO
{
    return new NodeIO().registerExtensions([
        BentleyLineStyleExtension,
        EdgeVisibilityExtension,
        PointStyleExtension,
    ]);
}

// ─── Pending extension descriptors ────────────────────────────────────────────

type PendingMeshExt = {
    type: 'mesh';
    primitive: Primitive;
    indices: Uint32Array;
    positions: Float32Array;
    normals: Float32Array;
    style: Style;
};

type PendingCurveExt = {
    type: 'curve';
    material: Material;
    style: Style;
};

type PendingPointExt = {
    type: 'point';
    material: Material;
    style: Style;
};

type PendingExt = PendingMeshExt | PendingCurveExt | PendingPointExt;

// ─── GLTFBuilder ──────────────────────────────────────────────────────────────

export class GLTFBuilder
{
    private _doc: Document;
    private _scene: GltfScene;
    private _up: Axis;
    private _pending: PendingExt[] = [];

    constructor(up: Axis = 'z', sceneName = 'scene')
    {
        this._doc = new Document();
        this._scene = this._doc.createScene(sceneName);
        this._doc.getRoot().setDefaultScene(this._scene);
        this._up = up;
    }

    //// PUBLIC ACCESSORS ////

    /** The gltf-transform Document being built. */
    get doc(): Document { return this._doc; }

    /** The up-axis configured for this build. */
    get up(): Axis { return this._up; }

    //// GEOMETRY PASS ////

    /**
     * Add a Mesh or Curve to this builder.
     * Geometry is written to the Document immediately; extension data is
     * queued for the applyExtensions() pass. Curve holes are added automatically.
     */
    add(item: Mesh | Curve | Polygon | Vertex, name?: string): this
    {
        if (item.style.visible === false) return this;
        if (item instanceof Mesh)
        {
            const n = name ?? 'mesh';
            if (!item._mesh || item.vertices().length === 0) return this;
            const { node, primitive, indices, positions, normals } = this._meshToGLTFNode(item, n);
            this.addSceneChild(node);
            this.queueMeshExtData(primitive, indices, positions, normals, item.style);
        }
        else if (item instanceof Polygon)
        {
            const n = name ?? 'polygon';
            if (item.vertices().length === 0) return this;
            const mesh = item.toMesh();
            const { node, primitive, indices, positions, normals } = this._meshToGLTFNode(mesh, n);
            this.addSceneChild(node);
            this.queueMeshExtData(primitive, indices, positions, normals, item.style);
        }
        else if (item instanceof Vertex)
        {
            const n = name ?? 'vertex';
            const { node, material } = this._vertexToGLTFNode(item, n);
            this.addSceneChild(node);
            this.queuePointExtData(material, item.style);
        }
        else
        {
            const n = name ?? 'curve';
            const { node, material } = this._curveToGLTFNode(item, n);
            this.addSceneChild(node);
            this.queueCurveExtData(material, item.style);

            if (item.hasHoles())
            {
                item.holes().forEach((hole, h) =>
                {
                    const { node: holeNode, material: holeMat } = this._curveToGLTFNode(hole, `${n}_hole_${h}`);
                    this.addSceneChild(holeNode);
                    this.queueCurveExtData(holeMat, hole.style);
                });
            }
        }
        return this;
    }

    /** Add a SceneNode hierarchy to this builder. */
    addSceneNode(node: SceneNode<any>, _name?: string): this
    {
        const rootNode = this._sceneNodeToGLTFNode(node);
        if (rootNode) this.addSceneChild(rootNode);
        return this;
    }

    /** Attach a top-level geometry node to the scene root. Called by shapes. */
    addSceneChild(node: GltfNode): this
    {
        this._scene.addChild(node);
        return this;
    }

    /** Queue mesh extension data (EXT_edge_visibility + optional BENTLEY_line_style). */
    queueMeshExtData(
        primitive: Primitive,
        indices: Uint32Array,
        positions: Float32Array,
        normals: Float32Array,
        style: Style,
    ): this
    {
        this._pending.push({ type: 'mesh', primitive, indices, positions, normals, style });
        return this;
    }

    /** Queue curve extension data (BENTLEY_materials_line_style). */
    queueCurveExtData(material: Material, style: Style): this
    {
        this._pending.push({ type: 'curve', material, style });
        return this;
    }

    /** Queue point extension data (AY_materials_point_style). */
    queuePointExtData(material: Material, style: Style): this
    {
        this._pending.push({ type: 'point', material, style });
        return this;
    }

    /** True when no visible shapes have been added yet. */
    isEmpty(): boolean
    {
        return this._scene.listChildren().length === 0;
    }

    //// EXTENSION PASS ////

    /**
     * Second pass: apply all queued CAD-specific extensions.
     * Must be called after all add() calls, before toGLTF() / toGLB().
     */
    applyExtensions(): this
    {
        for (const ext of this._pending)
        {
            if (ext.type === 'mesh')       this._applyMeshExtensions(ext);
            else if (ext.type === 'point') this._applyPointExtensions(ext);
            else                           this._applyCurveExtensions(ext);
        }
        this._pending = [];
        return this;
    }

    //// SERIALIZE ////

    /** Serialize to a self-contained GLTF JSON string. */
    async toGLTF(): Promise<string>
    {
        return createNodeIO().writeJSON(this._doc).then(GLTFJsonDocumentToString);
    }

    /** Serialize to a GLB binary (Uint8Array). */
    async toGLB(): Promise<Uint8Array>
    {
        return createNodeIO().writeBinary(this._doc);
    }

    //// SCENE NODE ////

    /** Recursively builds a GltfNode tree from a SceneNode hierarchy. */
    _sceneNodeToGLTFNode(node: SceneNode<any>): GltfNode | null
    {
        const gltfNode = this._doc.createNode(node.name);

        // Tag nodes that were explicitly hidden so the viewer can initialise them
        // as hidden while still allowing the user to toggle visibility on demand.
        if (node.style.visible === false)
        {
            gltfNode.setExtras({ defaultVisible: false } as SceneNodeExport as any); // NOTE: setExtras has no TS type
        }

        // Cascade the node's effective style down to each shape: node style is the base,
        // shape's own explicit properties take precedence.
        // Use non-recursive shapes() so each shape is processed exactly once,
        // by its own owning node (children are handled via the children().forEach below).
        const nodeEffective = node.effectiveStyle();

        const _directShape = node.shape();
        (_directShape ? [_directShape] : []).forEach((shape, i) =>
        {
            const name = `${node.name}_shape_${i}`;
            const cascadedStyle = new Style(nodeEffective.toData());
            cascadedStyle.merge(shape.style.explicitData() as any);

            // When the cascaded visibility is false (either the node or the shape
            // itself was hidden), tag the containing GLTF node as defaultVisible:false
            // so the viewer and scene navigator initialise it as hidden.
            // Do NOT return early — include the geometry so the user can toggle
            // visibility from the scene navigator, consistent with node.hide() behaviour.
            if (cascadedStyle.visible === false)
                gltfNode.setExtras({ defaultVisible: false });

            if (shape instanceof Mesh || shape.type === 'Mesh')
            {
                const mesh = shape as unknown as Mesh;
                if (!mesh._mesh || mesh.vertices().length === 0) return;
                const { node: meshNode, primitive, indices, positions, normals } = this._meshToGLTFNode(mesh, name, cascadedStyle);
                gltfNode.addChild(meshNode);
                this.queueMeshExtData(primitive, indices, positions, normals, cascadedStyle);
            }
            else if (shape instanceof Polygon || shape.type === 'Polygon')
            {
                const polygon = shape as unknown as Polygon;
                if (polygon.vertices().length === 0) return;
                const mesh = polygon.toMesh();
                const { node: meshNode, primitive, indices, positions, normals } = this._meshToGLTFNode(mesh, name, cascadedStyle);
                gltfNode.addChild(meshNode);
                this.queueMeshExtData(primitive, indices, positions, normals, cascadedStyle);
            }
            else if (shape instanceof Vertex || shape.type === 'Vertex')
            {
                const vertex = shape as unknown as Vertex;
                const { node: vertexNode, material } = this._vertexToGLTFNode(vertex, name, cascadedStyle);
                gltfNode.addChild(vertexNode);
                this.queuePointExtData(material, cascadedStyle);
            }
            else if (shape instanceof Curve || shape.type === 'Curve')
            {
                const curve = shape as unknown as Curve;
                const { node: curveNode, material } = this._curveToGLTFNode(curve, name, cascadedStyle);
                gltfNode.addChild(curveNode);
                this.queueCurveExtData(material, cascadedStyle);
            }
        });

        node.children().forEach(child =>
        {
            const childNode = this._sceneNodeToGLTFNode(child);
            if (childNode) gltfNode.addChild(childNode);
        });

        return gltfNode;
    }

    //// PRIVATE: GEOMETRY BUILDERS ////

    /** Assemble a GltfNode for a Mesh from its raw toBuffer() data. */
    private _meshToGLTFNode(mesh: Mesh, name = 'mesh', style?: Style): { node: GltfNode; primitive: Primitive; indices: Uint32Array; positions: Float32Array; normals: Float32Array }
    {
        const { positions: posRaw, normals: normRaw, indices } = mesh.toBuffer();
        const count = posRaw.length / 3;
        const posF32 = new Float32Array(count * 3);
        const normF32 = new Float32Array(count * 3);
        const c = mesh.bbox().center();
        for (let i = 0; i < count; i++)
        {
            [posF32[i * 3], posF32[i * 3 + 1], posF32[i * 3 + 2]] = remapAxis(posRaw[i * 3] - c.x, posRaw[i * 3 + 1] - c.y, posRaw[i * 3 + 2] - c.z, this._up);
            [normF32[i * 3], normF32[i * 3 + 1], normF32[i * 3 + 2]] = remapAxis(normRaw[i * 3], normRaw[i * 3 + 1], normRaw[i * 3 + 2], this._up);
        }
        const idxCopy = new Uint32Array(indices.buffer.slice(0) as ArrayBuffer);

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();
        const posAcc = this._doc.createAccessor().setType(Accessor.Type.VEC3).setArray(posF32).setBuffer(gtBuf);
        const normAcc = this._doc.createAccessor().setType(Accessor.Type.VEC3).setArray(normF32).setBuffer(gtBuf);
        const st = (style ?? mesh.style);
        const matDef = st.toGltfMaterial('mesh_material', false) as any;
        const pbr = matDef.pbrMetallicRoughness;

        const gltfMesh = this._doc.createMesh(name);
        const [tx, ty, tz] = remapAxis(c.x, c.y, c.z, this._up);
        const node = this._doc.createNode(name).setMesh(gltfMesh).setTranslation([tx, ty, tz]);

        // Base material factory (PBR ± an optional role texture with a given wrap mode).
        //
        // glTF base colour is baseColorFactor × baseColorTexture. Material textures are
        // therefore authored as GREYSCALE tint masks: the factor supplies the hue and the
        // texture only modulates it. Feeding a COLOURED texture here double-tints — brown
        // over brown rendered ~2.5x too dark — so keep material textures monochrome.
        const makeMaterial = (nm: string, texData?: string, wrap = 10497): Material =>
        {
            const m = this._doc.createMaterial(nm)
                .setBaseColorFactor(pbr.baseColorFactor)
                .setMetallicFactor(pbr.metallicFactor)
                .setRoughnessFactor(pbr.roughnessFactor)
                .setDoubleSided(matDef.doubleSided ?? true);
            if (matDef.alphaMode) m.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');
            if (texData)
            {
                m.setBaseColorTexture(this._getMaterialTexture(texData, nm));
                const info = m.getBaseColorTextureInfo();
                if (info) info.setWrapS(wrap as any).setWrapT(wrap as any);
            }
            return m;
        };

        const spec: any = (st as any)._style?.material;
        const sectionTex = (spec && typeof spec === 'object' && spec.textures?.section?.data) ? spec.textures.section : null;
        const sidesTex   = (spec && typeof spec === 'object' && spec.textures?.sides?.data)   ? spec.textures.sides   : null;

        // No material textures → single PBR primitive (original behaviour).
        if (!sectionTex && !sidesTex)
        {
            const idxAcc = this._doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(idxCopy).setBuffer(gtBuf);
            const primitive = this._doc.createPrimitive()
                .setAttribute('POSITION', posAcc).setAttribute('NORMAL', normAcc)
                .setIndices(idxAcc).setMode(Primitive.Mode.TRIANGLES)
                .setMaterial(makeMaterial('mesh_material'));
            gltfMesh.addPrimitive(primitive);
            return { node, primitive, indices: idxCopy, positions: posF32, normals: normF32 };
        }

        // Textured. Split faces into `section` (the two end faces, normal ∥ the longest
        // OBB axis) and `sides` (the rest). Both are fitted at real-world scale with a
        // per-shape random offset so identical parts don't look cloned.
        const modelUnitMM: number = (spec && spec.modelUnitMM) || 1;
        // Seed on name + size, so the crop is stable across re-exports but differs between parts.
        const seed = hashSeed(`${name}|${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}|${count}`);
        const { sectionUV, sidesUV, sectionIdx, sidesIdx, sectionFits, sidesFits } =
            this._planarUVsForMaterial(posF32, normF32, idxCopy, count, modelUnitMM, sectionTex, sidesTex, seed);

        // Independent UV accessors so each role uses its own mapping.
        const sidesUVAcc = this._doc.createAccessor().setType(Accessor.Type.VEC2).setArray(sidesUV as any).setBuffer(gtBuf);
        const sectionUVAcc = sectionIdx.length
            ? this._doc.createAccessor().setType(Accessor.Type.VEC2).setArray(sectionUV as any).setBuffer(gtBuf)
            : sidesUVAcc;

        const buildPrim = (idxArr: number[], uvAccessor: any, material: Material) =>
        {
            const ia = this._doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint32Array(idxArr)).setBuffer(gtBuf);
            return this._doc.createPrimitive()
                .setAttribute('POSITION', posAcc).setAttribute('NORMAL', normAcc).setAttribute('TEXCOORD_0', uvAccessor)
                .setIndices(ia).setMode(Primitive.Mode.TRIANGLES).setMaterial(material);
        };

        // Wrap mode is a per-shape decision: clamp only when the part actually fits inside
        // one tile, otherwise the clamped edge pixel smears along the overrun.
        const CLAMP = 33071, REPEAT = 10497;
        const sidesWrap = (sidesTex?.repeat === false && sidesFits) ? CLAMP : REPEAT;
        const sectionWrap = sectionFits ? CLAMP : REPEAT;

        const built: Array<{ prim: Primitive; idx: Uint32Array }> = [];
        if (sidesIdx.length)
        {
            const prim = buildPrim(sidesIdx, sidesUVAcc, makeMaterial('mesh_sides', sidesTex?.data, sidesWrap));
            gltfMesh.addPrimitive(prim);
            built.push({ prim, idx: new Uint32Array(sidesIdx) });
        }
        if (sectionIdx.length)
        {
            const prim = buildPrim(sectionIdx, sectionUVAcc, makeMaterial('mesh_section', sectionTex?.data ?? sidesTex?.data, sectionWrap));
            gltfMesh.addPrimitive(prim);
            built.push({ prim, idx: new Uint32Array(sectionIdx) });
        }

        // First primitive is returned for the caller's edge-extension queue; queue the rest here.
        for (let i = 1; i < built.length; i++) this.queueMeshExtData(built[i].prim, built[i].idx, posF32, normF32, st);
        const primary = built[0];
        return { node, primitive: primary.prim, indices: primary.idx, positions: posF32, normals: normF32 };
    }

    /** Cache of embedded material textures, keyed by role+data, deduped across primitives. */
    private _materialTextureCache = new Map<string, Texture>();

    /** Get or create a deduped gltf Texture from an embedded base64 data URI. */
    private _getMaterialTexture(data: string, name: string): Texture
    {
        const key = String(data).slice(0, 64) + `:${data.length}`;
        let texture = this._materialTextureCache.get(key);
        if (!texture)
        {
            const { bytes, mime } = decodeImageData(data);
            texture = this._doc.createTexture(name).setImage(bytes).setMimeType(mime);
            this._materialTextureCache.set(key, texture);
        }
        return texture;
    }

    /**
     * Split an (unindexed, per-face-normal) mesh into `section` vs `sides` faces and
     * compute per-role UVs at real-world scale.
     *
     *  - The longest OBB axis is the "length"; the two faces whose normal is parallel
     *    to it are the `section` (end) faces.
     *  - All other faces are `sides`.
     *
     * Both roles are mapped at real-world scale relative to the part's own bounding box
     * and then shifted by a random offset, so identical parts get a different crop of
     * the texture instead of looking cloned. Textures are authored at the largest
     * obtainable extent for the material (a log face for wood), so a part normally fits
     * inside one tile and never visibly repeats.
     *
     * The offsets come from a PRNG seeded on the shape (`seed`), not Math.random: the
     * appearance must be stable across re-exports, or every run reshuffles every part.
     *
     * Returns per-vertex UV arrays (length count*2), the triangle index lists per role,
     * and whether each role fits within a single tile (the caller picks CLAMP vs REPEAT
     * from that — clamping a part that overruns its tile smears the edge pixel).
     * A UV array is meaningful only at the vertices its role's indices reference.
     */
    private _planarUVsForMaterial(
        posF32: Float32Array, normF32: Float32Array, idx: Uint32Array, count: number,
        modelUnitMM: number, sectionTex: any, sidesTex: any, seed: number):
        {
            sectionUV: Float32Array; sidesUV: Float32Array;
            sectionIdx: number[]; sidesIdx: number[];
            sectionFits: boolean; sidesFits: boolean;
        }
    {
        const rnd = mulberry32(seed);
        // Longest axis (from centered positions) → the beam/board length.
        const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++)
        { const v = posF32[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
        const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
        const lengthAxis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : (ext[1] >= ext[2] ? 1 : 2);
        const [axA, axB] = [0, 1, 2].filter(a => a !== lengthAxis); // the two cross-section axes

        // Classify each triangle by its (per-face) normal's dominant axis.
        const role = new Uint8Array(count); // 1 = section, 0 = sides
        const sectionIdx: number[] = [], sidesIdx: number[] = [];
        const tris = Math.floor(idx.length / 3);
        for (let t = 0; t < tris; t++)
        {
            const v0 = idx[t * 3];
            const nx = Math.abs(normF32[v0 * 3]), ny = Math.abs(normF32[v0 * 3 + 1]), nz = Math.abs(normF32[v0 * 3 + 2]);
            const dom = nx >= ny && nx >= nz ? 0 : (ny >= nz ? 1 : 2);
            const isSection = !!sectionTex && dom === lengthAxis;
            const list = isSection ? sectionIdx : sidesIdx;
            for (let s = 0; s < 3; s++) { const v = idx[t * 3 + s]; list.push(v); role[v] = isSection ? 1 : 0; }
        }

        // Section face extents (over the two cross-section axes) for a real-scale fit.
        let sMinA = Infinity, sMaxA = -Infinity, sMinB = Infinity, sMaxB = -Infinity;
        for (let i = 0; i < count; i++) if (role[i] === 1)
        {
            const a = posF32[i * 3 + axA], b = posF32[i * 3 + axB];
            if (a < sMinA) sMinA = a; if (a > sMaxA) sMaxA = a; if (b < sMinB) sMinB = b; if (b > sMaxB) sMaxB = b;
        }
        const secW = (sectionTex?.realWidth ?? 150), secH = (sectionTex?.realHeight ?? 150);
        const spanA = (sMaxA - sMinA) * modelUnitMM / secW, spanB = (sMaxB - sMinB) * modelUnitMM / secH;
        const offA = rnd() * Math.max(0, 1 - spanA), offB = rnd() * Math.max(0, 1 - spanB);

        // Sides texture is directional: its Y (v, realHeight) is the longitudinal grain
        // direction. Default to a 500×889 mm tile (a log face) so v maps the long axis.
        const sidW = (sidesTex?.realWidth ?? 500), sidH = (sidesTex?.realHeight ?? 889);

        // Side spans: v always runs along the length axis; u runs along whichever cross
        // axis is not the face normal, so budget for the wider of the two.
        const spanLen = ext[lengthAxis] * modelUnitMM / sidH;
        const spanWid = Math.max(ext[axA], ext[axB]) * modelUnitMM / sidW;
        const offU = rnd() * Math.max(0, 1 - spanWid), offV = rnd() * Math.max(0, 1 - spanLen);

        const sectionUV = new Float32Array(count * 2), sidesUV = new Float32Array(count * 2);
        for (let i = 0; i < count; i++)
        {
            if (role[i] === 1)
            {
                // real-scale, randomly offset, non-repeating crop of the section image
                const a = posF32[i * 3 + axA], b = posF32[i * 3 + axB];
                sectionUV[i * 2] = (a - sMinA) * modelUnitMM / secW + offA;
                sectionUV[i * 2 + 1] = (b - sMinB) * modelUnitMM / secH + offB;
            }
            else
            {
                // Sides: align texture-V with the material's LONGITUDINAL (length) axis so
                // the grain runs down the beam; U spans the cross-width axis. The side face's
                // normal is one of the two non-length axes; the width axis is the other one.
                // Positions are taken relative to the part's own bbox (not absolute space) so
                // the random offset is what distinguishes one part from the next.
                const nx = Math.abs(normF32[i * 3]), ny = Math.abs(normF32[i * 3 + 1]), nz = Math.abs(normF32[i * 3 + 2]);
                const N = nx >= ny && nx >= nz ? 0 : (ny >= nz ? 1 : 2);
                const widthAxis = (N === axA) ? axB : axA;
                sidesUV[i * 2] = (posF32[i * 3 + widthAxis] - mn[widthAxis]) * modelUnitMM / sidW + offU;
                sidesUV[i * 2 + 1] = (posF32[i * 3 + lengthAxis] - mn[lengthAxis]) * modelUnitMM / sidH + offV;
            }
        }
        return {
            sectionUV, sidesUV, sectionIdx, sidesIdx,
            sectionFits: spanA <= 1 && spanB <= 1,
            sidesFits: spanWid <= 1 && spanLen <= 1,
        };
    }

    /**
     * Resample a tessellated polyline so a vertex lands on every gradient stop, and report each
     * vertex's position along the curve as a fraction of ARC LENGTH.
     *
     * Two reasons this is not just `i / (count - 1)`:
     *
     *  - Tessellation is adaptive (chord error, not even spacing), so index position and arc
     *    position diverge wherever a curve is tightly curved. A gradient driven by index would
     *    visibly bunch up on the tight parts.
     *  - A colour only exists AT a vertex; between vertices the GPU interpolates linearly. A
     *    straight line tessellates to two points, i.e. one segment, so a three-stop ramp on it
     *    would interpolate first→last and drop the middle stop entirely. Inserting a vertex at
     *    each stop is what makes multi-stop gradients work on straight geometry.
     *
     * Returns the (possibly extended) points in the same flat xyz layout as the input.
     */
    private static _resampleAlongStops(
        raw: Float32Array, stops: Array<{ at: number }>): { points: Float32Array; t: Float32Array }
    {
        const n = raw.length / 3;
        const at = (i: number): [number, number, number] => [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]];

        // Cumulative arc length → t per original vertex.
        const ts = new Float32Array(n);
        let total = 0;
        for (let i = 1; i < n; i++)
        {
            const [x0, y0, z0] = at(i - 1), [x1, y1, z1] = at(i);
            total += Math.hypot(x1 - x0, y1 - y0, z1 - z0);
            ts[i] = total;
        }
        // A closed or degenerate curve of zero length has no meaningful parameterisation; leave
        // every vertex at 0 so the ramp's first colour is used throughout rather than dividing
        // by zero.
        if (total > 0) { for (let i = 0; i < n; i++) { ts[i] /= total; } }

        // Merge in any interior stop that no vertex already sits on.
        const EPS = 1e-6;
        const wanted: number[] = Array.from(ts);
        for (const s of stops)
        {
            if (s.at <= EPS || s.at >= 1 - EPS) { continue; }
            if (wanted.some(t => Math.abs(t - s.at) < EPS)) { continue; }
            wanted.push(s.at);
        }

        if (wanted.length === n) { return { points: raw, t: ts }; }
        wanted.sort((a, b) => a - b);

        const out = new Float32Array(wanted.length * 3);
        const tOut = new Float32Array(wanted.length);
        let seg = 0;
        for (let k = 0; k < wanted.length; k++)
        {
            const t = wanted[k];
            tOut[k] = t;
            while (seg < n - 2 && ts[seg + 1] < t) { seg++; }

            const span = ts[seg + 1] - ts[seg];
            const local = span > 0 ? Math.max(0, Math.min(1, (t - ts[seg]) / span)) : 0;
            const [x0, y0, z0] = at(seg), [x1, y1, z1] = at(seg + 1);
            out[k * 3]     = x0 + (x1 - x0) * local;
            out[k * 3 + 1] = y0 + (y1 - y0) * local;
            out[k * 3 + 2] = z0 + (z1 - z0) * local;
        }
        return { points: out, t: tOut };
    }

    /** Assemble a GltfNode for a Curve from its raw toBuffer() data. */
    private _curveToGLTFNode(curve: Curve, name = 'curve', style?: Style): { node: GltfNode; material: Material }
    {
        const effStyle = style ?? curve.style;
        const gradient = effStyle.gradient;

        let rawBuf = curve.toBuffer();
        let tPerVertex: Float32Array | null = null;
        if (gradient)
        {
            const resampled = GLTFBuilder._resampleAlongStops(rawBuf, gradient.stops);
            rawBuf = resampled.points;
            tPerVertex = resampled.t;
        }

        const count = rawBuf.length / 3;
        const posF32 = new Float32Array(count * 3);
        const bb = curve.bbox();
        const c = bb ? bb.center() : { x: 0, y: 0, z: 0 };
        for (let i = 0; i < count; i++)
        {
            [posF32[i * 3], posF32[i * 3 + 1], posF32[i * 3 + 2]] = remapAxis(rawBuf[i * 3] - c.x, rawBuf[i * 3 + 1] - c.y, rawBuf[i * 3 + 2] - c.z, this._up);
        }

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();
        const posAcc = this._doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(posF32)
            .setBuffer(gtBuf);

        const matDef = effStyle.toGltfMaterial('curve_material', true) as any;
        const [r, g, b, a] = matDef.pbrMetallicRoughness.baseColorFactor;
        const material = this._doc.createMaterial('curve_material')
            // glTF MULTIPLIES COLOR_0 by baseColorFactor, so a gradient curve's factor has to be
            // white or every stop would be tinted by the flat stroke colour. Every curve already
            // owns a private material here (nothing is deduplicated), so this affects only this
            // one curve. Alpha is kept: opacity stays uniform, it is not part of the ramp.
            .setBaseColorFactor(gradient ? [1, 1, 1, a] : [r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const prim = this._doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setMode(Primitive.Mode.LINE_STRIP)
            .setMaterial(material);

        if (gradient && tPerVertex)
        {
            // VEC3, not VEC4: fat lines carry only rgb per vertex (instanceColorStart is a
            // vec3), so a per-vertex alpha would work on hairlines and silently not on thick
            // lines. Opacity therefore stays on the material.
            const colF32 = new Float32Array(count * 3);
            // Resolve each stop's colour ONCE — Color._cssNameToHex rebuilds a 148-entry table
            // per call, and this loop runs per vertex.
            const resolved = gradient.stops.map(s => ({ at: s.at, color: new Color(s.color) }));
            for (let i = 0; i < count; i++)
            {
                const [cr, cg, cb] = Color.sample(resolved, tPerVertex[i]).toRgb();
                colF32[i * 3]     = srgbToLinear(cr / 255);
                colF32[i * 3 + 1] = srgbToLinear(cg / 255);
                colF32[i * 3 + 2] = srgbToLinear(cb / 255);
            }
            const colAcc = this._doc.createAccessor()
                .setType(Accessor.Type.VEC3)
                .setArray(colF32)
                .setBuffer(gtBuf);
            prim.setAttribute('COLOR_0', colAcc);
        }

        const gltfMesh = this._doc.createMesh(name).addPrimitive(prim);
        const [tx, ty, tz] = remapAxis(c.x, c.y, c.z, this._up);
        const node = this._doc.createNode(name).setMesh(gltfMesh).setTranslation([tx, ty, tz]);
        return { node, material };
    }

    /** Assemble a GltfNode for a Vertex as a GLTF POINTS primitive at local origin. */
    private _vertexToGLTFNode(vertex: Vertex, name = 'vertex', style?: Style): { node: GltfNode; material: Material }
    {
        const posF32 = new Float32Array([0, 0, 0]);
        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();
        const posAcc = this._doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(posF32)
            .setBuffer(gtBuf);

        const st = style ?? vertex.style;
        const matDef = st.toGltfMaterial('vertex_material', true) as any;
        const [, , , a] = matDef.pbrMetallicRoughness.baseColorFactor;
        // Point marker color is independent: point.color if set, else the shape's shared color.
        const [r, g, b] = st.pointColorRgb();
        const material = this._doc.createMaterial('vertex_material')
            .setBaseColorFactor([r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const prim = this._doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setMode(Primitive.Mode.POINTS)
            .setMaterial(material);

        const gltfMesh = this._doc.createMesh(name).addPrimitive(prim);
        const [tx, ty, tz] = remapAxis(vertex.x, vertex.y, vertex.z, this._up);
        const node = this._doc.createNode(name).setMesh(gltfMesh).setTranslation([tx, ty, tz]);
        return { node, material };
    }

    //// PRIVATE: EXTENSION APPLICATION ////

    private _applyMeshExtensions(ext: PendingMeshExt): void
    {
        if (ext.indices.length === 0) return;

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();

        const bitfieldRaw = computeEdgeVisibilityBitfield(
            ext.positions, ext.indices, EDGE_PROJECTION_DEFAULTS.featureAngle,
        );
        const bitfield = new Uint8Array(bitfieldRaw.buffer.slice(0) as ArrayBuffer);
        const visAcc = this._doc.createAccessor()
            .setType(Accessor.Type.SCALAR)
            .setArray(bitfield)
            .setBuffer(gtBuf);

        const edgeVisProp = this._doc.createExtension(EdgeVisibilityExtension).createProperty();
        edgeVisProp.visibilityAccessor = visAcc;

        const hasStrokeWidth = (ext.style.strokeWidth ?? 0) > 0;
        const hasStrokeDash  = (ext.style.strokeDash?.length ?? 0) > 0;

        // A material carries its own outline style (black, 2px) so a textured part keeps
        // a readable silhouette instead of the default red hairline. It applies unless
        // the user chose a stroke DELIBERATELY.
        //
        // Detecting that means comparing to the default VALUES, not asking whether stroke
        // was "set": Style.merge() runs the stroke setter, which marks it explicit, and
        // every style cascaded from SHAPE_DEFAULT_STYLE goes through merge. So
        // explicitData().stroke is populated on essentially every real shape and cannot
        // distinguish an author's choice from an inherited default.
        const matEdge = (ext.style as any)._style?.material?.edge as
            { color?: string; opacity?: number; width?: number } | undefined;

        const defStroke = SHAPE_DEFAULT_STYLE.stroke!;
        const stroke = (ext.style as any)._style?.stroke ?? {};
        // Colours go through Color normalisation on the way in ('red' → '#ff0000'), so
        // compare canonical hex rather than the raw strings.
        const sameColor = (a?: string, b?: string) =>
        {
            if (a === undefined || b === undefined) return true;
            try { return new Color(a).toHex() === new Color(b).toHex(); }
            catch { return a === b; }
        };
        const strokeIsCustom =
            !sameColor(stroke.color, defStroke.color) ||
            (stroke.width !== undefined && stroke.width !== defStroke.width) ||
            (stroke.dash?.length ?? 0) > 0;

        const useMaterialEdge = !!matEdge && !strokeIsCustom;

        if (hasStrokeWidth || hasStrokeDash || useMaterialEdge)
        {
            let color: [number, number, number, number];
            let width: number;

            if (useMaterialEdge)
            {
                color = [...rgbOf(matEdge!.color ?? '#000000'), matEdge!.opacity ?? 1] as
                    [number, number, number, number];
                width = Math.max(1, Math.round(matEdge!.width ?? 1));
            }
            else
            {
                const edgeMatDef = ext.style.toGltfMaterial('edge_material', true) as any;
                color = edgeMatDef.pbrMetallicRoughness.baseColorFactor;
                width = hasStrokeWidth ? Math.round(ext.style.strokeWidth!) : 1;
            }

            // The name records the outline's origin for anything reading the GLB.
            const edgeMat = this._doc.createMaterial(useMaterialEdge ? 'material_edge' : 'edge_material')
                .setBaseColorFactor(color)
                .setMetallicFactor(0.0)
                .setRoughnessFactor(1.0)
                .setDoubleSided(true);
            if (color[3] < 1) edgeMat.setAlphaMode(Material.AlphaMode.BLEND);

            const lineStyleProp = this._doc.createExtension(BentleyLineStyleExtension).createProperty();
            lineStyleProp.width   = width;
            lineStyleProp.pattern = hasStrokeDash ? dashPatternToUint16(ext.style.strokeDash!) : 0xFFFF;
            edgeMat.setExtension('BENTLEY_materials_line_style', lineStyleProp);

            edgeVisProp.edgeMaterial = edgeMat;
        }

        ext.primitive.setExtension('EXT_mesh_primitive_edge_visibility', edgeVisProp);
    }

    private _applyCurveExtensions(ext: PendingCurveExt): void
    {
        const hasStrokeWidth = (ext.style.strokeWidth ?? 0) > 0;
        const hasStrokeDash  = (ext.style.strokeDash?.length ?? 0) > 0;
        if (!hasStrokeWidth && !hasStrokeDash) return;

        const lineStyleProp = this._doc.createExtension(BentleyLineStyleExtension).createProperty();
        lineStyleProp.width   = hasStrokeWidth ? Math.round(ext.style.strokeWidth!) : 1;
        lineStyleProp.pattern = hasStrokeDash  ? dashPatternToUint16(ext.style.strokeDash!) : 0xFFFF;
        ext.material.setExtension('BENTLEY_materials_line_style', lineStyleProp);
    }

    private _applyPointExtensions(ext: PendingPointExt): void
    {
        const pointStyleProp = this._doc.createExtension(PointStyleExtension).createProperty();
        pointStyleProp.size  = Math.max(1, Math.round(ext.style.pointSize));
        pointStyleProp.shape = ext.style.pointShape;
        ext.material.setExtension('AY_materials_point_style', pointStyleProp);
    }
}
