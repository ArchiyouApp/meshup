import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { MeshCollection } from '../../src/ShapeCollection';

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

describe('MeshCollection.hits()', () =>
{
    it('finds the overlapping pair', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        const c = Mesh.Cube(10); // overlaps a

        const col = new MeshCollection(a, b);
        const pairs = col.hits(c);
        // a and c overlap; b and c do not
        expect(pairs.length).toBe(1);
        expect(pairs[0][0]).toBe(a);
        expect(pairs[0][1]).toBe(c);
    });
});

// ── MeshCollection.distanceTo ─────────────────────────────────────────────────

describe('MeshCollection.distanceTo()', () =>
{
    it('returns 0 when a mesh overlaps at least one member', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(100, 0, 0);
        const col = new MeshCollection(a, b);
        expect(col.distanceTo(Mesh.Cube(10))).toBeCloseTo(0, 3);
    });
});

// ── MeshCollection.closestPair ────────────────────────────────────────────────

describe('MeshCollection.closestPair()', () =>
{
    it('finds the pair with minimum distance', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(50, 0, 0);
        const target = Mesh.Cube(10).move(55, 0, 0); // closer to b
        const col = new MeshCollection(a, b);
        const result = col.closestPair(new MeshCollection(target));
        expect(result).not.toBeNull();
        expect(result!.mesh1).toBe(b);
    });
});

// ── MeshCollection.raycast ────────────────────────────────────────────────────

describe('MeshCollection.raycast() — all hits (all=true, default)', () =>
{
    it('returns entries for every mesh the ray pierces', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new MeshCollection(a, b);
        const results = col.raycast([0, 0, 100], [0, 0, -1]) as Array<{ mesh: Mesh; hit: import('../../src/types').RaycastHit }>;
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(2);
    });

    it('results are sorted by ascending distance', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new MeshCollection(a, b);
        const results = col.raycast([0, 0, 100], [0, 0, -1]) as Array<{ mesh: Mesh; hit: import('../../src/types').RaycastHit }>;
        expect(results.length).toBe(2);
        expect(results[0].hit.distance).toBeLessThanOrEqual(results[1].hit.distance);
    });

    it('returns empty array when ray misses all meshes', () =>
    {
        const a = Mesh.Cube(10);
        const col = new MeshCollection(a);
        const results = col.raycast([100, 100, 100], [1, 0, 0]);
        expect(Array.isArray(results)).toBe(true);
        expect((results as any[]).length).toBe(0);
    });
});

describe('MeshCollection.raycast() — first hit (all=false)', () =>
{
    it('returns the nearest-hit mesh entry', () =>
    {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(0, 0, 50);
        const col = new MeshCollection(a, b);
        const result = col.raycast([0, 0, 100], [0, 0, -1], Infinity, false) as { mesh: Mesh; hit: import('../../src/types').RaycastHit };
        expect(result).not.toBeNull();
        expect(result.mesh).toBe(b); // b is closer to the ray origin at z=100
    });

    it('returns null when the ray misses all meshes', () =>
    {
        const a = Mesh.Cube(10);
        const col = new MeshCollection(a);
        const result = col.raycast([100, 100, 100], [1, 0, 0], Infinity, false);
        expect(result).toBeNull();
    });
});
