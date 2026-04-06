import { beforeAll, describe, it, expect } from 'vitest';
import { initAsync } from '../../src/index';
import { Container } from '../../src/Container';
import { Mesh } from '../../src/Mesh';
import { Curve } from '../../src/Curve';

beforeAll(async () => {
    await initAsync();
});

// ─── Construction ─────────────────────────────────────────────────────────────

describe('Container construction', () => {
    it('creates a container with default name', () => {
        const c = new Container();
        expect(c.name).toBe('container');
    });

    it('accepts a custom name', () => {
        const c = new Container('walls');
        expect(c.name).toBe('walls');
    });

    it('Container.root() creates an unnamed root', () => {
        const r = Container.root();
        expect(r.isRoot()).toBe(true);
        expect(r.name).toBe('root');
    });

    it('Container.from() wraps a Mesh', () => {
        const m = Mesh.Cube(5);
        const c = Container.from(m);
        expect(c.shapes()).toHaveLength(1);
        expect(c.shapes()[0]).toBe(m);
    });

    it('Container.from() wraps a Curve', () => {
        const cv = Curve.Line([0,0,0], [1,0,0]);
        const c = Container.from(cv, 'myLine');
        expect(c.name).toBe('myLine');
        expect(c.shapes()).toHaveLength(1);
    });
});

// ─── Shape management ─────────────────────────────────────────────────────────

describe('Container shape management', () => {
    it('addShape / shapes()', () => {
        const c = new Container('c');
        const m = Mesh.Cube(5);
        c.addShape(m);
        expect(c.shapes()).toContain(m);
    });

    it('addShape is idempotent', () => {
        const c = new Container('c');
        const m = Mesh.Cube(5);
        c.addShape(m).addShape(m);
        expect(c.shapes()).toHaveLength(1);
    });

    it('removeShape removes the shape', () => {
        const c = new Container('c');
        const m = Mesh.Cube(5);
        c.addShape(m).removeShape(m);
        expect(c.shapes()).toHaveLength(0);
    });

    it('isLayer() is true when no shapes', () => {
        const c = new Container('layer');
        expect(c.isLayer()).toBe(true);
    });

    it('isLayer() is false when shapes are present', () => {
        const c = new Container('c');
        c.addShape(Mesh.Cube(5));
        expect(c.isLayer()).toBe(false);
    });

    it('hasShape() mirrors isLayer()', () => {
        const c = new Container('c');
        expect(c.hasShape()).toBe(false);
        c.addShape(Mesh.Cube(5));
        expect(c.hasShape()).toBe(true);
    });

    it('meshes() returns only Mesh shapes', () => {
        const c = new Container('c');
        c.addShape(Mesh.Cube(5));
        c.addShape(Curve.Line([0,0,0], [1,0,0]));
        expect(c.meshes()).toHaveLength(1);
        expect(c.curves()).toHaveLength(1);
    });

    it('shapes(true) collects from descendants', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        const m = Mesh.Cube(5);
        child.addShape(m);
        parent.addChild(child);
        expect(parent.shapes(true)).toContain(m);
        expect(parent.shapes(false)).not.toContain(m);
    });
});

// ─── Hierarchy ────────────────────────────────────────────────────────────────

describe('Container hierarchy', () => {
    it('addChild / children()', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        expect(parent.children()).toContain(child);
    });

    it('addChild sets parent reference', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        expect(child.parent()).toBe(parent);
    });

    it('addChild is idempotent', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child).addChild(child);
        expect(parent.children()).toHaveLength(1);
    });

    it('removeChild removes child and clears parent ref', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child).removeChild(child);
        expect(parent.children()).toHaveLength(0);
        expect(child.parent()).toBeNull();
    });

    it('detach() unlinks from parent', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        child.detach();
        expect(parent.children()).toHaveLength(0);
        expect(child.parent()).toBeNull();
    });

    it('add() dispatches correctly for Container vs Shape', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        const m = Mesh.Cube(5);
        parent.add(child).add(m);
        expect(parent.children()).toContain(child);
        expect(parent.shapes()).toContain(m);
    });

    it('isRoot() is true for detached container', () => {
        const c = new Container('c');
        expect(c.isRoot()).toBe(true);
    });

    it('root() walks up to the topmost ancestor', () => {
        const a = new Container('a');
        const b = new Container('b');
        const c = new Container('c');
        a.addChild(b);
        b.addChild(c);
        expect(c.root()).toBe(a);
    });
});

// ─── Traversal ────────────────────────────────────────────────────────────────

describe('Container traversal', () => {
    function buildTree() {
        const root = new Container('root');
        const a = new Container('a');
        const b = new Container('b');
        const c = new Container('c');
        root.addChild(a).addChild(b);
        a.addChild(c);
        return { root, a, b, c };
    }

    it('descendants() returns all descendants in BFS order', () => {
        const { root, a, b, c } = buildTree();
        const descs = root.descendants();
        expect(descs).toContain(a);
        expect(descs).toContain(b);
        expect(descs).toContain(c);
        expect(descs).not.toContain(root);
    });

    it('ancestors() returns path from parent to root', () => {
        const { root, a, c } = buildTree();
        const ancs = c.ancestors();
        expect(ancs[0]).toBe(a);
        expect(ancs[1]).toBe(root);
    });

    it('find() locates a named descendant', () => {
        const { root, c } = buildTree();
        expect(root.find('c')).toBe(c);
    });

    it('find() returns undefined for missing name', () => {
        const { root } = buildTree();
        expect(root.find('nope')).toBeUndefined();
    });

    it('findAll() returns all matching descendants', () => {
        const root = new Container('root');
        const a = new Container('layer');
        const b = new Container('layer');
        root.addChild(a).addChild(b);
        const found = root.findAll(c => c.name === 'layer');
        expect(found).toHaveLength(2);
    });
});

