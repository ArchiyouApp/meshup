/**
 *  Container.ts
 *
 *  Manages a nested scene hierarchy of Shapes (Meshes / Curves), similar to
 *  a Blender Collection or a GLTF Node.  Every shape on the scene can be
 *  wrapped in a Container.  The scene root is also a Container.
 *
 *  Key concepts:
 *   - A Container can hold 0..N shapes directly AND 0..N child Containers.
 *   - If a Container holds no shapes (directly) it is considered a "layer".
 *   - Style cascades from ancestors to descendants at export time.
 *   - Containers export to SVG as nested <g> elements and to GLTF as nested
 *     Nodes via gltf-transform.
 */

import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Style } from './Style';
import type { StyleData } from './Style';
import type { Axis, ContainerGraphNode, BasePlane } from './types';
import { Document } from '@gltf-transform/core';
import { createNodeIO } from './GLTFExtensions';
import type { Node as GltfNode } from '@gltf-transform/core';
import { Collection } from './Collection';
import { GLTFJsonDocumentToString } from './utils';

/** Union of all concrete shape classes that can live inside a Container. */
export type Shape = Mesh | Curve;

export class Container
{
    name: string;
    style: Style;
    
    private _shapes: Shape[] = []; // Shapes held directly in this container (not in child containers)
    private _children: Container[] = []; // Child containers (sub-groups / layers)
    private _parent: Container | null = null; // Back-reference to the parent container; null if this is the root

    constructor(name = 'container')
    {
        this.name = name;
        this.style = new Style();
    }

    //// STATIC FACTORIES ////

    /** Create a root container (no parent). */
    static root(name = 'root'): Container
    {
        return new Container(name);
    }

    /** Wrap a single shape in a new container. */
    static from(shape: Shape, name?: string): Container
    {
        const c = new Container(name ?? (shape instanceof Mesh ? 'mesh' : 'curve'));
        c.addShape(shape);
        return c;
    }

    //// SHAPE MANAGEMENT ////

     /**
     * Convenience method: adds a child Container or a Shape to this container
     *   - String → addChild(new Container(string)) - new child container with given name
     *   - Container → addChild()
     *   - Mesh | Curve → addShape()
     */
    add(...items: Array<string|Container|Shape|Collection>): this
    {
        for (const item of items)
        {
            if (typeof item === 'string')
            {
                // Name of new Container: create it and add as child
                this.addChild(new Container(item));  
            } 
            else if (item instanceof Container) this.addChild(item);
            else if (item instanceof Collection) item.forEach(shape => this.addShape(shape));
            else this.addShape(item);
        }
        return this;
    }

    /** Add new Container (layer) and populate it with the given shape(s).
     *  Dot-notation creates nested layers: 'walls.inner' finds or creates 'walls',
     *  then finds or creates 'inner' inside it, and adds the item to the bottom layer.
     */
    addLayer(name: string, item: Shape|Collection): Container
    {
        const parts = name.split('.');
        const bottomName = parts.pop()!;

        // Walk / create the intermediate layers
        let parent: Container = this;
        for (const part of parts)
        {
            const existing = parent._children.find(c => c.name === part);
            if (existing)
            {
                parent = existing;
            }
            else
            {
                const intermediate = new Container(part);
                parent.addChild(intermediate);
                parent = intermediate;
            }
        }

        // Find or create the bottom layer and add the item
        const existing = parent._children.find(c => c.name === bottomName);
        const layer = existing ?? new Container(bottomName);
        if (!existing) parent.addChild(layer);

        if (item instanceof Collection)
        {
            item.forEach(shape => layer.addShape(shape));
        }
        else
        {
            layer.addShape(item);
        }

        return layer;
    }

    /** Add a shape to this container. Returns `this` for chaining. */
    addShape(shape: Shape): this
    {
        if (!this._shapes.includes(shape))
        {
            this._shapes.push(shape);
            shape._container = this;
        }
        return this;
    }

    /** Remove a shape from this container. */
    removeShape(shape: Shape): this
    {
        const idx = this._shapes.indexOf(shape);
        if (idx !== -1)
        {
            this._shapes.splice(idx, 1);
            shape._container = null;
        }
        return this;
    }

    /**
     * Return shapes held by this container.
     * @param recursive  If true, collect shapes from all descendant containers too.
     */
    shapes(recursive = false): Shape[]
    {
        if (!recursive) return [...this._shapes];
        return this._traverse().flatMap(c => c._shapes);
    }

    /** Return only Mesh shapes (optionally recursive). */
    meshes(recursive = false): Mesh[]
    {
        return this.shapes(recursive).filter((s): s is Mesh => s instanceof Mesh);
    }

