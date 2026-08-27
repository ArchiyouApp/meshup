/**
 *  quality.ts — one dial for how finely meshup discretises curved geometry.
 *
 *  meshup's geometry is exact where it can be: a circle is two 180° arcs, a fillet is a real
 *  arc, a boolean between two circles is solved on arcs rather than on polygons. But every
 *  mesh is triangles, and every export is line segments, so *somewhere* the exact geometry
 *  has to be sampled down. That sampling used to be governed by four unrelated numbers
 *  scattered across two languages — a chord tolerance in `constants.ts`, two segment counts
 *  in `Mesh.ts`, two file-private per-turn counts in `Curve.ts`, and a chord error in the
 *  Rust kernel that did not even agree with the TypeScript one.
 *
 *  A quality profile bundles them. Pick a preset by name, or override individual dials:
 *
 *      import { setQuality } from '@archiyou/meshup';
 *
 *      setQuality('draft');                    // a whole preset
 *      setQuality({ curveSegmentsPerTurn: 24 });  // one dial, rest unchanged
 *
 *  It is a global default, not a parameter that has to be threaded: every method that
 *  samples geometry keeps its explicit `tolerance` / `segments` argument, and an explicit
 *  argument always wins. So `curve.tessellate()` follows the profile while
 *  `curve.tessellate(1e-5)` does what it says, at any quality.
 *
 *  ### Why `segmentsPerTurn` and not just a tolerance
 *
 *  A tolerance alone cannot bound a count. Read as a distance, "stay within 0.001 of the
 *  true arc" asks for 226 points on a circle of radius 10 and 2224 on one of radius 1000 —
 *  and the same model authored in millimetres rather than metres asks for a thousand times
 *  more again. That is what meshup used to do, and it is why extruding a `Curve.Circle(100)`
 *  cost 708 polygons and 220 ms where the equivalent `Mesh.Cylinder` cost 96 and 1 ms.
 *
 *  How far an arc *turns* has no units and no size. Fixing the facets per full turn fixes
 *  the cost of a circle at every radius, in every unit — which is what a renderer, a mesh
 *  boolean and a downstream 3D print all actually care about. Tolerances remain for the
 *  spans that have no turn to read (Beziers, splines) and for callers who want to ask for
 *  something specific.
 */

import { getCsgrs, isInitialized } from './index';

/** How finely curved geometry is sampled. Each preset is a complete profile;
 *  see {@link QUALITY_PRESETS} for the numbers.
 *
 *  - `draft`   — fastest. Circles are visibly faceted. For scripts that run on every keystroke.
 *  - `preview` — light but round enough to read.
 *  - `normal`  — the default. Smooth at ordinary viewing sizes.
 *  - `fine`    — for close-ups, large-format drawings, and export to a mesh someone will print.
 *  - `precise` — as fine as the samplers go. Slow, and rarely what a display needs.
 */
export type QualityPreset = 'draft' | 'preview' | 'normal' | 'fine' | 'precise';

export interface QualitySettings
{
    /** Facets per full turn for an exact circular arc — a whole circle, a quarter-circle
     *  fillet, an offset's round corner. The primary dial: it is what makes a circle cost
     *  the same at radius 10 and at radius 10 000. */
    curveSegmentsPerTurn: number;
    /** Chord deviation as a **fraction of the span's own size**, for spans that have no
     *  exact turn to read: Beziers, rational conics, splines. Not a distance in model units
     *  — see the note at the top of this file. */
    curveChordTolerance: number;
    /** Least samples for one curved span. Keeps a very short arc from collapsing to its
     *  chord when the per-turn count rounds down to nothing. */
    curveMinSegments: number;
    /** Most samples for one curved span. The backstop against an explosion — a tolerance
     *  asking for more than this gets this. */
    curveMaxSegments: number;
    /** How finely `Curve.loft()` / `Polygon.loft()` subdivide a curved segment, per full
     *  turn. A straight segment is never subdivided, so a lofted rectangle stays four faces
     *  however high this is. */
    loftSegmentsPerTurn: number;
    /** How finely `Curve.revolve()` / `Polygon.revolve()` / `Sketch.revolve()` subdivide
     *  their sweep, per full turn. Matched to {@link loftSegmentsPerTurn} so a circle comes
     *  out equally smooth whether it was lofted or revolved. */
    revolveSegmentsPerTurn: number;
    /** Facets around `Mesh.Sphere()`. */
    sphereSegmentsWidth: number;
    /** Facets from pole to pole on `Mesh.Sphere()`. */
    sphereSegmentsHeight: number;
    /** Facets around `Mesh.Cylinder()`. */
    cylinderSegmentsRadial: number;
}

