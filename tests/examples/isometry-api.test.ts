/**
 * The `isometry(cam, method, { options })` signature.
 *
 * The settings are grouped in an object so the call stays readable once there
 * are five of them, and so options can be added without growing a positional
 * tail.
 *
 * The older positional form is still accepted and must stay that way: scripts
 * saved in the Archiyou script database call it, and those are user content
 * that cannot be migrated by editing this repository. Both forms are pinned
 * here, and pinned to agree with each other.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';

/** Compare two projections by their line work, ignoring object identity. */
function shape(result: ShapeCollection<any>): string
{
    return result.toArray()
        .map((c: any) =>
        {
            const pts = c.controlPoints?.() ?? c.points?.() ?? [];
            return pts.map((p: any) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).join(' ');
        })
        .sort()
        .join('|');
}

beforeAll(async () =>
{
    await initAsync();
});

describe('isometry(cam, method, options)', () =>
{
    it('takes a method and its options on Mesh', () =>
    {
        const iso = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], 'exact', { hiddenLines: true });
        expect(iso.group('visible')?.length).toBe(9);
        expect(iso.group('hidden')?.length).toBe(3);
    });

    it('takes a method and its options on ShapeCollection', () =>
    {
        const scene = new ShapeCollection<any>(
            Mesh.Box(20, 20, 20),
            Mesh.Box(20, 20, 20).move(60, 0, 0),
        );
        const iso = scene.isometry([-1, -1, 1], 'clip', { hiddenLines: false });
        expect(iso.group('visible')?.length).toBe(18);
    });

    it('accepts an options object on its own, with the method inside', () =>
    {
        const viaPair = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], 'exact', { hiddenLines: true });
        const viaObject = Mesh.Box(100, 100, 100)
            .isometry([-1, -1, 1], { method: 'exact', hiddenLines: true } as any);
        expect(shape(viaObject)).toBe(shape(viaPair));
    });

    it('defaults to the raycast method and no hidden lines', () =>
    {
        const bare = Mesh.Box(100, 100, 100).isometry();
        const spelled = Mesh.Box(100, 100, 100)
            .isometry([-1, -1, 1], 'raycast', { hiddenLines: false });
        expect(shape(bare)).toBe(shape(spelled));
        expect(bare.group('hidden')?.length ?? 0).toBe(0);
    });

    it('routes each method through to a different solver', () =>
    {
        // Same model, four methods: they must all draw something, and the two
        // that compute occlusion exactly must agree with each other.
        const build = () => new ShapeCollection<any>(
            Mesh.Box(20, 20, 20),
            Mesh.Box(20, 20, 20).move(20, 0, 0),
        );
        for (const method of ['raycast', 'exact', 'clip', 'painter'] as const)
        {
            const iso = build().isometry([-1, -1, 1], method);
            expect(iso.length, method).toBeGreaterThan(0);
        }
    });

    it('reports a method that cannot run, unless told to fall back', () =>
    {
        const notched = Mesh.Box(40, 40, 40).subtract(Mesh.Box(20, 20, 20).move(20, 20, 20));
        const scene = () => new ShapeCollection<any>(notched.copy(), Mesh.Box(20, 20, 20).move(80, 0, 0));

        expect(() => scene().isometry([-1, -1, 1], 'clip')).toThrow(/convex/i);
        expect(scene().isometry([-1, -1, 1], 'clip', { fallback: true }).length).toBeGreaterThan(0);
    });
});

describe('isometry: the legacy positional form still works', () =>
{
    it('agrees with the new form on Mesh', () =>
    {
        //                                     hidden, includeHidden, samples, angle
        const legacy = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], true, false, 16, 10);
        const current = Mesh.Box(100, 100, 100)
            .isometry([-1, -1, 1], 'raycast', { hiddenLines: true, samples: 16, featureAngle: 10 });
        expect(shape(legacy)).toBe(shape(current));
    });

    it('agrees with the new form on ShapeCollection', () =>
    {
        const build = () => new ShapeCollection<any>(
            Mesh.Box(20, 20, 20), Mesh.Box(20, 20, 20).move(60, 0, 0));

        const legacy = build().isometry([-1, -1, 1], false, false, 16, 10);
        const current = build().isometry([-1, -1, 1], 'raycast',
            { hiddenLines: false, samples: 16, featureAngle: 10 });
        expect(shape(legacy)).toBe(shape(current));
    });

    it('still honours a trailing view object, the pre-method spelling', () =>
    {
        const viaView = Mesh.Box(100, 100, 100)
            .isometry([-1, -1, 1], true, false, 16, 10, { strategy: 'exact' });
        const viaMethod = Mesh.Box(100, 100, 100)
            .isometry([-1, -1, 1], 'exact', { hiddenLines: true });
        expect(shape(viaView)).toBe(shape(viaMethod));
    });
});

describe('Curve.isometry', () =>
{
    it('projects a lone Curve onto the screen plane', () =>
    {
        const line = Curve.Line([0, 0, 0], [100, 0, 0]);
        const iso = line.isometry([-1, -1, 1], 'exact');

        // A curve is line work already: nothing can hide it on its own, so it
        // survives whole, flattened onto XY.
        expect(iso.length).toBe(1);
        const pts = (iso.toArray()[0] as any).controlPoints();
        pts.forEach((p: any) => expect(Math.abs(p.z)).toBeLessThan(1e-9));
    });

    it('is hidden by a solid when both are in a collection', () =>
    {
        // The occluders are what the collection knows about — a lone Curve has
        // none, which is exactly why this needs the collection form.
        const line = Curve.Line([-300, 0, 0], [300, 0, 0]);
        const alone = line.copy().isometry([0, -1, 0], 'exact', { hiddenLines: true });
        expect(alone.group('hidden')?.length ?? 0).toBe(0);

        const withSolid = new ShapeCollection<any>(Mesh.Box(100, 100, 100), line.copy())
            .isometry([0, -1, 0], 'exact', { hiddenLines: true });
        expect(withSolid.group('hidden')?.length ?? 0).toBeGreaterThan(0);
    });

    it('accepts the legacy positional form too', () =>
    {
        const line = Curve.Line([0, 0, 0], [100, 0, 0]);
        expect(shape(line.copy().isometry([-1, -1, 1], false, false, 16, 10)))
            .toBe(shape(line.copy().isometry([-1, -1, 1], 'raycast')));
    });
});
