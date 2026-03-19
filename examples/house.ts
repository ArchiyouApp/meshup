import { Curve, CurveCollection, initAsync as initMeshup, Sketch } from '../src';
import { Point } from '../src/Point';

import { rad } from '../src/utils';

import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

//// EXAMPLE MODELING A HOUSE USING VARIETY OF TECHNIQUES /////

// units in cm
const WIDTH = 400;
const HEIGHT = 300;
const ROOF_ANGLE = 45; 


const roofLine = new Sketch('xz')
                .moveTo(0,HEIGHT)
                .lineTo(WIDTH/2, `+${Math.round(Math.tan(rad(ROOF_ANGLE)) * WIDTH/2)}`) 
                .lineTo(WIDTH, HEIGHT)
                .copy().offset(10)
                .close()
                .end();

console.log(roofLine.first().normal());
const pnts = roofLine.first().points();
const v1 = pnts[0].toVector().subtract(pnts[1].toVector());
const v2 = pnts[1].toVector().subtract(pnts[2].toVector());
console.log(v1.cross(v2).normalize()); // should be [0,0,1] or [0,0,-1] depending on orientation


//roofLine.rotate(90,'x'); // OK
//console.log(roofLine.first().normal());
//console.log(roofLine.last().normal());


//roofLine.reorient([0,-1,0]);
//console.log(roofLine.toMesh().toGLTF());
//console.log(roofLine.toMesh().first().vertices());



    
    
save('roofLine.gltf', roofLine.toMesh().toGLTF()); 


/*
const c1 = Curve.Polyline([0,0], [100,0],[100,100]);
console.log(c1.normal());
console.log(c1.offset(10)?.normal());
*/



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