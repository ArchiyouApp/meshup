import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';

beforeAll(async () => {
    await initAsync();
});

describe('Curve.Line()', () => {
    it('creates a non-null curve', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c).toBeTruthy();
    });

    it('has the correct length', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.length()).toBeCloseTo(10, 1);
    });

    it('start() returns the start point', () => {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.start().x).toBeCloseTo(1);
        expect(c.start().y).toBeCloseTo(2);
        expect(c.start().z).toBeCloseTo(3);
    });

    it('end() returns the end point', () => {
        const c = Curve.Line([1, 2, 3], [4, 5, 6]);
        expect(c.end().x).toBeCloseTo(4);
        expect(c.end().y).toBeCloseTo(5);
        expect(c.end().z).toBeCloseTo(6);
    });

    it('is not closed', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(c.isClosed()).toBe(false);
    });

    it('throws for invalid points', () => {
        expect(() => Curve.Line('bad' as any, [0, 0, 0])).toThrow();
    });
});

describe('Curve.Polyline()', () => {
    it('creates a polyline through multiple points', () => {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0], [0,5,0]]);
        expect(c).toBeTruthy();
    });

    it('has a positive length', () => {
        const c = Curve.Polyline([[0,0,0], [5,0,0], [5,5,0]]);
        expect(c.length()).toBeGreaterThan(0);
    });

    it('accepts flat args: Curve.Polyline(p1, p2, p3)', () => {
        const c = Curve.Polyline([0,0,0], [10,0,0], [10,10,0]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });
});

describe('Curve.Interpolated()', () => {
    it('creates a smooth curve through control points', () => {
        // degree 3 needs at least 4 control points
        const c = Curve.Interpolated([[0,0,0], [3,5,0], [7,5,0], [10,0,0]]);
        expect(c).toBeTruthy();
        expect(c.length()).toBeGreaterThan(0);
    });
});

describe('Curve.Circle()', () => {
    it('creates a circle with the given radius', () => {
        const c = Curve.Circle(5);
        expect(c).toBeTruthy();
    });

    it('is closed', () => {
        const c = Curve.Circle(5);
        expect(c.isClosed()).toBe(true);
    });

    it('circumference ≈ 2πr', () => {
        const r = 10;
        const c = Curve.Circle(r);
        expect(c.length()).toBeCloseTo(2 * Math.PI * r, 0);
    });
});

describe('Curve.tessellate()', () => {
    it('returns an array of Points', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(Array.isArray(pts)).toBe(true);
        expect(pts.length).toBeGreaterThan(0);
    });

    it('first tessellated point is near the start', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const pts = c.tessellate();
        expect(pts[0].x).toBeCloseTo(0, 1);
    });
});

describe('Curve.pointAtParam()', () => {
    it('returns start point at param domain[0]', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const domain = c.inner().knotsDomain();
        const pt = c.pointAtParam(domain[0]);
        expect(pt.x).toBeCloseTo(0, 1);
    });
});

describe('Curve.type()', () => {
    it('returns "Curve" for a simple NurbsCurve', () => {
        const c = Curve.Line([0,0,0], [1,0,0]);
        expect(c.type()).toBe('Curve');
    });

    it('returns "Compound" for a compound curve', () => {
        const a = Curve.Line([0,0,0], [5,0,0]);
        const b = Curve.Line([5,0,0], [10,0,0]);
        const compound = Curve.Compound([a, b]);
        expect(compound.type()).toBe('Compound');
    });
});

describe('Curve.center()', () => {
    it('returns midpoint of a line along x-axis', () => {
        const c = Curve.Line([0, 0, 0], [10, 0, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(5, 1);
        expect(center.y).toBeCloseTo(0, 1);
        expect(center.z).toBeCloseTo(0, 1);
    });

    it('returns center of a circle', () => {
        const c = Curve.Circle(5, [3, 4, 0]);
        const center = c.center();
        expect(center.x).toBeCloseTo(3, 0);
        expect(center.y).toBeCloseTo(4, 0);
    });

    it('returns a Point instance', () => {
        const c = Curve.Line([1, 2, 3], [5, 6, 7]);
        expect(c.center()).toBeInstanceOf(Object); // Point
        expect(typeof c.center().x).toBe('number');
    });
});

describe('Curve.toPolygon()', () => {
    it('returns a Polygon for a closed curve', () => {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const p = c.toPolygon();
        expect(p).toBeInstanceOf(Polygon);
    });

    it('returns polygon with vertices', () => {
        const c = Curve.Circle(5);
        const p = c.toPolygon();
        expect(p).toBeTruthy();
        expect(p!.vertices().length).toBeGreaterThan(2);
    });
});

describe('Curve.toMesh()', () => {
    it('returns a Mesh for a closed curve', () => {
        const c = Curve.Polyline([[0,0,0], [10,0,0], [10,10,0], [0,10,0]]).close();
        const m = c.toMesh();
        expect(m).toBeInstanceOf(Mesh);
    });

    it('result mesh has triangles', () => {
        const c = Curve.Circle(5);
        const m = c.toMesh();
        expect(m).toBeTruthy();
        expect(m!.inner().triangleCount()).toBeGreaterThan(0);
    });
});

describe('Curve.extend() merge_colinear_lines regression', () => {
    it('keeps roof-profile polyline at 3 control points after extend both', () => {
        const roof = Curve.Polyline([
            [0, 0, 0],
            [200, 0, 500],
            [400, 0, 300],
        ]).extend(50, 'both');

        const spans = roof.spans();
        expect(spans.length).toBe(1);
        expect(spans[0].controlPoints().length).toBe(3);
    });
});
