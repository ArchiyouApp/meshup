import { Curve, CurveCollection, initAsync as initMeshup, Mesh, Sketch } from '../src';
import { Point } from '../src/Point';

import { rad,  debugGLTFNormals } from '../src/utils';

import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

//// EXAMPLE MODELING A HOUSE USING VARIETY OF TECHNIQUES /////

// units in cm

const WIDTH = 400;
const HEIGHT = 300;
const ROOF_ANGLE = 45; 

const roof = new Sketch('yz')
                .lineTo(WIDTH/2, Math.round(Math.tan(rad(ROOF_ANGLE)) * WIDTH/2)) 
                .lineTo(WIDTH, 0)
                .copy().offset(10)
                .close()
                .end()
                //.extrude(200);
  
save('roof.gltf', roof!.toGLTF());


//save('testrot.gltf', Mesh.Cube(10).rotateZ(45).toGLTF());

//console.log(debugGLTFNormals(roof!.toGLTF() as any));
//roof?.toPolygons()?.forEach(poly => console.log(poly.vertices().map(v => v.toArray())));


/*
const c1 = Curve.Polyline([0,0], [100,0],[100,100]);
console.log(c1.normal());
console.log(c1.offset(10)?.normal());
*/

