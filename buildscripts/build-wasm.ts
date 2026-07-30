/**
 *  build-wasm.ts
 *  Builds the Rust WASM module and inlines it as a Base64 string into a TypeScript file.
 *  Requirements:
 *      - The in-tree meshup Rust crate lives in ./rust/.
 *
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname('.')); // from root dir
const RUST_DIR = path.join(ROOT_DIR, 'rust'); // in-tree meshup Rust crate
const OUTPUT_TS_PATH = path.join(ROOT_DIR, 'src', 'meshup-js-binary.ts');
const WASM_DIR = path.join(ROOT_DIR, './src/wasm');
const WASM_FILE_NAME = 'meshup_bg.wasm'; // matches the crate name `meshup`

console.log(`**** 🦀 Building Rust to WASM ****
    In root dir: "${ROOT_DIR}"
    Rust dir: "${RUST_DIR}"
    Output TS path: "${OUTPUT_TS_PATH}"
    WASM dir: "${WASM_DIR}"
`);

// 1. Build Rust using wasm-pack (skip built-in wasm-opt; we run it manually below)
// RUSTFLAGS: enable wasm exception-handling so panic="unwind" works on wasm32.
// This allows std::panic::catch_unwind to catch boolmesh panics gracefully.
execSync(`wasm-pack build --release --no-opt --target web --out-dir ${WASM_DIR} --features wasm`, {
    cwd: RUST_DIR, 
    env: { ...process.env, RUSTFLAGS: "-C target-feature=+exception-handling" },
    stdio: 'inherit' 
});

// 1a. Clean up the wasm-pack scaffolding we must not keep.
//     - .gitignore: contains just "*". npm-packlist honours ignore files nested
//       inside directories admitted by package.json "files", so leaving it here
//       silently drops all of src/wasm/ (including meshup.js) from the published
//       tarball on a machine where it exists, while packing fine on a fresh clone.
//     - package.json: a second manifest declaring name "meshup" / license "MIT",
//       which collides with the real package manifest.
//     - README.md: the upstream csgrs readme, not ours. (LICENSE is kept: it is
//       the MIT notice we are required to redistribute — see NOTICE.)
['.gitignore', 'package.json', 'README.md'].forEach((f) =>
    fs.rmSync(path.join(WASM_DIR, f), { force: true })
);

// 1b. Run wasm-opt manually so we can pass --enable-exception-handling,
//     which preserves the wasm Exception Handling proposal instructions that
//     std::panic::catch_unwind relies on. Without this flag wasm-opt v117
//     would lower them to unreachable traps.
const wasmOptBin = (() => {
    // Locate the wasm-opt binary installed by wasm-pack.
    const cache = path.join(process.env.HOME || '~', '.cache', '.wasm-pack');
    const dirs = fs.existsSync(cache)
        ? fs.readdirSync(cache).filter(d => d.startsWith('wasm-opt'))
        : [];
    const bin = dirs.map(d => path.join(cache, d, 'bin', 'wasm-opt')).find(p => fs.existsSync(p));
    return bin;
})();

const wasmFilePath = path.join(WASM_DIR, WASM_FILE_NAME);
if (wasmOptBin) {
    execSync(`${wasmOptBin} -O3 --enable-exception-handling ${wasmFilePath} -o ${wasmFilePath}`, {
        stdio: 'inherit',
    });
    console.log('[INFO]: Optimized wasm binary with exception-handling enabled');
} else {
    console.warn('[WARN]: wasm-opt not found; skipping wasm optimization');
}

// 1c. Patch the generated glue: drop the `new URL('meshup_bg.wasm', import.meta.url)`
//     fallback. We never ship meshup_bg.wasm as a sibling file (the bytes are inlined
//     as base64 and handed to init() by src/loader.ts), and the static URL reference
//     makes consumer bundlers such as webpack 5 fail with "Module not found".
const gluePath = path.join(WASM_DIR, 'meshup.js');
const glueSource = fs.readFileSync(gluePath, 'utf8');
const glueNeedle = `    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('${WASM_FILE_NAME}', import.meta.url);
    }`;
const glueReplacement = `    // PATCHED by buildscripts/build-wasm.ts: the wasm-pack fallback
    //   module_or_path = new URL('${WASM_FILE_NAME}', import.meta.url)
    // is removed on purpose. meshup never ships ${WASM_FILE_NAME} as a sibling file
    // (the bytes are inlined as base64 and passed in by src/loader.ts), and the
    // URL reference made bundlers such as webpack 5 fail with "Module not found".
    if (typeof module_or_path === 'undefined') {
        throw new Error('meshup wasm init: no module or path given. Use init()/initAsync() from meshup instead of calling the raw wasm glue.');
    }`;

if (glueSource.includes(glueNeedle)) {
    fs.writeFileSync(gluePath, glueSource.replace(glueNeedle, glueReplacement));
    console.log('[INFO]: Patched out the import.meta.url wasm fallback in src/wasm/meshup.js');
} else if (!glueSource.includes('PATCHED by buildscripts/build-wasm.ts')) {
    // wasm-bindgen changed its output shape: fail loudly rather than ship a bundler-hostile glue.
    throw new Error(
        `Could not patch ${gluePath}: the expected 'new URL(...)' fallback was not found. ` +
        `wasm-bindgen output has changed — update glueNeedle in buildscripts/build-wasm.ts.`
    );
}

// 2. Read the generated .wasm file
const wasmPath = path.join(WASM_DIR, WASM_FILE_NAME); // check your actual filename in temp-wasm
const wasmBuffer = fs.readFileSync(wasmPath);

// 3. Convert to Base64
const base64Wasm = wasmBuffer.toString('base64');

// 4. Generate the TypeScript file
const tsContent = `// This file is auto-generated, and used to load WASM directly from base64 string. Do not edit.
export const WASM_BASE64 = "${base64Wasm}";
`;

fs.writeFileSync(OUTPUT_TS_PATH, tsContent);

console.log(`✅ WASM inlined into ${OUTPUT_TS_PATH} (${(wasmBuffer.length / 1024).toFixed(2)} KB)`);