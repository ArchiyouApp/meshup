/**
 * The projection signatures: `isometry(cam, options)`, `elevation(from, options)`,
 * `project(from, options)` (a collection's elevation with its hidden lines) and
 * `section(pivot, normal, options)` — on Mesh, Curve and ShapeCollection alike.
 *
 * The settings, the hidden-line method included, are one options object, so the call stays
 * readable and options can be added without growing a positional tail. The earlier forms —
 * a method before the options, and the positional settings — are refused with what to write
 * instead, rather than guessed at.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { ShapeCollection } from '../../src/ShapeCollection';
import { SceneNode } from '../../src/SceneNode';
import { resolveProjectionArgs } from '../../src/types';
import { PROJECTION_DEFAULTS } from '../../src/constants';

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

/** Run `fn` while recording the options of every call to one of Mesh's kernel projections. */
function recordKernelOptions(method: '_projectEdges' | '_projectEdgesSection', fn: () => void): any[]
{
    const seen: any[] = [];
    const original = (Mesh as any).prototype[method];
    (Mesh as any).prototype[method] = function (options: any, occluders?: any)
    {
        seen.push(options);
        return original.call(this, options, occluders);
    };
    try
    {
        fn();
    }
    finally
    {
        (Mesh as any).prototype[method] = original;
    }
    return seen;
}

const twoBoxes = () => new ShapeCollection<any>(Mesh.Box(20, 20, 20), Mesh.Box(20, 20, 20).move(60, 0, 0));

beforeAll(async () =>
{
    await initAsync();
});

describe('isometry(cam, options)', () =>
{
    it('takes its options on Mesh', () =>
    {
        const iso = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], { method: 'exact', hiddenLines: true });
        expect(iso.group('visible')?.length).toBe(9);
        expect(iso.group('hidden')?.length).toBe(3);
    });

    it('takes its options on ShapeCollection', () =>
    {
        const iso = twoBoxes().isometry([-1, -1, 1], { method: 'clip', hiddenLines: false });
        expect(iso.group('visible')?.length).toBe(18);
    });

    it('defaults to the exact method and no hidden lines', () =>
    {
        const bare = Mesh.Box(100, 100, 100).isometry();
        const spelled = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], { method: 'exact', hiddenLines: false });
        expect(shape(bare)).toBe(shape(spelled));
        expect(bare.group('hidden')?.length ?? 0).toBe(0);
    });

    it('routes each method through to a different solver', () =>
    {
        const build = () => new ShapeCollection<any>(Mesh.Box(20, 20, 20), Mesh.Box(20, 20, 20).move(20, 0, 0));
        for (const method of ['raycast', 'exact', 'clip', 'painter'] as const)
        {
            expect(build().isometry([-1, -1, 1], { method }).length, method).toBeGreaterThan(0);
        }
    });

    it('reports a method that cannot run, unless told to fall back', () =>
    {
        const notched = Mesh.Box(40, 40, 40).subtract(Mesh.Box(20, 20, 20).move(20, 20, 20));
        const scene = () => new ShapeCollection<any>(notched.copy(), Mesh.Box(20, 20, 20).move(80, 0, 0));

        expect(() => scene().isometry([-1, -1, 1], { method: 'clip' })).toThrow(/convex/i);
        expect(scene().isometry([-1, -1, 1], { method: 'clip', fallback: true }).length).toBeGreaterThan(0);
    });
});

describe('elevation(from, options)', () =>
{
    it('hands its options to the kernel on Mesh', () =>
    {
        const seen = recordKernelOptions('_projectEdges', () =>
            Mesh.Box(20, 20, 20).elevation('front', { method: 'raycast', samples: 123, featureAngle: 7 }));
        expect(seen.map(o => [o.strategy, o.samples, o.featureAngle])).toEqual([['raycast', 123, 7]]);
    });

    it('hands its options to the kernel on ShapeCollection', () =>
    {
        const seen = recordKernelOptions('_projectEdges', () =>
            twoBoxes().elevation('front', { method: 'raycast', samples: 123, featureAngle: 7 }));
        expect(seen.length).toBeGreaterThan(0);
        seen.forEach(o => expect([o.strategy, o.samples, o.featureAngle]).toEqual(['raycast', 123, 7]));
    });

    it('takes the default method when it is left out', () =>
    {
        const seen = recordKernelOptions('_projectEdges', () =>
            Mesh.Box(20, 20, 20).elevation('front', { samples: 123 }));
        expect(seen.map(o => [o.strategy, o.samples])).toEqual([['exact', 123]]);
    });

    it('reports a method that cannot run, unless told to fall back', () =>
    {
        const notched = Mesh.Box(40, 40, 40).subtract(Mesh.Box(20, 20, 20).move(20, 20, 20));
        const scene = () => new ShapeCollection<any>(notched.copy(), Mesh.Box(20, 20, 20).move(80, 0, 0));

        expect(() => scene().elevation('front', { method: 'clip' })).toThrow(/convex/i);
        expect(scene().elevation('front', { method: 'clip', fallback: true }).length).toBeGreaterThan(0);
    });
});

