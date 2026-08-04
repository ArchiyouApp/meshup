/**
 * Hidden-line-removal strategies, measured on real assembly geometry.
 *
 * The cases are lifted from a script called `isotest` in the Archiyou script
 * database, which was written to demonstrate HLR defects — its own comments
 * name them: "big-small ortho contact => dropped seperating edge". They are the
 * right benchmark for the alternative solvers, so they are rebuilt here with
 * meshup's own API and each is projected under every strategy.
 *
 * Two things come out of this, into `outputs/` beside this file:
 *   - svgs/   one SVG per combination — the drawing as it would be used;
 *   - gltfs/  one glTF per combination holding the source model with its
 *             projection set down beside it. An SVG shows what was drawn; the
 *             glTF shows it against the geometry it came from, which is what
 *             you need to judge whether a missing edge should have been there.
 *
 * Plus a wall-clock table, printed at the end.
 *
 * Timing note: each case is projected once per strategy after a warm-up pass,
 * and the geometry is rebuilt per strategy so no projection benefits from a
 * cache the previous one filled. Building that geometry is deliberately outside
 * the timed region — it is identical work for all four strategies and is not
 * hidden-line removal.
 */
import fs from 'node:fs';
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection } from '../../src/ShapeCollection';
import type { HlrStrategy } from '../../src/types';

const STRATEGIES: HlrStrategy[] = ['raycast', 'exact', 'clip', 'painter'];

const OUTPUT_DIR = './tests/examples/outputs/';
const SVG_DIR = OUTPUT_DIR + 'svgs/';
const GLTF_DIR = OUTPUT_DIR + 'gltfs/';

/** `$NUM` in the source script — how many slabs the stack case gets. */
const STACK_COUNT = 5;

interface Case
{
    name: string;
    /** Rebuilt per measurement so nothing is reused between strategies. */
    build: () => ShapeCollection<any>;
    cam: [number, number, number];
    samples: number;
    featureAngle: number;
}

const CASES: Case[] = [
    {
        name: 'single-box',
        build: () => new ShapeCollection<any>(Mesh.Box(100, 100, 100)),
        cam: [-1, -1, 1], samples: 16, featureAngle: 10,
    },
    {
        name: 'stack-merged',
        // One solid — the shape the merged path is happiest with.
        build: () => new ShapeCollection<any>(
            (Mesh.Box(100, 100, 10) as any)
                .replicate(STACK_COUNT, (s: any, i: number) => s.move(0, 0, 10 * i))
                .merge()),
        cam: [-1, -1, 1], samples: 16, featureAngle: 10,
    },
    {
        name: 'stack-collection',
        // The same stack left as separate shapes, every slab face touching.
        build: () => (Mesh.Box(100, 100, 10) as any)
            .replicate(STACK_COUNT, (s: any, i: number) => s.move(0, 0, 10 * i)),
        cam: [-1, -1, 1], samples: 16, featureAngle: 10,
    },
    {
        name: 'big-small-contact',
        // The script's own annotated failure: a thin batten sitting on a wide
        // slab, whose separating edge the merged path drops.
        build: () =>
        {
            const bigbox = Mesh.Box(400, 200, 10).move(0, -300);
            const sm = (Mesh.Box(5, 200, 5) as any)
                .align(bigbox, 'leftfrontbottom', 'leftfronttop');
            return new ShapeCollection<any>(bigbox, sm);
        },
        cam: [1, 1, 1], samples: 100, featureAngle: 10,
    },
    {
        name: 'beam-floor',
        build: () =>
        {
            const bs = (Mesh.Box(5, 500, 20).move(500) as any).row(5, 45);
            const bhf = Mesh.BoxBetween(
                bs.bbox().corner('leftfrontbottom'),
                bs.bbox().corner('rightfronttop').moveY(-10),
            );
            const bhb = (bhf as any).copy().mirrorY();
            return new ShapeCollection<any>(bs, bhf, bhb);
        },
        cam: [-1, -1, 1], samples: 200, featureAngle: 10,
    },
    {
        name: 'grid-3x3x3',
        build: () => (Mesh.Box(100, 100, 100) as any).grid(3, 3, 3, [150, 150, 150]),
        cam: [-1, -1, 1], samples: 16, featureAngle: 10,
    },
];