    /** Return only Curve shapes (optionally recursive). */
    curves(recursive = false): Curve[]
    {
        return this.shapes(recursive).filter((s): s is Curve => s instanceof Curve);
    }

    /** True when this container holds no shapes directly (acts as a layer). */
    isLayer(): boolean
    {
        return this._shapes.length === 0;
    }

    /** True when this container holds at least one shape directly. */
    hasShape(): boolean
    {
        return this._shapes.length > 0;
    }

    //// CHILD MANAGEMENT ////

    /** Add a child container. Sets child._parent to this. Returns `this`. */
    addChild(child: Container): this
    {
        if (!this._children.includes(child))
        {
            if (child._parent) child._parent.removeChild(child);
            child._parent = this;
            this._children.push(child);
        }
        return this;
    }

    /** Remove a child container without destroying it. */
    removeChild(child: Container): this
    {
        const idx = this._children.indexOf(child);
        if (idx !== -1)
        {
            child._parent = null;
            this._children.splice(idx, 1);
        }
        return this;
    }

    /** Remove a child Container or a Shape from this container. */
    remove(item: Container | Shape): this
    {
        if (item instanceof Container) return this.removeChild(item);
        return this.removeShape(item);
    }

    /** Detach this container from its parent. Returns `this`. */
    detach(): this
    {
        if (this._parent) this._parent.removeChild(this);
        return this;
    }

    //// TRAVERSAL ////

    /** Return direct child containers. */
    children(): Container[]
    {
        return [...this._children];
    }

    /** Return the parent container, or null if this is the root. */
    parent(): Container | null
    {
        return this._parent;
    }

    /** Return all ancestors from immediate parent up to (and including) the root. */
    ancestors(): Container[]
    {
        const collect = (node: Container | null, acc: Container[]): Container[] =>
            node ? collect(node._parent, [...acc, node]) : acc;
        return collect(this._parent, []);
    }

    /** Return all descendant containers in BFS order (not including this). */
    descendants(): Container[]
    {
        // Skip `this` itself — start from children
        const all = this._traverse();
        return all.slice(1); // first element is `this`
    }

    /** Return the root container (walk up _parent chain). */
    root(): Container
    {
        const walk = (node: Container): Container =>
            node._parent ? walk(node._parent) : node;
        return walk(this);
    }

    /** True when this container has no parent. */
    isRoot(): boolean
    {
        return this._parent === null;
    }

    /** Find the first descendant (DFS) whose name matches. */
    find(name: string): Container | undefined
    {
        return this._children.reduce<Container | undefined>((found, child) =>
        {
            if (found) return found;
            if (child.name === name) return child;
            return child.find(name);
        }, undefined);
    }

    /** Return all descendants (DFS) matching the predicate. */
    findAll(pred: (c: Container) => boolean): Container[]
    {
        return this._children.flatMap(child =>
        {
            const here = pred(child) ? [child] : [];
            return [...here, ...child.findAll(pred)];
        });
    }

    //// STYLE ////

    /** Set the fill/stroke color of this container's own style. */
    color(c: string | [number, number, number]): this
    {
        this.style.color = c as any;
        return this;
    }

    /** Set the opacity (0–1) of this container's own style. */
    opacity(o: number): this
    {
        this.style.opacity = o;
        return this;
    }

    /** Show or hide this container (and all its contents) during export. */
    visible(v: boolean): this
    {
        this.style.visible = v;
        return this;
    }

    /** Merge partial style data into this container's own style. */
    setStyle(data: Partial<StyleData>): this
    {
        this.style.merge(data as StyleData);
        return this;
    }

    /**
     * Compute the effective (cascaded) style for this container by merging
     * ancestor styles root-first, then applying this container's own style.
     * Only explicitly-set properties cascade; defaults do not override ancestors.
     * Does NOT mutate any shape or container.
     */
    effectiveStyle(): Style
    {
        const chain = [...this.ancestors().reverse(), this];
        const merged = new Style();
        chain.forEach(c => merged.merge(c.style.explicitData() as any));
        return merged;
    }

    /**
     * Push the effectiveStyle() down to every shape in this subtree, mutating
     * each shape's `.style` in place.  Call this before passing shapes to
     * external code that does not understand Container hierarchies.
     */
    applyStyle(): this
    {
        const eff = this.effectiveStyle();
        this.shapes(true).forEach(shape => shape.style.merge(eff.toData()));
        return this;
    }

    //// TO GRAPH ───────────────────────────────────────────────────────────────

    /** Return a plain-object tree representation of this container hierarchy. */
    toGraph(): ContainerGraphNode
    {
        return {
            name: this.name,
            isLayer: this.isLayer(),
            shapeCount: this._shapes.length,
            shapeTypes: this._shapes.map(s => (s instanceof Mesh ? 'mesh' : 'curve')),
            children: this._children.map(c => c.toGraph()),
        };
    }

