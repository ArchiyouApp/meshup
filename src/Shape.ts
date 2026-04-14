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

    //// GENERAL OUTPUT METHODS ////

}
