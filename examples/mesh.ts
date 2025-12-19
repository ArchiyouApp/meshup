import { initAsync as initMeshup, Mesh } from '../src';

await initMeshup(); // NOTE: loadSync does not work

const cube = Mesh.makeCube(10); // nices than new Mesh().makeCube(10);
//console.log(cube);

const box = Mesh.makeBoxBetween([0,0,0], [10,20,30]);
//const box = new Mesh().makeBox(10, 20, 30).moveToCenter();

const bbox = box.bbox();
console.log('Bounding Box:', bbox.width(), bbox.depth(), bbox.height(), bbox.center());
//console.log(bbox.center());
//console.log(box.position());


