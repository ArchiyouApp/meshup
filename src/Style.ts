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
import { SHAPE_DEFAULT_STYLE } from './constants';
import type { ColorInput, ColorStop } from './Color';
export { Color } from './Color';
export type { ColorInput, ColorStop } from './Color';


/** Data of Style */
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
    point?: {
        size?: number; // marker diameter in screen pixels
        color?: StyleColor;
        shape?: 'circle' | 'square';
    };
    /**
     * A colour ramp along the shape, rendered as per-vertex colour.
     *
     * Deliberately a TOP-LEVEL key rather than living inside `stroke`. `_explicit` tracks whole
     * top-level keys, so setting a gradient under `stroke` would mark the entire stroke object
     * explicit and push its default width/dash/cap/join into the style cascade, silently
     * overriding whatever a parent layer had set. A top-level key also reads correctly for
     * meshes, which have a gradient but no stroke.
     *
     * Absent means no gradient. There is deliberately no entry in SHAPE_DEFAULT_STYLE — the
     * Style constructor only deep-copies `fill`, `stroke` and `point`, so a fourth nested
     * default would be shared mutable state across every Style in the process.
     */
    gradient?: GradientData;
    material?: any; // TODO
}

/** A normalised colour ramp: stops sorted by position, colours resolved to '#rrggbb'. */
export type GradientData = {
    stops: Array<{ at: number; color: StyleColor }>;
}

/**
 * sRGB 0..1 → linear 0..1.
 *
 * glTF defines baseColorFactor in LINEAR space, while CSS colours (and our materials
 * database) are sRGB. Writing sRGB straight into the factor made every surface render
 * far too light and washed out — a #808080 concrete came out #e0e0e0 on screen — because
 * three.js converts the value back to sRGB for display, applying the transfer function
 * a second time. Textures are unaffected: glTF marks baseColorTexture as sRGB-encoded
 * and the loader tags it accordingly.
 */
