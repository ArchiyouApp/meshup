/**
 *  Color.ts
 *
 *  Parses any ColorInput into an immutable RGB color and provides
 *  typed output methods.
 *
 *  Accepted inputs:
 *    - CSS named color string : 'red', 'cornflowerblue', …
 *    - Hex string             : '#f00', '#ff0000'
 *    - RGB / RGBA string      : 'rgb(255,0,0)', 'rgba(255,0,0,1)'
 *    - RGB tuple              : [255, 0, 0]  (values clamped to 0–255)
 *
 *  Usage:
 *    const c = new Color('steelblue');
 *    c.toHex()  // '#4682b4'
 *    c.toInt()  // 0x4682b4
 *    c.toCss()  // 'rgb(70,130,180)'
 *    c.toRgb()  // [70, 130, 180]
 */

/** CSS color string or [r, g, b] tuple with values 0–255 */
export type ColorInput = string | [number, number, number];

export class Color
{
    private readonly _r: number;
    private readonly _g: number;
    private readonly _b: number;

    /**
     * Parse any ColorInput.
     * @throws {Error} if the input cannot be recognised as a valid color.
     */
    constructor(input: ColorInput)
    {
        const [r, g, b] = Color._parse(input);
        this._r = r;
        this._g = g;
        this._b = b;
    }

    // ---- output methods ----

    /** '#rrggbb' lowercase hex string */
    toHex(): string
    {
        return '#'
            + this._r.toString(16).padStart(2, '0')
            + this._g.toString(16).padStart(2, '0')
            + this._b.toString(16).padStart(2, '0');
    }

    /** 0xRRGGBB integer (e.g. for three.js `material.color.set()`) */
    toInt(): number
    {
        return (this._r << 16) | (this._g << 8) | this._b;
    }

    /** 'rgb(r,g,b)' CSS string */
    toCss(): string
    {
        return `rgb(${this._r},${this._g},${this._b})`;
    }

    /** [r, g, b] tuple with integer values 0–255 */
    toRgb(): [number, number, number]
    {
        return [this._r, this._g, this._b];
    }

    // ---- static helpers ----

    /**
     * Parse any ColorInput to [r, g, b].
     * @throws {Error} on unrecognised input.
     */
    static _parse(input: ColorInput): [number, number, number]
    {
        if (Array.isArray(input))
        {
            return (input as [number, number, number])
                .map(v => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number];
        }

        const s = (input as string).trim().toLowerCase();

        // #RGB
        if (/^#[0-9a-f]{3}$/.test(s))
        {
            const r = parseInt(s[1].repeat(2), 16);
            const g = parseInt(s[2].repeat(2), 16);
            const b = parseInt(s[3].repeat(2), 16);
            return [r, g, b];
        }

        // #RRGGBB
        if (/^#[0-9a-f]{6}$/.test(s))
        {
            return [
                parseInt(s.slice(1, 3), 16),
                parseInt(s.slice(3, 5), 16),
                parseInt(s.slice(5, 7), 16),
            ];
        }

        // rgb() / rgba()
        const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (rgbMatch)
        {
            const clamp = (n: number) => Math.max(0, Math.min(255, n));
            return [
                clamp(parseInt(rgbMatch[1])),
                clamp(parseInt(rgbMatch[2])),
                clamp(parseInt(rgbMatch[3])),
            ];
        }

        // Named CSS color
        const named = Color._cssNameToHex(s);
        if (named) return Color._parse(named);

        throw new Error(`Color: unrecognised color input: "${input}"`);
    }

    /** Map a lowercase CSS4 color name to its '#rrggbb' hex string, or undefined. */
    static _cssNameToHex(name: string): string | undefined
    {
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
