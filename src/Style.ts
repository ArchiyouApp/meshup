/**
 *   Uniform styling for Curves and Meshes
 *
 *      Style class is the interface to set, read and apply styles
 *
 *      Every Curve and Mesh has a default Style instance that can be modified:
 *
 *      myCurve.style.color = 'blue'; // sets both fill and stroke at the same time
 *      myMesh.style.opacity = 0.5;
 *      myCurve.style.stroke.width = 2;
 *      myCurve.style.stroke.dash = [5, 5]; // dashed line: 5px dash, 5px gap
 *
 */

export type StyleColor = string; // CSS color string, e.g. 'red', '#ff0000', 'rgba(255,0,0,1)'

import { Color } from './Color';
import type { ColorInput } from './Color';
export { Color } from './Color';
export type { ColorInput } from './Color';
export type StyleData = {
    visible?: boolean;
    color?: StyleColor;
    opacity?: number;
    fill?: {
        color?: StyleColor;
        opacity?: number;
    };
    stroke?: {
        color?: StyleColor;
        opacity?: number;
        width?: number;
        dash?: number[];
        cap?: 'butt' | 'round' | 'square';
        join?: 'bevel' | 'round' | 'miter';
    };
    material?: any; // TODO
}

//// SETTINGS ////

const DEFAULT_STYLE: StyleData = {
    visible: true,
    color: 'red',
    opacity: 1.0,
    fill: { color: 'red', opacity: 1.0 },
    stroke: { color: 'black', opacity: 1.0, width: 1, dash: [], cap: 'butt', join: 'miter' },
    material: null,
};

/** Parse any ColorInput and return a canonical '#rrggbb' hex string. Throws on invalid input. */
function resolveColor(color: ColorInput): string {
    return new Color(color).toHex();
}

function isValidOpacity(v: number): boolean {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
}

/** Main Style class */
export class Style
{
    _style: StyleData;
    /** Tracks which top-level StyleData keys were explicitly set (not just defaults). */
    private _explicit = new Set<keyof StyleData>();

    constructor(init?: StyleData)
    {
        this._style = {
            ...DEFAULT_STYLE,
            fill: { ...DEFAULT_STYLE.fill },
            stroke: { ...DEFAULT_STYLE.stroke },
        };
        if (init) this.merge(init);
    }

    /** Merge partial style data into this style */
    merge(data: StyleData): this {
        if (data.visible !== undefined) this.visible = data.visible;
        if (data.color !== undefined) this.color = data.color;
        if (data.opacity !== undefined) this.opacity = data.opacity;
        if (data.fill !== undefined) this.fill = data.fill;
        if (data.stroke !== undefined) this.stroke = data.stroke;
        if (data.material !== undefined) this._style.material = data.material;
        return this;
    }

    /**
     * Return only the properties that were explicitly set on this Style instance
     * (i.e. set via setters or merge(), not just constructor defaults).
     * Used for style cascading in Container.effectiveStyle().
     */
    explicitData(): Partial<StyleData> {
        const d: Partial<StyleData> = {};
        if (this._explicit.has('visible')) d.visible = this.visible;
        if (this._explicit.has('color')) d.color = this.color;
        if (this._explicit.has('opacity')) d.opacity = this.opacity;
        if (this._explicit.has('fill')) d.fill = { ...this._style.fill };
        if (this._explicit.has('stroke')) d.stroke = { ...this._style.stroke };
        if (this._explicit.has('material')) d.material = this._style.material;
        return d;
    }

    get visible(): boolean {
        return this._style.visible ?? true;
    }
    set visible(v: boolean)
    {
        if (typeof v !== 'boolean') throw new TypeError(`Style.visible must be a boolean, got: ${v}`);
        this._style.visible = v;
        this._explicit.add('visible');
    }

    /**
     * Shorthand: sets both fill.color and stroke.color at once.
     * Accepts any valid CSS color string.
     */
    get color(): StyleColor {
        return this._style.color ?? DEFAULT_STYLE.color!;
    }
    set color(v: ColorInput)
    {
        const n = resolveColor(v);
        this._style.color = n;
        this._style.fill!.color = n;
        this._style.stroke!.color = n;
        this._explicit.add('color');
    }

