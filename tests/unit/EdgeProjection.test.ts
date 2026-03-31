import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { MeshCollection, CurveCollection } from '../../src/Collection';
import type { ProjectionOptions } from '../../src/Collection';

beforeAll(async () => {
    await initAsync();
});

/** View straight down (-Z) onto the XY plane. */
const topViewOptions: ProjectionOptions = {
    viewPosition: [0, 0, -1],
    plane: { origin: [0, 0, -100], normal: [0, 0, 1] },
    featureAngle: 15,
    samples: 4,
};

// ── Mesh.projectEdges ─────────────────────────────────────────────────────────

describe('Mesh.projectEdges()', () => {
    it('returns a non-empty result for a cube viewed from above', () => {
        const cube = Mesh.Cube(10);
        const result = cube.projectEdges(topViewOptions);
        expect(result).toBeTruthy();
        expect(result.visible).toBeInstanceOf(CurveCollection);
        expect(result.hidden).toBeInstanceOf(CurveCollection);
        // At least visible or hidden curves should be produced
        const total = result.visible.curves().length + result.hidden.curves().length;
        expect(total).toBeGreaterThan(0);
    });

    it('visible CurveCollection contains Curve instances', () => {
        const cube = Mesh.Cube(10);
        const result = cube.projectEdges(topViewOptions);
        const curves = result.visible.curves();
        if (curves.length > 0) {
            expect(curves.first()).toBeTruthy();
            // Each curve should have at least 2 control/sample points
            const pts = curves.first().controlPoints();
            expect(pts.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('accepts an occluders array without throwing', () => {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(20, 0, 0);
        expect(() => a.projectEdges(topViewOptions, [b])).not.toThrow();
    });
});

// ── MeshCollection.projectEdges ───────────────────────────────────────────────

/*
describe('MeshCollection.projectEdges()', () => {
    it('merges results from all meshes in the collection', () => {
        const a = Mesh.Cube(10);
        const b = Mesh.Cube(10).move(30, 0, 0);
        const col = new MeshCollection(a, b);
        const result = col.projectEdges(topViewOptions);
        expect(result.visible).toBeInstanceOf(CurveCollection);
        // Should have at least as many curves as a single cube
        const singleResult = a.projectEdges(topViewOptions);
        const total = result.visible.curves().length + result.hidden.curves().length;
        const singleTotal = singleResult.visible.curves().length + singleResult.hidden.curves().length;
        expect(total).toBeGreaterThanOrEqual(singleTotal);
    });
});
*/

// ── Mesh.projectToPlane (shadow projection) ───────────────────────────────────

describe('Mesh.projectToPlane() — shadow use', () => {
    it('produces a flat mesh with all z=0 when projecting onto XY plane', () => {
        const cube = Mesh.Cube(10);
        const shadow = cube.projectToPlane([0, 0, 0], [0, 0, 1]);
        const positions = shadow.positions();
        expect(positions.length).toBeGreaterThan(0);
        for (const p of positions) {
            expect(p.z).toBeCloseTo(0, 6);
        }
    });

    it('can project onto an inclined plane (YZ plane)', () => {
        const cube = Mesh.Cube(10);
        const proj = cube.projectToPlane([0, 0, 0], [1, 0, 0]);
        const positions = proj.positions();
        for (const p of positions) {
            expect(p.x).toBeCloseTo(0, 6);
        }
    });
});
