import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Vector } from '../../src/Vector';

beforeAll(async () =>
{
    await initAsync();
});

describe('Vector construction', () =>
{
    it('constructs from (x, y, z)', () =>
    {
        const v = new Vector(1, 2, 3);
        expect(v.x).toBe(1);
        expect(v.y).toBe(2);
        expect(v.z).toBe(3);
    });

    it('constructs from a PointLike array', () =>
    {
        const v = new Vector([4, 5, 6]);
        expect(v.x).toBe(4);
        expect(v.y).toBe(5);
        expect(v.z).toBe(6);
    });

    it('constructs from axis shorthand "x"', () =>
    {
        const v = new Vector('x');
        expect(v.x).toBe(1);
        expect(v.y).toBe(0);
        expect(v.z).toBe(0);
    });

    it('constructs from axis shorthand "y"', () =>
    {
        const v = new Vector('y');
        expect(v.y).toBe(1);
    });

    it('constructs from axis shorthand "z"', () =>
    {
        const v = new Vector('z');
        expect(v.z).toBe(1);
    });

    it('Vector.from() is an alias for the constructor', () =>
    {
        const v = Vector.from(1, 0, 0);
        expect(v.x).toBe(1);
    });
});

describe('Vector.length()', () =>
{
    it('returns 1 for unit vector', () =>
    {
        expect(new Vector(1, 0, 0).length()).toBeCloseTo(1);
        expect(new Vector(0, 1, 0).length()).toBeCloseTo(1);
        expect(new Vector(0, 0, 1).length()).toBeCloseTo(1);
    });

    it('returns correct length for arbitrary vector', () => 
    {
        expect(new Vector(3, 4, 0).length()).toBeCloseTo(Math.sqrt(3*3+4*4)); // 5
        expect(new Vector(100, 50, 50).length()).toBeCloseTo(Math.sqrt(100*100+50*50+50*50)); // 125

    });

    it('returns 0 for zero vector', () =>
    {
        expect(new Vector(0, 0, 0).length()).toBeCloseTo(0);
    });
});

describe('Vector.normalize()', () =>
{
    it('returns a unit vector', () =>
    {
        const v = new Vector(3, 4, 0).normalize();
        expect(v.length()).toBeCloseTo(1);
    });

    it('does not mutate the original', () =>
    {
        const v = new Vector(2, 0, 0);
        const n = v.normalize();
        expect(v.x).toBe(2); // original unchanged
        expect(n.x).toBeCloseTo(1);
    });
});

describe('Vector.scale()', () =>
{
    it('scales by a positive factor', () =>
    {
        const v = new Vector(1, 2, 3).scale(2);
        expect(v.x).toBeCloseTo(2);
        expect(v.y).toBeCloseTo(4);
        expect(v.z).toBeCloseTo(6);
    });

    it('scales by zero produces zero vector', () =>
    {
        const v = new Vector(5, 5, 5).scale(0);
        expect(v.length()).toBeCloseTo(0);
    });
});

describe('Vector.add() / subtract()', () =>
{
    it('adds two vectors', () =>
    {
        const v = new Vector(1, 2, 3).add([4, 5, 6]);
        expect(v.x).toBeCloseTo(5);
        expect(v.y).toBeCloseTo(7);
        expect(v.z).toBeCloseTo(9);
    });

    it('subtracts two vectors', () =>
    {
        const v = new Vector(5, 5, 5).subtract([2, 3, 1]);
        expect(v.x).toBeCloseTo(3);
        expect(v.y).toBeCloseTo(2);
        expect(v.z).toBeCloseTo(4);
    });
});

describe('Vector.dot()', () =>
{
    it('dot product of perpendicular vectors is 0', () =>
    {
        const a = new Vector(1, 0, 0);
        const b = new Vector(0, 1, 0);
        expect(a.dot(b.toVector3Js())).toBeCloseTo(0);
    });

    it('dot product of parallel unit vectors is 1', () =>
    {
        const a = new Vector(1, 0, 0);
        expect(a.dot(a.toVector3Js())).toBeCloseTo(1);
    });
});

describe('Vector.cross()', () =>
{
    it('X cross Y = Z', () =>
    {
        const x = new Vector(1, 0, 0);
        const y = new Vector(0, 1, 0);
        const z = Vector.from(x.cross(y.toVector3Js()));
        expect(z.x).toBeCloseTo(0);
        expect(z.y).toBeCloseTo(0);
        expect(z.z).toBeCloseTo(1);
    });
});

describe('Vector.angle()', () =>
{
    it('angle between same vectors is 0', () =>
    {
        const v = new Vector(1, 0, 0);
        expect(v.angle([1, 0, 0])).toBeCloseTo(0);
    });

    it('angle between perpendicular vectors is 90 degrees', () =>
    {
        const v = new Vector(1, 0, 0);
        expect(v.angle([0, 1, 0])).toBeCloseTo(90);
    });

    it('angle between opposite vectors is 180 degrees', () =>
    {
        const v = new Vector(1, 0, 0);
        expect(v.angle([-1, 0, 0])).toBeCloseTo(180);
    });
});