// ─── Style cascading ──────────────────────────────────────────────────────────

describe('Container style cascading', () => {
    it('effectiveStyle() returns own style when no ancestors', () => {
        const c = new Container('c');
        c.style.opacity = 0.5;
        expect(c.effectiveStyle().opacity).toBe(0.5);
    });

    it('effectiveStyle() merges ancestor styles root-first', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        parent.style.color = 'blue';
        child.style.opacity = 0.3;
        const eff = child.effectiveStyle();
        expect(eff.opacity).toBe(0.3);
        expect(eff.fillColor).toBe('blue');
    });

    it('child style overrides parent style', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        parent.style.color = 'red';
        child.style.color = 'green';
        expect(child.effectiveStyle().fillColor).toBe('green');
    });

    it('applyStyle() mutates shape styles', () => {
        const c = new Container('c');
        const m = Mesh.Cube(5);
        c.addShape(m);
        c.color('blue');
        c.applyStyle();
        expect(m.style.fillColor).toBe('blue');
    });

    it('visible() shortcut sets style.visible', () => {
        const c = new Container('c');
        c.visible(false);
        expect(c.style.visible).toBe(false);
    });

    it('opacity() shortcut sets style.opacity', () => {
        const c = new Container('c');
        c.opacity(0.4);
        expect(c.style.opacity).toBe(0.4);
    });
});

// ─── toGraph ──────────────────────────────────────────────────────────────────

describe('Container.toGraph()', () => {
    it('returns correct structure for a single container with shapes', () => {
        const c = new Container('root');
        c.addShape(Mesh.Cube(5));
        c.addShape(Curve.Line([0,0,0], [1,0,0]));
        const g = c.toGraph();
        expect(g.name).toBe('root');
        expect(g.isLayer).toBe(false);
        expect(g.shapeCount).toBe(2);
        expect(g.shapeTypes).toEqual(['mesh', 'curve']);
        expect(g.children).toHaveLength(0);
    });

    it('isLayer is true when no direct shapes', () => {
        const c = new Container('layer');
        const g = c.toGraph();
        expect(g.isLayer).toBe(true);
    });

    it('children are reflected recursively', () => {
        const parent = new Container('parent');
        const child = new Container('child');
        child.addShape(Mesh.Cube(5));
        parent.addChild(child);
        const g = parent.toGraph();
        expect(g.children).toHaveLength(1);
        expect(g.children[0].name).toBe('child');
        expect(g.children[0].shapeCount).toBe(1);
    });
});

// ─── SVG export ───────────────────────────────────────────────────────────────

describe('Container.toSVG()', () => {
    it('returns a valid SVG string', () => {
        const c = new Container('scene');
        c.addShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
    });

    it('contains a <g> group with the container name', () => {
        const c = new Container('myGroup');
        c.addShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('id="myGroup"');
    });

    it('nested containers produce nested <g> groups', () => {
        const parent = new Container('outer');
        const child = new Container('inner');
        parent.addChild(child);
        child.addShape(Curve.Circle(5));
        const svg = parent.toSVG();
        expect(svg).toContain('id="outer"');
        expect(svg).toContain('id="inner"');
    });

    it('invisible container gets display="none"', () => {
        const c = new Container('hidden');
        c.visible(false);
        c.addShape(Curve.Line([0,0,0], [10,0,0]));
        const svg = c.toSVG();
        expect(svg).toContain('display="none"');
    });

    it('produces a valid SVG with no curves (empty container)', () => {
        const c = new Container('empty');
        const svg = c.toSVG();
        expect(svg).toContain('<svg');
    });
});

// ─── GLTF export ──────────────────────────────────────────────────────────────

describe('Container.toGLTF()', () => {
    it('returns a valid JSON string', async () => {
        const c = new Container('scene');
        c.addShape(Mesh.Cube(5));
        const gltf = await c.toGLTF();
        const parsed = JSON.parse(gltf);
        expect(parsed).toBeTruthy();
        expect(parsed.asset).toBeDefined();
    });

    it('root node carries the container name', async () => {
        const c = new Container('myScene');
        c.addShape(Mesh.Cube(5));
        const gltf = await c.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames.some(n => n === 'myScene')).toBe(true);
    });

    it('nested containers produce nested node hierarchy', async () => {
        const parent = new Container('parent');
        const child = new Container('child');
        parent.addChild(child);
        child.addShape(Mesh.Cube(5));
        const gltf = await parent.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames).toContain('parent');
        expect(nodeNames).toContain('child');
    });

    it('invisible container is excluded from GLTF', async () => {
        const root = new Container('root');
        const hidden = new Container('hiddenChild');
        hidden.visible(false);
        hidden.addShape(Mesh.Cube(5));
        root.addChild(hidden);
        const gltf = await root.toGLTF();
        const parsed = JSON.parse(gltf);
        const nodeNames: string[] = (parsed.nodes ?? []).map((n: any) => n.name as string);
        expect(nodeNames).not.toContain('hiddenChild');
    });

    it('toGLB() returns a Uint8Array', async () => {
        const c = new Container('scene');
        c.addShape(Mesh.Cube(5));
        const glb = await c.toGLB();
        expect(glb).toBeInstanceOf(Uint8Array);
        expect(glb.length).toBeGreaterThan(0);
    });
});
