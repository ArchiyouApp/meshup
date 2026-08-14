/**
 *  Loader resolution order.
 *
 *  meshup finds its kernel in three steps: an explicit `wasm` option, then the
 *  ./wasm/meshup_bg.wasm file next to the module, then the inlined base64. Only
 *  steps 1 and 3 are reachable here: vitest runs in `environment: 'node'`, where
 *  import.meta.url is a file: URL that fetch() cannot read, so the loader's
 *  protocol guard skips step 2 entirely (see src/loader.ts). The browser fetch
 *  branch is covered by building apps/editor and watching the Network tab.
 *
 *  Every other suite calls initAsync() bare and therefore exercises step 3.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { init, isInitialized, Mesh } from '../../src/index';

const WASM_PATH = fileURLToPath(new URL('../../src/wasm/meshup_bg.wasm', import.meta.url));

// vitest isolates modules per file, so this file gets its own uninitialized
// loader singleton and the two tests below run against it in order.
describe('loader: explicit wasm source', () =>
{
    it('fails loudly on a bad source instead of falling back to base64', async () =>
    {
        // Telling meshup where the kernel is and being wrong must be an error, not
        // a silent 7.5 MB base64 download. If the fallback ever leaks into this
        // path the init resolves and this assertion fails.
        await expect(init({ wasm: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
        expect(isInitialized()).toBe(false);
    });

    it('loads the shipped meshup_bg.wasm after that failure', async () =>
    {
        // Doubles as proof that the failed attempt above did not poison the
        // memoized promise, and that the binary we now ship is a valid kernel.
        await init({ wasm: readFileSync(WASM_PATH) });
        expect(isInitialized()).toBe(true);

        const cube = Mesh.Cube(10);
        expect(cube.bbox().width()).toBeCloseTo(10);
    });
});
