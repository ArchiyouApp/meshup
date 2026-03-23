import { initAsync as initMeshup, Curve, Mesh, Collection, CurveCollection } from '../src';
import { Point } from '../src/Point';
import { save } from '../src/utils';

await initMeshup(); // NOTE: loadSync does not work

/*
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

console.log(polyline.filletAtParams(5, [0.75]));  // ==> at controlpoint [10,20]
//console.log(polyline.fillet(3, [15,0]));
    [10,0,20],
]);

console.log(polylineXZ.length());
console.log(polylineXZ.isPlanar());
console.log(polylineXZ.getOnPlane());
console.log(polylineXZ.extend(10));
console.log(pRot.getOnPlane());
const polyline3 = Curve.Polyline([
    [10,20,20],
]);

console.log(polyline3.isPlanar());
console.log(polyline3.getOnPlane())


    [100,0],
    [200, 0]
], 3);

console.log(curve.length());
console.log(curve.knots());
console.log(curve.weights());
console.log(curve.tessellate(1));
//// CURVE INTERACTION ////
/*
    [10,0],
console.log(pl.controlPoints());
console.log(pl.controlPoints().map(p => p.round()));
console.log(pl.intersect(Curve.Line([-10,10], [20,10]))); // [10,10,0]
console.log(pl.intersect(Curve.Line([-10,100], [20,100]))); // []

    [200, 0]
]);

console.log(spl.intersect(Curve.Line([100,500], [100,-500])));
const circl = Curve.Circle(100, [10,10]);

const collection = new Collection(pl, spl, circl);
save('circle.gltf', circl.toMesh()?.toGLTF());

save('collection.gltf', collection.toGLTF());

const lineIntersection = line.intersection(cube);

//// CURVE.INTERSECTION() - Trimmed curve inside mesh ////

const insideCurves = longLine.intersection(box20).move(0,0,30);
save('insideCurves.gltf', new Collection(longLine, box20, insideCurves).toGLTF());

//// CURVE BOOLEAN OPERATIONS ////
const circle1 = Curve.Circle(10, [0,0,0]);

console.log('circle2 closed:', circle2.isClosed(), 'compound:', circle2.isCompound());
console.log('circle1 cp start/end:', circle1.controlPoints()[0]?.toArray(), circle1.controlPoints().at(-1)?.toArray());

const subtractResult = circle1.subtract(circle2);
console.log('Subtract result:', subtractResult?.length, 'curves');
console.log('Intersection result:', intersectionResult?.length, 'curves');
save('curve_subtract.gltf', subtractResult?.toGLTF());
save('curve_intersection.gltf', intersectionResult?.toGLTF());
save('curve_intersection_mesh.gltf', intersectionResult?.first()?.toMesh()?.toGLTF());
const hole = Curve.Circle(5);
const subHoleResult = circle1.subtract(Curve.Circle(5));
if (subHoleResult?.first()) {
    const firstCurve = subHoleResult.first()!;
    console.log('  Has holes:', firstCurve.hasHoles(), 'hole count:', firstCurve.holes().length);
        )?.toGLTF());

    
*/
/*
const line = Curve.Line([15,0], [15,40]);

save('beforeCombine.gltf', new Collection(pl, line).toGLTF());
console.log(pl.connectTo(line));
save('connect.gltf', pl.connectTo(line)?.toGLTF());
/*
    [-10,20],
]);

const line = Curve.Line([15,0], [15,40]);
const lineM = Curve.Line([0,0], [15,0]);

save('connCurveCollection.gltf', CurveCollection.from(pl, line, lineM).combine()?.toGLTF());
//const coll = CurveCollection.from(pl, line, lineM).combine();
*/
/*
const l2 = Curve.Line([15,0],[15,10]);

save('beforeClose.gltf', col.toGLTF());

const concol = col.connect();
console.log(concol);
save('afterClose.gltf', concol?.toGLTF());
// ...existing code...
const l1 = Curve.Line([0,0], [10,0]);
const l2 = Curve.Line([15,0],[15,10]);
const l3 = Curve.Line([0,20], [10,20]);
const col = new CurveCollection(l1, l2, l3);

save('beforeClose.gltf', col.toGLTF());
*/

const pl = Curve.Polyline([
    [0,0],
    [10,10],
    [20,0]]);

pl.alignPoints(
    [[0,0,0], [10,10,0], [20,0,0]], // 3 source points to fully constrain rotation
    [[0,0,0], [10,0,10], [20,0,0]], // 3 target points (XZ plane)
    false
);

//pl.rotateX(45, [0,0,0]);

console.log(pl.bbox());


save('pl.gltf', pl.toGLTF());
