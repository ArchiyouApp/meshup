import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Point } from '../../src/Point';

beforeAll(async () => {
    await initAsync();
});

describe('Point construction', () => {
    it('constructs from (x, y, z) numbers', () => {
        const p = new Point(1, 2, 3);
        expect(p.x).toBe(1);
        expect(p.y).toBe(2);
        expect(p.z).toBe(3);
    });

    it('defaults z to 0 when not supplied', () => {
        const p = new Point(4, 5);
        expect(p.z).toBe(0);
    });

    it('constructs from a 2-element array', () => {
        const p = new Point([7, 8]);
        expect(p.x).toBe(7);
        expect(p.y).toBe(8);
        expect(p.z).toBe(0);
    });

    it('constructs from a 3-element array', () => {
        const p = new Point([1, 2, 3]);
        expect(p.x).toBe(1);
        expect(p.y).toBe(2);
        expect(p.z).toBe(3);
    });

    it('constructs from an {x, y} object', () => {
        const p = new Point({ x: 3, y: 4 });
        expect(p.x).toBe(3);
        expect(p.y).toBe(4);
        expect(p.z).toBe(0);
    });

    it('constructs from an {x, y, z} object', () => {
        const p = new Point({ x: 3, y: 4, z: 5 });
        expect(p.z).toBe(5);
    });

    it('constructs from another Point', () => {
        const src = new Point(9, 8, 7);
        const p = new Point(src);
        expect(p.x).toBe(9);
        expect(p.y).toBe(8);
        expect(p.z).toBe(7);
    });

    it('Point.from() is an alias for the constructor', () => {
        const p = Point.from(2, 3, 4);
        expect(p.x).toBe(2);
        expect(p.y).toBe(3);
        expect(p.z).toBe(4);
    });

    it('throws for invalid input', () => {
        expect(() => new Point('bad' as any)).toThrow();
    });
});

describe('Point.distance()', () => {
    it('returns 0 for same point', () => {
        const p = new Point(1, 2, 3);
        expect(p.distance([1, 2, 3])).toBe(0);
    });

    it('returns 1 for adjacent points on x-axis', () => {
        const p = new Point(0, 0, 0);
        expect(p.distance([1, 0, 0])).toBeCloseTo(1);
    });

    it('computes 3D distance correctly', () => {
        const p = new Point(0, 0, 0);
        expect(p.distance([3, 4, 0])).toBeCloseTo(5);
    });
});

describe('Point.move()', () => {
    it('translates the point in-place', () => {
        const p = new Point(1, 2, 3);
        const result = p.move([1, 1, 1]);
        expect(p.x).toBe(2);
        expect(p.y).toBe(3);
        expect(p.z).toBe(4);
        expect(result).toBe(p); // returns this
    });

    it('translates with negative offset', () => {
        const p = new Point(5, 5, 5);
        p.move([-2, -3, -1]);
        expect(p.x).toBe(3);
        expect(p.y).toBe(2);
        expect(p.z).toBe(4);
    });
});

describe('Point.round()', () => {
    it('rounds to default tolerance', () => {
        const p = new Point(1.000001, 2.000002, 3.000003);
        p.round();
        // after rounding to POINT_TOLERANCE these should be very close to integers
        expect(p.x).toBeCloseTo(1);
        expect(p.y).toBeCloseTo(2);
        expect(p.z).toBeCloseTo(3);
    });

    it('rounds to given tolerance', () => {
        const p = new Point(1.6, 2.4, 3.5);
        p.round(1);
        expect(p.x).toBe(2);
        expect(p.y).toBe(2);
        expect(p.z).toBe(4);
    });

    it('returns this (chainable)', () => {
        const p = new Point(1, 2, 3);
        expect(p.round()).toBe(p);
    });
});

describe('Point.toArray()', () => {
    it('returns [x, y, z]', () => {
        const p = new Point(10, 20, 30);
        expect(p.toArray()).toEqual([10, 20, 30]);
    });
});
