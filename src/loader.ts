import { WASM_BASE64 } from './csgrs-js-binary';
// Import the init function and types from the generated crate
// We use a namespace import to get all the exported types automatically
import init, * as WasmExports from './wasm/csgrs.js';
import initSync from './wasm/csgrs.js';

// Re-export the types so your library users can use them
export type WasmModule = typeof WasmExports;

const decodeBase64 = (str: string): Uint8Array => 
{
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64');
  } else {
    // Browser fallback
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
};

// main wasm module to ensure we only load once
let wasmReady: WasmModule|Promise<WasmModule>|null = null;

/** Asynchronous loading of WASM base64 binary  
 *  This is actually the recommended way to load WASM modules,
 *  as it doesn't block the main thread during initialization.
 */
export const loadAsync = async (): Promise<WasmModule> => 
{
  if (wasmReady){
    console.info('WASM module already loaded, returning existing instance.');
    return wasmReady;
  }

  wasmReady = (async () => {
    const bytes = decodeBase64(WASM_BASE64);
    
    // MAGIC MOMENT: 
    // We pass the bytes directly to init(). 
    // This loads the WASM synchronously from memory, 
    // binds it to the generated JS glue code, and returns the typed exports.
    await init({ module_or_path: bytes });
    return WasmExports;
  })();

  return wasmReady;
};

/** For even more simplicity: We can use the synchronous version */
export const loadSync = (): WasmModule => 
{
  if (wasmReady)
  {
    console.info('WASM module already loaded, returning existing instance.');
    return wasmReady as unknown as WasmModule;
  };

  const bytes = decodeBase64(WASM_BASE64);
  initSync({ module_or_path: bytes });

  return WasmExports;
};
