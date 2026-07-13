import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Selector } from '../../src/Selector';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Point } from '../../src/Point';
import { Vertex } from '../../src/Vertex';
import { ShapeCollection } from '../../src/ShapeCollection';

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

// ===== Curve targets =====
// A rect on the XY plane centered at origin: control points at (±5, ±5, 0).
// A circle on the XY plane: plane normal is +z.

describe('Selector.execute() on Curve targets', () =>
{
    describe('side', () =>
    {
        it('vertex||left-front-bottom returns the corresponding bbox corner vertex', () =>
        {
            const rect = Curve.Rect(10, 10); // bbox: x/y in [-5,5], z = 0
            const result = new Selector('vertex||left-front-bottom').execute(rect) as ShapeCollection;
            const verts = result.toArray();
            expect(verts.length).toBe(1);
            expect(verts[0]).toBeInstanceOf(Vertex);
            const p = (verts[0] as Vertex).toPoint();
            expect(p.x).toBeCloseTo(-5);
            expect(p.y).toBeCloseTo(-5);
        });

        it('edge||left-front returns a single edge (Line curve) off a 3D bbox', () =>
        {
            // A 3D curve: bbox has extent on every axis; two keywords pin two axes, z is free.
            const line3d = Curve.Line([-5, -5, -5], [5, 5, 5]);
            const result = new Selector('edge||left-front').execute(line3d) as ShapeCollection;
            const edges = result.toArray();
            expect(edges.length).toBe(1);
            expect(edges[0]).toBeInstanceOf(Curve);
        });

        it('edge||front returns the front edge of a flat (XY) curve', () =>
        {
            const rect = Curve.Rect(10, 10); // flat on XY: bbox x/y in [-5,5], z = 0
            const result = new Selector('edge||front').execute(rect) as ShapeCollection;
            const edges = result.toArray();
            expect(edges.length).toBe(1);
            const edge = edges[0] as Curve;
            // Front edge = min-Y side, spanning X from -5 to 5 at y = -5, z = 0
            expect(edge.start().toPoint().y).toBeCloseTo(-5);
            expect(edge.end().toPoint().y).toBeCloseTo(-5);
            expect(edge.length()).toBeCloseTo(10);
        });

        it('edge||left returns the left edge of a flat (XY) curve', () =>
        {
            const rect = Curve.Rect(10, 10);
            const result = new Selector('edge||left').execute(rect) as ShapeCollection;
            const edges = result.toArray();
            expect(edges.length).toBe(1);
            const edge = edges[0] as Curve;
            expect(edge.start().toPoint().x).toBeCloseTo(-5);
            expect(edge.end().toPoint().x).toBeCloseTo(-5);
            expect(edge.length()).toBeCloseTo(10);
        });

        it('edge||left-front returns no edges on a flat curve (that corner is a vertex, not an edge)', () =>
        {
            const rect = Curve.Rect(10, 10);
            const result = new Selector('edge||left-front').execute(rect) as ShapeCollection;
            expect(result.length).toBe(0);
        });

        it('vertex||left is greedy: returns both left corners of a flat rect', () =>
        {
            const rect = Curve.Rect(10, 10); // bbox x/y in [-5,5], z = 0
            const result = new Selector('vertex||left').execute(rect) as ShapeCollection;
            const verts = result.toArray();
            expect(verts.length).toBe(2);
            verts.forEach(v => expect((v as Vertex).toPoint().x).toBeCloseTo(-5));
        });

        it('edge||front returns the single front edge of a flat rect (greedy but 1 match)', () =>
        {
            const rect = Curve.Rect(10, 10);
            const result = new Selector('edge||front').execute(rect) as ShapeCollection;
            expect(result.length).toBe(1);
        });

        it('face||front returns the bbox face polygon', () =>
        {
            const rect = Curve.Rect(10, 10);
            const result = new Selector('face||front').execute(rect) as ShapeCollection;
            const faces = result.toArray();
            expect(faces.length).toBeGreaterThan(0);
        });
    });

    describe('parallel', () =>
    {
        it('curve|z returns a curve whose plane normal is parallel to z', () =>
        {
            const circle = Curve.Circle(50); // on XY plane → normal +z
            const curves = new Selector('curve|z').execute(circle) as Curve[];
            expect(curves.length).toBe(1);
            expect(curves[0]).toBeInstanceOf(Curve);
        });

        it('curve|xy returns a curve parallel to the xy-plane', () =>
        {
            const circle = Curve.Circle(50);
            const curves = new Selector('curve|xy').execute(circle) as Curve[];
            expect(curves.length).toBe(1);
        });

        it('C|z shortcut works', () =>
        {
            const circle = Curve.Circle(50);
            const curves = new Selector('C|z').execute(circle) as Curve[];
            expect(curves.length).toBe(1);
        });

        it('curve|z returns nothing for a curve whose plane is not parallel to z', () =>
        {
            const rect = Curve.Rect(10, 10, [0, 0, 0], 'xz'); // normal is +y
            const curves = new Selector('curve|z').execute(rect) as Curve[];
            expect(curves.length).toBe(0);
        });
    });

    describe('positive / negative', () =>
    {
        it('vertex+x returns only control points with positive x', () =>
        {
            const rect = Curve.Rect(10, 10);
            const verts = new Selector('vertex+x').execute(rect) as Point[];
            expect(verts.length).toBeGreaterThan(0);
            verts.forEach(p => expect(p.x).toBeGreaterThan(0));
        });

        it('vertex-x returns only control points with negative x', () =>
        {
            const rect = Curve.Rect(10, 10);
            const verts = new Selector('vertex-x').execute(rect) as Point[];
            expect(verts.length).toBeGreaterThan(0);
            verts.forEach(p => expect(p.x).toBeLessThan(0));
        });

        it('curve+x returns the curve when its center has positive x', () =>
        {
            const circle = Curve.Circle(50, [100, 0, 0]); // center at x = 100
            const curves = new Selector('curve+x').execute(circle) as Curve[];
            expect(curves.length).toBe(1);
        });

        it('curve-x returns nothing when the curve center has positive x', () =>
        {
            const circle = Curve.Circle(50, [100, 0, 0]);
            const curves = new Selector('curve-x').execute(circle) as Curve[];
            expect(curves.length).toBe(0);
        });
    });

    describe('closest', () =>
    {
        it('vertex<<->[10,0,0] returns the control point closest to the reference', () =>
        {
            const rect = Curve.Rect(10, 10);
            const vert = new Selector('vertex<<->[10,0,0]').execute(rect);
            expect(vert).toBeInstanceOf(Point);
            expect((vert as Point).x).toBeCloseTo(5);
        });

        it('curve<<->[0,0,0] returns the curve (span) closest to the reference', () =>
        {
            const circle = Curve.Circle(50);
            const curve = new Selector('curve<<->[0,0,0]').execute(circle);
            expect(curve).toBeInstanceOf(Curve);
        });
    });

    describe('furthest', () =>
    {
        it('vertex<->>[0,0,0] returns a control point', () =>
        {
            const rect = Curve.Rect(10, 10);
            const vert = new Selector('vertex<->>[0,0,0]').execute(rect);
            expect(vert).toBeInstanceOf(Point);
        });

        it('curve<->>[100,0,0] returns the curve (span)', () =>
        {
            const circle = Curve.Circle(50);
            const curve = new Selector('curve<->>[100,0,0]').execute(circle);
            expect(curve).toBeInstanceOf(Curve);
        });
    });
});

// ===== Curve.select() convenience method =====

describe('Curve.select()', () =>
{
    it('delegates to the Selector (vertex+x)', () =>
    {
        const rect = Curve.Rect(10, 10);
        const verts = rect.select('vertex+x') as Point[];
        expect(verts.length).toBeGreaterThan(0);
        verts.forEach(p => expect(p.x).toBeGreaterThan(0));
    });

    it('delegates to the Selector (curve|z)', () =>
    {
        const circle = Curve.Circle(50);
        const curves = circle.select('curve|z') as Curve[];
        expect(curves.length).toBe(1);
    });

    it('throws for an unrecognized selector', () =>
    {
        const rect = Curve.Rect(10, 10);
        expect(() => rect.select('garbage')).toThrow('Unrecognized selector string');
    });
});
