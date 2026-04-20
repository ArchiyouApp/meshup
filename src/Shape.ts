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
import { Bbox } from './Bbox';

import type { PointLike, Axis } from './types';
import type { ShapeCollection } from './ShapeCollection';

import { uuid } from './utils';

export abstract class Shape
{
    private _id: string;
    _node: SceneNode | null = null;
    style: Style = new Style();
    metadata: Record<string, any> = {};

    constructor()
    {
        this._id = uuid();
    }

    inner():any
    {
        throw new Error('Shape::inner(): method not implemented for base Shape class.');
    }

     //// ABSTRACT: implemented by subclasses ////

    abstract type(): 'Curve' | 'Mesh' | 'Polygon' | 'Vertex';
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
    abstract copy(): this;

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

    rotateX(angleDeg: number, pivot: PointLike = [0, 0, 0]): this { return this.rotateAround(angleDeg, 'x', pivot); }
    rotateY(angleDeg: number, pivot: PointLike = [0, 0, 0]): this { return this.rotateAround(angleDeg, 'y', pivot); }
    rotateZ(angleDeg: number, pivot: PointLike = [0, 0, 0]): this { return this.rotateAround(angleDeg, 'z', pivot); }

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

    //// SELECTING ////

    select(_what: string)
    {
        throw new Error('select() method not implemented for base Shape class.');
    }

    //// OUTPUT ////

    toString(): string
    {
        return `<Shape id=${this.id()} type=${this.type()} subtype=${this.subtype()}>`;
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
