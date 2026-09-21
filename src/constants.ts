//// GLOBAL SETTINGS ////

import type { StyleData } from './Style';
import type { ResolvedProjectionOptions } from './types';

export const TOLERANCE = 1e-5; // general tolerance for geometric comparisons, in world units

// after Point operations we round to a given tolerance to avoid inaccuracies in further operations
export const POINT_TOLERANCE = TOLERANCE; 
export const ANGLE_COMPARE_TOLERANCE = 1e-3; // in degrees, for comparing angles (e.g. to detect axis-alignment)
/** Below this extent a bbox axis counts as flat (Bbox.is2D/is1D/axisMissingIn2D).
 *  Deliberately far tighter than TOLERANCE: this only has to absorb float residue from
 *  rotating a shape onto a plane (layflat()), not real thickness. The relative term keeps
 *  it meaningful for very large models. */
export const BBOX_FLAT_EPS = 1e-9;
export const BBOX_FLAT_REL_EPS = 1e-9;
/** How flat a point cloud has to be before OBbox orients it with the exact minimum-area
 *  (rotating-calipers) frame instead of PCA. Deliberately looser than BBOX_FLAT_EPS: a curve
 *  that came out of a boolean, an offset or a projection is planar to within kernel tolerance,
 *  not to float residue — and it still deserves the tight frame. Absolute + relative, same
 *  convention as BBOX_FLAT_EPS. */
export const OBBOX_PLANAR_EPS = 1e-7;
export const OBBOX_PLANAR_REL_EPS = 1e-7;
/*  How finely curved geometry is discretised now lives in a quality profile — see
    ./quality.ts, `setQuality()` / `getQuality()`. The constants below are the `'normal'`
    preset's values, kept as exports because they are part of the published API and because
    they are what these numbers were before there was a profile. Read the profile, not these,
    for anything that should follow a `setQuality()` call. */

/** Chord deviation as a fraction of a span's own size, at `'normal'` quality.
 *  NOT a distance in model units — see quality.ts for why that distinction is the whole
 *  point. @see {@link QualitySettings.curveChordTolerance} */
export const TESSELATION_TOLERANCE = 1e-3;

/** @see {@link QualitySettings.sphereSegmentsWidth} */
export const SHAPES_SPHERE_SEGMENTS_WIDTH = 32;
/** @see {@link QualitySettings.sphereSegmentsHeight} */
export const SHAPES_SPHERE_SEGMENTS_HEIGHT = 16;
/** @see {@link QualitySettings.cylinderSegmentsRadial} */
export const SHAPES_CYLINDER_SEGMENTS_RADIAL = 32;

export const MAIN_AXIS = ['x', 'y', 'z'];

/** Authoritative coordinate system of the kernel (csgrs/WASM) and all meshup geometry. */
export const KERNEL_COORDSYSTEM = { up: 'z', forward: 'y', right: 'x' } as const;

