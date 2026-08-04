/**
 * Hidden-line-removal strategies, side by side.
 *
 * The four algorithms are selectable per call so they can be compared on the
 * same model. This suite pins the behaviour that distinguishes them and writes
 * one SVG per strategy per fixture into tests/examples/outputs/ for
 * visual diffing.
 *
 * The cases here are the ones that motivated adding the alternatives:
 *  - a small shape crossing a large one, which the sampling solver misses
 *    because the occluder is narrower than its probe spacing;
 *  - lines that should stop exactly at a silhouette, which sampling can only
 *    place to bisection depth;
 *  - boxes sharing a face, where the sampling path needs a geometry nudge;
 *  - a dense grid, where merging every shape into one solid is the bottleneck.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection } from '../../src/ShapeCollection';
import type { HlrStrategy } from '../../src/types';

const OUTPUT_DIR = './tests/examples/outputs/';

/** Strategies that work on any geometry. */
const GENERAL_STRATEGIES: HlrStrategy[] = ['raycast', 'exact'];
/** Strategies that additionally need convex, non-interpenetrating shapes. */
const PER_SHAPE_STRATEGIES: HlrStrategy[] = ['clip', 'painter'];
const ALL_STRATEGIES: HlrStrategy[] = [...GENERAL_STRATEGIES, ...PER_SHAPE_STRATEGIES];

/** Total curve count across the visible group. */
function visibleCount(result: ShapeCollection<any>): number
{
    return result.group('visible')?.length ?? 0;
}

/** A grid of separated boxes — the shape of a real assembly drawing. */
function boxGrid(n: number, size = 10, gap = 15): ShapeCollection<Mesh>
{
    const boxes: Mesh[] = [];
    for (let x = 0; x < n; x++)
        for (let y = 0; y < n; y++)
            for (let z = 0; z < n; z++)
                boxes.push(Mesh.Cube(size).move(x * gap, y * gap, z * gap));
    return new ShapeCollection<Mesh>(...boxes);
}

beforeAll(async () =>
{
    await initAsync();
});

describe('HLR strategies: agreement on the easy cases', () =>
{
    it('every strategy draws a single cube the same way', async () =>
    {
        for (const strategy of ALL_STRATEGIES)
        {
            const iso = Mesh.Cube(100).isometry([-1, -1, 1], true, false, 16, 10, { strategy });

            // 12 edges: 9 visible, 3 hidden behind the solid.
            expect(visibleCount(iso), `${strategy}: visible`).toBe(9);
            expect(iso.group('hidden')?.length ?? 0, `${strategy}: hidden`).toBe(3);
            expect(iso.group('silhouette')?.length ?? 0, `${strategy}: silhouette`).toBe(6);

            await save(OUTPUT_DIR + `cube.${strategy}.svg`, iso.toSVG());
        }
    });

    it('two separated boxes keep all their edges under every strategy', async () =>
    {
        const boxes = new ShapeCollection<Mesh>(
            Mesh.Cube(20),
            Mesh.Cube(20).move(60, 0, 0),
        );
        for (const strategy of ALL_STRATEGIES)
        {
            const iso = boxes.iso([-1, -1, 1], false, false, 16, 10, { strategy });
            // Nothing overlaps on screen, so both cubes show their full
            // 9-visible-edge selves.
            expect(visibleCount(iso), `${strategy}`).toBe(18);
            await save(OUTPUT_DIR + `two-boxes.${strategy}.svg`, iso.toSVG());
        }
    });
});

describe('HLR strategies: the cases that motivated the alternatives', () =>
{
    it('exact finds a thin occluder that sampling steps over', async () =>
    {
        // A long slab with a narrow post standing in front of it. The post is
        // far thinner than the sampling solver's probe spacing along the slab.
        //
        // Compared at the Mesh level rather than through a collection so both
        // strategies take the identical path and the only difference is how
        // visibility is decided — a collection would BSP-merge the two shapes
        // first, which changes the geometry itself.
        // Mesh.Box takes explicit per-axis sizes and is centred on the origin.
        // (Mesh.scale is a uniform scale about a pivot, not a per-axis one.)
        // Slab spans x -500..500; the post is 0.4 wide in x and stands clear
        // above it, so it occludes a 0.4-long bite out of each long edge.
        const slab = Mesh.Box(1000, 40, 1);
        const post = Mesh.Box(0.4, 200, 20).move(0, 0, 15);

        const postWidthSpans = (strategy: HlrStrategy) =>
        {
            const r = slab._projectEdges(
                {
                    viewDirection: [0, 0, 1],
                    planeNormal: [0, 0, 1],
                    planeOrigin: [0, 0, 0],
                    featureAngle: 10,
                    samples: 16,
                    strategy,
                },
                new ShapeCollection<Mesh>(post),
            );
            // Count only spans the width of the post; the slab is a solid, so
            // its underside is hidden by its own top face in both solvers.
            return (r.group('hidden')?.toArray() ?? []).filter((c: any) =>
            {
                const pts = c.controlPoints?.() ?? c.points?.();
                if (!pts || pts.length < 2) return false;
                const a = pts[0], b = pts[pts.length - 1];
                const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
                return Math.abs(len - 0.4) < 1e-6;
            }).length;
        };

        // Sampling steps clean over the post; the exact solver clips against
        // its outline, so no positive width is too narrow to find.
        expect(postWidthSpans('raycast')).toBe(0);
        expect(postWidthSpans('exact')).toBeGreaterThan(0);

        const scene = new ShapeCollection<Mesh>(slab, post);
        for (const strategy of ALL_STRATEGIES)
        {
            const iso = scene.iso([-1, -1, 1], true, false, 16, 10, { strategy });
            await save(OUTPUT_DIR + `thin-occluder.${strategy}.svg`, iso.toSVG());
        }
    });

    it('boxes sharing a face keep their contact edges without a geometry nudge', async () =>
    {
        // Two cubes flush against each other. The shared face is coplanar with
        // both, so it must hide neither.
        const scene = new ShapeCollection<Mesh>(
            Mesh.Cube(20),
            Mesh.Cube(20).move(20, 0, 0),
        );

        for (const strategy of ALL_STRATEGIES)
        {
            const iso = scene.iso([-1, -1, 1], false, false, 16, 10, { strategy });
            // Both boxes must contribute line work — a contact face that
            // swallowed its neighbour's outline would show up as a sharp drop.
            expect(visibleCount(iso), `${strategy}`).toBeGreaterThanOrEqual(12);
            await save(OUTPUT_DIR + `touching-boxes.${strategy}.svg`, iso.toSVG());
        }
    });

    it('per-shape strategies survive a grid that the merged path chokes on', async () =>
    {
        // 10^3 boxes. The merged-solid path BSP-merges all 1000 into one mesh;
        // the per-shape path never merges, so there is nothing to choke on.
        const grid = boxGrid(10);

        for (const strategy of PER_SHAPE_STRATEGIES)
        {
            const iso = grid.iso([-1, -1, 1], false, false, 16, 10, { strategy });
            expect(visibleCount(iso), `${strategy}`).toBeGreaterThan(0);
        }
    }, 600_000);
});