describe('ShapeCollection.project(from, options)', () =>
{
    /** Length of every line in a projection, sorted: compares drawings without their order. */
    const lengths = (c: ShapeCollection<any>) => c.toArray().map((l: any) => +l.length().toFixed(6)).sort((a, b) => a - b);

    it('draws every edge once, the ones at the back too, with nothing hidden', () =>
    {
        // A box from the front: its back edges fall on the front ones, so one square
        const square = new ShapeCollection<any>(Mesh.Box(20, 20, 20)).project('front');
        expect(lengths(square)).toEqual([20, 20, 20, 20]);
        expect(square.group('hidden')).toBeFalsy();
        expect(square.group('silhouette')?.length).toBe(4);

        // Two touching boxes: top and bottom run through, the shared side is drawn once
        const pair = new ShapeCollection<any>(Mesh.Box(20, 20, 20), Mesh.Box(20, 20, 20).move(20, 0, 0)).project('front');
        expect(lengths(pair)).toEqual([20, 20, 20, 40, 40]);
    });

    it('shows what an elevation hides, without hiding it', () =>
    {
        // A small box behind a big one: gone in the elevation, drawn in the projection
        const scene = () => new ShapeCollection<any>(Mesh.Box(100, 10, 100), Mesh.Box(20, 20, 20).move(0, 50, 0));
        const elevated = scene().elevation('front');
        const projected = scene().project('front');
        expect(projected.length).toBeGreaterThan(elevated.length);
        expect(lengths(projected)).toEqual([20, 20, 20, 20, 100, 100, 100, 100]);
    });

    it('draws curves too, and leaves hidden shapes out unless asked', () =>
    {
        const line = Curve.Line([-50, 0, 0], [50, 0, 0]);
        expect(new ShapeCollection<any>(line).project('front').length).toBe(1);

        const withHidden = () => new ShapeCollection<any>(Mesh.Box(20, 20, 20), Mesh.Box(20, 20, 20).move(100, 0, 0).hide());
        expect(withHidden().project('front').length).toBe(4);
        expect(withHidden().project('front', { includeHiddenShapes: true }).length).toBe(8);
    });
});

