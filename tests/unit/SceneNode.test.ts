import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { SceneNode } from '../../src/SceneNode';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';

beforeAll(async () =>
{
    await initAsync();
});

// ─── Construction ─────────────────────────────────────────────────────────────

describe('SceneNode construction', () =>
{
    it('creates a container with default name', () =>
    {
        const c = new SceneNode();
        expect(c.name).toBe('container');
    });

    it('accepts a custom name', () =>
    {
        const c = new SceneNode('walls');
        expect(c.name).toBe('walls');
    });

    it('SceneNode.root() creates an unnamed root', () =>
    {
        const r = SceneNode.root();
        expect(r.isRoot()).toBe(true);
        expect(r.name).toBe('root');
    });

    it('SceneNode.from() wraps a Mesh', () =>
    {
        const m = Mesh.Cube(5);
        const c = SceneNode.from(m);
        expect(c.shapes()).toHaveLength(1);
        expect(c.shapes().toArray()[0]).toBe(m);
    });

    it('SceneNode.from() wraps a Curve', () =>
    {
        const cv = Curve.Line([0,0,0], [1,0,0]);
        const c = SceneNode.from(cv, 'myLine');
        expect(c.name).toBe('myLine');
        expect(c.shapes()).toHaveLength(1);
    });
});

// ─── Shape management ─────────────────────────────────────────────────────────

describe('SceneNode shape management', () =>
{
    it('addShape / shapes()', () =>
    {
        const c = new SceneNode('c');
        const m = Mesh.Cube(5);
        c.addShape(m);
        expect(c.shapes().toArray()).toContain(m);
    });

    it('addShape is idempotent', () =>
    {
        const c = new SceneNode('c');
        const m = Mesh.Cube(5);
        c.addShape(m).addShape(m);
        expect(c.shapes()).toHaveLength(1);
    });

    it('removeShape removes the shape', () =>
    {
        const c = new SceneNode('c');
        const m = Mesh.Cube(5);
        c.setShape(m).removeShape(m);
        expect(c.shapes().toArray()).toHaveLength(0);
    });

    it('isLayer() is true when no shapes', () =>
    {
        const c = new SceneNode('layer');
        expect(c.isLayer()).toBe(true);
    });

    it('isLayer() is false when shapes are present', () =>
    {
        const c = new SceneNode('c');
        c.setShape(Mesh.Cube(5));
        expect(c.isLayer()).toBe(false);
    });

    it('hasShape() mirrors isLayer()', () =>
    {
        const c = new SceneNode('c');
        expect(c.hasShape()).toBe(false);
        c.setShape(Mesh.Cube(5));
        expect(c.hasShape()).toBe(true);
    });

    it('can filter Mesh and Curve shapes from descendants', () =>
    {
        const parent = new SceneNode('p');
        const meshNode = new SceneNode('mn');
        const curveNode = new SceneNode('cn');
        meshNode.setShape(Mesh.Cube(5));
        curveNode.setShape(Curve.Line([0,0,0], [1,0,0]));
        parent.addChild(meshNode).addChild(curveNode);
        expect(parent.shapes().filter(s => s instanceof Mesh)).toHaveLength(1);
        expect(parent.shapes().filter(s => s instanceof Curve)).toHaveLength(1);
    });

    it('shapes collects from descendants', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        const m = Mesh.Cube(5);
        child.addShape(m);
        parent.addChild(child);
        expect(parent.shapes().toArray()).toContain(m);
        expect(parent.shapes().toArray()).toContain(m); // recursion
        expect(parent.shape()).toBeNull(); // shape() should not recurse
    });
});

// ─── Hierarchy ────────────────────────────────────────────────────────────────