interface Measurement
{
    ms: number | null;
    curves: number;
    note?: string;
}

const results: Record<string, Record<string, Measurement>> = {};

beforeAll(async () =>
{
    await initAsync();
});

describe('HLR strategies: cost on assembly geometry', () =>
{
    CASES.forEach((c) =>
    {
        it(`projects "${c.name}" under every strategy`, async () =>
        {
            results[c.name] ??= {};

            for (const strategy of STRATEGIES)
            {
                // Warm-up, so the first strategy measured is not the one that
                // pays for lazily-built kernel state.
                try { project(c, strategy); } catch { /* measured below */ }

                let measurement: Measurement;
                try
                {
                    const model = c.build();

                    const t0 = performance.now();
                    const projected = model._iso(
                        c.cam, false, false, c.samples, c.featureAngle, { strategy });
                    const ms = performance.now() - t0;

                    measurement = { ms: Math.round(ms * 10) / 10, curves: projected.length ?? 0 };
                    await save(SVG_DIR + `${c.name}.${strategy}.svg`, projected.toSVG());
                    await save(GLTF_DIR + `${c.name}.${strategy}.gltf`,
                        await buildDebugScene(model, projected));
                }
                catch (e: any)
                {
                    // The per-shape strategies decline geometry they cannot draw
                    // exactly. That is a result worth recording, not a test
                    // failure — it is the honest answer for that case.
                    measurement = { ms: null, curves: 0, note: shortReason(e) };
                }
                results[c.name][strategy] = measurement;
            }

            // Every case must at least be drawable by the two general solvers.
            expect(results[c.name].raycast.ms, 'raycast failed').not.toBeNull();
            expect(results[c.name].exact.ms, 'exact failed').not.toBeNull();
        }, 900_000);
    });

    it('reports the comparison', () =>
    {
        const pad = (s: string, n: number) => s.padEnd(n);
        const cell = (m: Measurement | undefined) =>
            !m ? '—'
            : m.ms === null ? `n/a (${m.note})`
            : `${m.ms} ms / ${m.curves}`;

        const lines = [
            '',
            'HLR strategy comparison — time / curve count, per geometry',
            '='.repeat(96),
            pad('geometry', 20) + STRATEGIES.map(s => pad(s, 19)).join(''),
            '-'.repeat(96),
            ...CASES.map(c => pad(c.name, 20)
                + STRATEGIES.map(s => pad(cell(results[c.name]?.[s]), 19)).join('')),
            '='.repeat(96),
            `output: ${OUTPUT_DIR}`,
            '  svgs/   the drawings',
            '  gltfs/  model + projection side by side, for debugging',
        ];

        const report = lines.join('\n');
        console.info(report);
        fs.writeFileSync(OUTPUT_DIR + 'hlr-performance.txt', report + '\n');
        expect(Object.keys(results).length).toBe(CASES.length);
    });
});

function project(c: Case, strategy: HlrStrategy): ShapeCollection<any>
{
    // _iso is the undecorated projection: it does not add to the scenegraph, so
    // repeated measurements do not grow the scene and skew later ones.
    return c.build()._iso(c.cam, false, false, c.samples, c.featureAngle, { strategy });
}

/**
 * A glTF scene with `model` and `projected` side by side.
 *
 * The projection comes back flattened onto XY and recentred on the origin, so
 * left alone it would sit inside the model it describes. It is moved clear of
 * the model's bounding box, with a gap proportional to the model, so the two
 * read as a pair at any scale.
 */
async function buildDebugScene(model: any, projected: any): Promise<string>
{
    const modelBox = model.bbox();
    const isoBox = projected.bbox();
    if (!modelBox || !isoBox) return await model.toGLTF();

    const gap = Math.max(modelBox.width(), 1) * 0.25;
    // Butt the projection's left edge up against the model's right edge.
    const shift = modelBox.max().x + gap - isoBox.min().x;

    const scene = new ShapeCollection<any>();
    model.toArray().forEach((s: any) => scene.add(s));
    projected.move(shift, 0, 0).toArray().forEach((s: any) => scene.add(s));
    return await scene.toGLTF();
}

function shortReason(e: any): string
{
    const msg = String(e?.message ?? e);
    const m = msg.match(/\(([^)]+)\)/);
    return m ? m[1] : msg.slice(0, 60);
}
