import { init, initAsync } from '../src/';
import { Vector } from '../src/Vector';

//// Load Meshup asynchronously ////
await initAsync(); // load async

const v1 = new Vector(0,1,0);
const v2  = new Vector(1);
console.log(v1.length()); // 1
console.log(v1.angle(v2))
console.log(v1.angleEuler(v2))
