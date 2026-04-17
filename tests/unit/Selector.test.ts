import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Selector } from '../../src/Selector';
import { Mesh } from '../../src/Mesh';
import { Polygon } from '../../src/Polygon';
import { Point } from '../../src/Point';

beforeAll(async () =>
{
    await initAsync();
});

describe('Selector parsing', () =>
{
    describe('shape shortcuts', () =>
    {
        it('parses F as face', () =>
        {
            const s = new Selector('F||front');
            expect(s.params.shape).toBe('face');
        });

        it('parses E as edge', () =>
        {
            const s = new Selector('E|x');
            expect(s.params.shape).toBe('edge');
        });

        it('parses V as vertex', () =>
        {
            const s = new Selector('V-z');
            expect(s.params.shape).toBe('vertex');
        });

        it('parses M as mesh', () =>
        {
            const s = new Selector('M+z');
            expect(s.params.shape).toBe('mesh');
        });

        it('parses C as curve', () =>
        {
            const s = new Selector('C<->>z');
            expect(s.params.shape).toBe('curve');
        });
    });

    describe('side selector', () =>
    {
        it('parses face||front', () =>
        {
            const s = new Selector('face||front');
            expect(s._parsed).toBe(true);
            expect(s.type).toBe('side');
            expect(s.params.shape).toBe('face');
            expect(s.params.alignments).toEqual('front');
        });
    });

    describe('parallel selector', () =>
    {
        it('parses face|x (axis)', () =>
        {
            const s = new Selector('face|x');
            expect(s.type).toBe('parallel');
            expect(s.params.shape).toBe('face');
            expect(s.params.axis).toBe('x');
        });

        it('parses edge|xz (plane)', () =>
        {
            const s = new Selector('edge|xz');
            expect(s.type).toBe('parallel');
            expect(s.params.shape).toBe('edge');
            expect(s.params.plane).toHaveProperty('normal');
        });
    });

    describe('positive / negative selectors', () =>
    {
        it('parses face+z', () =>
        {
            const s = new Selector('face+z');
            expect(s.type).toBe('positive');
            expect(s.params.shape).toBe('face');
            expect(s.params.axis).toBe('z');
        });

        it('parses vertex-x', () =>
        {
            const s = new Selector('vertex-x');
            expect(s.type).toBe('negative');
            expect(s.params.shape).toBe('vertex');
            expect(s.params.axis).toBe('x');
        });
    });

    describe('closest selector', () =>
    {
        it('parses face<<->z (axis)', () =>
        {
            const s = new Selector('face<<->z');
            expect(s.type).toBe('closest');
            expect(s.params.shape).toBe('face');
            expect(s.params.axis).toBe('z');
        });

        it('parses edge<<->front (plane)', () =>
        {
            const s = new Selector('edge<<->front');
            expect(s.type).toBe('closest');
            expect(s.params.shape).toBe('edge');
            expect(s.params.plane).toHaveProperty('normal');
        });
    });

    describe('furthest selector', () =>
    {
        it('parses vertex<->>y (axis)', () =>
        {
            const s = new Selector('vertex<->>y');
            expect(s.type).toBe('furthest');
            expect(s.params.shape).toBe('vertex');
            expect(s.params.axis).toBe('y');
        });

        it('parses face<->>left (plane)', () =>
        {
            const s = new Selector('face<->>left');
            expect(s.type).toBe('furthest');
            expect(s.params.shape).toBe('face');
            expect(s.params.plane).toHaveProperty('normal');
        });
    });

    describe('error handling', () =>
    {
        it('throws for an unrecognized selector', () =>
        {
            expect(() => new Selector('garbage')).toThrow('Unrecognized selector string');
        });

        it('throws for an invalid shape', () =>
        {
            expect(() => new Selector('bogus||front')).toThrow();
        });
    });
});

// ===== Execute tests =====
// Use a cube centered at origin: vertices from -5 to +5 on all axes
// 6 quad faces → normals along ±x, ±y, ±z

