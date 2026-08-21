/**
 * thickness.test.ts — the strokeWidth alias, and the fan-out it filled in.
 *
 * `strokeWidth()` used to exist only on Shape, so `all().curves().strokeWidth(2)` threw while
 * every sibling style method (`color`, `opacity`, `dashed`) fanned out. The alias and that gap
 * were fixed together, so the tests cover both.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Curve } from '../../src/Curve';
import { Mesh } from '../../src/Mesh';
import { ShapeCollection } from '../../src/ShapeCollection';
import { SceneNode } from '../../src/SceneNode';

beforeAll(async () => { await initAsync(); });

const line = () => Curve.Line([0, 0, 0], [10, 0, 0]);

describe('Shape', () =>
{
    it('sets exactly what strokeWidth sets', () =>
    {
        expect(line().thickness(4).style.strokeWidth).toBe(line().strokeWidth(4).style.strokeWidth);
        expect(line().thickness(4).style.strokeWidth).toBe(4);
    });

    it('chains', () =>
    {
        const c = line().thickness(3).color('red').dashed([4, 4]);
        expect(c.style.strokeWidth).toBe(3);
        expect(c.style.color).toBe('#ff0000');
        expect(c.style.strokeDash).toEqual([4, 4]);
    });

    it('is inherited by every Shape type, not just Curve', () =>
    {
        expect(Mesh.Box(1, 1, 1).thickness(2).style.strokeWidth).toBe(2);
    });
});

describe('ShapeCollection', () =>
{
    it('reaches every member', () =>
    {
        const col = new ShapeCollection(
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Line([0, 5, 0], [10, 5, 0]),
        );
        col.thickness(5);
        col.toArray().forEach((s: any) => expect(s.style.strokeWidth).toBe(5));
    });

    it('exposes strokeWidth too, which it did not have before', () =>
    {
        const col = new ShapeCollection(Curve.Line([0, 0, 0], [10, 0, 0]));
        expect(() => col.strokeWidth(2)).not.toThrow();
        expect((col.first() as any).style.strokeWidth).toBe(2);
    });

    it('does not throw on a mixed collection', () =>
    {
        // The fan-out uses optional invocation so a member without the method is skipped
        // rather than taking the whole call down.
        const col = new ShapeCollection(Curve.Line([0, 0, 0], [10, 0, 0]), Mesh.Box(1, 1, 1));
        expect(() => col.thickness(2)).not.toThrow();
    });
});

describe('SceneNode', () =>
{
    it('sets the container style and cascades', () =>
    {
        const node = new SceneNode('layer');
        node.thickness(6);
        expect(node.effectiveStyle().strokeWidth).toBe(6);
    });

    it("lets a shape's own width win over its layer's", () =>
    {
        const node = new SceneNode('layer');
        node.thickness(6);
        const c = line().thickness(2);

        const merged = node.effectiveStyle();
        merged.merge(c.style.explicitData() as any);
        expect(merged.strokeWidth).toBe(2);
    });

    it('does not wipe a dash set on the same layer', () =>
    {
        // Both write a PARTIAL stroke object. That only works because the `stroke` setter
        // merges rather than replaces — dashed() has always relied on it, and now so does this.
        const node = new SceneNode('layer');
        node.dashed([8, 3]).thickness(4);

        expect(node.style.strokeDash).toEqual([8, 3]);
        expect(node.style.strokeWidth).toBe(4);
    });

    it('does not wipe a width when a dash is set afterwards', () =>
    {
        const node = new SceneNode('layer');
        node.thickness(4).dashed([8, 3]);

        expect(node.style.strokeWidth).toBe(4);
        expect(node.style.strokeDash).toEqual([8, 3]);
    });
});

describe('it really is the same path', () =>
{
    it('reaches the glTF as BENTLEY_materials_line_style.width', async () =>
    {
        // The alias must drive the existing pipeline, not a parallel one — a width > 1 is what
        // makes the viewer swap in the fat-line material.
        const glb = await line().thickness(7).toGLB();
        const dv = new DataView(glb.buffer, glb.byteOffset);
        const jsonLength = dv.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));

        expect(json.materials[0].extensions['BENTLEY_materials_line_style'].width).toBe(7);
    });
});
