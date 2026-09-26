import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
import { Mesh } from '../../src/Mesh';
import { Vector } from '../../src/Vector';
import { Point } from '../../src/Point';

beforeAll(async () =>
{
    await initAsync();
});

describe('Curve.loft()', () =>
{
    it('two straight open lines -> flat Polygon (quad)', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        const b = Curve.Line([0, 0, 5], [10, 0, 5]);
        const result = a.loft(b);
        expect(result).toBeInstanceOf(Polygon);
        expect((result as Polygon).vertices().length).toBe(4);
    });

    it('two open arcs -> surface Mesh (no caps)', () =>
    {
        const a = Curve.Arc([0, 0, 0], [5, 5, 0], [10, 0, 0]);
        const b = Curve.Arc([0, 0, 5], [5, 5, 5], [10, 0, 5]);
        const result = a.loft(b);
        expect(result).toBeInstanceOf(Mesh);
        expect((result as Mesh).polygons().length).toBeGreaterThan(0);
    });

    it('two closed circles, solid=true -> watertight solid Mesh with positive volume', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0], [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const result = a.loft(b, true);
        expect(result).toBeInstanceOf(Mesh);
        const vol = (result as Mesh).volume();
        expect(vol).toBeGreaterThan(0);
    });

    it('two closed circles, solid=false -> fewer faces than solid (no caps)', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0], [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const solid = a.loft(b, true) as Mesh;
        const open  = a.loft(b, false) as Mesh;
        expect(open.polygons().length).toBeLessThan(solid.polygons().length);
    });

    it('loft through three circles via array', () =>
    {
        const a = Curve.Circle(10, [0, 0, 0],  [0, 0, 1]);
        const b = Curve.Circle(5,  [0, 0, 10], [0, 0, 1]);
        const c = Curve.Circle(8,  [0, 0, 20], [0, 0, 1]);
        const result = a.loft([b, c], true);
        expect(result).toBeInstanceOf(Mesh);
        expect((result as Mesh).volume()).toBeGreaterThan(0);
    });

    it('single profile / no others -> null', () =>
    {
        const a = Curve.Line([0, 0, 0], [10, 0, 0]);
        expect(a.loft([])).toBeNull();
    });
});

