/**
 *  Shape.ts
 *
 *  Abstract base class for all geometry types in Meshup (Mesh, Curve, Polygon, Vertex).
 *
 *  Provides:
 *    - id()           — UUID for this instance
 *    - type()         — 'Mesh' | 'Curve' | 'Polygon' | 'Vertex', implemented by each subclass
 *    - subtype()      — finer classification, implemented by each subclass
 *    - Shape.isShape() — type guard
 *    - Common transforms: translate, move, rotate, scale, mirror, copy (abstract)
 *    - Delegate shorthands: move, moveX/Y/Z, rotateX/Y/Z (concrete, call abstract translate/rotateAround)
 */

import { Style } from './Style';
import { SceneNode } from './SceneNode';
import { activeLayerOf } from './sceneDecorators';
import { Bbox } from './Bbox';

import type { PointLike, Axis } from './types';
import { isPointLike } from './types';
import type { ShapeCollection } from './ShapeCollection';
import { Point } from './Point';

import { uuid, nodeToString } from './utils';

/** Anything align()/alignTo() can be aimed at: a Shape, a ShapeCollection (both have a
 *  bbox()), or a bare point (treated as a zero-size bbox at that location). */
export type AlignTarget = Shape | ShapeCollection<any> | Point | PointLike;

export abstract class Shape
{
    private _id: string;
    abstract readonly type: 'Curve' | 'Mesh' | 'Polygon' | 'Vertex';
    _node: SceneNode | null = null;
    style: Style = new Style();
    metadata: Record<string, any> = {};

    /** Opaque back-reference to the host modeler (set by the app when a shape is adopted
     *  into a scene). meshup only carries and propagates it — it NEVER calls into it; the
     *  host uses it to reach app modules (annotator/materials/…) from any shape. */
    _modeler: any = null;
    /** Assigned material name (see the host's materials module). Set via `.material('wood')`. */
    _material?: string;
    /** True when this shape's name was inherited from a copy() source; the host auto-namer
     *  may then rename it after the variable it is assigned to. */
    _nameInherited?: boolean;
    /** Sticky flag set by `tmp()`: while true, scene decorators and copy() do no scene
     *  bookkeeping for this shape and mark any shape derived from it `tmp()` too. */
    _suppressScene?: boolean;
    /** The scene root this shape belongs to, kept even while the shape is detached (`_node`
     *  null). Sub-shape accessors (segments/start/vertices/…) hand back fresh, unattached
     *  shapes; carrying the root is what lets a later scene op on such a shape still resolve
     *  the active layer. Cleared by removeFromScene() — a shape taken out of the scene must
     *  not find its way back in. */
    _scene: SceneNode | null = null;

    constructor()
    {
        this._id = uuid();
    }

    inner():any
    {
        throw new Error('Shape::inner(): method not implemented for base Shape class.');
    }

    /** Annotations (dimension lines, labels) linked to this Shape by the host app.
     *  meshup itself never reads these — it only keeps the two-sided link intact. */
    _annotations: Array<any> = [];

    /** Link annotation(s) to this Shape (host-app side of the two-sided annotation link) */
    addAnnotations(annotations: any|Array<any>): this
    {
        // NOTE: several from()-constructors use Object.create and skip field initializers
        if (!this._annotations){ this._annotations = []; }
        const list = Array.isArray(annotations) ? annotations : [annotations];
        list.forEach(a => { if (a && !this._annotations.includes(a)) this._annotations.push(a); });
        return this;
    }

    /** Annotations linked to this Shape */
    annotations(): Array<any>
    {
        return this._annotations ?? [];
    }

     //// ABSTRACT: implemented by subclasses ////

    abstract is2D(): boolean;
    abstract bbox(): Bbox | undefined;

    abstract translate(px: PointLike | number, dy?: number, dz?: number): this;
    abstract rotate(angleDeg: number, axis?: Axis | PointLike, pivot?: PointLike): this;
    abstract rotateAround(angleDeg: number, axis: Axis | PointLike, pivot?: PointLike): this;
    abstract rotateQuaternion(wOrObj: number | { w: number; x: number; y: number; z: number }, x?: number, y?: number, z?: number): this;
    abstract scale(factor: number | PointLike, origin?: PointLike): this;
    abstract mirror(dir: Axis | PointLike, pos?: PointLike): this;
    abstract mirrorX(x?: number): this;
    abstract mirrorY(y?: number): this;
    abstract mirrorZ(z?: number): this;

    /** Pure kernel clone — never touches the scene graph. Implemented by each subclass.
     *  Use this for throwaway/internal copies inside kernel operations. */
    abstract _copy(): this;

