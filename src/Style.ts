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

/** Extended color input: CSS string or [r,g,b] array with values 0–255 */
export type ColorInput = StyleColor | [number, number, number];
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

//// VALIDATION HELPERS ////

/** Normalise any ColorInput to a plain CSS string before storing or validating.
 *  - [r,g,b] array → 'rgb(r,g,b)'
 *  - string        → returned unchanged
 */
function normalizeColor(color: ColorInput): string {
    if (Array.isArray(color)) {
        const [r, g, b] = (color as [number, number, number])
            .map(v => Math.max(0, Math.min(255, Math.round(v))));
        return `rgb(${r},${g},${b})`;
    }
    return color as string;
}

function isValidCssColor(color: string): boolean {
    if (typeof color !== 'string' || color.trim() === '') return false;
    const c = color.trim().toLowerCase();
    if (Style._cssNameToHex(c)) return true;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(c)) return true;
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+)?\s*\)$/.test(c)) return true;
    return false;
}

function isValidOpacity(v: number): boolean {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
}

/** Main Style class */
export class Style
{
    _style: StyleData;

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

    //// GETTERS AND SETTERS ////

    get visible(): boolean {
        return this._style.visible ?? true;
    }
    set visible(v: boolean) {
        if (typeof v !== 'boolean') throw new TypeError(`Style.visible must be a boolean, got: ${v}`);
        this._style.visible = v;
    }

    /**
     * Shorthand: sets both fill.color and stroke.color at once.
     * Accepts any valid CSS color string.
     */
    get color(): StyleColor {
        return this._style.color ?? DEFAULT_STYLE.color!;
    }
    set color(v: ColorInput) {
        const n = normalizeColor(v);
        if (!isValidCssColor(n)) throw new Error(`Style.color: invalid CSS color: "${v}"`);
        this._style.color = n;
        this._style.fill!.color = n;
        this._style.stroke!.color = n;
    }

    /** Overall opacity (0–1). Also sets fill.opacity and stroke.opacity. */
    get opacity(): number {
        return this._style.opacity ?? 1;
    }
    set opacity(v: number) {
        if (!isValidOpacity(v)) throw new RangeError(`Style.opacity must be between 0 and 1, got: ${v}`);
        this._style.opacity = v;
        this._style.fill!.opacity = v;
        this._style.stroke!.opacity = v;
    }

    //// FILL ////

    get fill(): NonNullable<StyleData['fill']> {
        return this._style.fill!;
    }
    set fill(v: { color?: ColorInput; opacity?: number }) {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError('Style.fill must be an object');
        const update: NonNullable<StyleData['fill']> = {};
        if (v.color !== undefined) {
            const n = normalizeColor(v.color);
            if (!isValidCssColor(n)) throw new Error(`Style.fill.color: invalid CSS color: "${v.color}"`);
            update.color = n;
        }
        if (v.opacity !== undefined) {
            if (!isValidOpacity(v.opacity)) throw new RangeError(`Style.fill.opacity must be between 0 and 1, got: ${v.opacity}`);
            update.opacity = v.opacity;
        }
        this._style.fill = { ...this._style.fill, ...update };
    }

    get fillColor(): StyleColor {
        return this._style.fill!.color ?? DEFAULT_STYLE.fill!.color!;
    }
    set fillColor(v: ColorInput) {
        const n = normalizeColor(v);
        if (!isValidCssColor(n)) throw new Error(`Style.fillColor: invalid CSS color: "${v}"`);
        this._style.fill!.color = n;
    }

    get fillOpacity(): number {
        return this._style.fill!.opacity ?? 1;
    }
    set fillOpacity(v: number) {
        if (!isValidOpacity(v)) throw new RangeError(`Style.fillOpacity must be between 0 and 1, got: ${v}`);
        this._style.fill!.opacity = v;
    }

    //// STROKE ////

