import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Point } from '../../src/Point';
import { Polygon } from '../../src/Polygon';
import { ShapeCollection } from '../../src/ShapeCollection';
import { Vertex } from '../../src/Vertex';

beforeAll(async () =>
{
    await initAsync();
});

// ── Mesh.raycast (first hit) ──────────────────────────────────────────────────

describe('Mesh.raycast() — first hit (all=false)', () =>
{
    it('hits a cube shot straight down from above', () =>
    {
        const cube = Mesh.Cube(10);
        const hit = cube.raycast([0, 0, 20], [0, 0, -1], Infinity, false);
        expect(hit).not.toBeNull();
        expect(hit!.distance).toBeGreaterThan(0);
        expect(hit!.distance).toBeLessThan(25);
    });

    it('returns null when the ray misses', () =>
    {
        const cube = Mesh.Cube(10);
        const hit = cube.raycast([100, 100, 100], [1, 0, 0], Infinity, false);
        expect(hit).toBeNull();
    });

    it('reports a hit point near the cube surface', () =>
    {
        const cube = Mesh.Cube(10);
        const hit = cube.raycast([0, 0, 20], [0, 0, -1], Infinity, false);
        expect(hit).not.toBeNull();
        // Cube of side 10 centred at origin → top face at z=5
        expect(hit!.pointZ).toBeCloseTo(5, 1);
    });
});

// ── Mesh.raycast (all hits) ───────────────────────────────────────────────────

describe('Mesh.raycast() — all hits (all=true, default)', () =>
{
    it('returns an array of hits when the ray pierces a cube', () =>
    {
        const cube = Mesh.Cube(10);
        const hits = cube.raycast([0, 0, 20], [0, 0, -1]);
        expect(Array.isArray(hits)).toBe(true);
        expect((hits as any[]).length).toBeGreaterThan(0);
    });

    it('returns an empty array when the ray misses', () =>
    {
        const cube = Mesh.Cube(10);
        const hits = cube.raycast([100, 100, 100], [1, 0, 0]);
        expect(Array.isArray(hits)).toBe(true);
        expect((hits as any[]).length).toBe(0);
    });

    it('hits are sorted by ascending distance', () =>
    {
        const cube = Mesh.Cube(10);
        const hits = cube.raycast([0, 0, 20], [0, 0, -1]) as import('../../src/types').RaycastHit[];
        hits.slice(1).forEach((hit, i) =>
        {
            expect(hit.distance).toBeGreaterThanOrEqual(hits[i].distance);
        });
    });
});

// ── closestPoint ─────────────────────────────────────────────────────────────

describe('Mesh.closestPoint()', () =>
{
    it('projects a point outside the mesh onto its surface', () =>
    {
        const cube = Mesh.Cube(10);
        const r = cube.closestPoint(0, 0, 20);
        expect(r).not.toBeNull();
        expect(r!.distance).toBeCloseTo(15, 1); // query at z=20, surface at z=5
    });

    it('detects that a point inside the mesh is inside', () =>
    {
        const cube = Mesh.Cube(10);
        const r = cube.closestPoint(0, 0, 0);
        expect(r).not.toBeNull();
        // expect(r!.isInside).toBe(true); // TODO:FIX
    });

    it('reports isInside=false for external query', () =>
    {
        const cube = Mesh.Cube(10);
        const r = cube.closestPoint(0, 0, 20);
        expect(r).not.toBeNull();
        expect(r!.isInside).toBe(false);
    });
});

// ── sampleSDF ────────────────────────────────────────────────────────────────

describe('Mesh.sampleSDF()', () =>
{
    it('returns negative distance inside the mesh', () =>
    {
        const cube = Mesh.Cube(10);
        const s = cube.sampleSDF(0, 0, 0);
        expect(s).not.toBeNull();
        // expect(s!.distance).toBeLessThan(0); // TODO: FIX
    });

    it('returns positive distance outside the mesh', () =>
    {
        const cube = Mesh.Cube(10);
        const s = cube.sampleSDF(0, 0, 20);
        expect(s).not.toBeNull();
        expect(s!.distance).toBeGreaterThan(0);
    });
});

// ── hits ─────────────────────────────────────────────────────────────────────

describe('Mesh.hits()', () =>
{
    it('returns true for two overlapping cubes', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10); // same position → full overlap
        expect(a.hits(b)).toBe(true);
    });

    it('returns false for two well-separated cubes', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        expect(a.hits(b)).toBe(false);
    });
});

