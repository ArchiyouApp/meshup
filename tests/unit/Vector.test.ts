import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Vector } from '../../src/Vector';
import { Vector3Js } from '../../src/wasm/csgrs';

beforeAll(async () =>
{
    await initAsync();
});

// ── Construction ──────────────────────────────────────────────────────────────

describe('construction', () =>
{
    it('constructs from (x, y, z)', () =>
    {
        const v = new Vector(1, 2, 3);
        expect(v.x).toBe(1);
        expect(v.y).toBe(2);
        expect(v.z).toBe(3);
    });

    it('constructs from a PointLike array [x, y, z]', () =>
    {
        const v = new Vector([4, 5, 6]);
        expect(v.x).toBe(4);
        expect(v.y).toBe(5);
        expect(v.z).toBe(6);
    });

    it('constructs from axis "x"', () => { expect(new Vector('x').toArray()).toEqual([1, 0, 0]); });
    it('constructs from axis "y"', () => { expect(new Vector('y').toArray()).toEqual([0, 1, 0]); });
    it('constructs from axis "z"', () => { expect(new Vector('z').toArray()).toEqual([0, 0, 1]); });

    it('Vector.from(x,y,z) returns same result as constructor', () =>
    {
        const a = new Vector(1, 2, 3);
        const b = Vector.from(1, 2, 3);
        expect(b.toArray()).toEqual(a.toArray());
    });

    it('Vector.from(Vector3Js) wraps without copying', () =>
    {
        const inner = new Vector3Js(7, 8, 9);
        const v = Vector.from(inner);
        expect(v.inner()).toBe(inner);
    });

    it('inner() returns the wrapped Vector3Js', () =>
    {
        const v = new Vector(1, 0, 0);
        expect(v.inner()).toBeInstanceOf(Vector3Js);
    });
});

// ── Mutation contract ─────────────────────────────────────────────────────────

describe('mutation contract — methods mutate this and return this', () =>
{
    it('add() mutates and returns this', () =>
    {
        const v = new Vector(1, 2, 3);
        const ret = v.add([1, 1, 1]);
        expect(ret).toBe(v);
        expect(v.toArray()).toEqual([2, 3, 4]);
    });

    it('subtract() mutates and returns this', () =>
    {
        const v = new Vector(5, 5, 5);
        v.subtract([2, 3, 1]);
        expect(v.toArray()).toEqual([3, 2, 4]);
    });

    it('scale() mutates and returns this', () =>
    {
        const v = new Vector(1, 2, 3);
        const ret = v.scale(2);
        expect(ret).toBe(v);
        expect(v.toArray()).toEqual([2, 4, 6]);
    });

    it('normalize() mutates and returns this', () =>
    {
        const v = new Vector(3, 4, 0);
        v.normalize();
        expect(v.length()).toBeCloseTo(1);
    });

    it('reverse() mutates and returns this', () =>
    {
        const v = new Vector(1, 2, 3);
        v.reverse();
        expect(v.toArray()).toEqual([-1, -2, -3]);
    });

    it('abs() mutates and returns this', () =>
    {
        const v = new Vector(-1, -2, 3);
        v.abs();
        expect(v.toArray()).toEqual([1, 2, 3]);
    });

    it('cross() mutates and returns this', () =>
    {
        const v = new Vector(1, 0, 0);
        const ret = v.cross(new Vector(0, 1, 0));
        expect(ret).toBe(v);
        expect(v.x).toBeCloseTo(0);
        expect(v.y).toBeCloseTo(0);
        expect(v.z).toBeCloseTo(1);
    });

    it('chaining works', () =>
    {
        const v = new Vector(2, 0, 0).scale(3).add([0, 6, 0]);
        expect(v.toArray()).toEqual([6, 6, 0]);
    });
});

// ── copy() ────────────────────────────────────────────────────────────────────

describe('copy()', () =>
{
    it('returns a new independent instance', () =>
    {
        const v = new Vector(1, 2, 3);
        const c = v.copy();
        expect(c).not.toBe(v);
        expect(c.toArray()).toEqual([1, 2, 3]);
    });

    it('mutations on copy do not affect original', () =>
    {
        const v = new Vector(1, 2, 3);
        v.copy().scale(99);
        expect(v.toArray()).toEqual([1, 2, 3]);
    });
});

// ── update() ─────────────────────────────────────────────────────────────────

describe('update()', () =>
{
    it('replaces inner from a Vector', () =>
    {
        const v = new Vector(1, 2, 3);
        v.update(new Vector(7, 8, 9));
        expect(v.toArray()).toEqual([7, 8, 9]);
    });

    it('replaces inner from a Vector3Js', () =>
    {
        const v = new Vector(1, 2, 3);
        v.update(new Vector3Js(4, 5, 6));
        expect(v.toArray()).toEqual([4, 5, 6]);
    });

    it('returns this', () =>
    {
        const v = new Vector(1, 2, 3);
        expect(v.update(new Vector(0, 0, 0))).toBe(v);
    });
});

// ── length() ──────────────────────────────────────────────────────────────────

