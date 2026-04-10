/**
 * Custom glTF extensions for CAD-style edge rendering.
 *
 * Implements:
 *   - EXT_mesh_primitive_edge_visibility  (primitive-level, edge visibility bitfield)
 *   - BENTLEY_materials_line_style        (material-level, line width & dash pattern)
 *
 * Usage: call createNodeIO() instead of new NodeIO() in all _toGLTF() methods so both
 * extensions are registered for serialisation.
 */

import
{
    Accessor,
    Extension,
    ExtensionProperty,
    Material,
    NodeIO,
    PropertyType,
    type ReaderContext,
    type WriterContext,
} from '@gltf-transform/core';

// ─── Helper: dash array → 16-bit repeating bitmask ────────────────────────────

/**
 * Convert a strokeDash array (e.g. [5, 5]) to a 16-bit repeating bitmask.
 * Each bit represents one screen pixel: 1 = lit, 0 = dark.
 * The pattern cycles through the dash lengths (even index = on, odd index = off).
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
                if (i % 2 === 0) pattern |= (1 << bit); // even index = "on" segment
                break;
            }
        }
    }
    return pattern;
}

// ─── Helper: edge visibility bitfield ─────────────────────────────────────────

/**
 * Compute the 2-bit-per-edge visibility bitfield for EXT_mesh_primitive_edge_visibility.
 *
 * Encoding per edge:
 *   0 = hidden (smooth interior edge)
 *   2 = hard edge (crease or boundary)
 *
 * Algorithm:
 *   1. Build an edge → adjacent-triangle map using canonical (min,max) vertex keys.
 *   2. For boundary edges (one adjacent triangle): mark as hard (2).
 *   3. For interior edges: compare averaged face normals; if dihedral angle > featureAngleDeg → hard (2), else hidden (0).
 *   4. Pack values into a byte array (2 bits per edge, LSB-first within each byte).
 *
 * @param indices       Flat triangle index buffer (length = 3 × triCount)
 * @param normals       Flat vertex normal buffer (length = 3 × vertexCount), F32 after axis remap
 * @param featureAngleDeg  Crease angle threshold in degrees (e.g. 10)
 */
export function computeEdgeVisibilityBitfield(
    indices: Uint32Array,
    normals: Float32Array,
    featureAngleDeg: number,
): Uint8Array
{
    const triCount = indices.length / 3;
    const cosThreshold = Math.cos((featureAngleDeg * Math.PI) / 180);

    // Map canonical edge key → list of {tri, slot}
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

    // Bitfield: 2 bits × 3 edges × triCount
    const totalEdges = triCount * 3;
    const bitfield = new Uint8Array(Math.ceil(totalEdges * 2 / 8));

    const setEdgeBits = (tri: number, slot: number, value: 0 | 2): void =>
    {
        if (value === 0) return; // 00 is the default; no need to write
        const edgeIndex = tri * 3 + slot;
        const byteIndex = Math.floor(edgeIndex * 2 / 8);
        const bitOffset = (edgeIndex * 2) % 8;
        bitfield[byteIndex] |= (value << bitOffset);
    };

    // Average vertex normals of a triangle (returns un-normalized average)
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
            // Boundary edge → always hard
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

/**
 * ExtensionProperty for BENTLEY_materials_line_style.
 * Attached to a Material to encode line width and dash pattern.
 */
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

/**
 * Extension class for BENTLEY_materials_line_style.
 * Writes `extensions.BENTLEY_materials_line_style` onto every material that
 * has a BentleyLineStyleProperty attached.
 */
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

/**
 * ExtensionProperty for EXT_mesh_primitive_edge_visibility.
 * Attached to a Primitive; holds a reference to the visibility bitfield Accessor
 * and an optional edge Material.
 *
 * Note: the Accessor and Material references are stored as plain TS fields (not
 * graph-tracked) because this extension is write-only in the current implementation.
 * Both objects are already tracked by the Document's graph via doc.createAccessor() /
 * doc.createMaterial(), so they will be serialised correctly.
 */
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

/**
 * Extension class for EXT_mesh_primitive_edge_visibility.
 * Writes `extensions.EXT_mesh_primitive_edge_visibility` onto every primitive that
 * has an EdgeVisibilityProperty attached.
 */
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

// ─── Shared NodeIO factory ─────────────────────────────────────────────────────

/**
 * Create a NodeIO instance with both custom extensions registered.
 * Use this instead of `new NodeIO()` in all _toGLTF() / toGLTF() methods.
 */
export function createNodeIO(): NodeIO
{
    return new NodeIO().registerExtensions([
        BentleyLineStyleExtension,
        EdgeVisibilityExtension,
    ]);
}
