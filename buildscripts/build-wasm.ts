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
const RUST_DIR = path.join(ROOT_DIR, 'lib/csgrs'); // from root dir
const OUTPUT_TS_PATH = path.join(ROOT_DIR, 'src', 'csgrs-js-binary.ts');
const WASM_DIR = path.join(ROOT_DIR, './src/wasm');
const WASM_FILE_NAME = 'csgrs_bg.wasm'; // Adjust based on your crate name

console.log(`**** 🦀 Building Rust to WASM ****
    In root dir: "${ROOT_DIR}"
    Rust dir: "${RUST_DIR}"
    Output TS path: "${OUTPUT_TS_PATH}"
    WASM dir: "${WASM_DIR}"
`);

// 1. Build Rust using wasm-pack
execSync(`wasm-pack build --release --target web --out-dir ${WASM_DIR} --features wasm`, { 
  cwd: RUST_DIR, 
  stdio: 'inherit' 
});

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