// Import the init function and types from the generated crate
// We use a namespace import to get all the exported types automatically
import init, * as WasmExports from './wasm/meshup.js';

// Re-export the types so your library users can use them
export type WasmModule = typeof WasmExports;

/** Anything the wasm-bindgen glue accepts as a kernel source. */
export type WasmSource = string | URL | Response | BufferSource | WebAssembly.Module;

export type InitOptions =
{
  /** Where to load the WASM kernel from. A string/URL is fetched; a Response is
   *  streamed; bytes or an already-compiled module are used as-is.
   *
   *  When given there is NO fallback: if you told meshup where the kernel is and
   *  you were wrong, that should fail loudly rather than silently cost a 7.5 MB
   *  base64 download.
   *
   *  Default: the ./wasm/meshup_bg.wasm file next to this module, then the
   *  inlined base64. */
  wasm?: WasmSource;
};

const decodeBase64 = (str: string): Uint8Array =>
{
  if (typeof Buffer !== 'undefined')
  {
    return Buffer.from(str, 'base64');
  }
  else
  {
    // Browser fallback
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    Array.from({ length: binaryString.length }, (_, i) => { bytes[i] = binaryString.charCodeAt(i); });
    return bytes;
  }
};

/** URL of the .wasm sitting next to this module, or null when this environment
 *  cannot fetch it.
 *
 *  `new URL('<string literal>', import.meta.url)` MUST stay in exactly this shape.
 *  It is the only form Vite/Rollup and webpack 5 statically recognise and rewrite
 *  into an emitted, hashed asset. Hoisting the path into a const, concatenating it
 *  or making it a template literal silently defeats the rewrite in every bundler:
 *  you get a URL pointing at a file nobody emitted, i.e. a permanent 404 and a
 *  permanent base64 fallback.
 *
 *  The flip side is that the file must exist at both src/wasm/ and dist/wasm/ — a
 *  missing target is a bundler BUILD error that no runtime fallback can rescue.
 *  See package.json "files", tsup.config.ts onSuccess and buildscripts/check-pack.ts.
 *
 *  Only http(s) is attempted. In Node import.meta.url is a file: URL and fetch()
 *  cannot read those, so we go straight to the inlined base64 instead of throwing a
 *  confusing network error on every startup. Same for blob:/data: module URLs.
 */
const wasmFileUrl = (): URL | null =>
{
  try
  {
    const url = new URL('./wasm/meshup_bg.wasm', import.meta.url);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url : null;
  }
  catch
  {
    return null; // import.meta stripped by a CJS transpiler
  }
};

/** Fetch the sibling .wasm, or null when it is not there — then the caller falls
 *  back to base64. `res.ok` alone is not enough: a static host with an SPA
 *  fallback answers 200 with index.html. */
const fetchWasmFile = async (): Promise<Response | null> =>
{
  const url = wasmFileUrl();
  if (!url) { return null; }

  try
  {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('html'))
    {
      await res.body?.cancel(); // don't download a page we won't use
      return null;
    }
    return res; // handed to the glue as-is, so it can instantiateStreaming()
  }
  catch
  {
    return null; // offline, CORS, CSP, unsupported scheme, ...
  }
};

/** The ~7.5 MB base64 kernel. Imported dynamically on purpose: that is what lets
 *  Vite/Rollup (and tsup with splitting: true) keep it in its own lazy chunk, only
 *  ever downloaded when the .wasm file could not be used. A static import here puts
 *  it straight back into the main bundle and the whole file path saves nothing. */
const inlinedWasmBytes = async (): Promise<Uint8Array> =>
{
  const { WASM_BASE64 } = await import('./meshup-js-binary');
  return decodeBase64(WASM_BASE64);
};

// main wasm module to ensure we only load once
let wasmReady: Promise<WasmModule>|null = null;

/** Asynchronous loading of the WASM kernel.
 *  This is the recommended way to load WASM modules, as it doesn't block the main
 *  thread during initialization.
 *
 *  Resolution order:
 *    1. options.wasm — the caller knows where the kernel is (no fallback)
 *    2. ./wasm/meshup_bg.wasm next to this module — compiled by the browser while
 *       it streams, and it keeps the base64 chunk off the wire entirely
 *    3. the inlined base64 — always works, everywhere, at ~7.5 MB of JS
 */
export const loadAsync = async (options?: InitOptions): Promise<WasmModule> =>
{
  if (wasmReady)
  {
    return wasmReady;
  }

  const ready = (async () =>
  {
    if (options?.wasm)
    {
      await init({ module_or_path: options.wasm });
      return WasmExports;
    }

    const res = await fetchWasmFile();
    if (res)
    {
      try
      {
        await init({ module_or_path: res });
        return WasmExports;
      }
      catch (e)
      {
        // Safe to retry with different bytes: the glue assigns its internal `wasm`
        // only inside __wbg_finalize_init, after instantiation resolved, so nothing
        // is half-initialized here. (The one exception is __wbindgen_start() itself
        // panicking — but then the identical base64 bytes would panic too.)
        console.warn('Meshup: meshup_bg.wasm could not be instantiated, falling back to the inlined base64 kernel.', e);
      }
    }

    // Worth a line: in a browser this means the ~7.8 MB base64 chunk is about to be
    // downloaded because the .wasm asset wasn't reachable — usually a hosting or
    // bundler-config detail worth fixing. In Node it is simply the expected route.
    if (wasmFileUrl()) { console.info('Meshup: meshup_bg.wasm not reachable, using the inlined base64 kernel instead.'); }

    await init({ module_or_path: await inlinedWasmBytes() });
    return WasmExports;
  })();

  wasmReady = ready;
  ready.catch(() => { wasmReady = null; }); // a hard failure must not poison later calls
  return ready;
};
