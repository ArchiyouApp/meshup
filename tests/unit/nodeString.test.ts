/**
 *  nodeString.test.ts
 *
 *  Every Shape.toString() shows its scene membership: which SceneNode holds it, or
 *  that it is not in the scene at all. Handy when debugging why something does not
 *  show up in the viewer.
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';
import { Vertex } from '../../src/Vertex';
import { Polygon } from '../../src/Polygon';
import { SceneNode } from '../../src/SceneNode';
import { nodeToString } from '../../src/utils';

beforeAll(async () =>
{
    await initAsync();
});

describe('nodeToString()', () =>
{
    it('reports a missing node', () =>
    {
        expect(nodeToString(null)).toEqual('node=<not in scene>');
        expect(nodeToString(undefined)).toEqual('node=<not in scene>');
    });

    it('reports name and id of a node', () =>
    {
        const node = new SceneNode('walls');
        expect(nodeToString(node)).toEqual(`node={ name: 'walls', id: '${node.id()}' }`);
    });
});

describe('SceneNode.id()', () =>
{
    it('is unique per node — names repeat across layers, ids do not', () =>
    {
        const a = new SceneNode('layer');
        const b = new SceneNode('layer');
        expect(a.id()).not.toEqual(b.id());
        expect(a.id()).toEqual(a.id()); // stable
    });
});

describe('Shape.toString() scene membership', () =>
{
    const shapes = () => (
    {
        Mesh: Mesh.Box(10),
        Curve: Curve.Line([0, 0, 0], [10, 0, 0]),
        Vertex: new Vertex([1, 2, 3]),
        Polygon: Polygon.from([[0, 0, 0], [10, 0, 0], [10, 10, 0]]),
    });

    it('says a detached shape is not in the scene', () =>
    {
        Object.entries(shapes()).forEach(([label, s]) =>
        {
            expect(s.toString(), label).toContain('node=<not in scene>');
        });
    });

    it('names the node once the shape is in the scene', () =>
    {
        Object.entries(shapes()).forEach(([label, s]) =>
        {
            const scene = new SceneNode('root');
            scene.addShape(s as any);
            s.name('myShape');

            expect(s.toString(), label).toContain(`node={ name: 'myShape', id: '${s.node()!.id()}' }`);
            expect(s.toString(), label).not.toContain('not in scene');
        });
    });

    it('goes back to <not in scene> after removeFromScene()', () =>
    {
        const m = Mesh.Box(10);
        new SceneNode('root').addShape(m);
        expect(m.toString()).toContain('node={');

        m.removeFromScene();
        expect(m.toString()).toContain('node=<not in scene>');
    });
});
