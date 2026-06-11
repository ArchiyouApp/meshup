import { beforeAll, describe, expect, it } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';

const OUTPUT_DIR = './tests/outputs/reconstruct/';

beforeAll(async () =>
{
    await initAsync();
});

/** Vertex count per polygon face of a Mesh. */
const faceVertCounts = (m: Mesh): number[] =>
    m.polygons().toArray().map(p => p.vertices().count());

describe('Example: Coplanar n-gon reconstruction after booleans', () =>
{
    it('a pristine box is built from quad faces', () =>
    {
        const b = Mesh.Box(100, 100, 100);
        const counts = faceVertCounts(b);

        expect(counts.length).toBe(6);            // 6 faces
        expect(counts.every(c => c === 4)).toBe(true); // all quads, no triangles
    });

    it('subtracting a notch keeps n-gon faces instead of triangle soup', async () =>
    {
        const b = Mesh.Box(100, 100, 100);
        // Cutter straddling the right (+x) / top (+z) edge — removes a 30×30 notch
        // running the full depth, the way `align(..., 'rightfronttop')` would.
        const cutter = Mesh.Box(30, 100, 30).move(50, 0, 50).hide();

        b.subtract(cutter);

        const counts = faceVertCounts(b);

        // Geometry survived.
        expect(b.polygons().count()).toBeGreaterThan(0);
        expect(b.inner().triangleCount()).toBeGreaterThan(0);

        // Reconstruction ran: the result is NOT pure triangle soup — at least
        // some coplanar faces were merged back into quads / larger n-gons.
        expect(counts.some(c => c > 3)).toBe(true);

        // The two untouched faces (the -x and -z sides) come back as clean quads.
        expect(counts.filter(c => c === 4).length).toBeGreaterThanOrEqual(2);

        await save(OUTPUT_DIR + 'test.reconstruct.notch.gltf', await b.toGLTF());
    });

    it('reconstructNgons() is idempotent on an already-merged mesh', () =>
    {
        const b = Mesh.Box(100, 100, 100);
        b.subtract(Mesh.Box(30, 100, 30).move(50, 0, 50));

        const before = faceVertCounts(b).sort((a, z) => a - z);
        // Re-running reconstruction must not change the face topology.
        const after = faceVertCounts(Mesh.from(b.inner().reconstructNgons())).sort((a, z) => a - z);

        expect(after).toEqual(before);
    });
});
