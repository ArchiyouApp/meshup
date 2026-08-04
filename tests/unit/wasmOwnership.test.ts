import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';

/** Guards against wasm-bindgen ownership bugs.
 *
 *  A binding that takes an exported type BY VALUE (e.g. `Vec<Curve3DJs>`) makes
 *  wasm-bindgen unwrap each operand by destroying it into a raw pointer, which frees the
 *  caller's JS wrapper. Every later use of that operand then throws
 *  "null pointer passed to rust", and the generated module gains a `__wbg_*_unwrap` import
 *  that the app's loader may not supply — which fails at `WebAssembly.instantiate()`,
 *  before any geometry runs.
 *
 *  This is invisible to tests that build inputs, call an operation and only inspect the
 *  OUTPUT. These tests deliberately reuse the inputs afterwards.
 */

beforeAll(async () => { await initAsync(); });

describe('wasm ownership: operands survive the call', () =>
{
    it('Curve.Compound() leaves its input curves usable', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        const b = Curve.Line([10, 0, 0], [20, 0, 0]);
        const joined = Curve.Compound([a, b]);
        expect(joined.length()).toBeCloseTo(20, 6);
        // The operands must still be alive.
        expect(a.length()).toBeCloseTo(10, 6);
        expect(b.length()).toBeCloseTo(10, 6);
    });

    it('the same curves can be joined more than once', () =>
    {
        const parts = [
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Line([10, 0, 0], [20, 0, 0]),
            Curve.Line([20, 0, 0], [20, 10, 0]),
        ];
        expect(Curve.Compound(parts).length()).toBeCloseTo(30, 6);
        expect(Curve.Compound(parts).length()).toBeCloseTo(30, 6);
    });

    it('a joined arc keeps its operands and its curvature', () =>
    {
        const arc = Curve.Arc([0, 0, 0], [10, 10, 0], [20, 0, 0], 'threepoint');
        const line = Curve.Line([20, 0, 0], [30, 0, 0]);
        const joined = Curve.Compound([arc, line]);
        expect(joined.inner().hasArcs()).toBe(true);
        expect(arc.length()).toBeCloseTo(Math.PI * 10, 6);
        expect(line.length()).toBeCloseTo(10, 6);
    });
});