    /** Overall opacity (0–1). Also sets fill.opacity and stroke.opacity. */
    get opacity(): number {
        return this._style.opacity ?? 1;
    }
    set opacity(v: number)
    {
        if (!isValidOpacity(v)) throw new RangeError(`Style.opacity must be between 0 and 1, got: ${v}`);
        this._style.opacity = v;
        this._style.fill!.opacity = v;
        this._style.stroke!.opacity = v;
        this._explicit.add('opacity');
    }

    //// FILL ////

    get fill(): NonNullable<StyleData['fill']> {
        return this._style.fill!;
    }
    set fill(v: { color?: ColorInput; opacity?: number })
    {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError('Style.fill must be an object');
        const update: NonNullable<StyleData['fill']> = {};
        if (v.color !== undefined)
        {
            update.color = resolveColor(v.color);
        }
        if (v.opacity !== undefined)
        {
            if (!isValidOpacity(v.opacity)) throw new RangeError(`Style.fill.opacity must be between 0 and 1, got: ${v.opacity}`);
            update.opacity = v.opacity;
        }
        this._style.fill = { ...this._style.fill, ...update };
        this._explicit.add('fill');
    }

    get fillColor(): StyleColor {
        return this._style.fill!.color ?? DEFAULT_STYLE.fill!.color!;
    }
    set fillColor(v: ColorInput)
    {
        this._style.fill!.color = resolveColor(v);
        this._explicit.add('fill');
    }

    get fillOpacity(): number {
        return this._style.fill!.opacity ?? 1;
    }
    set fillOpacity(v: number)
    {
        if (!isValidOpacity(v)) throw new RangeError(`Style.fillOpacity must be between 0 and 1, got: ${v}`);
        this._style.fill!.opacity = v;
        this._explicit.add('fill');
    }

    //// STROKE ////

    get stroke(): NonNullable<StyleData['stroke']> {
        return this._style.stroke!;
    }
    set stroke(v: { color?: ColorInput; opacity?: number; width?: number; dash?: number[]; cap?: 'butt'|'round'|'square'; join?: 'bevel'|'round'|'miter' })
    {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError('Style.stroke must be an object');
        const update: NonNullable<StyleData['stroke']> = {};
        if (v.color !== undefined)
        {
            update.color = resolveColor(v.color);
        }
        if (v.opacity !== undefined)
        {
            if (!isValidOpacity(v.opacity)) throw new RangeError(`Style.stroke.opacity must be between 0 and 1, got: ${v.opacity}`);
            update.opacity = v.opacity;
        }
        if (v.width !== undefined)
        {
            if (typeof v.width !== 'number' || v.width < 0) throw new RangeError(`Style.stroke.width must be a non-negative number, got: ${v.width}`);
            update.width = v.width;
        }
        if (v.dash !== undefined)
        {
            if (!Array.isArray(v.dash) || v.dash.some(n => typeof n !== 'number' || n < 0)) throw new TypeError(`Style.stroke.dash must be an array of non-negative numbers`);
            update.dash = v.dash;
        }
        if (v.cap !== undefined)
        {
            if (!['butt', 'round', 'square'].includes(v.cap)) throw new TypeError(`Style.stroke.cap must be 'butt', 'round', or 'square', got: "${v.cap}"`);
            update.cap = v.cap;
        }
        if (v.join !== undefined)
        {
            if (!['bevel', 'round', 'miter'].includes(v.join)) throw new TypeError(`Style.stroke.join must be 'bevel', 'round', or 'miter', got: "${v.join}"`);
            update.join = v.join;
        }
        this._style.stroke = { ...this._style.stroke, ...update };
        this._explicit.add('stroke');
    }

    get strokeColor(): StyleColor {
        return this._style.stroke!.color ?? DEFAULT_STYLE.stroke!.color!;
    }
    set strokeColor(v: ColorInput)
    {
        this._style.stroke!.color = resolveColor(v);
        this._explicit.add('stroke');
    }

    get strokeOpacity(): number {
        return this._style.stroke!.opacity ?? 1;
    }
    set strokeOpacity(v: number)
    {
        if (!isValidOpacity(v)) throw new RangeError(`Style.strokeOpacity must be between 0 and 1, got: ${v}`);
        this._style.stroke!.opacity = v;
        this._explicit.add('stroke');
    }

