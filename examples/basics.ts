import { init, initAsync } from '../src/';

//// Load Meshup synchronously ////
init(); // load sync

//// Load Meshup asynchronously ////
await initAsync(); // load async