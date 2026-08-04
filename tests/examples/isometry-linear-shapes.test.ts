/**
 * Linear shapes and style inheritance in isometric projection.
 *
 * A wireframe, a centreline or imported linework is geometry in the drawing
 * like any other: a solid in front of it has to hide it, and it has to appear
 * in the projection at all. Previously the projection collected only Meshes, so
 * Curves in a collection were silently dropped.
 *
 * Styling set on the source shape travels with the line work the projection
 * makes of it, so `box(...).color('blue')` draws blue edges and a `.dashed()`
 * wireframe stays dashed.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { save } from '../../src/utils';
import { ShapeCollection } from '../../src/ShapeCollection';
import type { HlrStrategy } from '../../src/types';

const OUTPUT_DIR = './tests/examples/outputs/';
const ALL_STRATEGIES: HlrStrategy[] = ['raycast', 'exact', 'clip', 'painter'];

/** Colours actually present on the projected curves. */
function colours(result: ShapeCollection<any>): Set<string>
{
    const out = new Set<string>();
    result.toArray().forEach((s: any) =>
    {
        const c = s?.style?.explicitData?.().color;
        if (c) out.add(String(c));
    });
    return out;
}

/** How many projected curves carry a dash pattern. */
function dashedCount(result: ShapeCollection<any>): number
{
    return result.toArray().filter((s: any) =>
    {
        const stroke = s?.style?.explicitData?.().stroke;
        return Array.isArray(stroke?.dash) && stroke.dash.length > 0;
    }).length;
}

beforeAll(async () =>
{
    await initAsync();
});

describe('isometry: linear shapes', () =>
{
    it('includes a wireframe box in the projection, with its styling', async () =>
    {
        // The reported case, verbatim.
        const bs = Mesh.Box(100, 200, 300).color('blue');
        const bsw = Mesh.Box(300, 50, 50).wireframe().dashed();
        const mixed = new ShapeCollection<any>(bs, bsw);

        const iso = mixed._iso([-1, -1, 1], false, false, 16, 10);

        // Without linear-shape support this collection projected only the solid.
        expect(iso.length).toBeGreaterThan(0);
        expect(dashedCount(iso), 'wireframe should stay dashed').toBeGreaterThan(0);
        expect(colours(iso).has('#0000ff'), 'solid should stay blue').toBe(true);

        await save(OUTPUT_DIR + 'mixed.svg', iso.toSVG());
    });

    it('drops the linear shapes if they are not collected — the old behaviour', () =>
    {
        // A collection of only Meshes must be unaffected by any of this.
        const solids = new ShapeCollection<any>(Mesh.Box(100, 100, 100), Mesh.Box(50, 50, 50).move(200));
        const iso = solids._iso([-1, -1, 1], false, false, 16, 10);
        expect(iso.length).toBe(18); // two boxes, 9 visible edges each
    });

    it('hides a curve where a solid stands in front of it', async () =>
    {
        // A line running through the middle of a box, seen down -Y so the box
        // is squarely in front of the line's midsection.
        const box = Mesh.Box(100, 100, 100);
        const line = Curve.Line([-300, 0, 0], [300, 0, 0]);
        const scene = new ShapeCollection<any>(box, line);

        const iso = scene._iso([0, -1, 0], true, false, 16, 10);
        const hidden = iso.group('hidden');

        // Some part of the line must come back hidden — the box is in the way.
        expect(hidden?.length ?? 0).toBeGreaterThan(0);
        await save(OUTPUT_DIR + 'occluded-line.svg', iso.toSVG());
    });

    it('projects a collection made only of curves', () =>
    {
        // No solids at all: nothing to occlude, everything survives.
        const scene = Mesh.Box(100, 100, 100).wireframe();
        const iso = scene._iso([-1, -1, 1], false, false, 16, 10);
        expect(iso.length).toBeGreaterThan(0);
    });

    it('carries linear shapes under every strategy', async () =>
    {
        for (const strategy of ALL_STRATEGIES)
        {
            const scene = new ShapeCollection<any>(
                Mesh.Box(100, 100, 100),
                Mesh.Box(60, 60, 60).move(200).wireframe().dashed(),
            );
            const iso = scene._iso([-1, -1, 1], false, false, 16, 10, { strategy });
            expect(dashedCount(iso), `${strategy}: wireframe missing`).toBeGreaterThan(0);
            await save(OUTPUT_DIR + `mixed.${strategy}.svg`, iso.toSVG());
        }
    });
});

describe('isometry: style inheritance', () =>
{
    it('carries a per-shape colour when the strategy keeps provenance', () =>
    {
        // 'clip' projects each shape separately, so each one's colour is known.
        const scene = new ShapeCollection<any>(
            Mesh.Box(100, 100, 100).color('red'),
            Mesh.Box(100, 100, 100).move(300).color('green'),
        );
        const iso = scene._iso([-1, -1, 1], false, false, 16, 10, { strategy: 'clip' });
        const found = colours(iso);
        expect(found.has('#ff0000')).toBe(true);
        expect(found.has('#008000')).toBe(true);
    });

    it('applies a shared colour on the merged path, and no colour when they differ', () =>
    {
        // Merging destroys provenance. When every mesh agrees there is still
        // only one right answer...
        const same = new ShapeCollection<any>(
            Mesh.Box(100, 100, 100).color('red'),
            Mesh.Box(100, 100, 100).move(300).color('red'),
        );
        expect(colours(same._iso([-1, -1, 1], false, false, 16, 10)).has('#ff0000')).toBe(true);

        // ...but when they disagree, guessing would be worse than not styling.
        const mixed = new ShapeCollection<any>(
            Mesh.Box(100, 100, 100).color('red'),
            Mesh.Box(100, 100, 100).move(300).color('green'),
        );
        expect(colours(mixed._iso([-1, -1, 1], false, false, 16, 10)).size).toBe(0);
    });
});

describe('Shape.resetStyle', () =>
{
    it('clears styling back to the defaults', () =>
    {
        const box = Mesh.Box(10, 10, 10).color('blue');
        expect(box.style.explicitData().color).toBeDefined();

        box.resetStyle();
        // Not merely set back to the default value — no longer explicitly set,
        // so it contributes nothing to the scene's style cascade.
        expect(box.style.explicitData().color).toBeUndefined();
        expect(Object.keys(box.style.explicitData()).length).toBe(0);
    });

    it('clears styling across a collection', () =>
    {
        const col = new ShapeCollection<any>(
            Mesh.Box(10, 10, 10).color('blue'),
            Mesh.Box(10, 10, 10).color('red'),
        );
        col.resetStyle();
        col.toArray().forEach((s: any) =>
            expect(Object.keys(s.style.explicitData()).length).toBe(0));
    });

    it('stops a reset shape from colouring its projection', () =>
    {
        const scene = new ShapeCollection<any>(
            Mesh.Box(100, 100, 100).color('red').resetStyle(),
            Mesh.Box(100, 100, 100).move(300).color('red').resetStyle(),
        );
        expect(colours(scene._iso([-1, -1, 1], false, false, 16, 10)).size).toBe(0);
    });
});
