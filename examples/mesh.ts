import { initAsync, Mesh } from '../src';
import { Vector } from '../src/Vector'
import { save } from '../src/utils'

await initAsync(); // NOTE: loadSync does not work

const cube = Mesh.makeCube(10); // nicer than new Mesh().makeCube(10);
console.log(cube);

const box = Mesh.makeBoxBetween([0,0,0], [10,20,30]);
//const box = new Mesh().makeBox(10, 20, 30).moveToCenter();

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

console.log(Mesh.makeBox(10).center())
const bb = Mesh.makeBox(10);
console.log(bb.positions());
console.log(bb.normals());

console.log('==== VEC ====');
const vv = new Vector(1,2,3);
console.log(vv);
console.log(vv.normalize());

//// OPS ////

box.subtract(cube);
save('model.gltf', box.toGLTF() as any);


