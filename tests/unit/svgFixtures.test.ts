/**
 * SVG import against files on disk.
 *
 * The other SVG tests build their input as inline strings, which keeps them readable but
 * means every one of them is written the way meshup itself would write it. These read real
 * files instead: `basic/` is hand-authored with its expected geometry documented in each
 * file, and `feather/` is ten unmodified MIT-licensed icons — files produced by a tool, in
 * a tool's formatting, that nobody here wrote to suit the parser.
 *
 * See tests/fixtures/svg/README.md for what each fixture covers and why these two sets.
 */

import { beforeAll, describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Curve, Importer, initAsync } from '../../src/index';

const FIXTURES = join(__dirname, '../fixtures/svg');
const basic = (name: string) => readFileSync(join(FIXTURES, 'basic', name), 'utf8');

beforeAll(async () =>
{
    await initAsync();
});

/** Import a fixture and return its curves, failing loudly on any warning. */
function importClean(svg: string): Curve[]
{
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) =>
    {
        warnings.push(String(m));
    });
    try
    {
        const curves = Importer.fromSVG(svg).toArray() as Curve[];
        expect(warnings).toEqual([]);
        return curves;
    }
    finally { spy.mockRestore(); }
}

describe('SVG fixtures: basic shapes', () =>
{
    it('reads each <line> as its own open curve', () =>
    {
        const curves = importClean(basic('lines.svg'));
        expect(curves.length).toBe(3);
        curves.forEach(c =>
        {
            expect(c.isClosed()).toBe(false);
            expect(c.segmentCount()).toBe(1);
            expect(c.hasArcs()).toBe(false);
        });
        expect(curves[0].length()).toBeCloseTo(100, 9);
        expect(curves[1].length()).toBeCloseTo(60, 9);
        expect(curves[2].length()).toBeCloseTo(50, 9);
    });

    it('reads an open polyline', () =>
    {
        const [c] = importClean(basic('polyline-open.svg'));
        expect(c.isClosed()).toBe(false);
        expect(c.segmentCount()).toBe(3);
        expect(c.length()).toBeCloseTo(20 + Math.hypot(20, 30) + 20, 9);
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(60, 9);
        expect(bb.depth()).toBeCloseTo(30, 9);
    });

    it('reads a closed polygon, with exact perimeter and area', () =>
    {
        const [c] = importClean(basic('polygon-closed.svg'));
        expect(c.isClosed()).toBe(true);
        expect(c.segmentCount()).toBe(3);
        // A 3-4-5 triangle, chosen so both numbers are exact.
        expect(c.length()).toBeCloseTo(12, 9);
        expect(Math.abs(c.area()!)).toBeCloseTo(6, 9);
    });

    it('reads a sharp rect as four lines', () =>
    {
        const [c] = importClean(basic('rect-sharp.svg'));
        expect(c.isClosed()).toBe(true);
        expect(c.segmentCount()).toBe(4);
        expect(c.hasArcs()).toBe(false);
        expect(c.length()).toBeCloseTo(2 * (60 + 40), 9);
        expect(Math.abs(c.area()!)).toBeCloseTo(60 * 40, 9);
    });

    it('reads a rounded rect as four sides and four arcs', () =>
    {
        const [c] = importClean(basic('rect-rounded.svg'));
        expect(c.isClosed()).toBe(true);
        expect(c.hasArcs()).toBe(true);
        expect(c.segmentCount()).toBe(8);

        // rx given, ry absent: the spec says ry takes rx's value, so the corners are
        // circular quarter turns of radius 8 — not ellipses, and not squared off.
        const arcs = c.spanParams().filter(s => s.kind === 'arc');
        expect(arcs.length).toBe(4);
        arcs.forEach(a =>
        {
            if (a.kind !== 'arc') { return; }
            expect(a.radius).toBeCloseTo(8, 9);
            expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI / 2, 9);
        });

        // Rounding the corners takes area off the rectangle but leaves its extent.
        const bb = c.bbox()!;
        expect(bb.width()).toBeCloseTo(60, 9);
        expect(bb.depth()).toBeCloseTo(40, 9);
        // 4 corners of radius r remove r^2*(4 - pi) between them.
        expect(Math.abs(c.area()!)).toBeCloseTo(60 * 40 - 64 * (4 - Math.PI), 9);
    });

    it('reads absolute and relative path commands to the same geometry', () =>
    {
        const [abs] = importClean(basic('path-absolute.svg'));
        const [rel] = importClean(basic('path-relative.svg'));

        for (const c of [abs, rel])
        {
            expect(c.isClosed()).toBe(true);
            expect(c.segmentCount()).toBe(4);
            expect(c.length()).toBeCloseTo(2 * (40 + 30), 9);
            expect(Math.abs(c.area()!)).toBeCloseTo(40 * 30, 9);
        }
        // H/V and h/v describe the same rectangle; nothing about the phrasing survives.
        expect(rel.bbox()!.min().x).toBeCloseTo(abs.bbox()!.min().x, 9);
        expect(rel.bbox()!.min().y).toBeCloseTo(abs.bbox()!.min().y, 9);
    });

    it('splits a multi-subpath d into separate curves', () =>
    {
        const curves = importClean(basic('path-subpaths.svg'));
        expect(curves.length).toBe(2);
        curves.forEach(c => expect(c.isClosed()).toBe(true));
        const areas = curves.map(c => Math.abs(c.area()!)).sort((a, b) => a - b);
        expect(areas[0]).toBeCloseTo(400, 9);   // inner 20 x 20
        expect(areas[1]).toBeCloseTo(1600, 9);  // outer 40 x 40
    });

    it('composes nested group transforms with an element transform', () =>
    {
        const [c] = importClean(basic('group-transform.svg'));
        const bb = c.bbox()!;
        expect(bb.min().x).toBeCloseTo(106, 9);   // 100 + 5 + 1
        expect(bb.min().y).toBeCloseTo(52, 9);    // 50 + 0 + 2
        expect(bb.width()).toBeCloseTo(10, 9);
        expect(bb.depth()).toBeCloseTo(10, 9);
    });

    it('applies a raw matrix() transform', () =>
    {
        const [c] = importClean(basic('transform-matrix.svg'));
        const bb = c.bbox()!;
        // A quarter turn takes the horizontal line to a vertical one of the same length.
        expect(c.length()).toBeCloseTo(20, 9);
        expect(bb.width()).toBeCloseTo(0, 9);
        expect(bb.depth()).toBeCloseTo(20, 9);
        expect(bb.min().x).toBeCloseTo(50, 9);
        expect(bb.min().y).toBeCloseTo(10, 9);
    });

    it('reads every element type from one document', () =>
    {
        const curves = importClean(basic('mixed-shapes.svg'));
        expect(curves.length).toBe(6);
        expect(curves.filter(c => c.isClosed()).length).toBe(4);  // polygon, rect, circle, path
        expect(curves.filter(c => c.hasArcs()).length).toBe(1);   // the circle
    });

    it('reads circular A commands as real arcs', () =>
    {
        const [c] = importClean(basic('arc-path.svg'));
        expect(c.isClosed()).toBe(true);
        expect(c.hasArcs()).toBe(true);
        expect(c.segmentCount()).toBe(2);        // the半 circle plus its closing diameter
        // Half a circle of radius 20, closed by the diameter.
        expect(c.length()).toBeCloseTo(Math.PI * 20 + 40, 6);
        expect(Math.abs(c.area()!)).toBeCloseTo((Math.PI * 400) / 2, 6);
    });
});

