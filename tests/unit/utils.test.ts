import { describe, it, expect } from 'vitest';
import { rad, deg, toBase64, fromBase64 } from '../../src/utils';

describe('rad', () =>
{
    it('converts 0 degrees to 0 radians', () =>
    {
        expect(rad(0)).toBe(0);
    });

    it('converts 180 degrees to PI radians', () =>
    {
        expect(rad(180)).toBeCloseTo(Math.PI);
    });

    it('converts 90 degrees to PI/2 radians', () =>
    {
        expect(rad(90)).toBeCloseTo(Math.PI / 2);
    });

    it('converts 360 degrees to 2*PI radians', () =>
    {
        expect(rad(360)).toBeCloseTo(2 * Math.PI);
    });

    it('converts negative degrees', () =>
    {
        expect(rad(-90)).toBeCloseTo(-Math.PI / 2);
    });
});

describe('deg', () =>
{
    it('converts 0 radians to 0 degrees', () =>
    {
        expect(deg(0)).toBe(0);
    });

    it('converts PI radians to 180 degrees', () =>
    {
        expect(deg(Math.PI)).toBeCloseTo(180);
    });

    it('converts PI/2 radians to 90 degrees', () =>
    {
        expect(deg(Math.PI / 2)).toBeCloseTo(90);
    });

    it('converts 2*PI radians to 360 degrees', () =>
    {
        expect(deg(2 * Math.PI)).toBeCloseTo(360);
    });
});

describe('rad/deg roundtrip', () =>
{
    it('converts degrees → radians → degrees', () =>
    {
        expect(deg(rad(45))).toBeCloseTo(45);
        expect(deg(rad(270))).toBeCloseTo(270);
    });
});

describe('toBase64 / fromBase64', () =>
{
    it('roundtrips a Uint8Array', () =>
    {
        const original = new Uint8Array([72, 101, 108, 108, 111]);
        const encoded = toBase64(original);
        expect(typeof encoded).toBe('string');
        const decoded = fromBase64(encoded);
        // fromBase64 returns Buffer in Node.js (a Uint8Array subclass)
        expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it('roundtrips a string', () =>
    {
        const original = 'Hello, MeshUp!';
        const encoded = toBase64(original);
        const decoded = fromBase64(encoded);
        expect(new TextDecoder().decode(decoded)).toBe(original);
    });
});