    get stroke(): NonNullable<StyleData['stroke']> {
        return this._style.stroke!;
    }
    set stroke(v: { color?: ColorInput; opacity?: number; width?: number; dash?: number[]; cap?: 'butt'|'round'|'square'; join?: 'bevel'|'round'|'miter' }) {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError('Style.stroke must be an object');
        const update: NonNullable<StyleData['stroke']> = {};
        if (v.color !== undefined) {
            const n = normalizeColor(v.color);
            if (!isValidCssColor(n)) throw new Error(`Style.stroke.color: invalid CSS color: "${v.color}"`);
            update.color = n;
        }
        if (v.opacity !== undefined) {
            if (!isValidOpacity(v.opacity)) throw new RangeError(`Style.stroke.opacity must be between 0 and 1, got: ${v.opacity}`);
            update.opacity = v.opacity;
        }
        if (v.width !== undefined) {
            if (typeof v.width !== 'number' || v.width < 0) throw new RangeError(`Style.stroke.width must be a non-negative number, got: ${v.width}`);
            update.width = v.width;
        }
        if (v.dash !== undefined) {
            if (!Array.isArray(v.dash) || v.dash.some(n => typeof n !== 'number' || n < 0)) throw new TypeError(`Style.stroke.dash must be an array of non-negative numbers`);
            update.dash = v.dash;
        }
        if (v.cap !== undefined) {
            if (!['butt', 'round', 'square'].includes(v.cap)) throw new TypeError(`Style.stroke.cap must be 'butt', 'round', or 'square', got: "${v.cap}"`);
            update.cap = v.cap;
        }
        if (v.join !== undefined) {
            if (!['bevel', 'round', 'miter'].includes(v.join)) throw new TypeError(`Style.stroke.join must be 'bevel', 'round', or 'miter', got: "${v.join}"`);
            update.join = v.join;
        }
        this._style.stroke = { ...this._style.stroke, ...update };
    }

    get strokeColor(): StyleColor {
        return this._style.stroke!.color ?? DEFAULT_STYLE.stroke!.color!;
    }
    set strokeColor(v: ColorInput) {
        const n = normalizeColor(v);
        if (!isValidCssColor(n)) throw new Error(`Style.strokeColor: invalid CSS color: "${v}"`);
        this._style.stroke!.color = n;
    }

    get strokeOpacity(): number {
        return this._style.stroke!.opacity ?? 1;
    }
    set strokeOpacity(v: number) {
        if (!isValidOpacity(v)) throw new RangeError(`Style.strokeOpacity must be between 0 and 1, got: ${v}`);
        this._style.stroke!.opacity = v;
    }

    get strokeWidth(): number {
        return this._style.stroke!.width ?? 1;
    }
    set strokeWidth(v: number) {
        if (typeof v !== 'number' || v < 0)
            throw new RangeError(`Style.strokeWidth must be a non-negative number, got: ${v}`);
        this._style.stroke!.width = v;
    }

    get strokeDash(): number[] {
        return this._style.stroke!.dash ?? [];
    }
    set strokeDash(v: number[]) {
        if (!Array.isArray(v) || v.some(n => typeof n !== 'number' || n < 0))
            throw new TypeError(`Style.strokeDash must be an array of non-negative numbers`);
        this._style.stroke!.dash = v;
    }

    get strokeCap(): 'butt' | 'round' | 'square' {
        return this._style.stroke!.cap ?? 'butt';
    }
    set strokeCap(v: 'butt' | 'round' | 'square') {
        if (!['butt', 'round', 'square'].includes(v))
            throw new TypeError(`Style.strokeCap must be 'butt', 'round', or 'square', got: "${v}"`);
        this._style.stroke!.cap = v;
    }

