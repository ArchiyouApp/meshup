/**
 *  SceneNode.ts
 *
 *  Manages a nested scene hierarchy of Shapes (Meshes / Curves), similar to
 *  a Blender ShapeCollection or a GLTF Node.  Every shape on the scene needs to be
 *  wrapped in a SceneNode.  The scene root is also a SceneNode.
 *
 *  Key concepts:
 *   - A SceneNode can hold 0 or one shape directly AND 0..N child SceneNodes.
 *   - If a SceneNode holds no shapes (directly) it is considered a "layer".
 *   - Style cascades from ancestors to descendants at export time.
 *   - SceneNodes export to SVG as nested <g> elements and to GLTF as nested
 *     Nodes via gltf-transform.
 *
 *  The class is generic over S (the shape type it holds).
 *  The default S = Shape (Vertex| Curve| Polygon | Mesh ) preserves existing behaviour.
 *  SmartSceneNode uses S = SmartShape.
 */


import { Shape } from './Shape';

import { Style } from './Style';
import type { StyleData } from './Style';
import type { Axis, ShapeType, SceneNodeGraphNode, BasePlane } from './types';
import { ShapeCollection } from './ShapeCollection';
import { GLTFBuilder } from './GLTFBuilder';


/** Minimal interface that any shape stored in a SceneNode must satisfy. */
export interface SceneNodeShape {
    type: ShapeType | string
    subtype(): string | null
    _node: SceneNode<any> | null
    style: Style
    is2D(): boolean
    bbox(): { min(): { x: number; y: number; z: number }; max(): { x: number; y: number; z: number } } | undefined
    // OUTPUT
    toGLTF?(): any // TODO: type
    toGLB?(): any // TODO: type
    toGLTFBuffer?(): any // TODO: type
    toSVG?() : string
    toSVGElem?(): string
}

export class SceneNode<S extends SceneNodeShape = Shape>
{
    name: string;
    style: Style;

    private _shape: S | null = null; // Shape held directly in this container (not in child containers)
    private _children: SceneNode<S>[] = []; // Child containers (sub-groups / layers)
    private _parent: SceneNode<S> | null = null; // Back-reference to the parent container; null if this is the root

    constructor(name = 'container')
    {
        this.name = name;
        this.style = new Style();
    }

    //// STATIC FACTORIES ////

    /** Create a root container (no parent). */
    static root<T extends SceneNode<any>>(this: new (name: string) => T, name = 'root'): T
    {
        return new this(name);
    }

    /** Wrap a single shape in a new container. */
    static from<S extends SceneNodeShape = Shape>(shape: S, name?: string): SceneNode<S>
    {
        const label = name || this.getName(shape);
        const c = new SceneNode<S>(name ?? label);
        c.setShape(shape);
        return c;
    }

    //// FACTORY HELPER (overrideable by subclasses) ////

    /** Create a new child node of the same concrete type. Override in subclasses. */
    protected _createChild(name: string): SceneNode<S>
    {
        return new SceneNode<S>(name);
    }

    /** Find a label based on shape */
    static getName<S extends SceneNodeShape>(s: S): string
    {
        const sub = s.subtype();
        return sub ? `${s.type}:${sub}` : s.type;
    }

    //// SHAPE MANAGEMENT ////

     /**
     * Convenience method: adds a child SceneNode or a Shape to this node
     *   - String → addChild(new SceneNode(string)) - new child container with given name
     *   - SceneNode<S> → addChild()
     *   - S = Shape (or subclass) → addShape()
     *   - ShapeCollection → addShape() for each (only meaningful when S = Shape)
     * 
     *   NOTE: _setShape only for internal use
     */
    add(...items: Array<string | SceneNode<S> | S | ShapeCollection>): this
    {
        for (const item of items)
        {
            if (typeof item === 'string')
            {
                // Name of new SceneNode: create it and add as child to current node
                this.addChild(this._createChild(item));
            }
            else if (item instanceof SceneNode) this.addChild(item as SceneNode<S>);
            else if (item instanceof ShapeCollection || Shape.isShape(item))  // any shape
            {
                const items = item instanceof ShapeCollection ? item.shapes() : [item as S];    
                items.forEach(shape =>
                {
                    this.addShape(shape as S);
                });
            }
            
            else {
                throw new Error(`SceneNode.add(): Invalid item: ${item}. Must be a string (new child name), SceneNode, ShapeCollection, or Shape.`);
            }
        }
        return this;
    }

