import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Sketch } from '../../src/Sketch';
import { Mesh } from '../../src/Mesh';

beforeAll(async () =>
{
    await initAsync();
});

/** Build a simple closed square sketch on the XY plane */
function makeSquare(size = 10): Sketch {
    return new Sketch()
        .moveTo(0, 0)
        .lineTo(size, 0)
        .lineTo(size, size)
        .lineTo(0, size)
        .close();
}

describe('Sketch construction', () =>
{
    it('creates a Sketch on the default XY plane', () =>
    {
        const s = new Sketch();
        expect(s).toBeTruthy();
    });

    it('starts with zero curves', () =>
    {
        const s = new Sketch();
        expect(s._curves.count()).toBe(0);
    });
});

describe('Sketch.moveTo() / lineTo()', () =>
{
    it('adds a line curve after lineTo', () =>
    {
        const s = new Sketch()
            .moveTo(0, 0)
            .lineTo(10, 0);
        expect(s._curves.count()).toBeGreaterThan(0);
    });

    it('supports relative coordinates with "+" prefix', () =>
    {
        const s = new Sketch()
            .moveTo(0, 0)
            .lineTo('+10', 0);
        expect(s._curves.count()).toBeGreaterThan(0);
    });

    it('lineTo with same start/end is silently skipped', () =>
    {
        const s = new Sketch()
            .moveTo(5, 5)
            .lineTo(5, 5); // zero-length — should be skipped
        expect(s._curves.count()).toBe(0);
    });
});

describe('Sketch on different base planes', () =>
{
    it('creates a Sketch on the XZ plane', () =>
    {
        const s = new Sketch('xz');
        expect(s).toBeTruthy();
    });

    it('creates a Sketch on the YZ plane', () =>
    {
        const s = new Sketch('yz');
        expect(s).toBeTruthy();
    });
});

describe('Sketch.curveTo()', () =>
{
    it('adds a smooth NURBS segment', () =>
    {
        const s = new Sketch()
            .moveTo(0, 0)
            .curveTo([[5, 5], [10, 0], [15, -5]]);
        expect(s._curves.count()).toBeGreaterThan(0);
    });
});

describe('Sketch.extend()', () =>
{
    it('extends the last curve at the end', () =>
    {
        const s = new Sketch().moveTo(0, 0).lineTo(10, 0);
        const lenBefore = s._curves.last()!.length();
        s.extend(5);
        expect(s._curves.last()!.length()).toBeGreaterThan(lenBefore);
    });

    it('extends the last curve at the start', () =>
    {
        const s = new Sketch().moveTo(0, 0).lineTo(10, 0);
        const lenBefore = s._curves.last()!.length();
        s.extend(5, 'start');
        expect(s._curves.last()!.length()).toBeGreaterThan(lenBefore);
    });

    it('returns this for chaining', () =>
    {
        const s = new Sketch().moveTo(0, 0).lineTo(10, 0);
        expect(s.extend(3)).toBe(s);
    });

    it('does nothing when no curve exists', () =>
    {
        const s = new Sketch();
        expect(() => s.extend(5)).not.toThrow();
    });
});
