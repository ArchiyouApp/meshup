import { initAsync as initMeshup, Curve, Mesh } from '../src';
import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

const polyline = Curve.Polyline([
    [0,0],
    [10,0],
    [10,20],
    [20,20],
    // length should be 40
]);

console.log(polyline.length()) // 40
console.log(polyline.pointAtParam(polyline.paramAtLength(10))); // [10,0]
console.log(polyline.degree()); // 1 (polyline)
console.log(polyline.paramClosestToPoint([-1,0])); // 0

console.log(polyline.controlPoints());
console.log(polyline.knots());
console.log(polyline.weights());
console.log(polyline.tessellate());
console.log(polyline.bbox());

console.log(polyline.isPlanar());
console.log(polyline.getOnPlane())

console.log('Knot domain:', polyline.knotsDomain());
console.log(polyline.paramClosestToPoint([10, 0]));
console.log(polyline.paramClosestToPoint([10, 20]));

save('polyline.gltf', polyline.toGLTF());
save('polyline_offset.gltf', polyline.copy().offset(2, 'round')?.toGLTF());

// DEBUG
// console.log(polyline.filletAtParams(5, [0.25])); // ==> at controlpoint [10,0] [FIXED]
console.log(polyline.filletAtParams(5, [0.75]));  // ==> at controlpoint [10,20]
//console.log(polyline.fillet(3, [15,0]));





//// POLYLINE XZ

const polylineXZ = Curve.Polyline([
    [0,0,0],
    [10,0,0],
    [10,0,20],
    [0,0,20],
]);

console.log(polylineXZ.length());
console.log(polylineXZ.isPlanar());
console.log(polylineXZ.getOnPlane());

//// POLYLINE ROTATED ////

console.log(polyline.bbox());
console.log(polyline.copy().move(100).bbox());
const pRot = polylineXZ.copy().rotate(45);
console.log(pRot.getOnPlane());

//// 3D POLYLINE ////

const polyline3 = Curve.Polyline([
    [0,0,0],
    [10,0,10],
    [10,20,20],
    [20,20,50],
]);

console.log(polyline3.isPlanar());
console.log(polyline3.getOnPlane())


//// CURVE ///

const curve = Curve.Interpolated([
    [0,0],
    [50,50],
    [100,0],
    [150,-100],
    [200, 0]
], 3);

console.log(curve.length());
console.log(curve.knots());
console.log(curve.weights());
console.log(curve.tessellate(1));
console.log(curve.bbox());
console.log(curve.toGLTF());

save('curve.gltf', curve.toGLTF());

save('curve_offset.gltf', curve.copy().offset(2, 'round')?.toGLTF());

