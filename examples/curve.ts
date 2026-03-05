import { initAsync as initMeshup, Curve, Mesh, Collection } from '../src';
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
console.log(polylineXZ.extend(10));

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
*/

//// CURVE INTERACTION ////

const pl = Curve.Polyline([
    [0,0],
    [10,0],
    [10,20],
]);
console.log(pl.controlPoints());
console.log(pl.controlPoints().map(p => p.round()));
console.log(pl.intersect(Curve.Line([-10,10], [20,10]))); // [10,10,0]
console.log(pl.intersect(Curve.Line([-10,100], [20,100]))); // []

const spl = Curve.Interpolated([
    [0,0],
    [50,50],
    [100,0],
    [150,-100],
    [200, 0]
]);

console.log(spl.intersect(Curve.Line([100,500], [100,-500])));
const circl = Curve.Circle(100, [10,10]);

const collection = new Collection(pl, spl, circl);
console.log(collection.length);

save('circle.gltf', circl.toMesh()?.toGLTF());




save('collection.gltf', collection.toGLTF());


//// CURVE-MESH INTERSECTION ////

const cube = Mesh.Cube(20); // 20x20x20 cube centered at origin
const line = Curve.Line([-50, 0, 0], [50, 0, 0]); // Line along the X axis through the center
const lineIntersection = line.intersection(cube);
console.log('Line-Mesh Intersection:', lineIntersection); // Should show the intersection points

//// CURVE.INTERSECTION() - Trimmed curve inside mesh ////

const longLine = Curve.Line([-50, 0, 0], [50, 0, 0]);
const box20 = Mesh.Cube(20); // centered at origin, spans [-10,10] on each axis
const insideCurves = longLine.intersection(box20).move(0,0,30);

save('insideCurves.gltf', new Collection(longLine, box20, insideCurves).toGLTF());

//// CURVE BOOLEAN OPERATIONS ////

const circle1 = Curve.Circle(10, [0,0,0]);
const circle2 = Curve.Circle(10, [8,0,0]);

console.log('circle1 closed:', circle1.isClosed(), 'compound:', circle1.isCompound());
console.log('circle2 closed:', circle2.isClosed(), 'compound:', circle2.isCompound());
console.log('circle1 cp start/end:', circle1.controlPoints()[0]?.toArray(), circle1.controlPoints().at(-1)?.toArray());
console.log('circle2 cp start/end:', circle2.controlPoints()[0]?.toArray(), circle2.controlPoints().at(-1)?.toArray());

// Both circles should be closed NURBS curves. 
// Try boolean operations:
const unionResult = circle1.union(circle2);
console.log('Union result:', unionResult?.length, 'curves');

const subtractResult = circle1.subtract(circle2);
console.log('Subtract result:', subtractResult?.length, 'curves');

const intersectionResult = circle1.intersections(circle2);
console.log('Intersection result:', intersectionResult?.length, 'curves');

save('curve_union.gltf', unionResult?.toGLTF());
save('curve_subtract.gltf', subtractResult?.toGLTF());


save('curve_intersection.gltf', intersectionResult?.toGLTF());
save('curve_intersection_mesh.gltf', intersectionResult?.first()?.toMesh()?.toGLTF());
console.log(intersectionResult);
console.log(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p).toArray()));
save('curve_intersection_test.gltf', 
    Curve.Polyline(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p)) || []).toGLTF());
//console.log(Curve.Polyline(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p)) || []).toGLTF());

console.log(Curve.Polyline(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p)) as Point[]).isClosed());
console.log(Curve.Polyline(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p)) as Point[]).toMesh()?.polygons()[0]?.triangulate());



save('curve_debug.gltf', Curve.Polyline(intersectionResult?.first()?.inner()?.tessellate().map(p => Point.from(p)) as Point[]).toGLTF());

    //console.log(intersectionResult?.first()?.toMesh()?.positions());
//save('curve_intersection_mesh.gltf', intersectionResult?.first()?.toMesh()?.toGLTF());
