/**
 * Argument shapes for the projection entry points.
 *
 * The current signature is `isometry(cam, method, { options })` — the camera,
 * which hidden-line algorithm to run, and that algorithm's settings. Grouping
 * the settings in an object is what keeps the call readable once there are
 * five of them, and what lets options be added without growing a positional
 * tail.
 *
 * The older positional form
 * `isometry(cam, hiddenLines, includeHiddenShapes, samples, featureAngle)` is
 * still accepted, and must stay that way: scripts saved in the Archiyou script
 * database call it, and those are user content that cannot be migrated by
 * editing this repository.
 */

import type { HlrStrategy, PointLike } from './types';
import { ISOMETRY_HLR_STRATEGY_DEFAULT } from './constants';

/** Settings for a projection, independent of which algorithm runs it. */
export interface IsometryOptions
{
    /** Keep occluded edges in a `'hidden'` group. Default `false`. */
    hiddenLines?: boolean;
    /** Include shapes whose style marks them invisible. Default `false`. */
    includeHiddenShapes?: boolean;
    /** Minimum dihedral angle (degrees) for an edge to count as a crease.
     *  Range `[0, 180]`, monotonic — higher drops more edges. Default `10`.
     *
     *  This is the main performance control on tessellated surfaces: at a low
     *  threshold nearly every triangle edge of a sphere survives, and whichever
     *  solver runs next does that many times more work. */
    featureAngle?: number;
    /** Visibility samples per edge. **`'raycast'` only** — the other methods
     *  compute occlusion rather than sampling it, and ignore this. Default `16`. */
    samples?: number;
    /** For `'clip'` and `'painter'`: fall back to `'raycast'` with a warning
     *  when the scene does not meet their requirements, instead of throwing.
     *  Default `false`, so a method that cannot run says so. */
    fallback?: boolean;
}

/** Everything a projection needs, with defaults filled in. */
export interface ResolvedIsometryOptions extends Required<Omit<IsometryOptions, 'fallback'>>
{
    method: HlrStrategy;
    fallback: boolean;
}

const DEFAULTS: ResolvedIsometryOptions = {
    method: ISOMETRY_HLR_STRATEGY_DEFAULT,
    hiddenLines: false,
    includeHiddenShapes: false,
    featureAngle: 10,
    samples: 16,
    fallback: false,
};

/**
 * Resolve either call form into one canonical options object.
 *
 * ```ts
 * isometry([-1,-1,1], 'exact', { hiddenLines: true })   // current
 * isometry([-1,-1,1], { method: 'exact' })              // options only
 * isometry([-1,-1,1], true, false, 16, 10)              // legacy positional
 * ```
 *
 * The forms are told apart by the type of the first argument after `cam`: a
 * string names a method, an object carries options, and a boolean is the
 * legacy `hiddenLines` flag. `undefined` takes the defaults.
 */
export function resolveIsometryArgs(args: any[]): ResolvedIsometryOptions
{
    const [first, second, third, fourth, fifth] = args;

    // isometry(cam, 'exact', { ... })
    if (typeof first === 'string')
    {
        return { ...DEFAULTS, ...(second ?? {}), method: first as HlrStrategy };
    }

    // isometry(cam, { method: 'exact', ... })
    if (first !== null && typeof first === 'object' && !Array.isArray(first))
    {
        return { ...DEFAULTS, ...first };
    }

    // isometry(cam, hiddenLines, includeHiddenShapes, samples, featureAngle, view)
    //
    // The trailing `view` argument is how the method was selected before it had
    // a positional slot; honour it so call sites written against that form keep
    // working too.
    const view = (fifth !== null && typeof fifth === 'object') ? fifth : {};
    return {
        ...DEFAULTS,
        hiddenLines: first ?? DEFAULTS.hiddenLines,
        includeHiddenShapes: second ?? DEFAULTS.includeHiddenShapes,
        samples: third ?? DEFAULTS.samples,
        featureAngle: fourth ?? DEFAULTS.featureAngle,
        method: view.strategy ?? DEFAULTS.method,
        fallback: view.fallback ?? DEFAULTS.fallback,
    };
}

/** Shared doc for the camera argument, so the entry points agree on it. */
export const DEFAULT_ISOMETRY_CAM: PointLike = [-1, -1, 1];