    /** Add new empty SceneNode (=layer) and populate it with the given shape(s).
     *  Dot-notation creates nested layers: 'walls.inner' finds or creates 'walls',
     */
    addLayer(name: string, item: S | ShapeCollection): SceneNode<S>
    {
        const parts = name.split('.');
        const bottomName = parts.pop()!;

        // Walk / create the intermediate layers
        let parent: SceneNode<S> = this;
        for (const part of parts)
        {
            const existing = parent._children.find(c => c.name === part);
            if (existing)
            {
                parent = existing;
            }
            else
            {
                const intermediate = this._createChild(part);
                parent.addChild(intermediate);
                parent = intermediate;
            }
        }

        // Find or create the bottom layer and add the item
        const existing = parent._children.find(c => c.name === bottomName);
        const layer = existing ?? this._createChild(bottomName);
        if (!existing) parent.addChild(layer);

        const items = item instanceof ShapeCollection ? item.shapes() : [item as S];
        items.forEach(shape =>
        {
            layer.addShape(shape as S);
        });
        
        return layer;
    }

    /** Wrap Shape in a new SceneNode and add it as a child. */
    addShape(s:S):this
    {
        // If already has a node. Move node to current container
        if (s._node && s._node !== this)
        {
            const existingNode = s._node as SceneNode<S>;
            existingNode.detach();
            this.addChild(existingNode);
            return this;
        }
        const childNode = this._createChild(SceneNode.getName(s));
        childNode.setShape(s as unknown as S);
        this.addChild(childNode);
        return this;
    }

    /**
     * Attach a shape to this node. Automatically detaches the shape from its previous node if it has one.
     */
    setShape(shape: S): this
    {
        if (this._shape === shape) return this;
        // Detach from previous node
        if (shape._node && shape._node !== this)
        {
            (shape._node as SceneNode<S>).resetShape(shape);
        }
        if (this._shape) this._shape._node = null;
        this._shape = shape;
        shape._node = this;
        return this;
    }

    /** Remove a shape from this SceneNode. */
    resetShape(shape: S): this
    {
        if (this._shape === shape)
        {
            this._shape._node = null;
            this._shape = null;
        }
        return this;
    }

    /** Return Shape held by this SceneNode */
    shape()
    {
        return this._shape;
    }

    /** Return shapes held by this SceneNode and its children */
    shapes(): ShapeCollection
    {
        return new ShapeCollection(
            this._traverse().flatMap(c => c._shape ? [c._shape] : []));
    }

    /** True when this container holds no shapes directly (acts as a layer). */
    isLayer(): boolean
    {
        return this._shape === null;
    }

    /** True when this container holds at least one shape directly. */
    hasShape(): boolean
    {
        return this._shape !== null;
    }

    //// CHILD MANAGEMENT ////

    /** Add a child container. Sets child._parent to this. Returns `this`. */
    addChild(child: SceneNode<S>): this
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
    removeChild(child: SceneNode<S>): this
    {
        const idx = this._children.indexOf(child);
        if (idx !== -1)
        {
            child._parent = null;
            this._children.splice(idx, 1);
        }
        return this;
    }

    /** Remove a shape from this node (public alias for resetShape). */
    removeShape(shape: S): this
    {
        return this.resetShape(shape);
    }

    /** Remove a child SceneNode or a Shape from this node. */
    remove(item: SceneNode<S> | S): this
    {
        if (item instanceof SceneNode) return this.removeChild(item as SceneNode<S>);
        return this.resetShape(item as S);
    }

    /** Detach this container from its parent. Returns `this`. */
    detach(): this
    {
        if (this._parent) this._parent.removeChild(this);
        return this;
    }

    //// TRAVERSAL ////

    /** Return direct child containers. */
    children(): SceneNode<S>[]
    {
        return [...this._children];
    }

    /** Return all descendant containers recursively (depth-first). */
    allChildren(): SceneNode<S>[]
    {
        return this._traverse().slice(1); // exclude self
    }

    /** Return the parent container, or null if this is the root. */
    parent(): SceneNode<S> | null
    {
        return this._parent;
    }

    /** Return all ancestors from immediate parent up to (and including) the root. */
    ancestors(): SceneNode<S>[]
    {
        const collect = (node: SceneNode<S> | null, acc: SceneNode<S>[]): SceneNode<S>[] =>
            node ? collect(node._parent, [...acc, node]) : acc;
        return collect(this._parent, []);
    }

    /** Return all descendant containers in BFS order (not including this). */
    descendants(): SceneNode<S>[]
    {
        // Skip `this` itself — start from children
        const all = this._traverse();
        return all.slice(1); // first element is `this`
    }

