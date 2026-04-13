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

import { uuid } from './utils';

export abstract class Shape
{
    private _id: string;

    constructor()
    {
        this._id = uuid();
    }

    /** UUID for this shape instance. */
    id(): string
    {
        return this._id;
    }

    /** Primary geometry type: 'Mesh' or 'Curve'. */
    abstract type(): 'Mesh' | 'Curve';

    /** Finer classification within the type
     *   For Mesh: 'mesh' (generic), 'box', 'sphere', etc.
     *   For Curve: 'line', 'arc', 'circle', 'ellipse', 'spline', etc.
     *  Returns null if no subType or unrecognized type.
     */
    abstract subType(): string|null;

    /** Type guard — returns true for any Mesh or Curve instance. */
    static isShape(o: unknown): o is Shape
    {
        return o instanceof Shape;
    }
}
