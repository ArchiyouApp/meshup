/**
 * A section shows what lies beyond the cut, never what is on the viewer's side of it.
 *
 * BUG (fixed 2026-11-05): `project_edges_section` sliced the mesh for the cut lines, then projected
 * the edges of the whole, uncut mesh. A floor plan at z=1500 drew the roof above it: its outline
 * and its ridge. Every path did it — a single mesh, meshes merged into one, meshes styled apart.
 * The mesh (and every occluder) is now split by the plane, the near half dropped and the cut
 * closed with a cap.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initAsync } from '../../src/index';
import { Solid } from '../../src/Solid';
import { ShapeCollection } from '../../src/ShapeCollection';

beforeAll(async () =>
{
    await initAsync();
});

type Segment = [[number, number], [number, number]];

/** Every straight piece of every line in a group, in drawing coordinates */
function segments(drawing: ShapeCollection<any>, group: string): Array<Segment>
{
    const col = drawing.groupNames().includes(group) ? drawing.group(group) : undefined;
    return (col?.toArray() ?? []).flatMap((curve: any) =>
    {
        const pts = curve.points().map((p: any) => [p.x, p.y] as [number, number]);
        return pts.slice(1).map((p: [number, number], i: number) => [pts[i], p] as Segment);
    });
}

function extent(drawing: ShapeCollection<any>): [number, number]
{
    const bb = drawing.bbox()!;
    return [bb.max().x - bb.min().x, bb.max().y - bb.min().y];
}

/** A 100 x 100 block from z=50 to 150 on a 20 x 20 leg, as one mesh */
const onLeg = () => Solid.BoxBetween([-50, -50, 50], [50, 50, 150])
    .union(Solid.BoxBetween([-10, -10, 0], [10, 10, 50]));

/** A 40 x 40 post up to z=100, and a 200 x 200 slab floating above it at z=300 */
const postAndSlab = () => [
    Solid.BoxBetween([-20, -20, 0], [20, 20, 100]),
    Solid.BoxBetween([-100, -100, 300], [100, 100, 320]),
];

describe('section: nothing on the viewer side of the cut', () =>
{
    it('a single mesh: an overhang above the cut is not drawn', () =>
    {
        // wide top on a narrow stem: cut through the stem, the top is above the cut
        const mushroom = Solid.BoxBetween([-10, -10, 0], [10, 10, 100])
            .union(Solid.BoxBetween([-60, -60, 100], [60, 60, 120]));
        const plan = mushroom.section([0, 0, 50]);
        expect(extent(plan)[0]).toBeCloseTo(20, 3);
        expect(extent(plan)[1]).toBeCloseTo(20, 3);
        expect(segments(plan, 'cut').length).toBeGreaterThan(0);
    });

    it('a mesh wholly above the cut is left out, merged with the rest', () =>
    {
        const plan = new ShapeCollection(...postAndSlab()).section([0, 0, 50]);
        expect(extent(plan)[0]).toBeCloseTo(40, 3);
        expect(extent(plan)[1]).toBeCloseTo(40, 3);
    });

    it('a mesh wholly above the cut is left out, styled apart (and hides nothing)', () =>
    {
        const [post, slab] = postAndSlab();
        const plan = new ShapeCollection(post.color('red'), slab.color('blue')).section([0, 0, 50]);
        expect(extent(plan)[0]).toBeCloseTo(40, 3);
        expect(segments(plan, 'cut').length).toBeGreaterThan(0);
    });

    it('only a mesh above the cut: an empty drawing', () =>
    {
        const plan = new ShapeCollection(postAndSlab()[1]).section([0, 0, 50]);
        expect(plan.toArray().length).toBe(0);
    });

    it('the cut is the same, and nothing is drawn inside it', () =>
    {
        const plan = onLeg().section([0, 0, 100]);
        const cut = segments(plan, 'cut');
        const xs = cut.flatMap(s => [s[0][0], s[1][0]]);
        const ys = cut.flatMap(s => [s[0][1], s[1][1]]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 3);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 3);

        // the leg below is hidden under the cut block: no line runs through the cut region
        const [cx, cy] = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
        const inside = (p: [number, number]) => Math.abs(p[0] - cx) < 45 && Math.abs(p[1] - cy) < 45;
        const through = ['visible', 'outline'].flatMap(g => segments(plan, g))
            .filter(s => inside([(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]));
        expect(through).toEqual([]);
    });

    it('a section still works from the side (no cap there, nothing lost)', () =>
    {
        const side = onLeg().section([0, 0, 0], [0, -1, 0]);
        expect(side.toArray().length).toBeGreaterThan(0);
    });
});
