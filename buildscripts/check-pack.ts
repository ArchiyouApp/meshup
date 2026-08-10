/**
 *  check-pack.ts
 *
 *  Asserts the shape of the tarball `npm pack` would produce.
 *
 *  The published package is easy to break silently:
 *    - a stray nested .gitignore (wasm-pack writes one containing "*") makes
 *      npm-packlist drop all of src/wasm/, including the glue meshup.js;
 *    - src/wasm/meshup_bg.wasm and dist/wasm/meshup_bg.wasm MUST ship. src/loader.ts
 *      resolves `new URL('./wasm/meshup_bg.wasm', import.meta.url)`, which Vite and
 *      webpack 5 resolve at BUILD time. A missing binary is a "Module not found"
 *      build error in the consumer's bundler that no runtime fallback can rescue,
 *      so this check is the only thing standing between a `files` regression and a
 *      broken downstream build. Both copies are needed: one for deep-src importers
 *      (@archiyou/meshup/src/index), one for dist/index.js, where import.meta.url
 *      points at dist/;
 *    - dist/index.js must stay small — the base64 kernel belongs in its own lazy
 *      chunk (tsup splitting), not in the entry;
 *    - src/wasm/package.json is a second manifest claiming name "meshup"/MIT.
 *
 *  Nothing in the monorepo imports the built `dist` entry, so this and the tarball
 *  smoke test are the only coverage the published artifact gets.
 */

import { execSync } from 'node:child_process';

const MAX_PACKED_MB = 20;

/** dist/index.js is ~690 KB with the base64 kernel split out, ~8.5 MB with it
 *  inlined. Anything near the upper number means tsup `splitting` got turned off. */
const MAX_ENTRY_MB = 2;

const MUST_INCLUDE = [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/wasm/meshup_bg.wasm',
    'src/index.ts',
    'src/loader.ts',
    'src/meshup-js-binary.ts',
    'src/wasm/meshup.js',
    'src/wasm/meshup.d.ts',
    'src/wasm/meshup_bg.wasm',
    'src/wasm/LICENSE',
    'LICENSE',
    'NOTICE',
    'THIRD-PARTY-NOTICES.txt',
    'README.md',
];

const MUST_EXCLUDE = [
    'src/wasm/package.json',
    'src/wasm/README.md',
    'dist/index.cjs',
    'dist/index.js.map',
];

type PackEntry = { path: string; size: number };
type PackResult = { files: PackEntry[]; size: number; unpackedSize: number };

const raw = execSync('npm pack --dry-run --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const [result] = JSON.parse(raw) as PackResult[];
const paths = new Set(result.files.map((f) => f.path));

const missing = MUST_INCLUDE.filter((p) => !paths.has(p));
const present = MUST_EXCLUDE.filter((p) => paths.has(p));
const packedMB = result.size / 1024 / 1024;
const entryMB = (result.files.find((f) => f.path === 'dist/index.js')?.size ?? 0) / 1024 / 1024;

const problems: string[] = [];
if (missing.length) { problems.push(`missing required files:\n    - ${missing.join('\n    - ')}`); }
if (present.length) { problems.push(`files that must not ship:\n    - ${present.join('\n    - ')}`); }
if (packedMB > MAX_PACKED_MB) { problems.push(`tarball is ${packedMB.toFixed(1)} MB, over the ${MAX_PACKED_MB} MB ceiling`); }
if (entryMB > MAX_ENTRY_MB)
{
    problems.push(`dist/index.js is ${entryMB.toFixed(1)} MB, over the ${MAX_ENTRY_MB} MB ceiling — the base64 kernel is no longer in its own lazy chunk (tsup \`splitting\` turned off?)`);
}

if (problems.length)
{
    console.error(`❌ pack check FAILED\n\n  ${problems.join('\n\n  ')}\n`);
    process.exit(1);
}

console.log(`✅ pack check OK — ${result.files.length} files, ${packedMB.toFixed(1)} MB packed / ${(result.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked, dist/index.js ${entryMB.toFixed(2)} MB`);
