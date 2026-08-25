/**
 * Faces in SVG output.
 *
 * A drawing made with flatten() is a collection of MESHES, not curves — flatten keeps the
 * faces aligned with an axis and collapses them onto the plane. The SVG exporters only ever
 * looked at curves(), so `collection(box(...), box(...)).flatten().toSVG()` answered with the
 * "no curves" placeholder: the geometry was there, drawable and flat, and simply never asked.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { Curve, Mesh, Polygon, ShapeCollection, initAsync } from '../../src/index';

beforeAll(async () =>
{
    await initAsync();
});

describe('Polygon.toSVGElem', () =>
{
    it('writes a face as a <polygon>, with y flipped for SVG', () =>
    {
        const poly = new Polygon([[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 20, 0]]);
        const elem = poly.toSVGElem('line', { omitDefaults: true });

        expect(elem).toBe('<polygon points="0,0 10,0 10,-20 0,-20" class="line"/>');
    });

    it('writes a face with holes as one even-odd <path>', () =>
    {
        // Two elements would let the hole be filled in as solid as its parent the moment the
        // face carries a fill — evenodd on a single path is what actually makes it a hole.
        const poly = new Polygon([[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]]);
        poly.addHole([[40, 40, 0], [60, 40, 0], [60, 60, 0], [40, 60, 0]]);

        const elem = poly.toSVGElem('line', { omitDefaults: true });
        expect(elem).toMatch(/^<path d="M0 0 L100 0 L100 -100 L0 -100 Z M/);
        expect(elem).toContain('fill-rule="evenodd"');
    });

    it('only claims to be flat on XY when it is', () =>
    {
        expect(new Polygon([[0, 0, 5], [10, 0, 5], [10, 10, 5]]).isFlatOnXY()).toBe(true);
        // A wall: planar, is2D() by any measure, and nothing but a line drawn from above.
        expect(new Polygon([[0, 0, 0], [10, 0, 0], [10, 0, 10]]).isFlatOnXY()).toBe(false);
    });
});

describe('Mesh.toSVGElem', () =>
{
    it('draws every face of a flattened mesh', () =>
    {
        const flat = Mesh.Box(100, 10, 30).flatten();

        expect(flat.isFlatOnXY()).toBe(true);
        expect(flat.toSVGElem('line', { omitDefaults: true }))
            .toBe('<polygon points="-50,5 -50,-5 50,-5 50,5" class="line"/>');
    });

    it('draws faces with the mesh\'s own style, not the wrapper default', () =>
    {
        // faces() hands out fresh Polygon wrappers with a default style each call, so a
        // colour set on the mesh reached the drawing nowhere.
        const flat = Mesh.Box(10, 10, 10).flatten();
        flat.style.stroke = { color: 'blue' };

        expect(flat.toSVGElem('line', { omitDefaults: true })).toMatch(/stroke="#0000ff"/i);
    });
});

describe('ShapeCollection.toSVG — faces', () =>
{
    /** The reported case: two boxes, flattened, exported. */
    const flattenedBoxes = () => new ShapeCollection<any>(
        Mesh.Box(100, 10, 30),
        Mesh.Box(20, 40, 30).move(50, 0, 0).move(0, 0, 100),
    ).flatten();

    it('draws flattened meshes instead of the "nothing to draw" placeholder', () =>
    {
        const svg = flattenedBoxes().toSVG();

        expect(svg).not.toContain('nothing 2D to draw');
        expect(svg.match(/<polygon /g)?.length).toBe(2);
    });

    it('frames the drawing around the faces', () =>
    {
        const vb = flattenedBoxes().toSVG().match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);

        // The two footprints span x [-50,60] and y [-20,20]; each box is padded by 5% of its
        // own longest side before the union, exactly as curves are.
        expect(vb[0]).toBeCloseTo(-55, 4);
        expect(vb[1]).toBeCloseTo(-22, 4);
        expect(vb[2]).toBeCloseTo(117, 4);
        expect(vb[3]).toBeCloseTo(44, 4);
    });

    it('leaves the styling to the stylesheet, as it does for curves', () =>
    {
        const svg = flattenedBoxes().toSVG();

        for (const poly of svg.match(/<polygon[^>]*\/>/g) ?? [])
        {
            expect(poly).not.toMatch(/\sstroke=|\sstroke-width=|\sfill=/);
        }
        // .line gives them fill:none — a drawing of outlines, like the curves beside them.
        expect(svg).toMatch(/\.line\{fill:none/);
    });

    it('draws faces and curves in one document', () =>
    {
        const col = new ShapeCollection<any>(Mesh.Box(100, 10, 30).flatten(), Curve.Line([0, 0, 0], [0, 100, 0]));
        const svg = col.toSVG();

        expect(svg).toContain('<polygon ');
        expect(svg).toContain('<path ');
    });

    it('skips shapes that a drawing from above would say nothing about', () =>
    {
        // A 3D box has no footprint to draw; so has a face standing up in Z. Both need a
        // projection (isometry/elevation/section) or a flatten() first.
        const wall = new Polygon([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]]);
        const svg = new ShapeCollection<any>(Mesh.Box(10, 10, 10), wall).toSVG();

        expect(svg).toContain('nothing 2D to draw');
    });
});