describe('projections keep the style of their shapes', () =>
{
    /** The explicit colours in a projection's line work, sorted; '-' for a line without one. */
    const colours = (c: ShapeCollection<any>) =>
        [...new Set(c.toArray().map((s: any) => s.style?.explicitData?.()?.color ?? '-'))].sort();

    const red = () => Mesh.Box(20, 20, 20).color('red');
    const blue = () => Mesh.Box(20, 20, 20).move(40, 0, 0).color('blue');
    const greenLine = () => Curve.Line([0, -30, 0], [60, -30, 0]).color('green');
    const RED = '#ff0000', BLUE = '#0000ff', GREEN = '#008000';

    const sources: Array<[string, () => any, string[]]> = [
        ['a Mesh',                          () => red(),                                              [RED]],
        ['a collection of one mesh',        () => new ShapeCollection<any>(red()),                    [RED]],
        ['a collection of one style',       () => new ShapeCollection<any>(red(), red().move(40, 0, 0)), [RED]],
        ['a collection of two styles',      () => new ShapeCollection<any>(red(), blue()),            [BLUE, RED]],
        ['a collection of a mesh and a curve', () => new ShapeCollection<any>(red(), greenLine()),    [GREEN, RED]],
    ];
    const projections: Array<[string, (s: any) => ShapeCollection<any>, boolean]> = [
        //                                                                            curves too?
        ['isometry',          s => s.isometry([-1, -1, 1]),                                  true],
        ['isometry clip',     s => s.isometry([-1, -1, 1], { method: 'clip' }),               true],
        ['elevation',         s => s.elevation('front'),                                      true],
        ['elevation hidden',  s => s.elevation('front', { hiddenLines: true }),               true],
        ['project',           s => s.project('front'),                                        true],
        ['section',           s => s.section([0, 0, 5], [0, 0, 1]),                           false], // a section cuts solids only
    ];

    sources.forEach(([source, make, expected]) =>
        projections.forEach(([name, project, curvesToo]) =>
        {
            if (name === 'project' && source === 'a Mesh') return; // project() is a collection method
            it(`${name} of ${source}`, () =>
            {
                const want = curvesToo ? expected : expected.filter(c => c !== GREEN);
                expect(colours(project(make()))).toEqual(want);
            });
        }));

    it('takes the colour a shape gets from its layer, its own colour winning', () =>
    {
        // layer('ringbeams').color('red'); layer('spanbeams').color('blue')
        const scene = SceneNode.root();
        const ring = Mesh.Box(20, 20, 20);
        const span = Mesh.Box(20, 20, 20).move(40, 0, 0);
        const screw = Mesh.Box(5, 5, 5).move(80, 0, 0).color('green');
        scene.addLayer('ringbeams', new ShapeCollection<any>(ring)).color('red');
        scene.addLayer('spanbeams', new ShapeCollection<any>(span, screw)).color('blue');

        const all = () => new ShapeCollection<any>(ring, span, screw);
        expect(colours(all().isometry([-1, -1, 1]))).toEqual([GREEN, BLUE, RED].sort());
        expect(colours(all().elevation('front', { hiddenLines: true }))).toEqual([GREEN, BLUE, RED].sort());
        expect(colours(all().project('front'))).toEqual([GREEN, BLUE, RED].sort());
        expect(colours(ring.isometry([-1, -1, 1]))).toEqual([RED]);
    });

    it('still draws a shape whose layer is hidden', () =>
    {
        const scene = SceneNode.root();
        const box = Mesh.Box(20, 20, 20);
        scene.addLayer('model', new ShapeCollection<any>(box)).color('red').hide();

        const drawing = new ShapeCollection<any>(box).elevation('front');
        expect(drawing.length).toBe(4);
        expect(drawing.toArray().every((s: any) => s.style.visible !== false)).toBe(true);
        expect(colours(drawing)).toEqual([RED]);
    });

    it('keeps a shape hidden by one of another style hidden', () =>
    {
        // A small blue box right behind a big red one: its edges stay hidden, in blue
        const scene = new ShapeCollection<any>(
            Mesh.Box(100, 10, 100).color('red'),
            Mesh.Box(20, 20, 20).move(0, 50, 0).color('blue'));
        const drawing = scene.elevation('front', { hiddenLines: true });
        expect(colours(drawing.group('visible')!)).toEqual([RED]);
        expect(colours(drawing.group('hidden')!)).toEqual([BLUE, RED]);
    });
});

describe('section(pivot, normal, options)', () =>
{
    it('hands its options to the kernel on Mesh and on ShapeCollection', () =>
    {
        const onMesh = recordKernelOptions('_projectEdgesSection', () =>
            Mesh.Box(20, 20, 20).section([0, 0, 0], [0, 0, 1], { method: 'raycast', samples: 321, featureAngle: 11 }));
        const onCollection = recordKernelOptions('_projectEdgesSection', () =>
            twoBoxes().section([0, 0, 0], [0, 0, 1], { method: 'raycast', samples: 321, featureAngle: 11 }));

        expect(onMesh.map(o => [o.strategy, o.samples, o.featureAngle])).toEqual([['raycast', 321, 11]]);
        expect(onCollection.map(o => [o.strategy, o.samples, o.featureAngle])).toEqual([['raycast', 321, 11]]);
    });
});

describe('the earlier call forms are refused', () =>
{
    const line = () => Curve.Line([0, 0, 0], [100, 0, 0]);
    const calls: Array<[string, () => any]> = [
        ['Mesh.isometry(cam, true)',                 () => (Mesh.Box(10, 10, 10) as any).isometry([-1, -1, 1], true)],
        ['Mesh.iso(cam, method, options)',           () => (Mesh.Box(10, 10, 10) as any).iso([-1, -1, 1], 'exact', { hiddenLines: true })],
        ['Mesh.elevation(from, true)',               () => (Mesh.Box(10, 10, 10) as any).elevation('front', true)],
        ['Mesh.elevation(from, method)',             () => (Mesh.Box(10, 10, 10) as any).elevation('front', 'raycast')],
        ['Mesh.section(pivot, normal, true, 16)',    () => (Mesh.Box(10, 10, 10) as any).section([0, 0, 0], [0, 0, 1], true, 16)],
        ['ShapeCollection.isometry(cam, false, false, 16, 10)', () => (twoBoxes() as any).isometry([-1, -1, 1], false, false, 16, 10)],
        ['ShapeCollection.elevation(from, true)',    () => (twoBoxes() as any).elevation('front', true)],
        ['ShapeCollection.elevation(from, method, options)', () => (twoBoxes() as any).elevation('front', 'exact', { hiddenLines: true })],
        ['ShapeCollection.project(from, true)',      () => (twoBoxes() as any).project('front', true)],
        ['ShapeCollection.section(pivot, normal, method)', () => (twoBoxes() as any).section([0, 0, 0], [0, 0, 1], 'exact')],
        ['Curve.isometry(cam, method)',              () => (line() as any).isometry([-1, -1, 1], 'raycast')],
    ];

    calls.forEach(([name, call]) =>
    {
        it(name, () => expect(call).toThrow(/options object/));
    });

    it('says what to write instead', () =>
    {
        expect(() => (twoBoxes() as any).elevation('front', true)).toThrow(/\{ hiddenLines: true \}/);
        expect(() => (twoBoxes() as any).elevation('front', 'raycast')).toThrow(/\{ method: 'raycast' \}/);
    });
});