describe('SVG fixtures: real-world line-work icons (feather, MIT)', () =>
{
    const files = readdirSync(join(FIXTURES, 'feather')).filter(f => f.endsWith('.svg')).sort();

    it('has the icons on disk', () =>
    {
        expect(files.length).toBeGreaterThanOrEqual(10);
    });

    files.forEach(file =>
    {
        it(`imports ${file} without warnings`, () =>
        {
            const svg = readFileSync(join(FIXTURES, 'feather', file), 'utf8');
            const curves = importClean(svg);

            expect(curves.length).toBeGreaterThan(0);
            curves.forEach(c =>
            {
                // Finite, non-degenerate geometry — the bar these files have to clear.
                // Their exact span counts are upstream data and deliberately not pinned.
                const bb = c.bbox()!;
                expect(Number.isFinite(bb.width())).toBe(true);
                expect(Number.isFinite(bb.depth())).toBe(true);
                expect(c.length()).toBeGreaterThan(0);
                expect(Number.isFinite(c.length())).toBe(true);
                expect(c.segmentCount()).toBeGreaterThan(0);
                // Feather draws on a 24 x 24 viewBox and the importer keeps user units.
                expect(bb.min().x).toBeGreaterThanOrEqual(-1);
                expect(bb.max().x).toBeLessThanOrEqual(25);
            });
        });
    });

    it('keeps the arcs in an icon that has them', () =>
    {
        // git-merge is two circles and a path whose corner is an `a` command.
        const curves = importClean(
            readFileSync(join(FIXTURES, 'feather', 'git-merge.svg'), 'utf8'));
        expect(curves.filter(c => c.hasArcs()).length).toBeGreaterThanOrEqual(3);
    });

    it('reads the rounded square as arcs, not as a squared-off box', () =>
    {
        const [c] = importClean(readFileSync(join(FIXTURES, 'feather', 'square.svg'), 'utf8'));
        expect(c.hasArcs()).toBe(true);
        expect(c.segmentCount()).toBe(8);
    });

    it('reads a plain polyline icon as pure line work', () =>
    {
        const curves = importClean(
            readFileSync(join(FIXTURES, 'feather', 'trending-up.svg'), 'utf8'));
        expect(curves.every(c => !c.hasArcs())).toBe(true);
    });
});