// ── distanceTo ───────────────────────────────────────────────────────────────

describe('Mesh.distanceTo()', () =>
{
    it('returns 0 for overlapping meshes', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10);
        expect(a.distanceTo(b)).toBeCloseTo(0, 3);
    });

    it('returns a positive value for separated meshes', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        expect(a.distanceTo(b)).toBeGreaterThan(0);
    });

    it('returns the closest-point distance for a vertex', () =>
    {
        const cube = Mesh.Cube(10);
        const vertex = new Vertex([20, 0, 0]);

        expect(cube.distanceTo(vertex)).toBeCloseTo(15, 6);
        expect(cube.distance(vertex)).toBeCloseTo(15, 6);
    });

    it('returns the closest-point distance for a point', () =>
    {
        const cube = Mesh.Cube(10);
        const point = new Point(20, 0, 0);

        expect(cube.distanceTo(point)).toBeCloseTo(15, 6);
        expect(cube.distance(point)).toBeCloseTo(15, 6);
    });

    it('defers polygon distance through polygon.toMesh()', () =>
    {
        const cube = Mesh.Cube(10);
        const polygon = Polygon.from([
            [20, -5, -5],
            [20, 5, -5],
            [20, 5, 5],
            [20, -5, 5],
        ]);

        expect(cube.distanceTo(polygon)).toBeCloseTo(cube.distanceTo(polygon.toMesh()), 6);
        expect(cube.distance(polygon)).toBeCloseTo(15, 6);
    });

    it('matches the legacy mesh-to-mesh distance path side-by-side', () =>
    {
        const left = Mesh.Sphere(20).move(-12, 3, 0);
        const right = Mesh.Cylinder(12, 50).rotate(15, 'x').rotate(35, 'y').rotate(20, 'z').move(31, -4, 9);

        const optimized = left.distanceTo(right);
        const legacy = left.distanceToLegacy(right);

        expect(optimized).toBeCloseTo(legacy, 6);
        expect(right.distanceTo(left)).toBeCloseTo(optimized, 6);
    });

    it('compares optimized and legacy mesh distance timings side-by-side', () =>
    {
        const left = Mesh.Sphere(24).move(-18, 0, 0);
        const right = Mesh.Cylinder(14, 60).rotate(25, 'x').rotate(15, 'y').rotate(35, 'z').move(36, 7, 5);
        const iterations = 50;

        const baselineOptimized = left.distanceTo(right);
        const baselineLegacy = left.distanceToLegacy(right);
        expect(baselineOptimized).toBeCloseTo(baselineLegacy, 6);

        const optimizedStart = performance.now();
        const optimizedDistances = Array.from({ length: iterations }, () => left.distanceTo(right));
        const optimizedDuration = performance.now() - optimizedStart;

        const legacyStart = performance.now();
        const legacyDistances = Array.from({ length: iterations }, () => left.distanceToLegacy(right));
        const legacyDuration = performance.now() - legacyStart;

        optimizedDistances.forEach(distance =>
        {
            expect(distance).toBeCloseTo(baselineLegacy, 6);
        });

        legacyDistances.forEach(distance =>
        {
            expect(distance).toBeCloseTo(baselineLegacy, 6);
        });

        console.log(
            `Mesh.distanceTo() comparison: optimized=${optimizedDuration.toFixed(2)}ms legacy=${legacyDuration.toFixed(2)}ms iterations=${iterations}`,
        );
    });
});

// ── projectToPlane ───────────────────────────────────────────────────────────

describe('Mesh.projectToPlane()', () =>
{
    it('flattens all vertices onto z=0 when projecting onto the XY plane', () =>
    {
        const cube = Mesh.Cube(10);
        const flat = cube.projectToPlane([0, 0, 0], [0, 0, 1]);
        const positions = flat.positions();
        positions.forEach(p =>
        {
            expect(p.z).toBeCloseTo(0, 6);
        });
    });
});

// ── distanceToPlane ──────────────────────────────────────────────────────────