describe('length()', () =>
{
    it('returns 1 for unit axes', () =>
    {
        expect(new Vector(1, 0, 0).length()).toBeCloseTo(1);
        expect(new Vector(0, 1, 0).length()).toBeCloseTo(1);
        expect(new Vector(0, 0, 1).length()).toBeCloseTo(1);
    });

    it('3-4-0 triangle has length 5', () =>
    {
        expect(new Vector(3, 4, 0).length()).toBeCloseTo(5);
    });

    it('zero vector has length 0', () =>
    {
        expect(new Vector(0, 0, 0).length()).toBeCloseTo(0);
    });
});

// ── dot() ─────────────────────────────────────────────────────────────────────

describe('dot()', () =>
{
    it('perpendicular vectors → 0', () =>
    {
        expect(new Vector(1, 0, 0).dot(new Vector(0, 1, 0))).toBeCloseTo(0);
    });

    it('parallel unit vectors → 1', () =>
    {
        expect(new Vector(1, 0, 0).dot(new Vector(1, 0, 0))).toBeCloseTo(1);
    });

    it('accepts both Vector and Vector3Js', () =>
    {
        const a = new Vector(2, 0, 0);
        expect(a.dot(new Vector3Js(3, 0, 0))).toBeCloseTo(6);
        expect(a.dot(new Vector(3, 0, 0))).toBeCloseTo(6);
    });
});

// ── cross() ───────────────────────────────────────────────────────────────────

describe('cross()', () =>
{
    it('X × Y = Z', () =>
    {
        const v = new Vector(1, 0, 0).cross(new Vector(0, 1, 0));
        expect(v.x).toBeCloseTo(0);
        expect(v.y).toBeCloseTo(0);
        expect(v.z).toBeCloseTo(1);
    });

    it('accepts both Vector and Vector3Js', () =>
    {
        const a = new Vector(1, 0, 0);
        a.cross(new Vector3Js(0, 1, 0));
        expect(a.z).toBeCloseTo(1);
    });
});

// ── angle() ───────────────────────────────────────────────────────────────────

describe('angle()', () =>
{
    it('same direction → 0°', () =>   { expect(new Vector(1, 0, 0).angle([1, 0, 0])).toBeCloseTo(0); });
    it('perpendicular → 90°', () =>   { expect(new Vector(1, 0, 0).angle([0, 1, 0])).toBeCloseTo(90); });
    it('opposite → 180°', () =>       { expect(new Vector(1, 0, 0).angle([-1, 0, 0])).toBeCloseTo(180); });
});

// ── angleX/Y/Z/XY/XZ() ───────────────────────────────────────────────────────

describe('angle projection helpers', () =>
{
    it('angleX() of +X axis is 0', () =>  { expect(new Vector(1, 0, 0).angleX()).toBeCloseTo(0); });
    it('angleY() of +Y axis is 0', () =>  { expect(new Vector(0, 1, 0).angleY()).toBeCloseTo(0); });
    it('angleZ() of +Z axis is 0', () =>  { expect(new Vector(0, 0, 1).angleZ()).toBeCloseTo(0); });
    it('angleXY() of +X is 0°', () =>     { expect(new Vector(1, 0, 0).angleXY()).toBeCloseTo(0); });
    it('angleXY() of +Y is 90°', () =>    { expect(new Vector(0, 1, 0).angleXY()).toBeCloseTo(90); });
    it('angleXZ() of +Z is 90°', () =>    { expect(new Vector(0, 0, 1).angleXZ()).toBeCloseTo(90); });
});

// ── isParallel() ──────────────────────────────────────────────────────────────

describe('isParallel()', () =>
{
    it('same direction is parallel', () =>      { expect(new Vector(1, 0, 0).isParallel([2, 0, 0])).toBe(true); });
    it('opposite direction is parallel', () =>  { expect(new Vector(1, 0, 0).isParallel([-1, 0, 0])).toBe(true); });
    it('perpendicular is not parallel', () =>   { expect(new Vector(1, 0, 0).isParallel([0, 1, 0])).toBe(false); });
});

// ── isOrtho() ─────────────────────────────────────────────────────────────────

describe('isOrtho()', () =>
{
    it('axis-aligned vectors are ortho', () =>
    {
        expect(new Vector(1, 0, 0).isOrtho()).toBe(true);
        expect(new Vector(0, -5, 0).isOrtho()).toBe(true);
    });

    it('diagonal vector is not ortho', () =>
    {
        expect(new Vector(1, 1, 0).isOrtho()).toBe(false);
    });

    it('does not mutate this', () =>
    {
        const v = new Vector(3, 0, 0);
        v.isOrtho();
        expect(v.x).toBe(3);
    });
});

// ── largestAxis() ─────────────────────────────────────────────────────────────

describe('largestAxis()', () =>
{
    it('returns x when x is largest', () => { expect(new Vector(5, 1, 1).largestAxis()).toBe('x'); });
    it('returns y when y is largest', () => { expect(new Vector(1, 5, 1).largestAxis()).toBe('y'); });
    it('returns z when z is largest', () => { expect(new Vector(1, 1, 5).largestAxis()).toBe('z'); });
});

