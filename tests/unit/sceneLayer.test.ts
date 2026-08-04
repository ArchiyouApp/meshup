import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Polygon } from '../../src/Polygon';
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

describe('select() does not add to the scene', () =>
{
    it('Mesh.select() leaves the scene untouched, select().copy() adds the copy', () =>
    {
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        const testLayer = root.addLayer('test', bx);
        root.setActiveLayer(testLayer);

        const front = bx.select('F||front') as Polygon;

        // selecting hands back geometry that is already in the scene - nothing is added
        expect(testLayer.shapes().toArray()).toEqual([bx]);
        expect((front as any)._node).toBeNull();

        // but the selection carries the scene, so copying it puts the copy in the active layer
        const copy = front.copy();
        expect(testLayer.shapes().toArray()).toEqual([bx, copy]);
    });

    it('Curve.select() leaves the scene untouched, select().copy() adds the copy', () =>
    {
        const root = new SceneNode('root');
        const rect = Curve.Rect(10, 10);
        const testLayer = root.addLayer('test', rect);
        root.setActiveLayer(testLayer);

        const front = rect.select('edge||front') as Curve;

        expect(testLayer.shapes().toArray()).toEqual([rect]);
        expect((front as any)._node).toBeNull();

        const copy = front.copy();
        expect(testLayer.shapes().toArray()).toEqual([rect, copy]);
    });
});

describe('bbox()/obbox() shapes join the measured shape\'s scene', () =>
{
    it('obbox().shape() lands on the active layer of the shape it measured', () =>
    {
        // Reproduces: pl = polyline(...).close(); pl.obbox().shape()  — used to stay out of the scene
        const root = new SceneNode('root');
        const pl = Curve.Polyline([0,0,0],[110,100,0],[50,400,0],[-300,-50,0]).close();
        const testLayer = root.addLayer('test', pl);
        root.setActiveLayer(testLayer);

        const shape = pl.obbox().shape();

        expect(shape).not.toBeNull();
        expect(shape!.node()).not.toBeNull();
        expect(testLayer.shapes().toArray()).toContain(shape);
    });

    it('bbox().box() and bbox().rect() do the same', () =>
    {
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        root.addShape(bx);

        const box = bx.bbox().box();
        expect(root.shapes().toArray()).toContain(box);

        const flat = Curve.Rect(100, 50);
        root.addShape(flat);
        const rect = flat.bbox().rect();
        expect(root.shapes().toArray()).toContain(rect);
    });

    it('planes() does not drag its helper box into the scene', () =>
    {
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        root.addShape(bx);

        const before = root.shapes().toArray().length;
        expect(bx.bbox().planes().length).toBe(6);
        expect(root.shapes().toArray().length).toBe(before);
    });

    it('leaves standalone and tmp() shapes alone', () =>
    {
        // standalone meshup: no scene at all
        const loose = Mesh.Cube(10);
        expect(loose.obbox().shape()!.node()).toBeNull();

        // tmp() opts out, and stays opted out
        const root = new SceneNode('root');
        const bx = Mesh.Cube(100);
        root.addShape(bx);
        bx.tmp();

        const before = root.shapes().toArray().length;
        const shape = bx.obbox().shape();
        expect(shape!.node()).toBeNull();
        expect(root.shapes().toArray().length).toBe(before);
    });
});