    /** Return the root container (walk up _parent chain). */
    root(): SceneNode<S>
    {
        const walk = (node: SceneNode<S>): SceneNode<S> =>
            node._parent ? walk(node._parent) : node;
        return walk(this);
    }

    /** True when this container has no parent. */
    isRoot(): boolean
    {
        return this._parent === null;
    }

    /** Find the first descendant (DFS) whose name matches. */
    find(name: string): SceneNode<S> | undefined
    {
        return this._children.reduce<SceneNode<S> | undefined>((found, child) =>
        {
            if (found) return found;
            if (child.name === name) return child;
            return child.find(name);
        }, undefined);
    }

    /** Return all descendants (DFS) matching the predicate. */
    findAll(pred: (c: SceneNode<S>) => boolean): SceneNode<S>[]
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

    hide(): this
    {
        return this.visible(false);
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
     * external code that does not understand SceneNode hierarchies.
     */
    applyStyle(): this
    {
        const eff = this.effectiveStyle();
        this.shapes().forEach(shape => shape.style.merge(eff.toData()));
        return this;
    }

    //// TO GRAPH ───────────────────────────────────────────────────────────────

    /** Return a plain-object tree representation of this container hierarchy. */
    toGraph(): SceneNodeGraphNode
    {
        return {
            name: this.name,
            isLayer: this.isLayer(),
            hasShape: !!this._shape,
            shapeType: this._shape ? this._shape.type : undefined,
            style: this.style.explicitData(),
            children: this._children.map(c => c.toGraph()),
        };
    }

    //// GLTF EXPORT ////

    /** Export this node hierarchy as a GLTF JSON string. */
    async toGLTF(up: Axis = 'z'): Promise<string>
    {
        return new GLTFBuilder(up, this.name).addSceneNode(this).applyExtensions().toGLTF();
    }

    /** Export this node hierarchy as a GLB binary (Uint8Array). */
    async toGLB(up: Axis = 'z'): Promise<Uint8Array>
    {
        return new GLTFBuilder(up, this.name).addSceneNode(this).applyExtensions().toGLB();
    }

    //// SVG EXPORT ────────────────────────────────────────────────────────────

    /**
     * Return a `<g>` SVG element for this node (with nested children).
     * Only 2D shapes (is2D() === true) are included; non-2D shapes are silently skipped.
     * Invisible nodes emit `<g display="none">` to preserve structure.
     */
    toSVGElem(): string
    {
        const eff = this.effectiveStyle();
        const displayAttr = eff.visible ? '' : ' display="none"';
        const lines: string[] = [`<g id="${this.name}"${displayAttr}>`];

        if (this._shape && this._shape.is2D() && this._shape.toSVGElem)
        {
            lines.push('  ' + this._shape.toSVGElem());
        }

        this._children.forEach(child =>
        {
            const childGroup = child.toSVGElem();
            lines.push(...childGroup.split('\n').map(l => '  ' + l));
        });

        lines.push('</g>');
        return lines.join('\n');
    }

    /**
     * Export this node hierarchy as a self-contained SVG string.
     * Only 2D shapes are included; the viewBox is the union of their bounding boxes.
     */
    toSVG(): string
    {
        const shapes2D = this.shapes().filter(s => s.is2D());

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shapes2D.forEach(shape =>
        {
            const bb = shape.bbox();
            if (!bb) return;
            minX = Math.min(minX, bb.min().x);
            minY = Math.min(minY, -bb.max().y); // SVG Y-axis is flipped
            maxX = Math.max(maxX, bb.max().x);
            maxY = Math.max(maxY, -bb.min().y);
        });

        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }

        const w = maxX - minX;
        const h = maxY - minY;
        const pad = Math.max(w, h) * 0.05 || 1;

        const vbX = +(minX - pad).toFixed(6);
        const vbY = +(minY - pad).toFixed(6);
        const vbW = +(w + 2 * pad).toFixed(6);
        const vbH = +(h + 2 * pad).toFixed(6);

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}">\n${this.toSVGElem()}\n</svg>`;
    }

    //// INTERNAL HELPERS ////

    /** BFS traversal that includes `this` as the first element. */
    protected _traverse(): SceneNode<S>[]
    {
        const bfs = (queue: SceneNode<S>[], acc: SceneNode<S>[]): SceneNode<S>[] =>
        {
            if (queue.length === 0) return acc;
            const [cur, ...rest] = queue;
            return bfs([...rest, ...cur._children], [...acc, cur]);
        };
        return bfs([this], []);
    }
}
