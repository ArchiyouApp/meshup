import { initAsync, Mesh } from '../src';
import { Vector } from '../src/Vector'
import { rad } from '../src/utils';

await initAsync(); 

const v = new Vector(10, 0,0);
console.log(v);
console.log(v.length());
console.log(v.normalize());
console.log(v.reverse());
console.log(v.scale(5));
console.log(rad(90));
console.log(v.rotate([0,0,1], rad(90)));


