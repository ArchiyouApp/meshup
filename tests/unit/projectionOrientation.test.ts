/**
 * Projections are views, not mirror images.
 *
 * A drawing made from camera direction `c` (from the model toward the viewer) lies on Z=0 and is
 * looked at from +Z. With R and U the 3D directions that end up as screen right and screen up,
 * the direction toward the viewer is R x U, and that must be `c`. A mirror image gives -c: the
 * drawing is then the view from the other side, flipped.
 *
 * BUG (fixed 2026-10-08): `Mesh.isometry`, `Mesh.elevation`, `Mesh.section` and their
 * ShapeCollection counterparts handed `_flattenProjectionToScreen` the plane normal reversed,
 * pointing away from the viewer; and when the up vector landed upside down the flatten turned it
 * 180° around X, which is a mirror too. The two cancelled for the front elevation (and a section
 * from the front), so those looked right while top, left, right, back, every isometry of a single
 * mesh, and floor-plan sections came out mirrored. Only `ShapeCollection.iso()` had the reversal
 * removed ("Now works. TODO: check why").
 *
 * The frame is read through `toScreen()`, the transform the projection records, so the test needs
 * no knowledge of which line is which.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Mesh, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

type V3 = [number, number, number];

const VIEWS: Record<string, V3> = {
    front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1],
};
const CAMS: Array<V3> = [[-1, -1, 1], [0, 1, 0], [1, -1, 1], [1, 1, 1], [-1, 1, 0.5], [0, 1, 0.5], [0.3, 1, 0], [0, -1, -0.5], [2, -0.5, 0.25]];

const normalize = (v: V3): V3 => { const l = Math.hypot(...v); return v.map(x => x / l) as V3; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Screen right R and up U as 3D directions, read from the transform the projection recorded */
function screenFrame(drawing: ShapeCollection<any>): { right: V3; up: V3 }
{
    const o = drawing.toScreen([0, 0, 0]);
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(a => drawing.toScreen(a as V3));
    expect(o).not.toBeNull();
    return {
        right: axes.map(p => p!.x - o!.x) as V3,
        up: axes.map(p => p!.y - o!.y) as V3,
    };
}

/** The drawing is the view from `cam`: R x U points at the viewer, and world-up is up unless
 *  looking straight down or up */
function expectViewFrom(drawing: ShapeCollection<any>, cam: V3): void
{
    const c = normalize(cam);
    const { right, up } = screenFrame(drawing);
    expect(dot(cross(right, up), c)).toBeCloseTo(1, 6);
    if (Math.abs(c[2]) < 0.999) { expect(up[2]).toBeGreaterThan(0); }
}

/** One asymmetric mesh, and the same split in three for the collection paths */
const single = () => Mesh.BoxBetween([0, 0, 0], [300, 150, 10]);
const several = () => new ShapeCollection([
    Mesh.BoxBetween([0, 0, 0], [300, 150, 10]),
    Mesh.BoxBetween([0, 0, 0], [20, 20, 200]),
    Mesh.BoxBetween([240, 100, 10], [300, 150, 80]),
]);

describe('projection orientation: a view, never a mirror image', () =>
{
    describe('elevation(view)', () =>
    {
        Object.entries(VIEWS).forEach(([name, cam]) =>
        {
            it(`Mesh: ${name}`, () => expectViewFrom(single().elevation(name as any), cam));
            it(`ShapeCollection: ${name}`, () => expectViewFrom(several().elevation(name as any), cam));
        });
    });

    describe('iso(cam)', () =>
    {
        CAMS.forEach(cam =>
        {
            it(`Mesh.isometry ${cam}`, () => expectViewFrom(single().isometry(cam), cam));
            it(`ShapeCollection.iso ${cam}`, () => expectViewFrom(several().iso(cam), cam));
        });
    });

    describe('project(view)', () =>
    {
        Object.entries(VIEWS).forEach(([name, cam]) =>
            it(`ShapeCollection: ${name}`, () => expectViewFrom(several().project(name as any), cam)));
    });

    describe('section(pivot, normal): the viewer looks along -normal', () =>
    {
        it('Mesh: a floor plan is seen from above, x to the right and y up', () =>
        {
            const plan = single().section([0, 0, 5], [0, 0, 1]);
            expectViewFrom(plan, [0, 0, 1]);
            const { right, up } = screenFrame(plan);
            expect(right[0]).toBeCloseTo(1, 6);
            expect(up[1]).toBeCloseTo(1, 6);
        });
        it('ShapeCollection: a floor plan is seen from above', () => expectViewFrom(several().section([0, 0, 5], [0, 0, 1]), [0, 0, 1]));
        it('ShapeCollection: a section seen from the front', () => expectViewFrom(several().section([0, 75, 0], [0, -1, 0]), [0, -1, 0]));
        it('ShapeCollection: a section seen from the back', () => expectViewFrom(several().section([0, 75, 0], [0, 1, 0]), [0, 1, 0]));
    });
});