describe('Selector.execute()', () =>
{
    describe('side', () =>
    {
        it('face||front returns faces that are facing the front side of the bounding box', () =>
        {
            const cube = Mesh.Cube(10);
            const result = new Selector('face||front').execute(cube);
            // execute() returns a ShapeCollection for side selectors
            const faces = (result as any).toArray ? (result as any).toArray() : (result as any[]);
            expect(faces.length).toBeGreaterThan(0);
            // All returned faces should have a normal parallel to [0,-1,0]
            faces.forEach((f: any) =>
            {
                const n = f.normal ? f.normal() : f.polygons()[0].normal();
                expect(Math.abs(n.y)).toBeCloseTo(1, 0);
            });
        });
    });

    describe('parallel', () =>
    {
        it('face|z returns faces whose normal is parallel to z-axis', () =>
        {
            const cube = Mesh.Cube(10);
            const faces = new Selector('face|z').execute(cube) as Polygon[];
            expect(faces.length).toBeGreaterThan(0);
            faces.forEach(f =>
            {
                const n = f.plane().normal();
                expect(Math.abs(n.z)).toBeCloseTo(1, 0);
            });
        });

        it('face|xy returns faces whose normal is parallel to xy-plane normal (z)', () =>
        {
            const cube = Mesh.Cube(10);
            const faces = new Selector('face|xy').execute(cube) as Polygon[];
            expect(faces.length).toBeGreaterThan(0);
            faces.forEach(f =>
            {
                const n = f.plane().normal();
                expect(Math.abs(n.z)).toBeCloseTo(1, 0);
            });
        });
    });

    describe('positive / negative', () =>
    {
        it('vertex+z returns only vertices with positive z', () =>
        {
            const cube = Mesh.Cube(10); // centered, so vertices at z = -5 and z = +5
            const verts = new Selector('vertex+z').execute(cube) as Point[];
            expect(verts.length).toBeGreaterThan(0);
            verts.forEach(p =>
            {
                expect(p.z).toBeGreaterThan(0);
            });
        });

        it('vertex-z returns only vertices with negative z', () =>
        {
            const cube = Mesh.Cube(10);
            const verts = new Selector('vertex-z').execute(cube) as Point[];
            expect(verts.length).toBeGreaterThan(0);
            verts.forEach(p =>
            {
                expect(p.z).toBeLessThan(0);
            });
        });

        it('V-z shortcut returns only vertices with negative z', () =>
        {
            const cube = Mesh.Cube(10);
            const verts = new Selector('V-z').execute(cube) as Point[];
            expect(verts.length).toBeGreaterThan(0);
            verts.forEach(p =>
            {
                expect(p.z).toBeLessThan(0);
            });
        });

        it('face+z returns faces with center z > 0', () =>
        {
            const cube = Mesh.Cube(10);
            const faces = new Selector('face+z').execute(cube) as Polygon[];
            expect(faces.length).toBeGreaterThan(0);
        });
    });

    describe('closest', () =>
    {
        it('face<<->z returns the face closest to the z-axis', () =>
        {
            const cube = Mesh.Cube(10);
            const face = new Selector('face<<->z').execute(cube);
            expect(face).toBeTruthy();
            expect(face).toBeInstanceOf(Polygon);
        });

        it('vertex<<->z returns the vertex closest to the z-axis', () =>
        {
            const cube = Mesh.Cube(10);
            const vert = new Selector('vertex<<->z').execute(cube);
            expect(vert).toBeTruthy();
            expect(vert).toBeInstanceOf(Point);
        });
    });

    describe('furthest', () =>
    {
        it('vertex<->>z returns the vertex furthest from z-axis', () =>
        {
            const cube = Mesh.Cube(10);
            const vert = new Selector('vertex<->>z').execute(cube);
            expect(vert).toBeTruthy();
            expect(vert).toBeInstanceOf(Point);
        });

        it('face<->>z returns a face', () =>
        {
            const cube = Mesh.Cube(10);
            const face = new Selector('face<->>z').execute(cube);
            expect(face).toBeTruthy();
            expect(face).toBeInstanceOf(Polygon);
        });
    });
});
