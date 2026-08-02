/**
 * Isometric projection — planarity of the result.
 *
 * A projection maps 3D onto a PLANE, so every point it returns must lie on that plane.
 * `Mesh._flattenProjectionToScreen` then rotates that plane onto XY — note it ROTATES,
 * it does not re-project, so anything not already coplanar stays non-coplanar and simply
 * ends up straddling z=0.
 *
 * Above a model size of roughly 3000 units the projection stops returning coplanar points
 * and drawings acquire lines that are not on the XY plane at all. Reported against
 * `archiyou/housetest:0.1`, a building at millimetre scale (~2500 x 4000 x 2550), which is
 * a completely ordinary size for the domain — architectural models in mm live here.
 *
 * Established while tracking it down:
 *
 *   - The Rust HLR is innocent: its raw output is planar to 9.8e-13 even at 4000 units.
 *     The damage happened afterwards, converting projected polylines into Curves.
 *   - Topology was never affected — same 12 curves, same 216 points either side of the
 *     cliff. Only positions were wrong.
 *   - `Curve.Polyline` alone reproduces it, with no projection involved at all: 18 points
 *     lying exactly on the plane z = x + y came back thousands of units off it.
 *
 * CAUSE (fixed): Curve3DJs stores a curve as 2D in a fitted `Frame`, and
 * `Frame::from_points` judged its own reliability with ABSOLUTE floors — three of them.
 * Every quantity involved scales with the geometry (Newell's sum and the fallback cross
 * product with the SQUARE of the coordinates, the "constant coordinate" test linearly), so
 * for degenerate input each is cancellation noise that scales the same way. Below a few
 * thousand units the noise stayed under 1e-9 and the robust path ran; above it the noise
 * cleared the floor and a normal made of pure noise was trusted, rebuilding the curve on a
 * plane unrelated to its points. All three floors now scale with the point set's extent, so
 * the decision is about the shape rather than about the units it happens to be drawn in.
 *
 * The Rust HLR was never at fault: its raw output is planar to 9.8e-13 at 4000 units. The
 * damage was done afterwards, when the projected polylines were turned into Curves.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Mesh, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

const ISO_CAM: [number, number, number] = [-1, -1, 1];
/** Unit normal of the projection plane for ISO_CAM. */
const N = 1 / Math.sqrt(3);

/** Largest distance of any returned point from the projection plane through the origin. */
function planeDeviation(collection: any): number
{
    let max = 0;
    collection.toArray().forEach((curve: any) =>
    {
        (curve.vertices?.() ?? []).forEach((p: any) =>
        {
            const d = Math.abs((-p.x - p.y + p.z) * N);
            if (d > max) max = d;
        });
    });
    return max;
}

/** Spread of z after flattening. Zero for a correct projection. */
function zSpread(collection: any): number
{
    let min = Infinity, max = -Infinity;
    collection.toArray().forEach((curve: any) =>
    {
        (curve.vertices?.() ?? []).forEach((p: any) =>
        {
            if (p.z < min) min = p.z;
            if (p.z > max) max = p.z;
        });
    });
    return max > min ? max - min : 0;
}

/** The raw Rust projection, before any TS flattening. */
function rawProjection(mesh: Mesh): any
{
    return (mesh as any)._projectEdges({
        viewDirection: [-N, -N, N],
        planeNormal:   [-N, -N, N],
        planeOrigin:   [0, 0, 0],
        featureAngle:  10,
        samples:       16,
    });
}

/** A building-like frame at millimetre scale, mirroring housetest's timber walls. */
function houseFrame(): ShapeCollection<Mesh>
{
    const W = 2500, D = 4000, H = 2550, T = 200;
    const parts: Mesh[] = [];
    for (let x = 0; x < W; x += 400)
    {
        parts.push(Mesh.Box(60, T, H).moveTo([x, 0, H / 2]));
        parts.push(Mesh.Box(60, T, H).moveTo([x, D, H / 2]));
    }
    for (let y = 400; y < D; y += 400)
    {
        parts.push(Mesh.Box(T, 60, H).moveTo([0, y, H / 2]));
        parts.push(Mesh.Box(T, 60, H).moveTo([W, y, H / 2]));
    }
    return new ShapeCollection<Mesh>(...parts);
}

describe('iso projection — what still works', () =>
{
    it('is exactly planar at ordinary scales', () =>
    {
        for (const scale of [10, 100, 1000, 3000])
        {
            expect(planeDeviation(rawProjection(Mesh.Box(scale, scale, scale))))
                .toBeLessThan(scale * 1e-9);
        }
    }, 300000);

    it('keeps its topology across the cliff', () =>
    {
        // Same shape, same answer — the failure below is purely positional, which rules
        // out edge classification and points at the projection arithmetic itself.
        const below = rawProjection(Mesh.Box(3000, 3000, 3000));
        const above = rawProjection(Mesh.Box(4000, 4000, 4000));
        expect(above.length).toBe(below.length);
    }, 300000);
});

describe('iso projection — planarity above ~3000 units (regression)', () =>
{
    it('returns points on the projection plane for a large single mesh', () =>
    {
        expect(planeDeviation(rawProjection(Mesh.Box(4000, 4000, 4000)))).toBeLessThan(1e-6);
    }, 300000);

    it('flattens a large single mesh onto z = 0', () =>
    {
        // _flattenProjectionToScreen rotates rather than re-projects, so any non-planarity
        // survives as z spread rather than being corrected. Was ~1516 units; now ~4e-12.
        expect(zSpread(Mesh.Box(4000, 4000, 4000).isometry(ISO_CAM, false))).toBeLessThan(1e-6);
    }, 300000);

    it('flattens a building-scale collection onto z = 0', () =>
    {
        // The housetest case: many parts at millimetre scale, through the multi-mesh path
        // (_projectMergedProjectionWithContactFaces), which runs several projections — the
        // merged solid plus one per touching contact face — and concatenates them.
        //
        // Was ~1805 mm of z spread; the Newell floor took it to ~168 mm and the fallback
        // floor to ~5e-11. The residual was 5 curves out of 424 whose collinear-set noise
        // happened to clear the fallback's absolute 1e-9 — the same defect, one branch down.
        expect(zSpread(houseFrame().iso())).toBeLessThan(1e-6);
    }, 600000);
});
