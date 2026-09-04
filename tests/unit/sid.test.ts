/** Shape serial ids (`sid`): the order in which shapes entered the scene.
 *
 *  meshup itself owns no counter — the host modeler installs a provider on the scene root
 *  (setSidProvider), exactly as it does for the active layer, and SceneNode.setShape() pulls
 *  one number per shape at adoption. A bare meshup scene has no provider and leaves sid 0.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { SceneNode } from '../../src/SceneNode';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';

beforeAll(async () =>
{
    await initAsync();
});

/** A scene root wired up the way Modeler.reset() wires one. */
function hostScene()
{
    let seq = 0;
    const root = SceneNode.root('root');
    root.setSidProvider(() => ++seq);
    return { root, peek: () => seq };
}

describe('sid: assignment on adoption', () =>
{
    it('numbers shapes 1,2,3… in the order they enter the scene', () =>
    {
        const { root, peek } = hostScene();
        const a = Mesh.Box(10, 10, 10);
        const b = Curve.Circle(5);
        const c = Mesh.Box(2, 2, 2);

        expect([a.sid(), b.sid(), c.sid()]).toEqual([0, 0, 0]); // not adopted yet

        root.addShape(a as any);
        root.addShape(b as any);
        root.addShape(c as any);

        expect([a.sid(), b.sid(), c.sid()]).toEqual([1, 2, 3]);
        expect(peek()).toEqual(3);
    });

    it('leaves sid 0 on a shape that never enters a scene', () =>
    {
        const m = Mesh.Box(1, 1, 1);
        expect(m.sid()).toEqual(0);
    });

    it('leaves sid 0 and does not throw when the scene has no host provider', () =>
    {
        const root = SceneNode.root('root'); // bare meshup scene: no setSidProvider
        const m = Mesh.Box(1, 1, 1);
        expect(() => root.addShape(m as any)).not.toThrow();
        expect(m.sid()).toEqual(0);
    });

    it('numbers shapes adopted into nested layers from the root sequence', () =>
    {
        const { root } = hostScene();
        const layerA = root.ensureLayer('a');
        const layerB = root.ensureLayer('b');

        const one = Mesh.Box(1, 1, 1);
        const two = Mesh.Box(2, 2, 2);
        layerA.addShape(one as any);
        layerB.addShape(two as any);

        // One sequence for the whole scene, not one per layer.
        expect([one.sid(), two.sid()]).toEqual([1, 2]);
    });
});

describe('sid: stability', () =>
{
    it('does not renumber a shape moved between layers', () =>
    {
        const { root, peek } = hostScene();
        const layerA = root.ensureLayer('a');
        const layerB = root.ensureLayer('b');

        const m = Mesh.Box(1, 1, 1);
        layerA.addShape(m as any);
        expect(m.sid()).toEqual(1);

        layerB.addShape(m as any); // re-parent
        expect(m.sid()).toEqual(1);
        expect(peek()).toEqual(1); // and consumed no further id
    });

    it('does not clear sid when a shape is detached from its node', () =>
    {
        const { root } = hostScene();
        const m = Mesh.Box(1, 1, 1);
        root.addShape(m as any);
        const sid = m.sid();

        m._node?.resetShape(m as any);
        expect(m.sid()).toEqual(sid);
    });

    it('gives two identical build sequences identical sids', () =>
    {
        const build = () =>
        {
            const { root } = hostScene();
            const shapes = [Mesh.Box(1, 1, 1), Curve.Circle(3), Mesh.Box(4, 4, 4)];
            shapes.forEach(s => root.addShape(s as any));
            return shapes.map(s => s.sid());
        };
        expect(build()).toEqual(build());
    });
});

describe('sid: copies', () =>
{
    it('gives a copy its own sid and records _sidFrom', () =>
    {
        const { root } = hostScene();
        const m = Mesh.Box(10, 10, 10);
        root.addShape(m as any);
        root.setActiveLayer(root); // copy() adds to the active layer

        const c = m.copy();

        expect(m.sid()).toEqual(1);
        expect(c.sid()).toEqual(2);
        expect(c._sidFrom).toEqual(1);
    });

    it('carries provenance through a chain of copies', () =>
    {
        const { root } = hostScene();
        const m = Mesh.Box(10, 10, 10);
        root.addShape(m as any);
        root.setActiveLayer(root);

        const c1 = m.copy();
        const c2 = c1.copy();

        expect(c2._sidFrom).toEqual(c1.sid());
        expect(c1._sidFrom).toEqual(m.sid());
    });

    it('carries _sidFrom from an unadopted source via its own _sidFrom', () =>
    {
        const { root } = hostScene();
        const m = Mesh.Box(10, 10, 10);
        root.addShape(m as any);

        const detached = m._copy();      // pure clone, never adopted -> sid 0
        expect(detached.sid()).toEqual(0);
        expect(detached._sidFrom).toEqual(m.sid());

        const second = detached._copy(); // falls back to the source's _sidFrom
        expect(second._sidFrom).toEqual(m.sid());
    });
});

describe('sid: serialisation', () =>
{
    it('carries sid in toData(), and omits it for containers', () =>
    {
        const { root } = hostScene();
        const layer = root.ensureLayer('walls');
        const m = Mesh.Box(1, 1, 1);
        layer.addShape(m as any);

        const data = root.toData();
        expect(data.sid).toBeUndefined();            // root container holds no shape
        const walls = data.children[0];
        expect(walls.sid).toBeUndefined();           // layer container holds no shape
        expect(walls.children[0].sid).toEqual(m.sid());
    });
});
