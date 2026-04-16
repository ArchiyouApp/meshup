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
    type ReaderContext,
    type WriterContext,
} from '@gltf-transform/core';
import { Style } from './Style';
import type { Axis } from './types';
import { GLTFJsonDocumentToString, remapAxis } from './utils';
import { EDGE_PROJECTION_DEFAULTS } from './constants';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import type { SceneNode } from './SceneNode';

// ─── Utility: dash array → 16-bit repeating bitmask ──────────────────────────

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
 * @param normals         Flat vertex normal buffer (length = 3 × vertexCount), F32 after axis remap
 * @param featureAngleDeg Crease angle threshold in degrees (e.g. 10)
 */
export function computeEdgeVisibilityBitfield(
    indices: Uint32Array,
    normals: Float32Array,
    featureAngleDeg: number,
): Uint8Array
{
    const triCount = indices.length / 3;
    const cosThreshold = Math.cos((featureAngleDeg * Math.PI) / 180);

    type EdgeRef = { tri: number; slot: number };
    const edgeMap = new Map<string, EdgeRef[]>();

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
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
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

    const triNormal = (tri: number): [number, number, number] =>
    {
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < 3; k++)
        {
            const v = indices[tri * 3 + k];
            nx += normals[v * 3];
            ny += normals[v * 3 + 1];
            nz += normals[v * 3 + 2];
        }
        return [nx / 3, ny / 3, nz / 3];
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

    read(_context: ReaderContext): this { return this; }

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

    read(_context: ReaderContext): this { return this; }

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
    ]);
}

// ─── Pending extension descriptors ────────────────────────────────────────────

type PendingMeshExt = {
    type: 'mesh';
    primitive: Primitive;
    indices: Uint32Array;
    normals: Float32Array;
    style: Style;
};

type PendingCurveExt = {
    type: 'curve';
    material: Material;
    style: Style;
};

