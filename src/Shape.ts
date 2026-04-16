/**
 *  Shape.ts
 *
 *  Abstract base class for all geometry types in Meshup (Mesh, Curve).
 *
 *  Provides:
 *    - id()           — UUID for this instance
 *    - type()         — 'Mesh' | 'Curve', implemented by each subclass
 *    - subType()      — finer classification, implemented by each subclass
 *    - Shape.isShape() — type guard
 */

import { Style } from './Style';
import { SceneNode } from './SceneNode';

import { uuid } from './utils';
// import { Selector } from './Selector';

export abstract class Shape
{
    private _id: string;
    _node: SceneNode | null = null; // The SceneNode this shape belongs to, or null if not in a container
    style: Style = new Style(); // Style properties for export (color, lineWidth, etc)
    metadata: Record<string, any> = {};

    constructor()
    {
        this._id = uuid();
    }

    /** UUID for this shape instance. */
    id(): string
    {
        return this._id;
    }

    node(): SceneNode | null
    {
        return this._node;
    }

    // Abstract methods to be implemented by concrete subclasses (Mesh, Curve)

    abstract type(): 'Mesh' | 'Curve';
    abstract subType(): string|null;
    abstract is2D(): boolean;
    abstract bbox(): { min(): { x: number; y: number; z: number }; max(): { x: number; y: number; z: number } } | undefined;

    /** Type guard — returns true for any Mesh or Curve instance. */
    static isShape(o: unknown): o is Shape
    {
        return o instanceof Shape;
    }

    //// STYLING ////

    /** Shortcut for `Shape.style.color`. Accepts `'red'`, `'#ff0000'`, or `r, g, b` (0–255). */
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

    /** Shortcut for `Shape.style.opacity`. Value between 0 (transparent) and 1 (opaque). */
    opacity(opacity: number): this
    {
        this.style.opacity = opacity;
        return this;
    }

    /** Alias for `opacity()`. */
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

    select(what:string)
    {
        // Implemented in subclasses to avoid circular dependency on Selector class, which needs to import Shape for type definitions. Selector is a higher-level utility that can operate on any Shape, so it shouldn't be imported into the base Shape class.
         throw new Error('select() method not implemented for base Shape class.');
    }

    //// GENERAL OUTPUT METHODS ////

}