/** The five named profiles.
 *
 *  `normal` reproduces the loft, revolve and mesh-primitive counts meshup has always used,
 *  so switching to it changes only the curve-tessellation route — the one that was
 *  size-dependent. The other presets step it by roughly a factor of two either way.
 */
export const QUALITY_PRESETS: Readonly<Record<QualityPreset, Readonly<QualitySettings>>> = Object.freeze({
    draft: Object.freeze({
        curveSegmentsPerTurn: 16,
        curveChordTolerance: 1e-2,
        curveMinSegments: 2,
        curveMaxSegments: 64,
        loftSegmentsPerTurn: 16,
        revolveSegmentsPerTurn: 16,
        sphereSegmentsWidth: 12,
        sphereSegmentsHeight: 6,
        cylinderSegmentsRadial: 12,
    }),
    preview: Object.freeze({
        curveSegmentsPerTurn: 32,
        curveChordTolerance: 4e-3,
        curveMinSegments: 2,
        curveMaxSegments: 128,
        loftSegmentsPerTurn: 32,
        revolveSegmentsPerTurn: 32,
        sphereSegmentsWidth: 20,
        sphereSegmentsHeight: 10,
        cylinderSegmentsRadial: 20,
    }),
    normal: Object.freeze({
        curveSegmentsPerTurn: 64,
        curveChordTolerance: 1e-3,
        curveMinSegments: 2,
        curveMaxSegments: 512,
        loftSegmentsPerTurn: 64,
        revolveSegmentsPerTurn: 64,
        sphereSegmentsWidth: 32,
        sphereSegmentsHeight: 16,
        cylinderSegmentsRadial: 32,
    }),
    fine: Object.freeze({
        curveSegmentsPerTurn: 128,
        curveChordTolerance: 2.5e-4,
        curveMinSegments: 4,
        curveMaxSegments: 512,
        loftSegmentsPerTurn: 128,
        revolveSegmentsPerTurn: 128,
        sphereSegmentsWidth: 64,
        sphereSegmentsHeight: 32,
        cylinderSegmentsRadial: 64,
    }),
    precise: Object.freeze({
        curveSegmentsPerTurn: 256,
        curveChordTolerance: 6e-5,
        curveMinSegments: 8,
        curveMaxSegments: 1024,
        loftSegmentsPerTurn: 256,
        revolveSegmentsPerTurn: 256,
        sphereSegmentsWidth: 128,
        sphereSegmentsHeight: 64,
        cylinderSegmentsRadial: 128,
    }),
});

/** The profile a fresh session starts on. */
export const DEFAULT_QUALITY_PRESET: QualityPreset = 'normal';

/** Which fields are counts of things, and so have to survive as positive integers. */
const INTEGER_FIELDS: ReadonlyArray<keyof QualitySettings> = [
    'curveMinSegments', 'curveMaxSegments',
    'loftSegmentsPerTurn', 'revolveSegmentsPerTurn',
    'sphereSegmentsWidth', 'sphereSegmentsHeight', 'cylinderSegmentsRadial',
];

let _current: QualitySettings = { ...QUALITY_PRESETS[DEFAULT_QUALITY_PRESET] };