describe('HLR strategies: per-shape output', () =>
{
    it('tags one group per source shape, ordered back to front', async () =>
    {
        const scene = new ShapeCollection<Mesh>(
            Mesh.Cube(20),
            Mesh.Cube(20).move(60, 0, 0),
            Mesh.Cube(20).move(120, 0, 0),
        );
        const iso = scene.iso([-1, -1, 1], false, false, 16, 10, { strategy: 'clip' });

        // Provenance survives projection — the merged path cannot do this.
        for (let i = 0; i < 3; i++)
        {
            expect(iso.group(`shape-${i}`)?.length ?? 0, `shape-${i}`).toBeGreaterThan(0);
        }
    });

    it('painter emits opaque fills and clip does not', async () =>
    {
        // Two separated boxes offset along the view direction, so they land on
        // top of each other on screen while staying disjoint in space — one is
        // squarely in front of the other.
        const scene = new ShapeCollection<Mesh>(
            Mesh.Cube(20),
            Mesh.Cube(20).move(-40, -40, 40),
        );

        const clip = scene.iso([-1, -1, 1], false, false, 16, 10, { strategy: 'clip' });
        const painter = scene.iso([-1, -1, 1], false, false, 16, 10, { strategy: 'painter' });

        // Painter's occlusion IS the fill: front faces painted over whatever
        // was drawn earlier. Clip computes occlusion into the line work instead,
        // so it emits none.
        expect(clip.group('fill')?.length ?? 0, 'clip should emit no fills').toBe(0);
        expect(painter.group('fill')?.length ?? 0, 'painter should emit fills').toBeGreaterThan(0);

        const svg = painter.toSVG();
        expect(svg).toContain('.fill{fill:#fff;stroke:none}');
        expect(svg).toContain('class="line fill"');

        // Because painter never clips against siblings, its line work is the
        // full self-occluded wireframe of every shape — more curves than clip,
        // which removes the covered parts outright.
        expect(visibleCount(painter)).toBeGreaterThanOrEqual(visibleCount(clip));

        await save(OUTPUT_DIR + 'overlap.clip.svg', clip.toSVG());
        await save(OUTPUT_DIR + 'overlap.painter.svg', svg);
    });

    it('refuses a per-shape strategy on geometry it cannot draw exactly', () =>
    {
        // A cube with a notch taken out is not convex, so "a face is visible
        // iff it faces the viewer" no longer holds.
        const notched = Mesh.Cube(40).subtract(Mesh.Cube(20).move(20, 20, 20));
        const scene = new ShapeCollection<Mesh>(notched, Mesh.Cube(20).move(80, 0, 0));

        expect(() => scene.iso([-1, -1, 1], false, false, 16, 10, { strategy: 'clip' }))
            .toThrow(/convex/i);
    });

    it('downgrades instead of throwing when asked to', () =>
    {
        const notched = Mesh.Cube(40).subtract(Mesh.Cube(20).move(20, 20, 20));
        const scene = new ShapeCollection<Mesh>(notched, Mesh.Cube(20).move(80, 0, 0));

        const iso = scene.iso([-1, -1, 1], false, false, 16, 10,
            { strategy: 'clip', fallback: true });
        expect(visibleCount(iso)).toBeGreaterThan(0);
    });
});

describe('HLR strategies: cost', () =>
{
    it('records wall-clock per strategy on a 4x4x4 grid', async () =>
    {
        const grid = boxGrid(4);
        const timings: Record<string, number> = {};

        for (const strategy of ALL_STRATEGIES)
        {
            const t0 = performance.now();
            const iso = grid.iso([-1, -1, 1], false, false, 16, 10, { strategy });
            timings[strategy] = Math.round(performance.now() - t0);
            expect(visibleCount(iso), `${strategy} produced no line work`).toBeGreaterThan(0);
            await save(OUTPUT_DIR + `grid-4.${strategy}.svg`, iso.toSVG());
        }

        // Reported rather than asserted: this is a comparison harness, and a
        // wall-clock threshold would be a flaky test on shared CI hardware.
        console.info('HLR strategy timings (ms) on 4^3 boxes:', timings);
    }, 600_000);
});