    get strokeWidth(): number {
        return this._style.stroke!.width ?? 1;
    }
    set strokeWidth(v: number)
    {
        if (typeof v !== 'number' || v < 0)
            throw new RangeError(`Style.strokeWidth must be a non-negative number, got: ${v}`);
        this._style.stroke!.width = v;
        this._explicit.add('stroke');
    }

    get strokeDash(): number[] {
        return this._style.stroke!.dash ?? [];
    }
    set strokeDash(v: number[])
    {
        if (!Array.isArray(v) || v.some(n => typeof n !== 'number' || n < 0))
            throw new TypeError(`Style.strokeDash must be an array of non-negative numbers`);
        this._style.stroke!.dash = v;
        this._explicit.add('stroke');
    }

    get strokeCap(): 'butt' | 'round' | 'square' {
        return this._style.stroke!.cap ?? 'butt';
    }
    set strokeCap(v: 'butt' | 'round' | 'square')
    {
        if (!['butt', 'round', 'square'].includes(v))
            throw new TypeError(`Style.strokeCap must be 'butt', 'round', or 'square', got: "${v}"`);
        this._style.stroke!.cap = v;
        this._explicit.add('stroke');
    }

    get strokeJoin(): 'bevel' | 'round' | 'miter' {
        return this._style.stroke!.join ?? 'miter';
    }
    set strokeJoin(v: 'bevel' | 'round' | 'miter')
    {
        if (!['bevel', 'round', 'miter'].includes(v))
            throw new TypeError(`Style.strokeJoin must be 'bevel', 'round', or 'miter', got: "${v}"`);
        this._style.stroke!.join = v;
        this._explicit.add('stroke');
    }

    //// APPLY ////

    /**
     * Apply this style to an SVG element via setAttribute.
     * Works with any SVGElement (path, circle, rect, line, polyline, etc.).
     */
    applyToSvg(elem: Element): void {
        if (!elem) return;

        // visibility
        elem.setAttribute('visibility', this.visible ? 'visible' : 'hidden');

        // fill
        const fillColor = this._style.fill?.color;
        if (fillColor !== undefined)
        {
            elem.setAttribute('fill', fillColor);
        }
        const fillOpacity = this._style.fill?.opacity;
        if (fillOpacity !== undefined && fillOpacity !== 1)
        {
            elem.setAttribute('fill-opacity', String(fillOpacity));
        }

        // stroke
        const strokeColor = this._style.stroke?.color;
        if (strokeColor !== undefined)
        {
            elem.setAttribute('stroke', strokeColor);
        }
        const strokeOpacity = this._style.stroke?.opacity;
        if (strokeOpacity !== undefined && strokeOpacity !== 1)
        {
            elem.setAttribute('stroke-opacity', String(strokeOpacity));
        }
        const strokeWidth = this._style.stroke?.width;
        if (strokeWidth !== undefined)
        {
            elem.setAttribute('stroke-width', String(strokeWidth));
        }
        const dash = this._style.stroke?.dash;
        if (dash && dash.length > 0)
        {
            elem.setAttribute('stroke-dasharray', dash.join(' '));
        }
        const cap = this._style.stroke?.cap;
        if (cap)
        {
            elem.setAttribute('stroke-linecap', cap);
        }
        const join = this._style.stroke?.join;
        if (join)
        {
            elem.setAttribute('stroke-linejoin', join);
        }

        // overall opacity
        if (this._style.opacity !== undefined && this._style.opacity !== 1)
        {
            elem.setAttribute('opacity', String(this._style.opacity));
        }
    }

