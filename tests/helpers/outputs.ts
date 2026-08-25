/**
 *  tests/helpers/outputs.ts
 *
 *  Where a test writes what it generates.
 *
 *  A test hands in its own module URL and gets back the `outputs/` folder BESIDE ITSELF, so
 *  generated files sit next to what makes them rather than in a parallel tree (the same
 *  convention .gitignore keeps out of the repo: `tests/**\/outputs/`).
 *
 *      const OUTPUT_DIR = outputDir(import.meta.url);
 *      await save(OUTPUT_DIR + 'test.house.gltf', await house.toGLTF());
 *
 *  Derived from the module URL rather than written out as './tests/examples/outputs/',
 *  which is what every test used to carry: that path is relative to the working directory
 *  vitest happens to be started from, so running the suite from the monorepo root instead of
 *  this package silently scattered the artifacts (or wrote none at all). A path taken from
 *  the test's own location cannot be wrong about where the test is.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The `outputs/` folder beside the test file at `testFileUrl`, WITH a trailing slash —
 *  callers build filenames by concatenation, not through path.join().
 *
 *  The folder itself is not created here: utils.save() already makes the directory of
 *  whatever it is asked to write, so a test that generates nothing leaves no empty folder. */
export function outputDir(testFileUrl: string): string
{
    return `${dirname(fileURLToPath(testFileUrl))}/outputs/`;
}
