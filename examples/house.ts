import { initAsync as initMeshup, Sketch } from '../src';

import { toRad } from '../src/utils';

import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

//// EXAMPLE MODELING A HOUSE USING VARIETY OF TECHNIQUES /////

// units in cm
const WIDTH = 400;
const HEIGHT = 300;
const ROOF_ANGLE = 30; 

const front = new Sketch('xy')
                .lineTo(0,HEIGHT)
                .lineTo(WIDTH/2, Math.tan(toRad(ROOF_ANGLE)) * WIDTH/2)
                .lineTo(WIDTH, HEIGHT)
                .lineTo(WIDTH, 0)
                .close();