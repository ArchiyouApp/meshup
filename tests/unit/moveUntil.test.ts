/**
 * moveUntil(): move a shape along a direction until it touches another, on the true shapes.
 *
 * Placing a part against a tilted one used to mean working out the angles: a crossbar under a
 * sloping seat, a bar behind a leaning back board. moveUntil() measures instead (conservative
 * advancement on the exact mesh distance), so a script can say "this bar goes up until it meets
 * the seat".
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

/** A seat board 500 x 450 x 15, tilted back 12° about its front-top edge, front-top edge at z 400 */
const seat = () => Mesh.BoxBetween([-250, 0, -15], [250, 450, 0]).rotateX(-12, [0, 0, 0]).moveZ(400);
/** A crossbar 560 x 30 x 30 at y 100..130, on the floor */
const bar = () => Mesh.BoxBetween([-280, 100, 0], [280, 130, 30]);

const overlap = (a: Mesh, b: Mesh) => a.intersection(b)?.volume() ?? 0;

describe('moveUntil()', () =>
{
    it('pushes a bar up under a tilted seat until it touches the underside', () =>
    {
        const s = seat(), b = bar();
        b.moveUntil(s, 'up');
        // The underside above the bar's back edge (y 130): 385.33 - 0.21256 * (130 + 3.119)
        const theta = 12 * Math.PI / 180;
        const yFront = 15 * Math.sin(theta);                    // the underside's front edge moved forward
        const expected = 400 - 15 * Math.cos(theta) - (130 + yFront) * Math.tan(theta);
        expect(b.bbox()!.max().z).toBeCloseTo(expected, 4);
        expect(b.distance(s)).toBeLessThan(1e-4);
        expect(overlap(b, s)).toBeLessThan(1e-3);
        expect([b.bbox()!.min().x, b.bbox()!.min().y]).toEqual([-280, 100]);  // only moved up
    });

    it('slides a bar forward against a leaning board', () =>
    {
        // A back board leaning back 26°, its foot at y 300; a bar under the arms behind it
        const back = Mesh.BoxBetween([-200, -12, 0], [200, 0, 800]).rotateX(-26, [0, 0, 0]).move(0, 300, 100);
        const top = Mesh.BoxBetween([-280, 900, 500], [280, 930, 530]);
        top.moveUntil(back, 'front');
        expect(top.distance(back)).toBeLessThan(1e-4);
        expect(overlap(top, back)).toBeLessThan(1e-3);
        expect(top.bbox()!.min().y).toBeGreaterThan(300);     // stopped against the board, behind its foot
    });

    it('stops `gap` short, and takes a vector as well as a word', () =>
    {
        const floor = Mesh.BoxBetween([-500, -500, -10], [500, 500, 0]);
        const a = Mesh.BoxBetween([0, 0, 200], [100, 100, 218]).moveUntil(floor, 'down', 5);
        const b = Mesh.BoxBetween([0, 0, 200], [100, 100, 218]).moveUntil(floor, [0, 0, -2], 5);
        expect(a.bbox()!.min().z).toBeCloseTo(5, 6);
        expect(b.bbox()!.min().z).toBeCloseTo(5, 6);
    });

    it('throws when it would never touch, and leaves the shape where it was', () =>
    {
        const s = seat();
        const aside = Mesh.BoxBetween([400, 100, 0], [460, 130, 30]);  // beside the seat, not under it
        expect(() => aside.moveUntil(s, 'up')).toThrow(/never touches the other shape \(they pass each other\)/);
        expect(aside.bbox()!.min().z).toBe(0);
        const above = Mesh.BoxBetween([-280, 100, 500], [280, 130, 530]);
        expect(() => above.moveUntil(s, 'up')).toThrow(/that lies behind it/);
        expect(() => bar().moveUntil(s, 'sideways')).toThrow(/give a direction/);
    });

    it('leaves a shape that already touches where it is', () =>
    {
        const floor = Mesh.BoxBetween([-500, -500, -10], [500, 500, 0]);
        const box = Mesh.BoxBetween([0, 0, 0], [100, 100, 100]).moveUntil(floor, 'down');
        expect(box.bbox()!.min().z).toBe(0);
    });

    it('moves a collection as one until its first shape touches; stops at the first of several others', () =>
    {
        const floor = Mesh.BoxBetween([-500, -500, -10], [500, 500, 0]);
        const pair = new ShapeCollection([
            Mesh.BoxBetween([0, 0, 300], [100, 100, 400]),
            Mesh.BoxBetween([200, 0, 250], [300, 100, 350]),    // the lower one lands first
        ]).moveUntil(floor, 'down');
        expect(pair.bbox()!.min().z).toBeCloseTo(0, 6);
        expect(pair.toArray()[0].bbox()!.min().z).toBeCloseTo(50, 6);

        const steps = new ShapeCollection([Mesh.BoxBetween([0, 0, 0], [100, 100, 50]), Mesh.BoxBetween([0, 0, 0], [100, 100, 120]).move(300, 0, 0)]);
        const plate = Mesh.BoxBetween([-50, -50, 400], [450, 150, 410]).moveUntil(steps, 'down');
        expect(plate.bbox()!.min().z).toBeCloseTo(120, 6);  // on the taller one
    });
});
