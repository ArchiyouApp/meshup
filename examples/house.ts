import { Curve, CurveCollection, initAsync as initMeshup, Sketch } from '../src';

import { rad } from '../src/utils';

import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

//// EXAMPLE MODELING A HOUSE USING VARIETY OF TECHNIQUES /////

// units in cm
const WIDTH = 400;
const HEIGHT = 300;
const ROOF_ANGLE = 45; 



const roofLine = new Sketch('xy')
                .moveTo(0,HEIGHT)
                .lineTo(WIDTH/2, `+${Math.round(Math.tan(rad(ROOF_ANGLE)) * WIDTH/2)}`) 
                .lineTo(WIDTH, HEIGHT)
                .copy().offset(10)
                .end();

// ...existing code...

save('roofLine.gltf', roofLine.toGLTF()); // OFFSET NOT OK



// THIS WORKS
/*
const pl = Curve.Polyline([0,0,0], [WIDTH/2,HEIGHT,0], [WIDTH,0,0]);
const plOffset = pl.offset(20);
const col = CurveCollection.from(pl, plOffset!);
save('pl.gltf', col.toGLTF());
*/

/*
const front = new Sketch('xz')
                .lineTo(0,HEIGHT)
                .lineTo(WIDTH/2, `+${Math.tan(rad(ROOF_ANGLE)) * WIDTH/2}`)
                .lineTo(WIDTH, HEIGHT)
                .lineTo(WIDTH, 0)
                .close()
                .end();




*/