describe('SceneNode hierarchy', () =>
{
    it('addChild / children()', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        expect(parent.children()).toContain(child);
    });

    it('addChild sets parent reference', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        expect(child.parent()).toBe(parent);
    });

    it('addChild is idempotent', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child).addChild(child);
        expect(parent.children()).toHaveLength(1);
    });

    it('removeChild removes child and clears parent ref', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child).removeChild(child);
        expect(parent.children()).toHaveLength(0);
        expect(child.parent()).toBeNull();
    });

    it('detach() unlinks from parent', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        child.detach();
        expect(parent.children()).toHaveLength(0);
        expect(child.parent()).toBeNull();
    });

    it('add() dispatches correctly for SceneNode vs Shape', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        const m = Mesh.Cube(5);
        parent.add(child).add(m);
        expect(parent.children()).toContain(child);
        expect(parent.shapes().toArray()).toContain(m);
    });

    it('isRoot() is true for detached container', () =>
    {
        const c = new SceneNode('c');
        expect(c.isRoot()).toBe(true);
    });

    it('root() walks up to the topmost ancestor', () =>
    {
        const a = new SceneNode('a');
        const b = new SceneNode('b');
        const c = new SceneNode('c');
        a.addChild(b);
        b.addChild(c);
        expect(c.root()).toBe(a);
    });
});

// ─── Traversal ────────────────────────────────────────────────────────────────

describe('SceneNode traversal', () =>
{
    function buildTree()
    {
        const root = new SceneNode('root');
        const a = new SceneNode('a');
        const b = new SceneNode('b');
        const c = new SceneNode('c');
        root.addChild(a).addChild(b);
        a.addChild(c);
        return { root, a, b, c };
    }

    it('descendants() returns all descendants in BFS order', () =>
    {
        const { root, a, b, c } = buildTree();
        const descs = root.descendants();
        expect(descs).toContain(a);
        expect(descs).toContain(b);
        expect(descs).toContain(c);
        expect(descs).not.toContain(root);
    });

    it('ancestors() returns path from parent to root', () =>
    {
        const { root, a, c } = buildTree();
        const ancs = c.ancestors();
        expect(ancs[0]).toBe(a);
        expect(ancs[1]).toBe(root);
    });

    it('find() locates a named descendant', () =>
    {
        const { root, c } = buildTree();
        expect(root.find('c')).toBe(c);
    });

    it('find() returns undefined for missing name', () =>
    {
        const { root } = buildTree();
        expect(root.find('nope')).toBeUndefined();
    });

    it('findAll() returns all matching descendants', () =>
    {
        const root = new SceneNode('root');
        const a = new SceneNode('layer');
        const b = new SceneNode('layer');
        root.addChild(a).addChild(b);
        const found = root.findAll(c => c.name === 'layer');
        expect(found).toHaveLength(2);
    });
});

// ─── Style cascading ──────────────────────────────────────────────────────────

describe('SceneNode style cascading', () =>
{
    it('effectiveStyle() returns own style when no ancestors', () =>
    {
        const c = new SceneNode('c');
        c.style.opacity = 0.5;
        expect(c.effectiveStyle().opacity).toBe(0.5);
    });

    it('effectiveStyle() merges ancestor styles root-first', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        parent.style.color = 'blue';
        child.style.opacity = 0.3;
        const eff = child.effectiveStyle();
        expect(eff.opacity).toBe(0.3);
        expect(eff.fillColor).toBe('#0000ff');
    });

    it('child style overrides parent style', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        parent.style.color = 'red';
        child.style.color = 'green';
        expect(child.effectiveStyle().fillColor).toBe('#008000');
    });

    it('applyStyle() mutates shape styles', () =>
    {
        const c = new SceneNode('c');
        const m = Mesh.Cube(5);
        c.setShape(m);
        c.color('blue');
        c.applyStyle();
        expect(m.style.fillColor).toBe('#0000ff');
    });

    it('visible() shortcut sets style.visible', () =>
    {
        const c = new SceneNode('c');
        c.visible(false);
        expect(c.style.visible).toBe(false);
    });

    it('opacity() shortcut sets style.opacity', () =>
    {
        const c = new SceneNode('c');
        c.opacity(0.4);
        expect(c.style.opacity).toBe(0.4);
    });
});

