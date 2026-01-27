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

console.log('Knot domain:', polyline.knotsDomain());
console.log(polyline.paramClosestToPoint([10, 0]));
console.log(polyline.paramClosestToPoint([10, 20]));


// DEBUG
// console.log(polyline.filletAtParams(5, [0.25])); // ==> at controlpoint [10,0] [FIXED]
console.log(polyline.filletAtParams(5, [0.75]));  // ==> at controlpoint [10,20]
//console.log(polyline.fillet(3, [15,0]));

save('polyline.gltf', polyline.toGLTF());


/*
const curve = Curve.Interpolated([
    [0,0],
    [50,50],
    [100,0],
    [150,-100]
], 3);

console.log(curve.length());
console.log(curve.knots());
console.log(curve.weights());
console.log(curve.tessellate(1));
console.log(curve.bbox());
console.log(curve.toGLTF());

//save('curve.gltf', curve.toGLTF());

*/