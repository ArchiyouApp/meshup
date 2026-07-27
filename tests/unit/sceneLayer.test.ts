import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { ShapeCollection } from '../../src/ShapeCollection';
import { SceneNode } from '../../src/SceneNode';

beforeAll(async () =>
{
    await initAsync();
});

describe('@sceneLayer projections group under the ACTIVE layer', () =>
{
    it('Mesh.iso() lands in an "iso" group inside the active layer, not a root layer', () =>
    {
        // Reproduces: layer('test'); bx = box(100); bx.iso();
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        const testLayer = root.addLayer('test', bx);
        root.setActiveLayer(testLayer);

        const iso = bx.iso();

        // No stray 'iso' layer directly under the root.
        expect(root.children().map(c => c.name)).not.toContain('iso');

        // The projection lives in an 'iso' group under the active 'test' layer.
        const isoGroup = testLayer.children().find(c => c.name === 'iso');
        expect(isoGroup).toBeDefined();
        expect(isoGroup!.shapes().toArray()).toEqual(iso.toArray());

        // The source box stays on 'test'.
        expect(testLayer.shapes().toArray()).toContain(bx);
    });

    it('ShapeCollection.iso() lands in an "iso" group inside the active layer', () =>
    {
        const root = new SceneNode('root');
        const a = Mesh.Cube(100);
        const b = Mesh.Cube(50).move(200, 0, 0);
        const testLayer = root.addLayer('test', new ShapeCollection<Mesh>(a, b));
        root.setActiveLayer(testLayer);

        const iso = new ShapeCollection<Mesh>(a, b).iso();

        expect(root.children().map(c => c.name)).not.toContain('iso');
        const isoGroup = testLayer.children().find(c => c.name === 'iso');
        expect(isoGroup).toBeDefined();
        expect(isoGroup!.shapes().toArray()).toEqual(iso.toArray());
    });

    it('falls back to the root when no active layer is set', () =>
    {
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        root.addShape(bx);

        bx.iso();

        expect(root.children().map(c => c.name)).toContain('iso');
    });
});