describe('resolveProjectionArgs', () =>
{
    it('reads an options object, method included, and fills in the defaults', () =>
    {
        expect(resolveProjectionArgs([{ method: 'clip', fallback: true }], 'test'))
            .toEqual({ ...PROJECTION_DEFAULTS, method: 'clip', fallback: true });
        expect(resolveProjectionArgs([], 'test')).toEqual(PROJECTION_DEFAULTS);
        expect(resolveProjectionArgs([undefined], 'test')).toEqual(PROJECTION_DEFAULTS);
        expect(resolveProjectionArgs([{ samples: undefined, featureAngle: undefined }], 'test'))
            .toEqual(PROJECTION_DEFAULTS);
    });

    it('refuses anything else, naming the call', () =>
    {
        expect(() => resolveProjectionArgs([true], 'Mesh.elevation(from, options)'))
            .toThrow(/^Mesh\.elevation\(from, options\): /);
        expect(() => resolveProjectionArgs([{ hiddenLines: true }, 16], 'test')).toThrow();
        expect(() => resolveProjectionArgs([undefined, { hiddenLines: true }], 'test')).toThrow();
    });
});

describe('Curve.isometry', () =>
{
    it('projects a lone Curve onto the screen plane', () =>
    {
        const line = Curve.Line([0, 0, 0], [100, 0, 0]);
        const iso = line.isometry([-1, -1, 1], { method: 'exact' });

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
        const alone = line.copy().isometry([0, -1, 0], { hiddenLines: true });
        expect(alone.group('hidden')?.length ?? 0).toBe(0);

        const withSolid = new ShapeCollection<any>(Mesh.Box(100, 100, 100), line.copy())
            .isometry([0, -1, 0], { hiddenLines: true });
        expect(withSolid.group('hidden')?.length ?? 0).toBeGreaterThan(0);
    });
});

/**
 * A projection's groups are reachable as shortcut properties (iso.visible), and
 * that only works while no method owns the name. ShapeCollection's filters are
 * therefore called onlyVisible()/onlyHidden(): naming them visible()/hidden()
 * made every group key collide, so the shortcut was skipped and a warning was
 * logged on every re-index — 1204 of them for one workbench drawing.
 */
describe('projection group shortcuts', () =>
{
    it('exposes visible/hidden/silhouette as live shortcut properties', () =>
    {
        const warns: string[] = [];
        const orig = console.warn;
        console.warn = (...a: any[]) => { warns.push(a.join(' ')); };
        const iso: any = Mesh.Box(100, 100, 100).isometry([-1, -1, 1], { hiddenLines: true });
        console.warn = orig;

        expect(warns.filter(w => w.includes('conflicts with an existing'))).toEqual([]);

        for (const name of ['visible', 'hidden', 'silhouette'])
        {
            expect(ShapeCollection.isShapeCollection(iso[name])).toBe(true);
            expect(iso[name].length).toBe(iso.group(name)!.length);
        }

        // the shortcut IS the group, not a copy of it — mutations reach the shapes
        expect(iso.hidden.toArray()[0]).toBe(iso.group('hidden')!.toArray()[0]);
        iso.hidden.color('red');
        expect((iso.group('hidden')!.toArray()[0] as any).style.color).toBe('#ff0000');
    });

    it('keeps the visibility filters under their only- names', () =>
    {
        const col = new ShapeCollection<any>(Mesh.Box(10, 10, 10), Mesh.Box(10, 10, 10).move(50).hide());
        expect(col.onlyVisible().length).toBe(1);
        expect(col.onlyHidden().length).toBe(1);
        // the old names must stay free, or the shortcuts above break again
        expect((ShapeCollection.prototype as any).visible).toBe(undefined);
        expect((ShapeCollection.prototype as any).hidden).toBe(undefined);
    });
});