describe('Curve.loft() resolution', () =>
{
    it('lofts a rectangle onto a rectangle into 6 faces', () =>
    {
        // a box has four sides and two caps — a loft that resamples the profiles instead of
        // following their segments used to make this 66
        const box = Curve.Rect(100, 50).loft(Curve.Rect(100, 50).move(0, 0, 100)) as Mesh;
        expect(box).toBeInstanceOf(Mesh);
        expect(box.polygons().length).toBe(6);
        expect(box.volume()).toBeCloseTo(100 * 50 * 100, 6); // no faceting, so this is exact
    });

    it('keeps the four side faces when the rectangles differ', () =>
    {
        const frustum = Curve.Rect(100, 50).loft(Curve.Rect(50, 25).move(0, 0, 100)) as Mesh;
        expect(frustum.polygons().length).toBe(6);
        // h/3 * (A1 + A2 + sqrt(A1*A2)) for a tapered prism
        expect(frustum.volume()).toBeCloseTo(100 / 3 * (5000 + 1250 + Math.sqrt(5000 * 1250)), 6);
    });

    it('splits the twisted sides of a loft onto a rotated profile into flat triangles', () =>
    {
        // a square onto a 45° turned one: every side quad is twisted. Triangulating those as-is
        // put points halfway up the wall and left holes in it
        const lofted = Curve.Rect(100, 100).loft(Curve.Rect(40, 40).rotateZ(45).move(0, 0, 100)) as Mesh;
        const onProfile = (p: { x: number, y: number, z: number }) =>
            (Math.abs(p.z) < 1e-6 && Math.max(Math.abs(p.x), Math.abs(p.y)) === 50)
            || (Math.abs(p.z - 100) < 1e-6 && Math.abs(Math.abs(p.x) + Math.abs(p.y) - 20 * Math.SQRT2) < 1e-6);
        const points = lofted.copy().triangulate().polygons().toArray().flatMap( p => p.vertices().toArray());
        expect(points.every(onProfile)).toBe(true);
        expect(lofted.polygons().length).toBe(8 + 2);

        // prismatoid: h/6 * (bottom + 4 * middle + top), the middle section an octagon
        const half = 25 + 10 * Math.SQRT2;
        const middle = (2 * half) ** 2 - 2 * (10 * Math.SQRT2) ** 2;
        expect(lofted.volume()).toBeCloseTo(100 / 6 * (100 * 100 + 4 * middle + 40 * 40), 4);
    });

    it('faces every wall outward, whichever way it lofts or the profiles wind', () =>
    {
        const bottom = () => Curve.Rect(100, 100);
        const top = () => Curve.Rect(40, 40).rotateZ(45).move(0, 0, 100);
        const lofts = {
            up:       bottom().loft(top()),
            down:     top().loft(bottom()),
            reversed: bottom().reverse().loft(top()),
        } as Record<string, Mesh>;

        Object.entries(lofts).forEach( ([name, lofted]) =>
        {
            const center = lofted.bbox().center();
            lofted.polygons().toArray().forEach( face =>
            {
                const out = Vector.from(face.center()).subtracted(center);
                expect(face.normal().dot(out), name).toBeGreaterThan(0);
            });
            expect(lofted.volume(), name).toBeCloseTo(lofts.up.volume(), 4);

            // the viewer shades by vertex normals: none of them may be left at zero
            const { normals } = lofted.toBuffer();
            const lengths = Array.from({ length: normals.length / 3 }, (_, i) => Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]));
            expect(lengths.every( l => Math.abs(l - 1) < 1e-6), name).toBe(true);
        });
    });

    it('leaves out the caps when solid is false', () =>
    {
        const tube = Curve.Rect(100, 50).loft(Curve.Rect(100, 50).move(0, 0, 100), false) as Mesh;
        expect(tube.polygons().length).toBe(4);
    });

    it('carries the segments through a loft over three profiles', () =>
    {
        const a = Curve.Rect(100, 50);
        const b = Curve.Rect(50, 25).move(0, 0, 50);
        const c = Curve.Rect(80, 40).move(0, 0, 100);
        const stack = a.loft([b, c]) as Mesh;
        expect(stack.polygons().length).toBe(4 + 4 + 2); // two rings of sides, two caps
    });

    it('still subdivides curved segments', () =>
    {
        // straight segments cost one face each, the fillet arcs are subdivided by how far they turn
        const rounded = Curve.Rect(100, 50).fillet(10)!;
        const lofted = rounded.loft(Curve.Rect(100, 50).fillet(10)!.move(0, 0, 50)) as Mesh;
        expect(lofted.polygons().length).toBeGreaterThan(6);
        // area of the rounded rect: the four corners lose (4 - pi) * r^2 between them
        expect(lofted.volume()).toBeCloseTo((5000 - (4 - Math.PI) * 100) * 50, -2);
    });

    it('resolves a circle the same however it is lofted', () =>
    {
        // a full turn is LOFT_SEGMENTS_PER_TURN steps, so two half-circle spans give 64 sides
        const tube = Curve.Circle(50).loft(Curve.Circle(50).move(0, 0, 100), false) as Mesh;
        expect(tube.polygons().length).toBe(64);
    });

    it('falls back to uniform sampling when the profiles do not line up', () =>
    {
        // a rectangle has four segments and a circle two: there is no correspondence to follow
        const cone = Curve.Rect(100, 50).loft(Curve.Circle(30).move(0, 0, 100)) as Mesh;
        expect(cone).toBeInstanceOf(Mesh);
        expect(cone.volume()).toBeGreaterThan(0);
    });

    it('caps from the same points the sides are built from', () =>
    {
        // a cap sampled differently from the wall it closes leaves gaps along the seam
        const solid = Curve.Circle(50).loft(Curve.Circle(50).move(0, 0, 100)) as Mesh;
        expect(solid.polygons().length).toBe(64 + 2);
        // a 64-gon prism, not the ideal cylinder: area is (n/2) * r^2 * sin(2*pi/n)
        expect(solid.volume()).toBeCloseTo(32 * 2500 * Math.sin(2 * Math.PI / 64) * 100, -2);
    });
});