    //// GLTF EXPORT ////

    /**
     * Build a gltf-transform Node tree for this container within an existing Document.
     * Invisible containers (effectiveStyle().visible === false) are skipped entirely.
     * @internal
     */
    _buildGLTFNode(doc: Document, up: Axis = 'z'): GltfNode | null
    {
        if (!this.effectiveStyle().visible) return null;

        const node = doc.createNode(this.name);

        this._shapes.forEach((shape, i) =>
        {
            const shapeNode = shape._buildGLTFNode(doc, up, `${this.name}_shape_${i}`);
            node.addChild(shapeNode);
        });

        this._children.forEach(child =>
        {
            const childNode = child._buildGLTFNode(doc, up);
            if (childNode) node.addChild(childNode);
        });

        return node;
    }

    /** Export this container hierarchy as a GLTF JSON string. */
    async toGLTF(up: Axis = 'z'): Promise<string>
    {
        const doc = new Document();
        const rootNode = this._buildGLTFNode(doc, up);
        const scene = doc.createScene(this.name);
        if (rootNode) scene.addChild(rootNode);
        doc.getRoot().setDefaultScene(scene);
        const io = createNodeIO();
        return io.writeJSON(doc).then(GLTFJsonDocumentToString);
    }

    /** Export this container hierarchy as a GLB binary (Uint8Array). */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array>
    {
        const doc = new Document();
        const rootNode = this._buildGLTFNode(doc, up);
        const scene = doc.createScene(this.name);
        if (rootNode) scene.addChild(rootNode);
        doc.getRoot().setDefaultScene(scene);
        const io = createNodeIO();
        return io.writeBinary(doc);
    }

    //// SVG EXPORT ────────────────────────────────────────────────────────────

    /**
     * Build a `<g>` SVG group element (with nested children) for this container.
     * Invisible containers emit `<g display="none">` to preserve structure while hiding content.
     * Mesh shapes are skipped with a warning (SVG is curves-only, matching Collection.toSVG()).
     * @internal
     */
    _toSVGGroup(plane: BasePlane = 'xy'): string
    {
        const eff = this.effectiveStyle();
        const displayAttr = eff.visible ? '' : ' display="none"';
        const lines: string[] = [`<g id="${this.name}"${displayAttr}>`];

        this._shapes.forEach(shape =>
        {
            if (shape instanceof Mesh)
            {
                console.warn(`Container.toSVG(): Mesh shapes are not exported to SVG (container "${this.name}"). Use Curve shapes for SVG export.`);
                return;
            }
            lines.push('  ' + shape._toSVGElement(plane));
        });

        this._children.forEach(child =>
        {
            const childGroup = child._toSVGGroup(plane);
            lines.push(...childGroup.split('\n').map(l => '  ' + l));
        });

        lines.push('</g>');
        return lines.join('\n');
    }

    /**
     * Export this container hierarchy as a self-contained SVG string.
     * Curves are projected onto `plane`; the viewBox is the union of all descendant curve bounds.
     * @param plane  Base plane to project onto (default: 'xy')
     */
    toSVG(plane: BasePlane = 'xy'): string
    {
        const allCurves = this.curves(true);

        // Compute union viewBox
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        allCurves.forEach(curve =>
        {
            const bb = curve.copy().projectOnto(plane).bbox();
            if (!bb) return;
            // SVG Y-axis is flipped
            minX = Math.min(minX, bb.min().x);
            minY = Math.min(minY, -bb.max().y);
            maxX = Math.max(maxX, bb.max().x);
            maxY = Math.max(maxY, -bb.min().y);
        });

        if (!isFinite(minX))
        {
            // No curves at all — still emit a valid SVG
            minX = 0; minY = 0; maxX = 1; maxY = 1;
        }

        const w = maxX - minX;
        const h = maxY - minY;
        const pad = Math.max(w, h) * 0.05 || 1;

        const vbX = +(minX - pad).toFixed(6);
        const vbY = +(minY - pad).toFixed(6);
        const vbW = +(w + 2 * pad).toFixed(6);
        const vbH = +(h + 2 * pad).toFixed(6);

        const group = this._toSVGGroup(plane);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">\n${group}\n</svg>`;
    }

    //// INTERNAL HELPERS ////

    /** traversal (BFS) that includes `this` as the first element. */
    private _traverse(): Container[]
    {
        const bfs = (queue: Container[], acc: Container[]): Container[] =>
        {
            if (queue.length === 0) return acc;
            const [cur, ...rest] = queue;
            return bfs([...rest, ...cur._children], [...acc, cur]);
        };
        return bfs([this], []);
    }
}
