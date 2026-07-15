import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { initAsync, Sketch, Curve, Mesh, ShapeCollection, HERSHEY_FONTS } from '../../src/index';
import { save } from '../../src/utils';

const OUTPUT_DIR = './tests/outputs/text/';
const ttf = () => new Uint8Array(readFileSync('./rust/asar.ttf'));

beforeAll(async () =>
{
    await initAsync();
});

describe('Example: native text', () =>
{
    it('renders TTF outline text as closed curves (with counters) and exports SVG', async () =>
    {
        const curves = Sketch.textOutline('Archiyou', { font: ttf(), size: 20 });
        // Letters with counters (A, o, u) contribute holes → more rings than letters
        expect(curves.count()).toBeGreaterThan('Archiyou'.length);
        expect(curves.toArray().every(c => c instanceof Curve)).toBe(true);
        expect(curves.toArray().some(c => c.isClosed())).toBe(true);
        await save(OUTPUT_DIR + 'outline.svg', curves.toSVG());
    });

    it('extrudes outline text into a solid mesh preserving counters', () =>
    {
        const mesh = Sketch.textSolid('Ao', { font: ttf(), size: 20, depth: 3 });
        expect(mesh).toBeInstanceOf(Mesh);
        const bb = mesh.bbox();
        expect(bb.max().z - bb.min().z).toBeCloseTo(3, 1);
        expect(bb.width()).toBeGreaterThan(0);
    });

    it('renders single-stroke Hershey text as open line curves and exports SVG', async () =>
    {
        const curves = Sketch.textStroke('CNC', { font: 'sans', size: 6 });
        expect(curves.count()).toBeGreaterThan(0);
        expect(curves.toArray().every(c => !c.isClosed())).toBe(true); // strokes stay open
        await save(OUTPUT_DIR + 'stroke.svg', curves.toSVG());
    });

    it('supports every bundled Hershey font', () =>
    {
        for (const name of Object.keys(HERSHEY_FONTS))
        {
            const curves = Sketch.textStroke('Ab', { font: name, size: 5 });
            expect(curves.count(), `font ${name}`).toBeGreaterThan(0);
        }
    });

    it('aligns text: center is symmetric about x=0, right ends at x≈0', () =>
    {
        const c = Sketch.textOutline('HELLO', { font: ttf(), size: 20, align: 'center' });
        const bb = c.bbox()!;
        expect(bb.minX() + bb.width() / 2).toBeCloseTo(0, 2);

        const r = Sketch.textOutline('HELLO', { font: ttf(), size: 20, align: 'right' });
        const rb = r.bbox()!;
        expect(rb.minX() + rb.width()).toBeCloseTo(0, 2);
    });

    it('lays out spaces and advances with real metrics', () =>
    {
        const withSpace = Sketch.textOutline('A A', { font: ttf(), size: 20 });
        const noSpace = Sketch.textOutline('AA', { font: ttf(), size: 20 });
        // The space must widen the run.
        expect(withSpace.bbox()!.width()).toBeGreaterThan(noSpace.bbox()!.width());
    });

    it('exports a solid-text scene to GLTF', async () =>
    {
        const mesh = Sketch.textSolid('3D', { font: ttf(), size: 20, depth: 2 });
        await save(OUTPUT_DIR + 'solid.gltf', await new ShapeCollection(mesh).toGLTF());
    });
});