export const BASE_PLANE_NAME_TO_PLANE = {
    'xy': { normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] },
    'yz': { normal: [1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'xz': { normal: [0,-1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'front': { normal: [0,-1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'back': { normal: [0,1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'left': { normal: [-1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'right': { normal: [1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'top': { normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] },
    'bottom': { normal: [0,0,-1], xDir: [1,0,0], yDir: [0,1,0] },
} as Record<string, { normal: [number, number, number], xDir: [number, number, number], yDir: [number, number, number] }>;

export const BBOX_SIDES = ['top', 'bottom', 'front', 'back', 'left', 'right'];

/** Which bbox bound a side keyword pins: 'left' is at the min of x, 'top' at the max of z */
export const BBOX_SIDE_TO_BOUND = {
    left:   { axis: 'x', max: false },
    right:  { axis: 'x', max: true },
    front:  { axis: 'y', max: false },
    back:   { axis: 'y', max: true },
    bottom: { axis: 'z', max: false },
    top:    { axis: 'z', max: true },
} as Record<string, { axis: 'x'|'y'|'z', max: boolean }>;

// Follow BREP terminology for subshapes. Face = Polygon, Wire = Curve
export const SELECTOR_SHAPES = ['mesh', 'curve', 'face', 'edge', 'wire','vertex'];

/** Where the camera sits when a projection names none: front-left and above, the classic
 *  isometric view. A direction from the origin toward the viewer. */
export const ISOMETRY_CAM_DEFAULT: [number, number, number] = [-1, -1, 1];

/** What {@link Mesh._projectEdges} fills in for a setting the caller leaves out. The
 *  projection entry points (`isometry()`, `elevation()`, `section()`) take their numbers from
 *  here too, so there is one default per setting. */
export const EDGE_PROJECTION_DEFAULTS = {
    viewDirection: ISOMETRY_CAM_DEFAULT, // direction toward the viewer
    planeNormal: [1, 1, -1], // normal of the projection plane, facing away from the viewer
    planeOrigin: [0, 0, 0],
    featureAngle: 10, // degrees. Minimum dihedral angle for an edge to count as a crease and be projected.
    samples: 16, // visibility samples per edge for hidden-line removal ('raycast' only)
}

/** Every hidden-line-removal algorithm, in the order they were added.
 *  See {@link HlrStrategy} for what each one does.
 */
export const HLR_STRATEGIES = ['raycast', 'exact', 'clip', 'painter'] as const;

/** The hidden-line algorithm {@link Mesh.isometry} (and `elevation` / `section` and their
 *  collection equivalents) use when the caller names none.
 *
 *  `'exact'`: occlusion is solved as exact parametric intervals, so segment endpoints land
 *  on the true silhouette crossing and no occluder can slip between samples. The previous
 *  default, `'raycast'`, probes visibility at a finite number of points along each edge and
 *  bisects to find transitions — so endpoints are only approximate and an occluder narrower
 *  than the sample spacing is missed entirely.
 *
 *  This is also the target that `'clip'` and `'painter'` fall back to when a scene does not
 *  meet their convex, non-interpenetrating requirement, so those degrade to the exact
 *  solver rather than to sampling. */
export const ISOMETRY_HLR_STRATEGY_DEFAULT = 'exact';

/** Strategies resolved per shape in TypeScript rather than inside the kernel. */
export const HLR_PER_SHAPE_STRATEGIES = ['clip', 'painter'] as const;

export const EDGE_PROJECTION_LIMITS = {
    featureAngleMin: 0,
    featureAngleMax: 180,
    minSamples: 2,
    maxSamples: 4096,
} as const;

/** Every setting of `isometry()`, `elevation()` and `section()` that the caller leaves out.
 *  See {@link ProjectionOptions}. */
export const PROJECTION_DEFAULTS: ResolvedProjectionOptions = {
    method: ISOMETRY_HLR_STRATEGY_DEFAULT,
    hiddenLines: false,
    includeHiddenShapes: false,
    featureAngle: EDGE_PROJECTION_DEFAULTS.featureAngle,
    samples: EDGE_PROJECTION_DEFAULTS.samples,
    fallback: false,
};

/** The settings of the legacy positional projection signatures, in their order — followed by
 *  a trailing {@link ProjectionViewOptions} object. Every collection projection and
 *  `isometry()` on a single shape take them like this. */
export const PROJECTION_LEGACY_ARGS = ['hiddenLines', 'includeHiddenShapes', 'samples', 'featureAngle'] as const;

/** The legacy positional settings of `Mesh.elevation()` and `Mesh.section()`. A single mesh has
 *  no hidden shapes to leave out, and these two never took `includeHiddenShapes`. */
export const MESH_PROJECTION_LEGACY_ARGS = ['hiddenLines', 'samples', 'featureAngle'] as const;

export const SHAPE_DEFAULT_STYLE: StyleData = {
    visible: true,
    color: 'red',
    opacity: 1.0,
    fill: { color: 'red', opacity: 1.0 },
    stroke: { color: 'red', opacity: 1.0, width: 1, dash: [], cap: 'butt', join: 'miter' },
    point: { size: 5, shape: 'circle' }, // color omitted → inherits the shape's color

    material: null,
};

