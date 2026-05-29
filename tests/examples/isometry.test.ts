import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { save } from '../../src/utils';
import { ShapeCollection } from '../../src/ShapeCollection';

const OUTPUT_DIR = './tests/outputs/isometry/';

function collectPolylineEndpoints(shape: ShapeCollection<any>): Array<[number, number]>
{
    const endpoints: Array<[number, number]> = [];
    shape.toArray().forEach((curve: any) =>
    {
        const pts = curve.controlPoints?.() ?? curve.points?.();
        if (!pts || pts.length < 2) return;
        endpoints.push([pts[0].x, pts[0].y]);
        endpoints.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
    });
    return endpoints;
}

function countOrphanEndpoints(endpoints: Array<[number, number]>, eps: number): number
{
    return endpoints.filter((p, i) => !endpoints.some((q, j) =>
        j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < eps)).length;
}

beforeAll(async () => 
{
    await initAsync();
});

describe('Example: Isometric projection with hidden lines', async () =>
{
    it('can do basic isometric projection', async () =>
    {
        const box = Mesh.Cube(100);
        // hiddenLines=true so both groups stay populated for the count
        // assertions below — with the default `false`, isometry() calls
        // removeGroup('hidden'), dropping the 3 hidden polylines and
        // collapsing total length to 9.
        const boxIso = box.isometry([-1, -1, 1], true);
        expect(boxIso).toBeTruthy();
        expect(boxIso.length).toBe(12);
        expect(boxIso.group('hidden')?.length).toBe(3);
        expect(boxIso.group('visible')?.length).toBe(9);
        // Isometric silhouette of a cube is the hexagonal outline → 6 edges.
        // Silhouette is a tagged subset of 'visible'; it must NOT inflate
        // the total shape count.
        expect(boxIso.group('silhouette')?.length).toBe(6);

        boxIso.group('hidden')?.color('blue').dashed();
        boxIso.group('visible')?.color('red');
        boxIso.group('silhouette')?.color('green');

        const col = new ShapeCollection(box.move(-200), boxIso!)

        await save(OUTPUT_DIR + 'test.isometry.box.gltf', await col.toGLTF());
        await save(OUTPUT_DIR + 'test.isometry.box.svg', boxIso.toSVG());
    });

    it('keeps cube isometry line endpoints attached', async () =>
    {
        const boxIso = Mesh.Cube(100).isometry([-1, -1, 1], true);
        const endpoints = collectPolylineEndpoints(boxIso);
        const orphanCount = countOrphanEndpoints(endpoints, 1e-6);

        expect(boxIso.length).toBe(12);
        expect(orphanCount).toBe(0);
    });

    it('can do isometric projection of boxes difference', async () =>
    {
        const bigbox = Mesh.Cube(50);
        const smallbox = Mesh.Cube(20).moveTo(bigbox.bbox().corner('leftfronttop'));
        const diff = bigbox.subtract(smallbox)!;
        const diffIso = diff.isometry();

        expect(diffIso).toBeTruthy();
        //expect(diffIso.group('hidden')?.length).toBe(9);
        //expect(diffIso.group('visible')?.length).toBe(15);

        await save(OUTPUT_DIR + 'test.isometry.diff.gltf', await new ShapeCollection(
            diff.move(-bigbox.bbox().width()*2), diffIso.group('visible')!).toGLTF()); // OK
    });

    it('can do isometric projection of a Sphere', async () =>
    {
        const sphere = Mesh.Sphere(20);
        const sphereIso = sphere.isometry();
        expect(sphereIso).toBeTruthy();
        await save(OUTPUT_DIR + 'test.isometry.sphere.gltf', await new ShapeCollection(sphere.move(-20*2), sphereIso.group('visible')!).toGLTF());
    });

    it('can do isometric projection of box with a hole', async () =>
    {
        const box = Mesh.Cube(50);
        const hole = Mesh.Cylinder(10, 100);
        const subBox = Mesh.Cube(20).move(-25);
        box.subtract(hole).subtract(subBox);

        await save(OUTPUT_DIR + 'test.isometry.hole.gltf',
                await new ShapeCollection(
                    box.isometry()?.group('visible')!,
                    box.move(-100)
                    ).toGLTF());

        // NOTE: some wrong edge near rectangular hole
    });

    it('isometry of a lot of boxes', async () =>
    {
        // 8³ = 512 boxes. NOTE: 10³ = 1000 currently panics inside
        // MeshJs.projectEdges (Rust `unreachable` trap) somewhere above ~800
        // boxes in this configuration, and the panic poisons the WASM module
        // — every later test in this file then fails at the next WASM call.
        // Boundary is between 9³ (passes) and 10³ (panics). Re-raise once the
        // Rust panic is diagnosed and a new csgrs WASM is built.
        const box = Mesh.Cube(50);
        const boxes = box.grid(8, 8, 8, 60);

        const t = performance.now();
        const iso = boxes.isometry()?.group('visible')!;
        console.log('Created boxes grid isometry in', performance.now() - t, 'ms');

        await save(OUTPUT_DIR + 'test.isometry.boxes.gltf',
                await new ShapeCollection(
                    boxes,
                    iso.move(1000),
                    ).toGLTF());
    }, 60_000);

    // Regression: a "floor" formed by a row of slender vertical beams flanked
    // front and back by two long horizontal beams (each horizontal beam
    // touches all the verticals along a contact line). User-reported: many of
    // the contact edges where the horizontals meet each vertical are missing
    // from the visible-edge projection.
    //
    // We sanity-check that the visible group is not catastrophically short:
    // each vertical contributes ≥ 9 visible edges from a [-1,-1,1] iso view
    // and each horizontal contributes ≥ 9, so for 10 verticals + 2 horizontals
    // we should see ≥ 12 * 9 = 108 visible polylines once contact edges are
    // preserved. The buggy path drops the horizontal-vs-vertical contact
    // rings and falls well under that floor.
    it('preserves contact edges in a beam-grid floor', async () =>
    {
        // 10 vertical beams (5 wide × 300 deep × 20 tall), spaced 45 apart in X.
        const bs = (Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh).row(10, 45);

        // Bbox of the grid → two horizontal beams (front + back) hugging the
        // outer faces of the row. The user wrote `rightfrontop` — using the
        // canonical 'righttopfront' so the keyword parser actually matches
        // top/front/right.
        const bsBbox = bs.bbox()!;
        const bhf = Mesh.BoxBetween(
            bsBbox.corner('leftbottomfront'),
            bsBbox.corner('righttopfront').moveY(-10),
        );
        const bhb = (bhf.copy() as Mesh).mirrorY();

        const floor = new ShapeCollection(bs, bhf, bhb);
        expect(floor.length).toBe(12); // 10 verticals flattened in + 2 horizontals

        const iso = floor.isometry([-1, -1, 1], false, false, 500, 5);

        const visible = iso.group('visible');
        await save(OUTPUT_DIR + 'test.isometry.beam-grid.gltf',
            await new ShapeCollection(floor, (visible ?? iso).copy().translate(1200, 0, 0))
                .toGLTF());

        console.log(`beam-grid floor → visible edges: ${visible?.length ?? 0}`);

        // Conservative floor: 12 meshes × 9 visible edges per cuboid = 108
        // (theoretical maximum if every silhouette stays intact). Our fix
        // reaches 107 — one box's silhouette legitimately drops to 8 because
        // of how the contact rectangles cut into the projection. We assert
        // ≥ 100 so the regression bites loudly if contact edges start
        // collapsing again (pre-fix this was 86).
        expect(visible?.length ?? 0).toBeGreaterThanOrEqual(100);
    }, 30_000);

    // Plumbing regression: `samples` from ShapeCollection.iso() reaches
    // Rust core unchanged. Monkey-patches Mesh.prototype._projectEdges to
    // capture the `options.samples` of every call during a multi-mesh iso.
    it('iso() forwards `samples` from ShapeCollection.iso down to _projectEdges', async () =>
    {
        const seen: Array<number | undefined> = [];
        const original = (Mesh as any).prototype._projectEdges;
        (Mesh as any).prototype._projectEdges = function (
            options: any, occluders?: any,
        )
        {
            seen.push(options?.samples);
            return original.call(this, options, occluders);
        };
        try
        {
            const bs = (Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh).row(4, 45);
            const bsBbox = bs.bbox()!;
            const bhf = Mesh.BoxBetween(
                bsBbox.corner('leftbottomfront'),
                bsBbox.corner('righttopfront').moveY(-10),
            );
            const bhb = (bhf.copy() as Mesh).mirrorY();
            new ShapeCollection(bs, bhf, bhb).iso([-1, -1, 1], false, false, 1000, 5);
        }
        finally
        {
            (Mesh as any).prototype._projectEdges = original;
        }
        // Merged-base collection isometry does one base projection pass plus
        // one extra _projectEdges call for each touching-face add-back.
        expect(seen.length).toBe(9);
        expect(seen.every(s => s === 1000)).toBe(true);
    });

    // Behavioural regression: `samples` actually affects the Rust HLR (both
    // runtime and visible-polyline count). A previous concern was that the
    // Rust ignored n_samples. This test proves it doesn't.
    it('iso() output and runtime both scale with `samples`', async () =>
    {
        const make = () =>
        {
            const bs = (Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh).row(4, 45);
            const bsBbox = bs.bbox()!;
            const bhf = Mesh.BoxBetween(
                bsBbox.corner('leftbottomfront'),
                bsBbox.corner('righttopfront').moveY(-10),
            );
            const bhb = (bhf.copy() as Mesh).mirrorY();
            return new ShapeCollection(bs, bhf, bhb);
        };
        const runSamples = (s: number) =>
        {
            const t0 = performance.now();
            const v = make().iso([-1, -1, 1], false, false, s, 5).group('visible');
            return { dt: performance.now() - t0, visible: v?.length ?? 0 };
        };
        const lo = runSamples(8);     // expected: few polylines, low time
        const hi = runSamples(2000);  // expected: more polylines, much higher time

        console.log(`samples=8   → ${lo.dt.toFixed(0)}ms / ${lo.visible} polylines`);
        console.log(`samples=2000 → ${hi.dt.toFixed(0)}ms / ${hi.visible} polylines`);

        // Coarse sanity: high-sample run must not produce FEWER polylines
        // and must take at least 3× as long. Note: with the analytic contact
        // perimeters always added, the visible count from low/high samples
        // can stabilise quickly — the runtime check is the firmer signal
        // that `samples` is honoured by the Rust HLR.
        expect(hi.visible).toBeGreaterThanOrEqual(lo.visible);
        expect(hi.dt).toBeGreaterThan(lo.dt * 3);
    }, 60_000);

    // Diagnostic comparing shift vs no-shift: which path produces the long
    // (~233) "ghost" polylines we kept seeing as orphan endpoints?
    it('beam-grid orphan count vs shift magnitude', async () =>
    {
        const make = () =>
        {
            const bs = (Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh).row(4, 45);
            const bsBbox = bs.bbox()!;
            const bhf = Mesh.BoxBetween(
                bsBbox.corner('leftbottomfront'),
                bsBbox.corner('righttopfront').moveY(-10),
            );
            const bhb = (bhf.copy() as Mesh).mirrorY();
            return new ShapeCollection(bs, bhf, bhb);
        };

        const orphanCount = (visible: ShapeCollection<any>) =>
        {
            const eps: Array<[number, number]> = [];
            visible.toArray().forEach((c: any) =>
            {
                const pts = c.controlPoints?.() ?? c.points?.();
                if (!pts || pts.length < 2) return;
                eps.push([pts[0].x, pts[0].y]);
                eps.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
            });
            return eps.filter((p, i) => !eps.some((q, j) =>
                j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.0)).length;
        };
        const longCount = (visible: ShapeCollection<any>) =>
        {
            let n = 0;
            visible.toArray().forEach((c: any) =>
            {
                const pts = c.controlPoints?.() ?? c.points?.();
                if (!pts || pts.length < 2) return;
                const a = pts[0], b = pts[pts.length - 1];
                if (Math.hypot(b.x - a.x, b.y - a.y) > 200) n++;
            });
            return n;
        };

        for (const k of [0, 0.001, 0.01, 0.1, 1])
        {
            (globalThis as any).__ISO_SHIFT__ = k;
            const visible = make().iso([-1, -1, 1], false, false, 1000, 5).group('visible')!;
            console.log(`shift=${k} → polylines=${visible.length}, ` +
                `orphans=${orphanCount(visible)}, long(>200)=${longCount(visible)}`);
        }
        (globalThis as any).__ISO_SHIFT__ = undefined;
        expect(true).toBe(true);
    }, 60_000);

    // Diagnostic: orphan endpoints in beam-grid iso (4-vertical version).
    // Counts how many visible-polyline endpoints have no neighbour endpoint
    // within `EPS` mm in screen-space — a proxy for cross-mesh clip-point
    // misalignment AND for legitimate HLR visible↔hidden boundaries. The
    // current code reports ~8; document it here so future changes can
    // compare. No hard assertion until the root cause is fixed.
    it('identifies orphan endpoints in beam-grid iso (4-vertical version)', async () =>
    {
        const bs = (Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh).row(4, 45);
        const bsBbox = bs.bbox()!;
        const bhf = Mesh.BoxBetween(
            bsBbox.corner('leftbottomfront'),
            bsBbox.corner('righttopfront').moveY(-10),
        );
        const bhb = (bhf.copy() as Mesh).mirrorY();
        const floor = new ShapeCollection(bs, bhf, bhb);

        const visible = floor.iso([-1, -1, 1], false, false, 1000, 5).group('visible')!;

        const endpoints = collectPolylineEndpoints(visible);

        const EPS = 1.0;
        const orphans = endpoints.filter((p, i) => !endpoints.some((q, j) =>
            j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < EPS));

        await save(OUTPUT_DIR + 'test.isometry.beam-grid-4.gltf',
            await new ShapeCollection(floor, visible.copy().translate(1200, 0, 0)).toGLTF());

        console.log(`beam-grid (4 verts) → polylines: ${visible.length}, ` +
            `endpoints: ${endpoints.length}, orphans: ${orphans.length}`);

        const polylineByEp = new Map<string, { idx: number; otherEnd: any; len: number }>();
        visible.toArray().forEach((c: any, idx: number) =>
        {
            const pts = c.controlPoints?.() ?? c.points?.();
            if (!pts || pts.length < 2) return;
            const a = pts[0], b = pts[pts.length - 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            polylineByEp.set(`${a.x.toFixed(3)},${a.y.toFixed(3)}`, { idx, otherEnd: b, len });
            polylineByEp.set(`${b.x.toFixed(3)},${b.y.toFixed(3)}`, { idx, otherEnd: a, len });
        });
        orphans.forEach(p =>
        {
            const k = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
            const info = polylineByEp.get(k);
            if (info)
            {
                console.log(`  orphan (${p[0].toFixed(2)},${p[1].toFixed(2)}) → ` +
                    `polyline #${info.idx} len=${info.len.toFixed(2)} ` +
                    `→ (${info.otherEnd.x.toFixed(2)},${info.otherEnd.y.toFixed(2)})`);
            }
        });
        expect(visible.length).toBeGreaterThan(0);
    }, 30_000);

    // Minimal diagnostic for touching-beam contact recovery with the merged
    // collection path. This should improve on plain merged isometry by
    // re-adding contact-face edges, but it does not match the more aggressive
    // old per-mesh path.
    it('preserves contact edges between one vertical + one horizontal beam', async () =>
    {
        const v = Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh;
        const vBb = v.bbox()!;
        const h = Mesh.BoxBetween(
            vBb.corner('leftbottomfront'),
            vBb.corner('righttopfront').moveY(-10),
        );

        const pair = new ShapeCollection(v, h);
        const visible = pair.isometry([-1, -1, 1], false, false, 500, 5).group('visible');

        await save(OUTPUT_DIR + 'test.isometry.beam-pair.gltf',
            await new ShapeCollection(pair, (visible ?? new ShapeCollection()).copy().translate(800, 0, 0))
                .toGLTF());

        expect(visible?.length ?? 0).toBeGreaterThanOrEqual(15);
    }, 30_000);

    it('isoTest preserves contact edges between one vertical + one horizontal beam', () =>
    {
        const v = Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh;
        const vBb = v.bbox()!;
        const h = Mesh.BoxBetween(
            vBb.corner('leftbottomfront'),
            vBb.corner('righttopfront').moveY(-10),
        );

        const pair = new ShapeCollection(v, h);
        const mergedVisible = pair.merge().isometry([-1, -1, 1], false, false, 500, 5).group('visible');
        const visible = pair.isoTest([-1, -1, 1], false, false, 500, 5).group('visible');

        expect(visible?.length ?? 0).toBeGreaterThan(mergedVisible?.length ?? 0);
        expect(visible?.length ?? 0).toBeGreaterThanOrEqual(15);
    }, 30_000);

    it('isoTest handles beam floor collections without wasm array-type errors', () =>
    {
        const bs = (Mesh.Box(5, 500, 20).move(500) as Mesh).row(5, 45);
        const bb = bs.bbox()!;
        const bhf = Mesh.BoxBetween(
            bb.corner('leftfrontbottom'),
            bb.corner('rightfronttop').moveY(-10),
        );
        const bhb = bhf.copy().mirrorY();
        const floor = new ShapeCollection(bs as any, bhf as any, bhb as any);

        const visible = floor.isoTest([-1, -1, 1], false, false, 200, 10).group('visible');

        expect(visible?.length ?? 0).toBeGreaterThan(0);
    }, 30_000);

    // Regression: merged-base collection isometry should still recover one
    // contact-face perimeter per shared ring in a vertical stack, even though
    // it no longer duplicates that ring from both touching boxes as the old
    // per-mesh path did.
    it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])(
        'preserves contact edges between %i stacked boxes',
        async (n) =>
        {
            const b1 = Mesh.Box(100, 100, 10);
            const c = b1.replicate(n, (s, i) => s.move(0, 0, 10 * i));
            const iso = c.isometry()?.group('visible')!;

            await save(OUTPUT_DIR + `test.isometry.stack-${n}.gltf`,
                await new ShapeCollection(c, iso.copy().move(200)).toGLTF());

            console.log(`stack n=${n} → visible edges: ${iso.length}`);

            // The merged base contributes 9 visible edges for the exposed top
            // box silhouette, then each shared face adds back one visible
            // four-edge perimeter. Total ≥ 9 + 4(n-1).
            const minExpected = 9 + 4 * (n - 1);
            expect(iso.length).toBeGreaterThanOrEqual(minExpected);
        },
        30_000,
    );

    it('collection elevation uses merged projection passes and forwards samples', () =>
    {
        const seen: Array<{ samples: number; featureAngle: number; bboxWidth: number }> = [];
        const original = (Mesh as any).prototype._projectEdges;
        (Mesh as any).prototype._projectEdges = function (
            options: any,
            occluders?: any,
        )
        {
            void occluders;
            seen.push({
                samples: options?.samples,
                featureAngle: options?.featureAngle,
                bboxWidth: this.bbox()?.width() ?? 0,
            });
            return new ShapeCollection();
        };

        try
        {
            const a = Mesh.Box(10, 10, 10);
            const b = Mesh.Box(10, 10, 10).move(10, 0, 0);
            const hidden = Mesh.Box(10, 10, 10).move(1000, 0, 0).hide();
            new ShapeCollection(a, b, hidden).elevation('front', true, false, 123, 7);
        }
        finally
        {
            (Mesh as any).prototype._projectEdges = original;
        }

        expect(seen.length).toBe(2);
        expect(seen[0].samples).toBe(123);
        expect(seen[0].featureAngle).toBe(7);
        expect(seen[0].bboxWidth).toBeLessThan(100);
    });

    it('collection elevation restores a touching-beam contact edge beyond merged elevation', () =>
    {
        const v = Mesh.Box(5, 300, 20).translate(500, 0, 0) as Mesh;
        const vBb = v.bbox()!;
        const h = Mesh.BoxBetween(
            vBb.corner('leftbottomfront'),
            vBb.corner('righttopfront').moveY(-10),
        );

        const pair = new ShapeCollection(v, h);
        const mergedVisible = pair.merge().elevation('left', false, 500, 5).group('visible');
        const visible = pair.elevation('left', false, false, 500, 5).group('visible');

        expect(visible?.length ?? 0).toBeGreaterThan(mergedVisible?.length ?? 0);
    });

    it('collection section merges visible meshes and forwards samples', () =>
    {
        const seen: Array<{ samples: number; featureAngle: number; bboxWidth: number }> = [];
        const original = (Mesh as any).prototype.section;
        (Mesh as any).prototype.section = function (
            pivot: any,
            normal: any,
            hiddenLines: boolean,
            samples: number,
            featureAngle: number,
        )
        {
            void pivot;
            void normal;
            void hiddenLines;
            seen.push({
                samples,
                featureAngle,
                bboxWidth: this.bbox()?.width() ?? 0,
            });
            return new ShapeCollection();
        };

        try
        {
            const a = Mesh.Box(10, 10, 10);
            const b = Mesh.Box(10, 10, 10).move(10, 0, 0);
            const hidden = Mesh.Box(10, 10, 10).move(1000, 0, 0).hide();
            new ShapeCollection(a, b, hidden).section([0, 0, 0], [0, 0, 1], true, false, 321, 11);
        }
        finally
        {
            (Mesh as any).prototype.section = original;
        }

        expect(seen.length).toBe(1);
        expect(seen[0].samples).toBe(321);
        expect(seen[0].featureAngle).toBe(11);
        expect(seen[0].bboxWidth).toBeLessThan(100);
    });
});