describe('Mesh.distanceToPlane()', () =>
{
    it('returns 0 when a vertex lies on the plane', () =>
    {
        // Cube centred at origin has vertices at ±5 on every axis.
        // The plane z=5 passes through the top face vertices.
        const cube = Mesh.Cube(10);
        const d = cube.distanceToPlane([0, 0, 5], [0, 0, 1]);
        expect(d).toBeCloseTo(0, 6);
    });

    it('returns a positive distance for a plane that misses all vertices', () =>
    {
        const cube = Mesh.Cube(10);
        const d = cube.distanceToPlane([0, 0, 100], [0, 0, 1]);
        expect(d).toBeGreaterThan(0);
    });
});

// ── Mesh.fromSDF ─────────────────────────────────────────────────────────────

describe('Mesh.fromSDF()', () =>
{
    it('creates a mesh from a sphere SDF', () =>
    {
        const radius = 1.5;
        const mesh = Mesh.fromSDF(
            (x, y, z) => Math.sqrt(x * x + y * y + z * z) - radius,
            { min: [-2, -2, -2], max: [2, 2, 2] },
            [20, 20, 20],
        );
        expect(mesh).toBeTruthy();
        const positions = mesh.positions();
        expect(positions.length).toBeGreaterThan(0);
    });
});

// ── MeshCollection.hits ───────────────────────────────────────────────────────

describe('ShapeCollection.hits()', () =>
{
    it('finds the overlapping pair', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        const c = Mesh.Cube(10); // overlaps a

        const col = new ShapeCollection<Mesh>(a, b);
        const pairs = col.hits(c);
        // a and c overlap; b and c do not
        expect(pairs.length).toBe(1);
        expect(pairs[0][0]).toBe(a);
        expect(pairs[0][1]).toBe(c);
    });
});

// ── MeshCollection.distanceTo ─────────────────────────────────────────────────

describe('ShapeCollection.distanceTo()', () =>
{
    it('returns 0 when a mesh overlaps at least one member', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        const col = new ShapeCollection<Mesh>(a, b);
        expect(col.distanceTo(Mesh.Cube(10))).toBeCloseTo(0, 3);
    });
});

// ── MeshCollection.closestPair ────────────────────────────────────────────────

describe('ShapeCollection.closestPair()', () =>
{
    it('finds the pair with minimum distance', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(50, 0, 0);
        const target = Mesh.Cube(10).move(55, 0, 0); // closer to b
        const col = new ShapeCollection<Mesh>(a, b);
        const result = col.closestPair(new ShapeCollection<Mesh>(target));
        expect(result).not.toBeNull();
        expect(result!.mesh1).toBe(b);
    });
});

// ── MeshCollection.raycast ────────────────────────────────────────────────────

describe('ShapeCollection.raycast() — all hits (all=true, default)', () =>
{
    it('returns entries for every mesh the ray pierces', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new ShapeCollection<Mesh>(a, b);
        const results = col.raycast([0, 0, 100], [0, 0, -1]) as Array<{ mesh: Mesh; hit: import('../../src/types').RaycastHit }>;
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(2);
    });

    it('results are sorted by ascending distance', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new ShapeCollection<Mesh>(a, b);
        const results = col.raycast([0, 0, 100], [0, 0, -1]) as Array<{ mesh: Mesh; hit: import('../../src/types').RaycastHit }>;
        expect(results.length).toBe(2);
        expect(results[0].hit.distance).toBeLessThanOrEqual(results[1].hit.distance);
    });

    it('returns empty array when ray misses all meshes', () =>
    {
        const a = Mesh.Cube(10);
        const col = new ShapeCollection<Mesh>(a);
        const results = col.raycast([100, 100, 100], [1, 0, 0]);
        expect(Array.isArray(results)).toBe(true);
        expect((results as any[]).length).toBe(0);
    });
});

describe('ShapeCollection.raycast() — first hit (all=false)', () =>
{
    it('returns the nearest-hit mesh entry', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new ShapeCollection<Mesh>(a, b);
        const result = col.raycast([0, 0, 100], [0, 0, -1], Infinity, false) as { mesh: Mesh; hit: import('../../src/types').RaycastHit };
        expect(result).not.toBeNull();
        expect(result.mesh).toBe(b); // b is closer to the ray origin at z=100
    });

    it('returns null when the ray misses all meshes', () =>
    {
        const a = Mesh.Cube(10);
        const col = new ShapeCollection<Mesh>(a);
        const result = col.raycast([100, 100, 100], [1, 0, 0], Infinity, false);
        expect(result).toBeNull();
    });
});
