//// GLOBAL SETTINGS ////

import type { StyleData } from './Style';

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
export const TESSELATION_TOLERANCE = 1e-3;

export const SHAPES_SPHERE_SEGMENTS_WIDTH = 32;
export const SHAPES_SPHERE_SEGMENTS_HEIGHT = 16;
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

export const EDGE_PROJECTION_DEFAULTS = {
    viewDirection: [-1, -1, 1], // direction to project along (e.g. camera view direction)
    planeNormal: [1,1,1], // normal of the projection plane
    featureAngle: 10, // degrees. Max angle between adjacent faces to be considered a "feature edge" and projected.
    samples: 32, // number of rays to cast per edge for hidden-line removal
}
export const EDGE_PROJECTION_LIMITS = {
    featureAngleMin: 0,
    featureAngleMax: 180,
    minSamples: 2,
    maxSamples: 4096,
} as const;

export const SHAPE_DEFAULT_STYLE: StyleData = {
    visible: true,
    color: 'red',
    opacity: 1.0,
    fill: { color: 'red', opacity: 1.0 },
    stroke: { color: 'red', opacity: 1.0, width: 1, dash: [], cap: 'butt', join: 'miter' },
    point: { size: 5, shape: 'circle' }, // color omitted → inherits the shape's color

    material: null,
};

