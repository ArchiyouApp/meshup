/**
 *  build-wasm.ts
 *  Builds the Rust WASM module and inlines it as a Base64 string into a TypeScript file.
 *  Requirements:
 *      - Please make sure you have csgrs Rust git submodule in lib/csgrs folder. 
 * 
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(path.dirname('.')); // from root dir
const RUST_DIR = path.join(ROOT_DIR, 'devlibs/csgrs'); // from root dir
const OUTPUT_TS_PATH = path.join(ROOT_DIR, 'src', 'csgrs-js-binary.ts');
const WASM_DIR = path.join(ROOT_DIR, './src/wasm');
const WASM_FILE_NAME = 'csgrs_bg.wasm'; // Adjust based on your crate name

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