type PendingExt = PendingMeshExt | PendingCurveExt;

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
    add(item: Mesh | Curve, name?: string): this
    {
        if (item instanceof Mesh)
        {
            const n = name ?? 'mesh';
            if (!item._mesh || item.vertices().length === 0) return this;
            const { node, primitive, indices, normals } = this._meshToGLTFNode(item, n);
            this.addSceneChild(node);
            this.queueMeshExtData(primitive, indices, normals, item.style);
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
        normals: Float32Array,
        style: Style,
    ): this
    {
        this._pending.push({ type: 'mesh', primitive, indices, normals, style });
        return this;
    }

    /** Queue curve extension data (BENTLEY_materials_line_style). */
    queueCurveExtData(material: Material, style: Style): this
    {
        this._pending.push({ type: 'curve', material, style });
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
            if (ext.type === 'mesh') this._applyMeshExtensions(ext);
            else                     this._applyCurveExtensions(ext);
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
        if (!node.effectiveStyle().visible) return null;

        const gltfNode = this._doc.createNode(node.name);

        // Cascade the node's effective style down to each shape: node style is the base,
        // shape's own explicit properties take precedence.
        const nodeEffective = node.effectiveStyle();

        node.shapes().forEach((shape, i) =>
        {
            const name = `${node.name}_shape_${i}`;
            const cascadedStyle = new Style(nodeEffective.toData());
            cascadedStyle.merge(shape.style.explicitData() as any);

            if (shape instanceof Mesh || shape.type?.() === 'Mesh')
            {
                const mesh = shape as unknown as Mesh;
                if (!mesh._mesh || mesh.vertices().length === 0) return;
                const { node: meshNode, primitive, indices, normals } = this._meshToGLTFNode(mesh, name, cascadedStyle);
                gltfNode.addChild(meshNode);
                this.queueMeshExtData(primitive, indices, normals, cascadedStyle);
            }
            else if (shape instanceof Curve || shape.type?.() === 'Curve')
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
    private _meshToGLTFNode(mesh: Mesh, name = 'mesh', style?: Style): { node: GltfNode; primitive: Primitive; indices: Uint32Array; normals: Float32Array }
    {
        const { positions: posRaw, normals: normRaw, indices } = mesh.toBuffer();
        const count = posRaw.length / 3;
        const posF32 = new Float32Array(count * 3);
        const normF32 = new Float32Array(count * 3);
        for (let i = 0; i < count; i++)
        {
            [posF32[i * 3], posF32[i * 3 + 1], posF32[i * 3 + 2]] = remapAxis(posRaw[i * 3], posRaw[i * 3 + 1], posRaw[i * 3 + 2], this._up);
            [normF32[i * 3], normF32[i * 3 + 1], normF32[i * 3 + 2]] = remapAxis(normRaw[i * 3], normRaw[i * 3 + 1], normRaw[i * 3 + 2], this._up);
        }
        const idxCopy = new Uint32Array(indices.buffer.slice(0) as ArrayBuffer);

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();
        const posAcc = this._doc.createAccessor().setType(Accessor.Type.VEC3).setArray(posF32).setBuffer(gtBuf);
        const normAcc = this._doc.createAccessor().setType(Accessor.Type.VEC3).setArray(normF32).setBuffer(gtBuf);
        const idxAcc = this._doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(idxCopy).setBuffer(gtBuf);

        const matDef = (style ?? mesh.style).toGltfMaterial('mesh_material', false) as any;
        const [r, g, b, a] = matDef.pbrMetallicRoughness.baseColorFactor;
        const material = this._doc.createMaterial('mesh_material')
            .setBaseColorFactor([r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const primitive = this._doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setAttribute('NORMAL', normAcc)
            .setIndices(idxAcc)
            .setMode(Primitive.Mode.TRIANGLES)
            .setMaterial(material);

        const gltfMesh = this._doc.createMesh(name).addPrimitive(primitive);
        const node = this._doc.createNode(name).setMesh(gltfMesh);
        return { node, primitive, indices: idxCopy, normals: normF32 };
    }

    /** Assemble a GltfNode for a Curve from its raw toBuffer() data. */
    private _curveToGLTFNode(curve: Curve, name = 'curve', style?: Style): { node: GltfNode; material: Material }
    {
        const rawBuf = curve.toBuffer();
        const count = rawBuf.length / 3;
        const posF32 = new Float32Array(count * 3);
        for (let i = 0; i < count; i++)
        {
            [posF32[i * 3], posF32[i * 3 + 1], posF32[i * 3 + 2]] = remapAxis(rawBuf[i * 3], rawBuf[i * 3 + 1], rawBuf[i * 3 + 2], this._up);
        }

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();
        const posAcc = this._doc.createAccessor()
            .setType(Accessor.Type.VEC3)
            .setArray(posF32)
            .setBuffer(gtBuf);

        const matDef = (style ?? curve.style).toGltfMaterial('curve_material', true) as any;
        const [r, g, b, a] = matDef.pbrMetallicRoughness.baseColorFactor;
        const material = this._doc.createMaterial('curve_material')
            .setBaseColorFactor([r, g, b, a])
            .setMetallicFactor(matDef.pbrMetallicRoughness.metallicFactor)
            .setRoughnessFactor(matDef.pbrMetallicRoughness.roughnessFactor)
            .setDoubleSided(matDef.doubleSided ?? true);
        if (matDef.alphaMode) material.setAlphaMode(matDef.alphaMode as 'BLEND' | 'OPAQUE' | 'MASK');

        const prim = this._doc.createPrimitive()
            .setAttribute('POSITION', posAcc)
            .setMode(Primitive.Mode.LINE_STRIP)
            .setMaterial(material);

        const gltfMesh = this._doc.createMesh(name).addPrimitive(prim);
        const node = this._doc.createNode(name).setMesh(gltfMesh);
        return { node, material };
    }

    //// PRIVATE: EXTENSION APPLICATION ////

    private _applyMeshExtensions(ext: PendingMeshExt): void
    {
        if (ext.indices.length === 0) return;

        const gtBuf = this._doc.getRoot().listBuffers()[0] ?? this._doc.createBuffer();

        const bitfieldRaw = computeEdgeVisibilityBitfield(
            ext.indices, ext.normals, EDGE_PROJECTION_DEFAULTS.featureAngle,
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
        if (hasStrokeWidth || hasStrokeDash)
        {
            const edgeMatDef = ext.style.toGltfMaterial('edge_material', true) as any;
            const [er, eg, eb, ea] = edgeMatDef.pbrMetallicRoughness.baseColorFactor;
            const edgeMat = this._doc.createMaterial('edge_material')
                .setBaseColorFactor([er, eg, eb, ea])
                .setMetallicFactor(0.0)
                .setRoughnessFactor(1.0)
                .setDoubleSided(true);

            const lineStyleProp = this._doc.createExtension(BentleyLineStyleExtension).createProperty();
            lineStyleProp.width   = hasStrokeWidth ? Math.round(ext.style.strokeWidth!) : 1;
            lineStyleProp.pattern = hasStrokeDash  ? dashPatternToUint16(ext.style.strokeDash!) : 0xFFFF;
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
}