    /** Public copy. Clones via `_copy()`, then — unless this shape is `tmp()` — adds the
     *  clone to the active layer. `copy()` means "give me a new shape", and new shapes render:
     *  the clone is attached whenever a layer is reachable, which includes copying a DETACHED
     *  but scene-derived shape (`curve.segments().first().copy()`) via the carried `_scene`.
     *  The clone inherits the opaque `_modeler` and is flagged `_nameInherited` so the host
     *  auto-namer can rename it after its variable.
     *
     *  Inside kernel operations use `_copy()` instead — it is the pure clone and never touches
     *  the scene. Do NOT reach for `tmp()` there: `_suppressScene` is sticky and propagates to
     *  every derived shape, so a tmp'd internal copy would suppress the real result too. */
    copy(): this
    {
        const c = this._copy();
        c._modeler = this._modeler;
        c._scene = this._node?.root() ?? this._scene;
        c._nameInherited = true;
        c._material = this._material;

        if (this._suppressScene)
        {
            c._suppressScene = true;
            return c;
        }

        const layer = activeLayerOf(this);
        if (layer) (layer as SceneNode).addShape(c as any);
        return c;
    }

    abstract length(): number | undefined;
    abstract area(): number | undefined;
    abstract volume(): number | undefined;


    //// IDENTITY ////

    id(): string
    {
        return this._id;
    }

    node(): SceneNode | null
    {
        return this._node;
    }

    //// SCENE MEMBERSHIP ////

    /** Remove this shape from the scene (detaches its SceneNode). Returns `this`. */
    removeFromScene(): this
    {
        this._node?.detach();
        this._node = null;
        this._scene = null;
        return this;
    }

    /** Mark this shape as temporary: detach it from the scene AND set a sticky
     *  `_suppressScene` flag so that every subsequent scene op (copy/extrude/split/…) on it
     *  is a no-op and every shape derived from it is `tmp()` too. Ideal for building helper
     *  geometry inside advanced methods. `addToScene()` (host) clears the flag. Returns `this`. */
    tmp(): this
    {
        this._suppressScene = true;
        return this.removeFromScene();
    }

    //// CLASSIFICATION ////

    /** True for curve-like shapes: mesh Curve (brep Edge/Wire once wired). */
    isCurve(): boolean
    {
        const t = this.type as string;
        return t === 'Curve' || t === 'Edge' || t === 'Wire';
    }

    /** True for solid-like shapes: mesh Mesh (brep Shell/Solid once wired). */
    isSolid(): boolean
    {
        const t = this.type as string;
        return t === 'Mesh' || t === 'Shell' || t === 'Solid';
    }

    get shapeKind(): 'closed' | 'linear'
    {
        return this.isCurve() ? 'linear' : 'closed';
    }

    /** Get or set a name for this shape (stored in metadata).
     *  - Called with a string: sets the name and returns this (chainable).
     *  - Called with no arguments: returns the current name or undefined.
     */
    name(n: string): this;
    name(): string | undefined;
    name(n?: string): this | string | undefined
    {
        if (n !== undefined)
        {
            this.metadata.name = n;
            // Keep the scene node label in sync so the scenegraph/viewer show the name.
            if (this._node) this._node.name = n;
            // An explicit / auto-assigned name is authoritative: clear the inherited flag.
            this._nameInherited = false;
            return this;
        }
        return this.metadata.name as string | undefined;
    }

    subtype(): string|null 
    { 
        return (this.metadata?.subtype as string) ?? null;
    } 

    /** Implement this and ShapeCollection allows it */
    isShapeClass(): boolean
    {
        return true;
    }

    //// TYPE GUARD ////

    static isShape(o: unknown): o is Shape
    {
        return o instanceof Shape;
    }

    static isShapeCollection(o: unknown): o is ShapeCollection
    {
        return false;
    }

    //// TRANSFORM SHORTHANDS ////

    move(px: PointLike | number, dy?: number, dz?: number): this
    {
        return this.translate(px, dy, dz);
    }

    moveX(dx: number): this { return this.translate(dx, 0, 0); }
    moveY(dy: number): this { return this.translate(0, dy, 0); }
    moveZ(dz: number): this { return this.translate(0, 0, dz); }

    /** Move this shape so its bbox centre lands on `target` */
    moveTo(target: PointLike | number, py?: number, pz?: number): this
    {
        const bb = this.bbox();
        if (!bb) return this;
        const c = bb.center();
        const t = Point.from(target as PointLike, py, pz);
        return this.translate(t.x - c.x, t.y - c.y, t.z - c.z);
    }

    moveToX(x: number): this { const bb = this.bbox(); return bb ? this.translate(x - bb.center().x, 0, 0) : this; }
    moveToY(y: number): this { const bb = this.bbox(); return bb ? this.translate(0, y - bb.center().y, 0) : this; }
    moveToZ(z: number): this { const bb = this.bbox(); return bb ? this.translate(0, 0, z - bb.center().z) : this; }

    rotateX(angleDeg: number, pivot?: PointLike): this { return this.rotateAround(angleDeg, 'x', pivot); }
    rotateY(angleDeg: number, pivot?: PointLike): this { return this.rotateAround(angleDeg, 'y', pivot); }
    rotateZ(angleDeg: number, pivot?: PointLike): this { return this.rotateAround(angleDeg, 'z', pivot); }

