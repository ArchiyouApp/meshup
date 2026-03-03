//// GLOBAL SETTINGS ////

// after Point operations we round to a given tolerance to avoid inaccuracies in further operations
export const POINT_TOLERANCE = 1e-6; 
export const TESSELATION_TOLERANCE = 1e-3; 

export const SHAPES_SPHERE_SEGMENTS_WIDTH = 32;
export const SHAPES_SPHERE_SEGMENTS_HEIGHT = 16;
export const SHAPES_CYLINDER_SEGMENTS_RADIAL = 32;

export const BASE_PLANE_NAME_TO_PLANE = {
    'xy': { normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] },
    'yz': { normal: [1,0,0], xDir: [0,1,0], yDir: [0,0,1] },
    'zx': { normal: [0,1,0], xDir: [0,0,1], yDir: [1,0,0] },
    'front': { normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] },
    'back': { normal: [0,0,-1], xDir: [-1,0,0], yDir: [0,1,0] },
    'left': { normal: [-1,0,0], xDir: [0,1,0], yDir: [0,0,-1] },
    'right': { normal: [1,0,0], xDir: [0,-1,0], yDir: [0,0,-1] },
}