/** Is this a preset name? Narrow rather than cast, so an unknown string is caught. */
function isPreset(q: unknown): q is QualityPreset
{
    return typeof q === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, q);
}

/** Merge a partial override onto `base`, dropping anything that is not a usable number.
 *  A bad dial is warned about and ignored rather than installed: it would otherwise reach a
 *  sampling loop, where "0 segments per turn" is not a coarse curve but an empty one. */
function merge(base: QualitySettings, patch: Partial<QualitySettings>): QualitySettings
{
    const out = { ...base };
    (Object.keys(patch) as Array<keyof QualitySettings>).forEach( key =>
    {
        const value = patch[key];
        if(value === undefined){ return; }
        if(!Object.prototype.hasOwnProperty.call(base, key))
        {
            console.warn(`setQuality(): unknown quality setting '${String(key)}' ignored.`);
            return;
        }
        if(typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        {
            console.warn(`setQuality(): '${String(key)}' must be a positive number, got ${value}. Ignored.`);
            return;
        }
        out[key] = INTEGER_FIELDS.includes(key) ? Math.max(1, Math.round(value)) : value;
    });
    // A max below the min is not a coarse profile, it is a contradiction. Let the min win:
    // the floor exists to keep an arc from collapsing, and that matters more than the cap.
    out.curveMaxSegments = Math.max(out.curveMaxSegments, out.curveMinSegments);
    return out;
}

/** Push the curve dials into the WASM kernel, which owns the sampling loops.
 *  Silently skipped before `init()` — `init()` flushes the current profile itself, so a
 *  `setQuality()` written above the `await init()` still takes effect. */
function pushToKernel(): void
{
    if(!isInitialized()){ return; }
    const setter = (getCsgrs() as any).setTessellationQuality;
    if(typeof setter !== 'function')
    {
        console.warn('setQuality(): this meshup WASM build has no setTessellationQuality(); '
            + 'curve tessellation will stay at the kernel default.');
        return;
    }
    setter(_current.curveSegmentsPerTurn, _current.curveChordTolerance,
        _current.curveMinSegments, _current.curveMaxSegments);
}

/** Install a quality profile, by preset name or as a partial override of the current one.
 *
 *  ```ts
 *  setQuality('draft');                       // whole preset
 *  setQuality({ curveSegmentsPerTurn: 24 });  // one dial
 *  setQuality('fine');                        // and back to a preset
 *  ```
 *
 *  Takes effect immediately, for shapes built from here on. Geometry already built keeps the
 *  points it was sampled with — exact curves are re-sampled on every operation, so a Curve
 *  follows the new profile, but a Mesh that has already been triangulated does not.
 *
 *  @returns the resolved profile now in force.
 */
export function setQuality(quality: QualityPreset | Partial<QualitySettings>): QualitySettings
{
    if(isPreset(quality))
    {
        _current = { ...QUALITY_PRESETS[quality] };
    }
    else if(quality && typeof quality === 'object')
    {
        _current = merge(_current, quality);
    }
    else
    {
        console.warn(`setQuality(): expected a preset name (${Object.keys(QUALITY_PRESETS).join(', ')}) `
            + `or a settings object, got ${typeof quality}. Quality unchanged.`);
        return getQuality() as QualitySettings;
    }
    pushToKernel();
    return { ..._current };
}

/** The quality profile in force. */
export function getQuality(): Readonly<QualitySettings>
{
    return _current;
}

/** Back to {@link DEFAULT_QUALITY_PRESET}. */
export function resetQuality(): QualitySettings
{
    return setQuality(DEFAULT_QUALITY_PRESET);
}

/** Send the current profile to the kernel. Called by `init()` once the WASM is up, so that
 *  a profile set before initialisation is not lost. Not part of the public API. */
export function syncQualityToKernel(): void
{
    pushToKernel();
}
