/**
 *  check-pack.ts
 *
 *  Asserts the shape of the tarball `npm pack` would produce.
 *
 *  The published package is easy to break silently:
 *    - a stray nested .gitignore (wasm-pack writes one containing "*") makes
 *      npm-packlist drop all of src/wasm/, including the glue meshup.js;
 *    - src/wasm/meshup_bg.wasm (6.9 MB) must NOT ship — the bytes are inlined as
 *      base64 and the sibling-file reference has been patched out of the glue;
 *    - src/wasm/package.json is a second manifest claiming name "meshup"/MIT.
 *
 *  Nothing in the monorepo imports the built `dist` entry, so this and the tarball
 *  smoke test are the only coverage the published artifact gets.
 */

import { execSync } from 'node:child_process';

const MAX_PACKED_MB = 20;

const MUST_INCLUDE = [
    'dist/index.js',
    'dist/index.d.ts',
    'src/index.ts',
    'src/loader.ts',
    'src/meshup-js-binary.ts',
    'src/wasm/meshup.js',
    'src/wasm/meshup.d.ts',
    'src/wasm/LICENSE',
    'LICENSE',
    'NOTICE',
    'THIRD-PARTY-NOTICES.txt',
    'README.md',
];

const MUST_EXCLUDE = [
    'src/wasm/meshup_bg.wasm',
    'src/wasm/package.json',
    'src/wasm/README.md',
    'dist/index.cjs',
    'dist/index.js.map',
];

type PackEntry = { path: string };
type PackResult = { files: PackEntry[]; size: number; unpackedSize: number };

const raw = execSync('npm pack --dry-run --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const [result] = JSON.parse(raw) as PackResult[];
const paths = new Set(result.files.map((f) => f.path));

const missing = MUST_INCLUDE.filter((p) => !paths.has(p));
const present = MUST_EXCLUDE.filter((p) => paths.has(p));
const packedMB = result.size / 1024 / 1024;

const problems: string[] = [];
if (missing.length) { problems.push(`missing required files:\n    - ${missing.join('\n    - ')}`); }
if (present.length) { problems.push(`files that must not ship:\n    - ${present.join('\n    - ')}`); }
if (packedMB > MAX_PACKED_MB) { problems.push(`tarball is ${packedMB.toFixed(1)} MB, over the ${MAX_PACKED_MB} MB ceiling`); }

if (problems.length)
{
    console.error(`❌ pack check FAILED\n\n  ${problems.join('\n\n  ')}\n`);
    process.exit(1);
}

console.log(`✅ pack check OK — ${result.files.length} files, ${packedMB.toFixed(1)} MB packed / ${(result.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked`);
