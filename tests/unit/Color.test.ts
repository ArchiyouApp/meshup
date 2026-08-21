/**
 * Color.test.ts — parsing, and the ramp interpolation that colorGradient() is built on.
 */
import { describe, it, expect } from 'vitest';
import { Color, type ColorStop } from '../../src/Color';

describe('Color.mix', () =>
{
    it('returns the endpoints at t=0 and t=1', () =>
    {
        expect(Color.mix('#000000', '#ffffff', 0).toHex()).toBe('#000000');
        expect(Color.mix('#000000', '#ffffff', 1).toHex()).toBe('#ffffff');
    });

    it('lands halfway at t=0.5', () =>
    {
        expect(Color.mix('#000000', '#ffffff', 0.5).toHex()).toBe('#808080');
        expect(Color.mix('#ff0000', '#0000ff', 0.5).toRgb()).toEqual([128, 0, 128]);
    });

    it('clamps t outside 0..1 rather than extrapolating', () =>
    {
        // Extrapolating would produce colours outside the ramp the caller asked for.
        expect(Color.mix('#000000', '#ffffff', -5).toHex()).toBe('#000000');
        expect(Color.mix('#000000', '#ffffff', 99).toHex()).toBe('#ffffff');
    });

    it('accepts every ColorInput form, and pre-parsed Colors', () =>
    {
        expect(Color.mix('red', 'blue', 0).toHex()).toBe('#ff0000');
        expect(Color.mix(0xff0000, [0, 0, 255], 1).toHex()).toBe('#0000ff');
        expect(Color.mix(new Color('red'), new Color('blue'), 1).toHex()).toBe('#0000ff');
    });
});

describe('Color.sample', () =>
{
    const RAMP: ColorStop[] = [
        { at: 0, color: '#ff0000' },
        { at: 0.5, color: '#00ff00' },
        { at: 1, color: '#0000ff' },
    ];

    it('hits each stop exactly', () =>
    {
        expect(Color.sample(RAMP, 0).toHex()).toBe('#ff0000');
        expect(Color.sample(RAMP, 0.5).toHex()).toBe('#00ff00');
        expect(Color.sample(RAMP, 1).toHex()).toBe('#0000ff');
    });

    it('interpolates within the bracketing pair, not across the whole ramp', () =>
    {
        // The point of multi-stop: at t=0.25 the answer is red→green halfway, NOT red→blue
        // a quarter of the way. Getting this wrong makes middle stops decorative.
        expect(Color.sample(RAMP, 0.25).toRgb()).toEqual([128, 128, 0]);
        expect(Color.sample(RAMP, 0.75).toRgb()).toEqual([0, 128, 128]);
    });

    it('clamps outside the ramp instead of extrapolating', () =>
    {
        expect(Color.sample(RAMP, -1).toHex()).toBe('#ff0000');
        expect(Color.sample(RAMP, 2).toHex()).toBe('#0000ff');
    });

    it('holds the end colours for a ramp that does not span 0..1', () =>
    {
        const partial: ColorStop[] = [{ at: 0.4, color: 'red' }, { at: 0.6, color: 'blue' }];
        expect(Color.sample(partial, 0).toHex()).toBe('#ff0000');
        expect(Color.sample(partial, 1).toHex()).toBe('#0000ff');
        expect(Color.sample(partial, 0.5).toRgb()).toEqual([128, 0, 128]);
    });

    it('treats coincident stops as a hard colour break', () =>
    {
        // Two stops at the same position mean "switch here" — and must not divide by zero.
        const hard: ColorStop[] = [
            { at: 0, color: 'red' }, { at: 0.5, color: 'red' },
            { at: 0.5, color: 'blue' }, { at: 1, color: 'blue' },
        ];
        expect(Color.sample(hard, 0.25).toHex()).toBe('#ff0000');
        expect(Color.sample(hard, 0.75).toHex()).toBe('#0000ff');
        expect(Number.isFinite(Color.sample(hard, 0.5).toInt())).toBe(true);
    });

    it('works with a single stop', () =>
    {
        expect(Color.sample([{ at: 0, color: 'red' }], 0.7).toHex()).toBe('#ff0000');
    });

    it('refuses an empty ramp rather than inventing a colour', () =>
    {
        expect(() => Color.sample([], 0.5)).toThrow(/at least one stop/);
    });

    it('accepts pre-parsed Colors, so a hot loop need not re-parse', () =>
    {
        const pre: ColorStop[] = [{ at: 0, color: new Color('red') }, { at: 1, color: new Color('blue') }];
        expect(Color.sample(pre, 0.5).toRgb()).toEqual([128, 0, 128]);
    });
});