export function srgbToLinear(c: number): number
{
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Main Style class */
export class Style
{
    _style: StyleData;
    /** Tracks which top-level StyleData keys were explicitly set (not just defaults). */
    private _explicit = new Set<keyof StyleData>();

    /** Parse any ColorInput and return a canonical '#rrggbb' hex string. Throws on invalid input. */
    private static _resolveColor(color: ColorInput): string
    {
        return new Color(color).toHex();
    }

    private static _isValidOpacity(v: number): boolean
    {
        return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
    }

    constructor(init?: StyleData)
    {
        this._style = {
            ...SHAPE_DEFAULT_STYLE,
            fill: { ...SHAPE_DEFAULT_STYLE.fill },
            stroke: { ...SHAPE_DEFAULT_STYLE.stroke },
            point: { ...SHAPE_DEFAULT_STYLE.point },
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
        if (data.point !== undefined) this.point = data.point;
        if (data.gradient !== undefined) this.gradient = data.gradient;
        if (data.material !== undefined) this._style.material = data.material;
        return this;
    }

    /**
     * Return only the properties that were explicitly set on this Style instance
     * (i.e. set via setters or merge(), not just constructor defaults).
     * Used for style cascading in SceneNode.effectiveStyle().
     */
    explicitData(): Partial<StyleData> {
        const d: Partial<StyleData> = {};
        if (this._explicit.has('visible')) d.visible = this.visible;
        if (this._explicit.has('color')) d.color = this.color;
        if (this._explicit.has('opacity')) d.opacity = this.opacity;
        if (this._explicit.has('fill')) d.fill = { ...this._style.fill };
        if (this._explicit.has('stroke')) d.stroke = { ...this._style.stroke };
        if (this._explicit.has('point')) d.point = { ...this._style.point };
        if (this._explicit.has('gradient')) d.gradient = Style._cloneGradient(this._style.gradient);
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
        return this._style.color ?? SHAPE_DEFAULT_STYLE.color!;
    }
    set color(v: ColorInput)
    {
        const n = Style._resolveColor(v);
        this._style.color = n;
        this._style.fill!.color = n;
        this._style.stroke!.color = n;
        this._explicit.add('color');
        // A flat colour set after a gradient wins: last call decides. Without this the
        // gradient would keep rendering and .color() would look like it did nothing.
        this._style.gradient = undefined;
        this._explicit.delete('gradient');
    }

    /**
     * A colour ramp along the shape. Undefined when none is set.
     *
     * Rendered as per-vertex colour (glTF `COLOR_0`), so a gradient is smooth rather than
     * banded, and one shape stays one shape. Note that opacity is NOT part of the ramp: fat
     * lines carry only rgb per vertex, so a gradient that faded opacity would work on hairlines
     * and silently not on thick ones. Opacity stays uniform on the shape.
     */
    get gradient(): GradientData | undefined {
        return Style._cloneGradient(this._style.gradient);
    }
    set gradient(v: GradientData | Array<{ at: number; color: ColorInput }> | undefined)
    {
        if (v === undefined || v === null)
        {
            this._style.gradient = undefined;
            this._explicit.delete('gradient');
            return;
        }
        const stops = Array.isArray(v) ? v : v.stops;
        this._style.gradient = { stops: Style.normaliseStops(stops) };
        this._explicit.add('gradient');
    }

    /**
     * Put a raw stop list into canonical form: colours resolved to '#rrggbb', positions clamped
     * to 0–1, sorted ascending, and always at least two stops.
     *
     * Sorting here rather than at sample time is deliberate — `Color.sample` runs once per
     * vertex during export and must not re-sort a ramp on every call.
     */
    static normaliseStops(stops: Array<{ at: number; color: ColorInput }>): Array<{ at: number; color: StyleColor }>
    {
        if (!Array.isArray(stops) || stops.length === 0)
        {
            throw new Error('Style.gradient: a colour ramp needs at least one stop.');
        }

        const out = stops.map((s, i) =>
        {
            if (s === null || typeof s !== 'object' || !('color' in s))
            {
                throw new Error(`Style.gradient: stop ${i} is not a { at, color } object.`);
            }
            const at = typeof s.at === 'number' && isFinite(s.at) ? Math.max(0, Math.min(1, s.at)) : 0;
            return { at, color: Style._resolveColor(s.color) };
        });

        // A stable sort keeps coincident stops in the order written, which is what makes
        // [{0,red},{0.5,red},{0.5,blue},{1,blue}] read as a hard break at the midpoint.
        out.sort((a, b) => a.at - b.at);

        // A single stop is a flat colour; give the ramp two ends so every consumer can assume
        // a span without special-casing.
        if (out.length === 1) { return [{ at: 0, color: out[0].color }, { at: 1, color: out[0].color }]; }
        return out;
    }

    /**
     * Parse the arguments of `colorGradient(...)` into a raw stop list.
     *
     * Accepted forms:
     *
     * ```
     * colorGradient('red', 'blue')                        two colours, 0 and 1
     * colorGradient('red', 'white', 'blue')               N colours, evenly spaced
     * colorGradient([[0,'red'], [0.5,'x'], [1,'blue']])   an array of stops
     * colorGradient([0,'red'], [0.5,'x'], [1,'blue'])     the same, as varargs
     * colorGradient([{ at: 0, color: 'red' }, …])         stops as objects
     * ```
     *
     * ONE AMBIGUITY HAS TO BE RESOLVED EXPLICITLY, because {@link ColorInput} already accepts
     * `[r,g,b]` tuples: is `[0, 255]` a colour or a stop? The rule is that a stop is a
     * two-element array whose second element is **not** a number. So `[255,0,0]` is a colour
     * (three numbers) and `[0.5,'blue']` is a stop. Nothing else disambiguates them, so this
     * rule is part of the public contract, not an implementation detail.
     */
    static parseGradientArgs(args: Array<any>): Array<{ at: number; color: ColorInput }>
    {
        // Both halves of this matter. Requiring a NUMERIC position stops a two-element array
        // OF stops — `[[0,'red'],[1,'blue']]` — from being read as one stop whose position is
        // an array. Requiring a NON-numeric colour is what separates `[0.5,'blue']` (a stop)
        // from `[255,0,0]` (a colour).
        const isStopPair = (v: any): boolean =>
            Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] !== 'number';
        const isStopObject = (v: any): boolean =>
            v !== null && typeof v === 'object' && !Array.isArray(v) && 'color' in v;
        const toStop = (v: any) =>
            (isStopPair(v) ? { at: v[0], color: v[1] } : { at: v.at, color: v.color });

        if (args.length === 0)
        {
            throw new Error(
                'colorGradient(): needs at least two colours, e.g. colorGradient(\'red\', \'blue\'), '
                + 'or a list of stops, e.g. colorGradient([[0,\'red\'],[1,\'blue\']]).');
        }

        // A single array argument is a list of stops — unless it is itself one stop.
        if (args.length === 1 && Array.isArray(args[0]) && !isStopPair(args[0]))
        {
            const arr = args[0] as Array<any>;
            if (arr.length > 0 && arr.every(x => isStopPair(x) || isStopObject(x)))
            {
                return arr.map(toStop);
            }
            throw new Error(
                `colorGradient(): could not read ${JSON.stringify(args[0])} as a list of stops. `
                + 'A stop is [position, colour] — e.g. [0.5, \'blue\'] — or { at, color }. '
                + 'Note that [255,0,0] is a COLOUR, not a stop: a stop is a two-element array '
                + 'whose second element is not a number.');
        }

        if (args.every(a => isStopPair(a) || isStopObject(a))) { return args.map(toStop); }

        if (args.length === 1)
        {
            throw new Error(
                'colorGradient(): one colour is not a gradient. Use .color() for a flat colour, '
                + 'or give at least two, e.g. colorGradient(\'red\', \'blue\').');
        }

        // Two or more plain colours, spread evenly from 0 to 1.
        return args.map((color, i) => ({ at: i / (args.length - 1), color: color as ColorInput }));
    }

    /** Deep-copy a gradient, so callers cannot mutate a Style's ramp through the reference. */
    private static _cloneGradient(g: GradientData | undefined): GradientData | undefined
    {
        return g ? { stops: g.stops.map(s => ({ ...s })) } : undefined;
    }

    /** Colour at position `t` (0–1) along the ramp, or the flat colour when there is none. */
    sampleGradient(t: number): string
    {
        const g = this._style.gradient;
        if (!g) { return this.strokeColor; }
        return Color.sample(g.stops, t).toHex();
    }

    /** Overall opacity (0–1). Also sets fill.opacity and stroke.opacity. */
    get opacity(): number {
        return this._style.opacity ?? 1;
    }
    set opacity(v: number)
    {
        if (!Style._isValidOpacity(v)) throw new RangeError(`Style.opacity must be between 0 and 1, got: ${v}`);
        this._style.opacity = v;
        this._style.fill!.opacity = v;
        this._style.stroke!.opacity = v;
        this._explicit.add('opacity');
    }

    /** Material reference or render spec ({ pbr, textures, ... }) — used by GLTF export. */
    get material(): any {
        return this._style.material;
    }
    set material(v: any)
    {
        this._style.material = v;
        this._explicit.add('material');
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
            update.color = Style._resolveColor(v.color);
        }
        if (v.opacity !== undefined)
        {
            if (!Style._isValidOpacity(v.opacity)) throw new RangeError(`Style.fill.opacity must be between 0 and 1, got: ${v.opacity}`);
            update.opacity = v.opacity;
        }
        this._style.fill = { ...this._style.fill, ...update };
        this._explicit.add('fill');
    }

    get fillColor(): StyleColor {
        return this._style.fill!.color ?? SHAPE_DEFAULT_STYLE.fill!.color!;
    }
    set fillColor(v: ColorInput)
    {
        this._style.fill!.color = Style._resolveColor(v);
        this._explicit.add('fill');
    }

    get fillOpacity(): number {
        return this._style.fill!.opacity ?? 1;
    }
    set fillOpacity(v: number)
    {
        if (!Style._isValidOpacity(v)) throw new RangeError(`Style.fillOpacity must be between 0 and 1, got: ${v}`);
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
            update.color = Style._resolveColor(v.color);
        }
        if (v.opacity !== undefined)
        {
            if (!Style._isValidOpacity(v.opacity)) throw new RangeError(`Style.stroke.opacity must be between 0 and 1, got: ${v.opacity}`);
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
        return this._style.stroke!.color ?? SHAPE_DEFAULT_STYLE.stroke!.color!;
    }
    set strokeColor(v: ColorInput)
    {
        this._style.stroke!.color = Style._resolveColor(v);
        this._explicit.add('stroke');
    }

    get strokeOpacity(): number {
        return this._style.stroke!.opacity ?? 1;
    }
    set strokeOpacity(v: number)
    {
        if (!Style._isValidOpacity(v)) throw new RangeError(`Style.strokeOpacity must be between 0 and 1, got: ${v}`);
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

    //// POINT ////

    get point(): NonNullable<StyleData['point']> {
        return this._style.point!;
    }
    set point(v: { size?: number; color?: ColorInput; shape?: 'circle' | 'square' })
    {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TypeError('Style.point must be an object');
        const update: NonNullable<StyleData['point']> = {};
        if (v.size !== undefined)
        {
            if (typeof v.size !== 'number' || v.size < 0) throw new RangeError(`Style.point.size must be a non-negative number, got: ${v.size}`);
            update.size = v.size;
        }
        if (v.color !== undefined)
        {
            update.color = Style._resolveColor(v.color);
        }
        if (v.shape !== undefined)
        {
            if (!['circle', 'square'].includes(v.shape)) throw new TypeError(`Style.point.shape must be 'circle' or 'square', got: "${v.shape}"`);
            update.shape = v.shape;
        }
        this._style.point = { ...this._style.point, ...update };
        this._explicit.add('point');
    }

    get pointSize(): number {
        return this._style.point!.size ?? SHAPE_DEFAULT_STYLE.point!.size!;
    }
    set pointSize(v: number)
    {
        if (typeof v !== 'number' || v < 0)
            throw new RangeError(`Style.pointSize must be a non-negative number, got: ${v}`);
        this._style.point!.size = v;
        this._explicit.add('point');
    }

    /** Point marker color. Falls back to the shape's shared color when not set explicitly. */
    get pointColor(): StyleColor {
        return this._style.point!.color ?? this.color;
    }
    set pointColor(v: ColorInput)
    {
        this._style.point!.color = Style._resolveColor(v);
        this._explicit.add('point');
    }

    /** Resolve the point marker color to an [r, g, b] triple (each 0–1) for GLTF. */
    pointColorRgb(): [number, number, number] {
        try
        {
            return new Color(this.pointColor).toRgb().map(v => v / 255) as [number, number, number];
        }
        catch { return [1, 0, 0]; }
    }

    get pointShape(): 'circle' | 'square' {
        return this._style.point!.shape ?? SHAPE_DEFAULT_STYLE.point!.shape!;
    }
    set pointShape(v: 'circle' | 'square')
    {
        if (!['circle', 'square'].includes(v))
            throw new TypeError(`Style.pointShape must be 'circle' or 'square', got: "${v}"`);
        this._style.point!.shape = v;
        this._explicit.add('point');
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
        // A gradient degrades to a single representative colour here. SVG can do real ramps,
        // but only through a <defs><linearGradient> that this method has no way to contribute
        // to — it sets attributes on one element and cannot reach the document. Sampling the
        // middle of the ramp keeps printed output recognisable; see toSvgAttrs for the same
        // reasoning.
        const strokeColor = this._style.gradient
            ? this.sampleGradient(0.5)
            : this._style.stroke?.color;
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
     *
     * @param closed - when true the fill color is applied; when false fill is "none".
     * @param opts.nonScalingStroke - emit `vector-effect="non-scaling-stroke"`.
     *      DEFAULT FALSE, and deliberately so. Non-scaling-stroke pins the line width —
     *      and the dash pattern — to device pixels, ignoring every transform above the
     *      element. That is right for an on-screen overlay you always want one pixel wide,
     *      and wrong for anything with a real scale: in a document the drawing is placed in
     *      a view that scales model units to millimetres of paper, so a "0.25" line stopped
     *      tracking the drawing and dashes no longer matched the geometry at any zoom.
     *      Callers that genuinely want constant-width lines opt in.
     * @param opts.omitDefaults - skip every property whose value is the shape default.
     *      For use by serializers that ship their own stylesheet (see ShapeCollection.toSVG):
     *      a presentation attribute and a CSS rule for the same property both being present
     *      is a silent trap, because CSS wins and the attribute looks authoritative but is
     *      inert. With this set, the stylesheet owns the defaults and only genuine per-shape
     *      overrides are emitted — so an author's .color('blue') actually takes effect.
     */
    toSvgAttrs(closed: boolean = false, opts?: { nonScalingStroke?: boolean; omitDefaults?: boolean }): string {
        const parts: string[] = [];
        const omitDefaults = opts?.omitDefaults === true;
        const defaultStroke = SHAPE_DEFAULT_STYLE.stroke!;

        // fill
        if (closed && this._style.fill?.color)
        {
            const isDefaultFill = this._style.fill.color === SHAPE_DEFAULT_STYLE.fill?.color;
            if (!(omitDefaults && isDefaultFill)) parts.push(`fill="${this._style.fill.color}"`);
            const fo = this._style.fill.opacity;
            if (fo !== undefined && fo !== 1) parts.push(`fill-opacity="${fo}"`);
        }
        else if (!omitDefaults)
        {
            parts.push('fill="none"');
        }

        // stroke
        //
        // GRADIENTS FLATTEN HERE, deliberately. A real SVG gradient needs a
        // <defs><linearGradient id=…> in the document plus stroke="url(#…)", and this method
        // returns a bare attribute string with no channel to contribute a defs entry. Rather
        // than half-render one, the ramp is sampled at its midpoint so a printed drawing shows
        // a sensible representative colour instead of the ramp's first stop.
        //
        // The flattened colour also bypasses `omitDefaults`: it is never the default stroke, so
        // it must always be written.
        const gradientColor = this._style.gradient ? this.sampleGradient(0.5) : undefined;
        const sc = gradientColor ?? this._style.stroke?.color ?? defaultStroke.color!;
        if (gradientColor !== undefined || !(omitDefaults && sc === defaultStroke.color))
        {
            parts.push(`stroke="${sc}"`);
        }

        const so = this._style.stroke?.opacity;
        if (so !== undefined && so !== 1) parts.push(`stroke-opacity="${so}"`);

        const sw = this._style.stroke?.width;
        if (sw !== undefined && !(omitDefaults && sw === defaultStroke.width)) parts.push(`stroke-width="${sw}"`);

        if (opts?.nonScalingStroke) parts.push('vector-effect="non-scaling-stroke"');

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
            ? (this._style.stroke?.color ?? this._style.color ?? SHAPE_DEFAULT_STYLE.stroke!.color!)
            : (this._style.fill?.color ?? this._style.color ?? SHAPE_DEFAULT_STYLE.fill!.color!);

        let r = 1, g = 0, b = 0;
        try
        {
            [r, g, b] = new Color(colorStr ?? SHAPE_DEFAULT_STYLE.fill!.color!).toRgb().map(v => v / 255) as [number, number, number];
        } catch { /* leave defaults */ }

        // A material may be threaded through as a render spec ({ pbr, textures, ... })
        // or a bare name string. When a pbr block is present it overrides the
        // per-style color/opacity and the hardcoded metallic/roughness defaults.
        const pbr = (this._style.material && typeof this._style.material === 'object')
            ? (this._style.material as any).pbr
            : undefined;

        // Only for the FILL. A line's colour comes from the stroke: overriding it with the
        // material's base colour made every edge the same colour as the surface it sits
        // on, i.e. invisible.
        if (pbr?.color && !isLine)
        {
            try { [r, g, b] = new Color(pbr.color).toRgb().map(v => v / 255) as [number, number, number]; }
            catch { /* keep style color */ }
        }

        const a = (isLine ? undefined : pbr?.alpha) ?? this._style.opacity ?? 1;

        const mat: Record<string, any> = {
            name: name ?? 'material',
            pbrMetallicRoughness: {
                // LINEAR — see srgbToLinear. r/g/b are sRGB up to this point.
                baseColorFactor: [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a],
                metallicFactor: pbr?.metallic ?? 0.0,
                roughnessFactor: pbr?.roughness ?? 0.8,
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
            point: { ...this._style.point },
            gradient: Style._cloneGradient(this._style.gradient),
            material: this._style.material,
        };
    }

}