    /**
     * Apply this style to a GLTF/three.js scene node (THREE.Object3D / THREE.Mesh).
     * Uses duck-typing so no three.js import is required.
     *
     * Handles:
     *  - node.visible
     *  - node.material.color  (three.js Color — supports .set(hexInt))
     *  - node.material.opacity
     *  - node.material.transparent
     */
    applyToGLTF(node: any): void {
        if (!node) return;

        // Visibility
        if ('visible' in node)
        {
            node.visible = this.visible;
        }

        const mat = node.material;
        if (!mat) return;

        // Color — use fill color for meshes, stroke color for lines
        const isLine = node.isLine || node.type === 'Line' || node.type === 'LineSegments' || node.type === 'LineLoop';
        const colorStr = isLine
            ? (this._style.stroke?.color ?? this._style.color)
            : (this._style.fill?.color ?? this._style.color);

        if (colorStr !== undefined)
        {
            try
            {
                const colorInt = new Color(colorStr).toInt();
                if (mat.color && typeof mat.color.set === 'function')
                {
                    mat.color.set(colorInt);
                }
            } catch { /* unsupported color format — skip */ }
        }

        // Opacity
        const opacity = this._style.opacity ?? 1;
        if ('opacity' in mat)
        {
            mat.opacity = opacity;
        }
        if ('transparent' in mat)
        {
            mat.transparent = opacity < 1;
        }

        // Emissive (optional — zero it out so the diffuse color shows cleanly)
        if (mat.emissive && typeof mat.emissive.set === 'function')
        {
            mat.emissive.set(0x000000);
        }

        // Mark material as needing update
        if ('needsUpdate' in mat)
        {
            mat.needsUpdate = true;
        }
    }

    //// OUTPUTS ////

    /**
     * Build a string of SVG presentation attributes from this style.
     * @param closed - when true the fill color is applied; when false fill is "none".
     */
    toSvgAttrs(closed: boolean = false): string {
        const parts: string[] = [];

        // fill
        if (closed && this._style.fill?.color)
        {
            parts.push(`fill="${this._style.fill.color}"`);
            const fo = this._style.fill.opacity;
            if (fo !== undefined && fo !== 1) parts.push(`fill-opacity="${fo}"`);
        }
        else
        {
            parts.push('fill="none"');
        }

        // stroke
        const sc = this._style.stroke?.color ?? 'black';
        parts.push(`stroke="${sc}"`);

        const so = this._style.stroke?.opacity;
        if (so !== undefined && so !== 1) parts.push(`stroke-opacity="${so}"`);

        const sw = this._style.stroke?.width ?? 1;
        parts.push(`stroke-width="${sw}"`);

        const dash = this._style.stroke?.dash;
        if (dash && dash.length > 0) parts.push(`stroke-dasharray="${dash.join(' ')}"`);

        const cap = this._style.stroke?.cap;
        if (cap && cap !== 'butt') parts.push(`stroke-linecap="${cap}"`);

        const join = this._style.stroke?.join;
        if (join && join !== 'miter') parts.push(`stroke-linejoin="${join}"`);

        // overall opacity
        const op = this._style.opacity;
        if (op !== undefined && op !== 1) parts.push(`opacity="${op}"`);

        if (!this.visible) parts.push('visibility="hidden"');

        return parts.join(' ');
    }

    /**
     * Build a GLTF 2.0 material object from this style.
     * @param name   - optional material name
     * @param isLine - when true uses stroke color instead of fill color
     */
    toGltfMaterial(name?: string, isLine: boolean = false): object {
        const colorStr = isLine
            ? (this._style.stroke?.color ?? this._style.color ?? 'black')
            : (this._style.fill?.color ?? this._style.color ?? 'red');

        let r = 1, g = 0, b = 0;
        try
        {
            [r, g, b] = new Color(colorStr ?? 'red').toRgb().map(v => v / 255) as [number, number, number];
        } catch { /* leave defaults */ }

        const a = this._style.opacity ?? 1;

        const mat: Record<string, any> = {
            name: name ?? 'material',
            pbrMetallicRoughness: {
                baseColorFactor: [r, g, b, a],
                metallicFactor: 0.0,
                roughnessFactor: 0.8,
            },
            doubleSided: true,
        };

        if (a < 1) mat.alphaMode = 'BLEND';

        return mat;
    }

    /** Return a plain-object snapshot of the current style data */
    toData(): StyleData {
        return {
            visible: this._style.visible,
            color: this._style.color,
            opacity: this._style.opacity,
            fill: { ...this._style.fill },
            stroke: { ...this._style.stroke },
            material: this._style.material,
        };
    }

}