    //// ALIGNMENT ////

    /** Translate this shape so that the `pivot` point on its own bbox coincides with
     *  the `alignment` point on `other`'s bbox.
     *
     *  Both `pivot` and `alignment` accept:
     *  - A keyword string combining any of: left, right, front, back, top, bottom
     *    (unspecified axes default to the centre of that axis)
     *  - A PointLike [x%, y%, z%] where 0 = min-side and 1 = max-side
     *
     *  `other` may be a Shape, a Point, or a raw PointLike; a point is treated as a
     *  zero-size bbox at that location (as if it were a Vertex).
     *
     *  @example
     *    box.align(shelf, 'bottom', 'top')  // sits box on top of shelf
     *    box.align(other, 'center', 'center') // centres box on other
     *    box.align(curve.middle(), 'lefttop') // align to a bare point
     */
    align(other: AlignTarget, pivot: string | PointLike = 'center', alignment: string | PointLike = 'center'): this
    {
        const selfBbox  = this.bbox();
        const otherBbox = Shape.bboxOf(other);
        if (!selfBbox || !otherBbox) return this;

        const fromPos = Shape.bboxPointOf(selfBbox, pivot);
        const toPos   = Shape.bboxPointOf(otherBbox, alignment);

        return this.translate(toPos.x - fromPos.x, toPos.y - fromPos.y, toPos.z - fromPos.z);
    }

    /** Alias for align() */
    alignTo(other: AlignTarget, pivot: string | PointLike = 'center', alignment: string | PointLike = 'center'): this
    {
        return this.align(other, pivot, alignment);
    }

    /** Bbox of anything an alignment can target: a Shape, a ShapeCollection, or a bare point.
     *  A Point / PointLike behaves like a Vertex: a zero-size bbox at that location. */
    static bboxOf(target: AlignTarget): Bbox | undefined
    {
        if (typeof (target as { bbox?: unknown })?.bbox === 'function')
        {
            return (target as { bbox(): Bbox | undefined }).bbox();
        }
        const p = new Point(target as Point | PointLike);
        return new Bbox([p.x, p.y, p.z], [p.x, p.y, p.z]);
    }

    /** Resolve an alignment spec — a corner keyword ('lefttop') or a [x%, y%, z%] triple —
     *  to a world-space Point on `bb`. */
    static bboxPointOf(bb: Bbox, spec: string | PointLike): Point
    {
        return isPointLike(spec) ? Shape.bboxPercToPoint(bb, spec) : bb.corner(spec as string);
    }

    /** Resolve a [x%, y%, z%] percentage triple to a world-space Point within `bb`. */
    static bboxPercToPoint(bb: Bbox, perc: PointLike): Point
    {
        const p = new Point(perc);
        return new Point(
            bb.minX() + p.x * bb.width(),
            bb.minY() + p.y * bb.depth(),
            bb.minZ() + p.z * bb.height(),
        );
    }

    //// STYLING ////

    color(color: number | string, g?: number, b?: number): this
    {
        if (typeof color === 'number' && typeof g === 'number' && typeof b === 'number')
        {
            this.style.color = [color, g, b];
        }
        else
        {
            this.style.color = color as string;
        }
        return this;
    }

    opacity(opacity: number): this
    {
        this.style.opacity = opacity;
        return this;
    }

    alpha(a: number): this { return this.opacity(a); }

    strokeWidth(width: number): this
    {
        this.style.strokeWidth = width;
        return this;
    }

    hide(): this
    {
        this.style.visible = false;
        return this;
    }

    show(): this
    {
        this.style.visible = true;
        return this;
    }

    /** Drop every style set on this Shape, back to the defaults.
     *
     *  A fresh {@link Style} rather than a cleared one, so the "explicitly set"
     *  bookkeeping resets too: after this the Shape contributes nothing of its
     *  own to the scene's style cascade, exactly as if it had never been styled.
     *  That is the difference between this and setting the properties back to
     *  their default values by hand, which would keep overriding a parent.
     */
    resetStyle(): this
    {
        this.style = new Style();
        return this;
    }

    //// SELECTING ////

    select(_what: string)
    {
        throw new Error('select() method not implemented for base Shape class.');
    }

    //// OUTPUT ////

    toString(): string
    {
        return `<Shape id=${this.id()} type=${this.type} subtype=${this.subtype()} ${this.nodeString()}>`;
    }

    /** Scene membership of this Shape, as shown by every toString(): the node holding it,
     *  or that it is not in the scene at all. */
    nodeString(): string
    {
        return nodeToString(this._node);
    }

    async toGLB(up: Axis = 'z'): Promise<Uint8Array|undefined>
    {
        throw new Error('toGLB() method not implemented for base Shape class.');
    }

    async toGLTF(up: Axis = 'z'): Promise<string|undefined>
    {
        throw new Error('toGLTF() method not implemented for base Shape class.');
    }

    toSVG(): string
    {
        throw new Error('toSVG() method not implemented for base Shape class.');
    }
}
