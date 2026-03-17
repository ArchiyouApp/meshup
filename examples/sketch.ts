import { initAsync, Sketch } from '../src';
import { save } from '../src/utils';

//// Load Meshup asynchronously ////
await initAsync(); // load async

const s = new Sketch()
            .lineTo(20)
            .lineTo(20,20)
            .lineTo('+0','+40')
            .lineTo('50<45')
            .lineTo('50<<-45')
            .end();

// ...existing code...
save('sketch.gltf', s.toGLTF());