// ─── toGraph ──────────────────────────────────────────────────────────────────

describe('SceneNode.toGraph()', () =>
{
    it('returns correct structure for a single container with a shape', () =>
    {
        const c = new SceneNode('root');
        c.setShape(Mesh.Cube(5));
        const g = c.toGraph();
        expect(g.name).toBe('root');
        expect(g.isLayer).toBe(false);
        expect(g.hasShape).toBe(true);
        expect(g.shapeType).toEqual('Mesh');
        expect(g.children).toHaveLength(0);
    });

    it('isLayer is true when no direct shapes', () =>
    {
        const c = new SceneNode('layer');
        const g = c.toGraph();
        expect(g.isLayer).toBe(true);
    });

    it('children are reflected recursively', () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        child.setShape(Mesh.Cube(5));
        parent.addChild(child);
        const g = parent.toGraph();
        expect(g.children).toHaveLength(1);
        expect(g.children[0].name).toBe('child');
        expect(g.children[0].hasShape).toBe(true);
    });
});

// ─── SVG export ───────────────────────────────────────────────────────────────

describe('SceneNode.toSVG()', () =>
{
    it('returns a valid SVG string', () =>
    {
        const c = new SceneNode('scene');
        c.setShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
    });

    it('contains a <g> group with the container name', () =>
    {
        const c = new SceneNode('myGroup');
        c.setShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('id="myGroup"');
    });

    it('nested containers produce nested <g> groups', () =>
    {
        const parent = new SceneNode('outer');
        const child = new SceneNode('inner');
        parent.addChild(child);
        child.setShape(Curve.Circle(5));
        const svg = parent.toSVG();
        expect(svg).toContain('id="outer"');
        expect(svg).toContain('id="inner"');
    });

    it('invisible container gets display="none"', () =>
    {
        const c = new SceneNode('hidden');
        c.visible(false);
        c.setShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('display="none"');
    });

    it('produces a valid SVG with no curves (empty container)', () =>
    {
        const c = new SceneNode('empty');
        const svg = c.toSVG();
        expect(svg).toContain('<svg');
    });
});

// ─── GLTF export ──────────────────────────────────────────────────────────────

describe('SceneNode.toGLTF()', () =>
{
    it('returns a valid JSON string', async () =>
    {
        const c = new SceneNode('scene');
        c.setShape(Mesh.Cube(5));
        const gltf = await c.toGLTF();
        const parsed = JSON.parse(gltf);
        expect(parsed).toBeTruthy();
        expect(parsed.asset).toBeDefined();
    });

    it('root node carries the container name', async () =>
    {
        const c = new SceneNode('myScene');
        c.setShape(Mesh.Cube(5));
        const gltf = await c.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames.some(n => n === 'myScene')).toBe(true);
    });

    it('nested containers produce nested node hierarchy', async () =>
    {
        const parent = new SceneNode('parent');
        const child = new SceneNode('child');
        parent.addChild(child);
        child.setShape(Mesh.Cube(5));
        const gltf = await parent.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames).toContain('parent');
        expect(nodeNames).toContain('child');
    });

    it('invisible container is excluded from GLTF', async () =>
    {
        const root = new SceneNode('root');
        const hidden = new SceneNode('hiddenChild');
        hidden.visible(false);
        hidden.setShape(Mesh.Cube(5));
        root.addChild(hidden);
        const gltf = await root.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames).not.toContain('hiddenChild');
    });

    it('toGLB() returns a Uint8Array', async () =>
    {
        const c = new SceneNode('scene');
        c.setShape(Mesh.Cube(5));
        const glb = await c.toGLB();
        expect(glb).toBeInstanceOf(Uint8Array);
        expect(glb.length).toBeGreaterThan(0);
    });
});