    get strokeJoin(): 'bevel' | 'round' | 'miter' {
        return this._style.stroke!.join ?? 'miter';
    }
    set strokeJoin(v: 'bevel' | 'round' | 'miter') {
        if (!['bevel', 'round', 'miter'].includes(v))
            throw new TypeError(`Style.strokeJoin must be 'bevel', 'round', or 'miter', got: "${v}"`);
        this._style.stroke!.join = v;
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
        if (fillColor !== undefined) {
            elem.setAttribute('fill', fillColor);
        }
        const fillOpacity = this._style.fill?.opacity;
        if (fillOpacity !== undefined && fillOpacity !== 1) {
            elem.setAttribute('fill-opacity', String(fillOpacity));
        }

        // stroke
        const strokeColor = this._style.stroke?.color;
        if (strokeColor !== undefined) {
            elem.setAttribute('stroke', strokeColor);
        }
        const strokeOpacity = this._style.stroke?.opacity;
        if (strokeOpacity !== undefined && strokeOpacity !== 1) {
            elem.setAttribute('stroke-opacity', String(strokeOpacity));
        }
        const strokeWidth = this._style.stroke?.width;
        if (strokeWidth !== undefined) {
            elem.setAttribute('stroke-width', String(strokeWidth));
        }
        const dash = this._style.stroke?.dash;
        if (dash && dash.length > 0) {
            elem.setAttribute('stroke-dasharray', dash.join(' '));
        }
        const cap = this._style.stroke?.cap;
        if (cap) {
            elem.setAttribute('stroke-linecap', cap);
        }
        const join = this._style.stroke?.join;
        if (join) {
            elem.setAttribute('stroke-linejoin', join);
        }

        // overall opacity
        if (this._style.opacity !== undefined && this._style.opacity !== 1) {
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
        if ('visible' in node) {
            node.visible = this.visible;
        }

        const mat = node.material;
        if (!mat) return;

        // Color — use fill color for meshes, stroke color for lines
        const isLine = node.isLine || node.type === 'Line' || node.type === 'LineSegments' || node.type === 'LineLoop';
        const colorStr = isLine
            ? (this._style.stroke?.color ?? this._style.color)
            : (this._style.fill?.color ?? this._style.color);

        if (colorStr !== undefined) {
            try {
                const colorInt = Style._cssToInt(colorStr);
                if (mat.color && typeof mat.color.set === 'function') {
                    mat.color.set(colorInt);
                }
            } catch { /* unsupported color format — skip */ }
        }

        // Opacity
        const opacity = this._style.opacity ?? 1;
        if ('opacity' in mat) {
            mat.opacity = opacity;
        }
        if ('transparent' in mat) {
            mat.transparent = opacity < 1;
        }

        // Emissive (optional — zero it out so the diffuse color shows cleanly)
        if (mat.emissive && typeof mat.emissive.set === 'function') {
            mat.emissive.set(0x000000);
        }

        // Mark material as needing update
        if ('needsUpdate' in mat) {
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
        if (closed && this._style.fill?.color) {
            parts.push(`fill="${this._style.fill.color}"`);
            const fo = this._style.fill.opacity;
            if (fo !== undefined && fo !== 1) parts.push(`fill-opacity="${fo}"`);
        } else {
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
        try {
            const hex = Style._cssToHex(colorStr ?? 'red');
            r = parseInt(hex.slice(1, 3), 16) / 255;
            g = parseInt(hex.slice(3, 5), 16) / 255;
            b = parseInt(hex.slice(5, 7), 16) / 255;
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

     //// UTILS ////

    /**
     * Convert a CSS color string to a normalized #RRGGBB hex string.
     * Supports: named colors, #RGB, #RRGGBB, rgb(), rgba().
     */
    static _cssToHex(color: string): string {
        const c = color.trim().toLowerCase();

        // #RGB → #RRGGBB
        if (/^#[0-9a-f]{3}$/.test(c)) {
            return '#' + c[1].repeat(2) + c[2].repeat(2) + c[3].repeat(2);
        }

        // #RRGGBB (already valid hex)
        if (/^#[0-9a-f]{6}$/.test(c)) {
            return c;
        }

        // rgb() / rgba() — values may be 0-255 integers
        const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch) {
            const clamp = (n: number) => Math.max(0, Math.min(255, n));
            const r = clamp(parseInt(rgbMatch[1])).toString(16).padStart(2, '0');
            const g = clamp(parseInt(rgbMatch[2])).toString(16).padStart(2, '0');
            const b = clamp(parseInt(rgbMatch[3])).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }

        // Named color
        const named = this._cssNameToHex(c);
        if (named) return named;

        throw new Error(`Style._cssToHex: cannot convert CSS color to hex: "${color}"`);
    }

    /**
     * Convert a CSS color string to a 0xRRGGBB integer (e.g. for three.js).
     */
    static _cssToInt(color: string): number {
        const hex = Style._cssToHex(color).slice(1); // strip '#'
        return parseInt(hex, 16);
    }

    static _cssNameToHex(name: string): string | undefined 
    {
        // Full CSS4 named color map → lowercase name to #RRGGBB hex
        const CSS_NAMED_COLORS: Record<string, string> = {
            aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff',
            aquamarine: '#7fffd4', azure: '#f0ffff', beige: '#f5f5dc',
            bisque: '#ffe4c4', black: '#000000', blanchedalmond: '#ffebcd',
            blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
            burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00',
            chocolate: '#d2691e', coral: '#ff7f50', cornflowerblue: '#6495ed',
            cornsilk: '#fff8dc', crimson: '#dc143c', cyan: '#00ffff',
            darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
            darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9',
            darkkhaki: '#bdb76b', darkmagenta: '#8b008b', darkolivegreen: '#556b2f',
            darkorange: '#ff8c00', darkorchid: '#9932cc', darkred: '#8b0000',
            darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
            darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1',
            darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
            dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
            firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
            fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff',
            gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
            green: '#008000', greenyellow: '#adff2f', grey: '#808080',
            honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
            indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c',
            lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
            lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
            lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
            lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1',
            lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
            lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de',
            lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
            linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000',
            mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
            mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
            mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
            midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1',
            moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
            oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
            orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
            palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
            palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9',
            peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
            powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
            red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
            saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460',
            seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
            silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
            slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
            springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c',
            teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
            turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
            white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
            yellowgreen: '#9acd32',
        };
        return CSS_NAMED_COLORS[name.toLowerCase()];
    }

}