// ── round() ───────────────────────────────────────────────────────────────────

describe('round()', () =>
{
    it('rounds to 0 decimals by default', () =>
    {
        const v = new Vector(1.6, 2.4, 3.5);
        v.round();
        expect(v.toArray()).toEqual([2, 2, 4]);
    });

    it('rounds to given decimal places', () =>
    {
        const v = new Vector(1.234, 5.678, 9.999);
        v.round(2);
        expect(v.x).toBeCloseTo(1.23);
        expect(v.y).toBeCloseTo(5.68);
        expect(v.z).toBeCloseTo(10.00);
    });
});

// ── setX/Y/Z/Component() ──────────────────────────────────────────────────────

describe('setX/Y/Z/Component()', () =>
{
    it('setX replaces x', () =>
    {
        const v = new Vector(1, 2, 3);
        v.setX(9);
        expect(v.toArray()).toEqual([9, 2, 3]);
    });

    it('setY replaces y', () =>
    {
        const v = new Vector(1, 2, 3);
        v.setY(9);
        expect(v.toArray()).toEqual([1, 9, 3]);
    });

    it('setZ replaces z', () =>
    {
        const v = new Vector(1, 2, 3);
        v.setZ(9);
        expect(v.toArray()).toEqual([1, 2, 9]);
    });

    it('setComponent("x") replaces x', () =>
    {
        const v = new Vector(1, 2, 3);
        v.setComponent('x', 99);
        expect(v.x).toBe(99);
    });
});

// ── rotate() / rotateZ() ──────────────────────────────────────────────────────

describe('rotate()', () =>
{
    it('rotateZ(90) rotates +X to +Y', () =>
    {
        const v = new Vector(1, 0, 0);
        v.rotateZ(90);
        expect(v.x).toBeCloseTo(0);
        expect(v.y).toBeCloseTo(1);
    });

    it('rotateZ(180) flips direction', () =>
    {
        const v = new Vector(1, 0, 0);
        v.rotateZ(180);
        expect(v.x).toBeCloseTo(-1);
    });
});

// ── rotateQuaternion() ────────────────────────────────────────────────────────

describe('rotateQuaternion()', () =>
{
    it('identity quaternion leaves vector unchanged', () =>
    {
        const v = new Vector(1, 2, 3);
        v.rotateQuaternion(1, 0, 0, 0);
        expect(v.x).toBeCloseTo(1);
        expect(v.y).toBeCloseTo(2);
        expect(v.z).toBeCloseTo(3);
    });

    it('accepts object form {w,x,y,z}', () =>
    {
        const v = new Vector(1, 0, 0);
        v.rotateQuaternion({ w: 1, x: 0, y: 0, z: 0 });
        expect(v.x).toBeCloseTo(1);
    });
});

// ── rotationBetween() ─────────────────────────────────────────────────────────

describe('rotationBetween()', () =>
{
    it('returns a quaternion object with w/x/y/z', () =>
    {
        const q = new Vector(1, 0, 0).rotationBetween([0, 1, 0]);
        expect(q).toHaveProperty('w');
        expect(q).toHaveProperty('x');
        expect(q).toHaveProperty('y');
        expect(q).toHaveProperty('z');
    });

    it('same vector gives identity-like quaternion (w ≈ 1)', () =>
    {
        const q = new Vector(1, 0, 0).rotationBetween([1, 0, 0]);
        expect(q.w).toBeCloseTo(1);
    });
});

// ── equals() ─────────────────────────────────────────────────────────────────

describe('equals()', () =>
{
    it('same components are equal', () =>
    {
        expect(new Vector(1, 2, 3).equals([1, 2, 3])).toBe(true);
    });

    it('different components are not equal', () =>
    {
        expect(new Vector(1, 2, 3).equals([1, 2, 4])).toBe(false);
    });

    it('respects tolerance', () =>
    {
        expect(new Vector(1, 2, 3).equals([1.000001, 2, 3], 1e-4)).toBe(true);
        expect(new Vector(1, 2, 3).equals([1.001, 2, 3], 1e-4)).toBe(false);
    });
});

// ── conversions ───────────────────────────────────────────────────────────────

describe('conversions', () =>
{
    it('toArray() returns [x, y, z]', () =>
    {
        expect(new Vector(1, 2, 3).toArray()).toEqual([1, 2, 3]);
    });

    it('toPoint() returns a Point with same coords', () =>
    {
        const p = new Vector(1, 2, 3).toPoint();
        expect(p.x).toBe(1);
        expect(p.y).toBe(2);
        expect(p.z).toBe(3);
    });

    it('toVector3Js() returns a Vector3Js', () =>
    {
        const v3 = new Vector(1, 2, 3).toVector3Js();
        expect(v3).toBeInstanceOf(Vector3Js);
        expect(v3.x).toBe(1);
    });

    it('toString() contains coordinates', () =>
    {
        const s = new Vector(1, 2, 3).toString();
        expect(s).toContain('1');
        expect(s).toContain('2');
        expect(s).toContain('3');
    });
});
