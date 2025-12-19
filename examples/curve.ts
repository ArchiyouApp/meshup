import { initAsync as initMeshup, Curve, Mesh } from '../src';

await initMeshup(); // NOTE: loadSync does not work

const polyline = Curve.makePolyline([
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


const curve = Curve.makeInterpolated([
    [0,0],
    [50,10],
    [100,0],
    [150,-10]
], 3);

console.log(curve.length());


