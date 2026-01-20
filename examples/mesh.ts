import { initAsync, Mesh } from '../src';
import { Vector } from '../src/Vector'
import { save } from '../src/utils'

await initAsync(); // NOTE: loadSync does not work

const cube = Mesh.Cube(10); // nicer than new Mesh().Cube(10);
console.log(cube);

const box = Mesh.BoxBetween([0,0,0], [10,20,30]);
//const box = new Mesh().Box(10, 20, 30).moveToCenter();

const bbox = box.bbox();
console.log('Bounding Box:', bbox.width(), bbox.depth(), bbox.height(), bbox.center());
//console.log(bbox.center());

// From polygons

const tri = Mesh.fromPolygons([
    [[-5, -5,0], [5,-5,0], [0, 5, 0]],
]);

const pyramid = Mesh.fromPolygons([
    // Base (square)
    [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]],
    // Side 1 (front)
    [[-5, -5, 0], [5, -5, 0], [0, 0, 10]],
    // Side 2 (right)
    [[5, -5, 0], [5, 5, 0], [0, 0, 10]],
    // Side 3 (back)
    [[5, 5, 0], [-5, 5, 0], [0, 0, 10]],
    // Side 4 (left)
    [[-5, 5, 0], [-5, -5, 0], [0, 0, 10]],
]);

console.log('pyramid');
console.log(pyramid.bbox());
console.log(pyramid.center());

console.log(Mesh.Box(10).center())
const bb = Mesh.Box(10);
console.log(bb.positions());
console.log(bb.normals());

console.log('==== VEC ====');
const vv = new Vector(1,2,3);
console.log(vv);
console.log(vv.normalize());

//// MESH NGON ////
/*
const ngon = Mesh.fromPolygons([
    [[-5, -5, 0], [0, -10, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]],
]);

save('ngon.gltf', ngon.toGLTF() as any);
*/

//// OPS ////

//box.subtract(cube);
//save('model.gltf', box.toGLTF() as any);
//save('union.gltf', Mesh.Box(10).union(Mesh.Sphere(10).move(5,5,5)).toGLTF());
//save('union.gltf', new Mesh().union(Mesh.Sphere(10).move(5,5,5)).toGLTF()); // start with empty mesh

// Mirror
/*
const mb = Mesh.Box(10,5,5)
            //.copy()
            ?.move(0,0,20)
            //?.mirror('z', [0, 10, 0]);
save('mirror.gltf', mb?.toGLTF() as any);
*/

//console.log(Mesh.Box(5).grid(5,5,1,10)?.union());

save('grid.gltf', Mesh.Box(5).grid(5,5,1,10)?.toGLTF());
