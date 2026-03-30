//// GLOBAL SETTINGS ////

export const TOLERANCE = 1e-6; // general tolerance for geometric comparisons, in world units

// after Point operations we round to a given tolerance to avoid inaccuracies in further operations
export const POINT_TOLERANCE = TOLERANCE; 
export const ANGLE_COMPARE_TOLERANCE = 1e-3; // in degrees, for comparing angles (e.g. to detect axis-alignment)
export const TESSELATION_TOLERANCE = 1e-3; 

export const SHAPES_SPHERE_SEGMENTS_WIDTH = 32;
export const SHAPES_SPHERE_SEGMENTS_HEIGHT = 16;
export const SHAPES_CYLINDER_SEGMENTS_RADIAL = 32;

export const MAIN_AXIS = ['x', 'y', 'z'];

export const BASE_PLANE_NAME_TO_PLANE = {
    'xy': { normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] },
    'yz': { normal: [1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'xz': { normal: [0,-1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'front': { normal: [0,-1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'back': { normal: [0,1,0], xDir: [1,0,0], yDir: [0,0,1] },
    'left': { normal: [-1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'right': { normal: [1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
}

// Follow BREP terminology for subshapes. Face = Polygon, Wire = Curve
export const SELECTOR_SHAPES = ['mesh', 'curve', 'face', 'edge', 'wire','vertex'];