describe('Curve.loft() robustness', () =>
{
    // Whatever the profiles, a loft has to keep these: its points on the profiles, the corners
    // of every profile, flat faces, one consistent winding, and normals the viewer can shade by.
    // A closed loft capped into a solid must also be watertight with a positive volume.

    const TOL = 1e-4;
    const H = 100;

    type Case = {
        profiles: () => Curve[],
        /** Exact test for "lies on a profile", for curves Curve.distance() is slow on */
        onProfile?: (p: Point) => boolean,
        volume?: number,
    };

    const key = (p: Point) => [p.x, p.y, p.z].map( n => (Math.round(n / TOL) * TOL + 0).toFixed(4)).join(',');
    const L = (s: number = 1) => Curve.Polyline([[0, 0, 0], [60 * s, 0, 0], [60 * s, 20 * s, 0], [20 * s, 20 * s, 0], [20 * s, 50 * s, 0], [0, 50 * s, 0], [0, 0, 0]]);
    const hexagon = (r: number) => Curve.Polyline(Array.from({ length: 7 }, (_, i) => [r * Math.cos(i * Math.PI / 3), r * Math.sin(i * Math.PI / 3), 0]));
    const arc = (bulge: number, z: number = 0) => Curve.Arc([0, 0, z], [50, bulge, z], [100, 0, z], 'threepoint');

    const CLOSED: Record<string, Case> = {
        'rect - rect':              { profiles: () => [Curve.Rect(100, 50), Curve.Rect(100, 50).move(0, 0, H)], volume: 100 * 50 * H },
        'rect - circle':            { profiles: () => [Curve.Rect(100, 50), Curve.Circle(30).move(0, 0, H)] },
        'circle - rect':            { profiles: () => [Curve.Circle(30), Curve.Rect(100, 50).move(0, 0, H)] },
        'circle - offset circle':   { profiles: () => [Curve.Circle(30), Curve.Circle(20).move(40, 10, H)] },
        'clockwise circle - rect':  { profiles: () => [Curve.Circle(30, [0, 0, 0], [0, 0, -1]), Curve.Rect(100, 50).move(0, 0, H)] },
        'triangle - circle':        { profiles: () => [Curve.Polyline([[-40, -30, 0], [40, -30, 0], [0, 40, 0], [-40, -30, 0]]), Curve.Circle(30).move(0, 0, H)] },
        'hexagon - rect':           { profiles: () => [hexagon(40), Curve.Rect(60, 60).move(0, 0, H)] },
        'rounded rect - rect':      { profiles: () => [Curve.Rect(100, 50).fillet(10)!, Curve.Rect(100, 50).move(0, 0, H)] },
        'rounded rect - circle':    { profiles: () => [Curve.Rect(100, 50).fillet(10)!, Curve.Circle(30).move(0, 0, H)] },
        'concave L - L':            { profiles: () => [L(), L().move(0, 0, H)], volume: (60 * 20 + 20 * 30) * H },
        'concave L - smaller L':    { profiles: () => [L(), L(0.5).move(0, 0, H)] },
        'concave L - rect':         { profiles: () => [L(), Curve.Rect(60, 50, [30, 25, 0]).move(0, 0, H)] },
        'rect - rotated rect':      { profiles: () => [Curve.Rect(100, 100), Curve.Rect(40, 40).rotateZ(45).move(0, 0, H)] },
        'rect - tilted rect':       { profiles: () => [Curve.Rect(100, 50), Curve.Rect(100, 50).rotateX(30).move(0, 0, H)] },
        'rect - circle along x':    { profiles: () => [Curve.Rect(100, 50, [0, 0, 0], 'yz'), Curve.Circle(20, [H, 0, 0], [1, 0, 0])] },
        'rect down to circle':      { profiles: () => [Curve.Rect(100, 50).move(0, 0, H), Curve.Circle(30)] },
        'rect - circle - rect':     { profiles: () => [Curve.Rect(100, 50), Curve.Circle(20).move(0, 0, H), Curve.Rect(60, 60).move(0, 0, 2 * H)] },
        'circle - ellipse':         {
            profiles: () => [Curve.Circle(30), Curve.Ellipse(50, 20).move(0, 0, H)],
            onProfile: p => (Math.abs(p.z) < TOL && Math.abs(Math.hypot(p.x, p.y) - 30) < TOL)
                || (Math.abs(p.z - H) < TOL && Math.abs(Math.hypot(p.x / 50, p.y / 20) - 1) < TOL),
        },
    };

    const OPEN: Record<string, Case> = {
        'line - line':              { profiles: () => [Curve.Line([0, 0, 0], [100, 0, 0]), Curve.Line([0, 0, H], [100, 0, H])] },
        'line - skew line':         { profiles: () => [Curve.Line([0, 0, 0], [100, 0, 0]), Curve.Line([0, 50, H], [100, -50, H])] },
        'line - arc':               { profiles: () => [Curve.Line([0, 0, 0], [100, 0, 0]), arc(40, H)] },
        'arc - opposite arc':       { profiles: () => [arc(40), arc(-40, H)] },
        'polyline - arc':           { profiles: () => [Curve.Polyline([[0, 0, 0], [30, 20, 0], [70, 20, 0], [100, 0, 0]]), arc(40, H)] },
        'twisted polylines':        { profiles: () => [Curve.Polyline([[0, 0, 0], [50, 0, 0], [50, 50, 0]]), Curve.Polyline([[0, 0, H], [0, 50, H], [50, 50, H]])] },
        'line - skew - line':       { profiles: () => [Curve.Line([0, 0, 0], [100, 0, 0]), Curve.Line([0, 20, H], [100, -20, H]), Curve.Line([0, 0, 2 * H], [100, 0, 2 * H])] },
        'spline - line':            {
            profiles: () => [Curve.Interpolated([[0, 0, 0], [30, 30, 0], [70, -30, 0], [100, 0, 0]]), Curve.Line([0, 0, H], [100, 0, H])],
            onProfile: p => Math.abs(p.z) < TOL || (Math.abs(p.z - H) < TOL && Math.abs(p.y) < TOL), // the spline side is checked by its corners
        },
    };

    /** The faces of a loft, and its directed edges (a -> b per face side) with how often each occurs */
    const topology = (result: Mesh | Polygon) =>
    {
        const faces = (result instanceof Polygon) ? [result] : result.polygons().toArray();
        const edges = faces.flatMap( face =>
        {
            const vs = face.vertices().toArray();
            return vs.map( (v, i) => `${key(v)}>${key(vs[(i + 1) % vs.length])}`);
        }).reduce( (count, edge) => count.set(edge, (count.get(edge) ?? 0) + 1), new Map<string, number>());
        const unpaired = [...edges.keys()].filter( edge => !edges.has(edge.split('>').reverse().join('>')));
        return { faces, edges, unpaired };
    };

    const expectLoft = (result: Mesh | Polygon | null, c: Case, closedSolid: boolean) =>
    {
        expect(result).not.toBeNull();
        const profiles = c.profiles();
        const { faces, edges, unpaired } = topology(result!);
        const points = [...new Map(faces.flatMap( f => f.vertices().toArray()).map( p => [key(p), p])).values()];

        const onProfile = c.onProfile ?? ((p: Point) => profiles.some( curve => (curve.distance([p.x, p.y, p.z]) ?? Infinity) < TOL));
        expect(points.filter( p => !onProfile(p)).map(key), 'points off the profiles').toEqual([]);

        const corners = profiles.flatMap( curve => curve._atomicSegments().map( seg => seg.start()));
        const lost = corners.filter( corner => !points.some( p => p.distance(corner) < TOL));
        expect(lost.map(key), 'profile corners cut off').toEqual([]);

        const twisted = faces.filter( face =>
        {
            const vs = face.vertices().toArray();
            const n = face.normal().normalize();
            return vs.some( v => Math.abs(n.dot(Vector.from(v.x - vs[0].x, v.y - vs[0].y, v.z - vs[0].z))) > TOL);
        });
        expect(twisted.length, 'faces that are not flat').toBe(0);

        // two faces running the same way along an edge: one of them is flipped
        expect([...edges.values()].filter( n => n > 1).length, 'flipped faces').toBe(0);

        if (result instanceof Mesh)
        {
            const { normals } = result.toBuffer();
            const lengths = Array.from({ length: normals.length / 3 }, (_, i) => Math.hypot(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]));
            expect(lengths.filter( l => Math.abs(l - 1) > 1e-6).length, 'render normals that are not unit length').toBe(0);
        }

        if (closedSolid)
        {
            expect(unpaired.length, 'open edges on a solid').toBe(0);
            const volume = (result as Mesh).volume()!;
            expect(volume).toBeGreaterThan(0);
            if (c.volume !== undefined) { expect(volume).toBeCloseTo(c.volume, 4); }
        }
    };

    describe.each(Object.entries(CLOSED))('closed: %s', (_name, c) =>
    {
        // each loft is built once: on NURBS profiles (the ellipse) sampling costs seconds
        const lofted = new Map<boolean, Mesh>();
        const loft = (solid: boolean): Mesh =>
        {
            const [first, ...others] = c.profiles();
            return lofted.get(solid) ?? lofted.set(solid, first.loft(others, solid) as Mesh).get(solid)!;
        };

        it('lofts into a sound solid', () =>
        {
            expect(loft(true)).toBeInstanceOf(Mesh);
            expectLoft(loft(true), c, true);
        }, 30_000);

        it('lofts into an open tube without caps', () =>
        {
            expectLoft(loft(false), c, false);
            expect(loft(false).polygons().length).toBe(loft(true).polygons().length - 2);
        }, 30_000);
    });

    describe.each(Object.entries(OPEN))('open: %s', (_name, c) =>
    {
        it('lofts into a sound surface', () =>
        {
            const [first, ...others] = c.profiles();
            expectLoft(first.loft(others), c, false);
        }, 30_000);
    });
});
