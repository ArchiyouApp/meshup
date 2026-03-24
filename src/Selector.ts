/**
 *  Selector.ts
 *      Select (sub)shapes from Collections, Mesh and Curve objects
 *  
 *  Shapes: 
 *      - Mesh (if collection)
 *      - Vertex
 *      - Edge (=Curve Span? - TODO: extract from Mesh edges?)
 *      - Wire (=(Compound)Curve - TODO: extract from Mesh polygons?)
 *      - Face (=Polygon, Mesh only)
 * 
 */

import { Collection } from "./Collection";
import { 
    MAIN_AXIS,
    SELECTOR_SHAPES,
    BASE_PLANE_NAME_TO_PLANE
  } from "./constants"
import { Curve } from "./Curve";
import { Mesh } from "./Mesh";
import { Point } from "./Point";
import { Polygon } from "./Polygon";
import { Vector } from "./Vector";
import { isPointLike } from "./types"
import type { Axis, PointLike } from "./types"

//// CONFIG ////


const SELECTORS = {
    // Order of patterns matters, more specific ones should be defined first
    side: {
        // Get subshapes that are parallal to bbox sides (e.g. top, bottom, left, right, front, back) of target
        // Example: "face||front" to get faces parallel to the front plane of the target
        pattern: '{{shape}}||{{side}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: ['face'], 
        side: BASE_PLANE_NAME_TO_PLANE,
    },
    parallel: {
        // Get subshapes that are parallel to target shape
        pattern: '{{shape}}|{{axis|plane}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: ['face', 'edge', 'wire'],
        axis: MAIN_AXIS,
        plane: BASE_PLANE_NAME_TO_PLANE,
    },
    closest: {
        // Get subshape(s) that are closest to a target point, axis, or plane
        pattern: '{{shape}}<<->{{point|axis|plane}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: SELECTOR_SHAPES,
        axis: MAIN_AXIS,
        plane: BASE_PLANE_NAME_TO_PLANE,
    },
    furthest: {
        // Get subshape(s) that are furthest from a target point, axis, or plane
        pattern: '{{shape}}<->>{{point|axis|plane}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: SELECTOR_SHAPES,
        point: isPointLike,
        axis: MAIN_AXIS,
        plane: BASE_PLANE_NAME_TO_PLANE,
    },
    positive: {
        // Get subshapes in the positive half-space of a target axis or plane
        pattern: '{{shape}}+{{axis}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: SELECTOR_SHAPES,
        axis: MAIN_AXIS,
    },
    negative: {
        // Get subshapes in the negative half-space of a target axis or plane
        pattern: '{{shape}}-{{axis}}',
        target: ['collection', 'mesh', 'curve'], // only these types can be the target of a side selector
        shape: SELECTOR_SHAPES,
        axis: MAIN_AXIS,
    }
}

/** Shape shortcuts are configured here */
const SHAPE_SHORTCUTS: Record<string, string> = {
    F: 'face',
    E: 'edge', 
    W: 'wire',
    V: 'vertex',
    M: 'mesh',
    C: 'curve',
};

//// LOCAL TYPES ////

type SelectorType = keyof typeof SELECTORS;

interface SlotMatch {
    /** Which parameter name the value matched (e.g. 'shape', 'axis', 'plane') */
    param: string;
    raw: string; // The raw captured string
    value: any; // The resolved value: the string itself for arrays, the object entry for objects, or parsed value for functions
}

//// MAIN CLASS ////

export class Selector 
{
    /** The matched selector type (e.g. 'side', 'parallel', 'closest') */
    type: SelectorType | null = null;
    /** Resolved parameter values keyed by parameter name */
    params: Record<string, any> = {};    
    _raw: string; // The original input string
    _parsed: boolean = false; // Whether parsing succeeded

    /** Parse selector string and initialize selector */
    constructor(selectorString: string)
    {
        this._raw = selectorString;
        this._parse(selectorString);
    }

    /** Execute the selector on a target object */
    execute(target: Collection|Mesh|Curve): any
    {
        if (!this._parsed)
        {
            throw new Error('Cannot execute selector: parsing failed.');
        }

        const method = (this as any)[`_${this.type}`];
        if (typeof method !== 'function')
        {
            throw new Error(`Selector::execute(): Selector type "${this.type}" is not implemented.`);
        }

        return method.call(this, target);
    }

    //// PER SELECTOR-TYPE IMPLEMENTATIONS ////

    /** Angle tolerance in degrees for "parallel" normal comparisons */
    static ANGLE_TOLERANCE = 1.0;

    /**
     *  side: face||<side>
     *  Return faces whose normal is parallel (within tolerance) to the side plane normal.
     */
    private _side(target: Collection | Mesh | Curve): Array<Polygon>
    {
        const planeNormal = new Vector(this.params.side.normal);
        return this._facesFromTarget(target)
            .filter(f => this._normalIsParallel(f.normal(), planeNormal));
    }

    /**
     *  parallel: <shape>|<axis|plane>
     *  Return subshapes whose orientation is parallel to the given axis or plane normal.
     */
    private _parallel(target: Collection | Mesh | Curve): Array<Polygon | Curve>
    {
        const refNormal = this._refNormal();
        const shape = this.params.shape as string;
        if (shape === 'face')
        {
            return this._facesFromTarget(target)
                .filter(f => this._normalIsParallel(f.normal(), refNormal));
        }
        // edge / wire
        // TODO: edge and wire selection from meshes not yet available
        return [];
    }

    /**
     *  closest: <shape><<-><point|axis|plane>
     *  Return the single subshape whose center is closest to the reference.
     */
    private _closest(target: Collection | Mesh | Curve): Polygon | Point | Curve | null
    {
        const items = this._subshapesFromTarget(target);
        if (items.length === 0) return null;

        let best: any = null;
        let bestDist = Infinity;
        for (const item of items)
        {
            const d = this._distanceToRef(this._shapeCenter(item));
            if (d < bestDist) { bestDist = d; best = item; }
        }
        return best;
    }

    /**
     *  furthest: <shape><->><point|axis|plane>
     *  Return the single subshape whose center is furthest from the reference.
     */
    private _furthest(target: Collection | Mesh | Curve): Polygon | Point | Curve | null
    {
        const items = this._subshapesFromTarget(target);
        if (items.length === 0) return null;

        let best: any = null;
        let bestDist = -Infinity;
        for (const item of items)
        {
            const d = this._distanceToRef(this._shapeCenter(item));
            if (d > bestDist) { bestDist = d; best = item; }
        }
        return best;
    }

    /**
     *  positive: <shape>+<axis>
     *  Return subshapes whose center has a positive coordinate along the given axis.
     */
    private _positive(target: Collection | Mesh | Curve): Array<Polygon | Point | Curve>
    {
        const axis = this.params.axis as Axis;
        return this._subshapesFromTarget(target)
            .filter(item => this._axisCoord(this._shapeCenter(item), axis) > 0);
    }

    /**
     *  negative: <shape>-<axis>
     *  Return subshapes whose center has a negative coordinate along the given axis.
     */
    private _negative(target: Collection | Mesh | Curve): Array<Polygon | Point | Curve>
    {
        const axis = this.params.axis as Axis;
        return this._subshapesFromTarget(target)
            .filter(item => this._axisCoord(this._shapeCenter(item), axis) < 0);
    }

    //// SUBSHAPE EXTRACTION HELPERS ////

    /** Get all faces (Polygons) from a target */
    private _facesFromTarget(target: Collection | Mesh | Curve): Array<Polygon>
    {
        if (target instanceof Mesh) return target.polygons();
        if (target instanceof Collection)
        {
            const faces: Polygon[] = [];
            for (const m of target.meshes()) faces.push(...m.polygons());
            return faces;
        }
        return [];
    }

    /** Get all vertices (Points) from a target */
    private _verticesFromTarget(target: Collection | Mesh | Curve): Array<Point>
    {
        if (target instanceof Mesh) return target.vertices();
        if (target instanceof Curve) return target.controlPoints();
        if (target instanceof Collection)
        {
            const pts: Point[] = [];
            for (const m of target.meshes()) pts.push(...m.vertices());
            for (const c of target.curves()) pts.push(...c.controlPoints());
            return pts;
        }
        return [];
    }

    /** Extract subshapes of the requested shape type from the target */
    private _subshapesFromTarget(target: Collection | Mesh | Curve): Array<any>
    {
        const shape = this.params.shape as string;
        switch (shape)
        {
            case 'face':
                return this._facesFromTarget(target);
            case 'vertex':
                return this._verticesFromTarget(target);
            case 'mesh':
                if (target instanceof Collection) return target.meshes();
                if (target instanceof Mesh) return [target];
                return [];
            case 'curve':
            case 'wire':
                if (target instanceof Collection) return target.curves();
                if (target instanceof Curve) return [target];
                return [];
            case 'edge':
                // TODO: edge extraction not yet available
                return [];
            default:
                return [];
        }
    }

    //// GEOMETRY HELPERS ////

    /** Compute the center of any subshape */
    private _shapeCenter(item: any): Point
    {
        if (item instanceof Point) return item;
        if (item instanceof Polygon || item instanceof Curve || item instanceof Mesh)
        {
            return item.center();
        }
        return new Point(0, 0, 0);
    }

    /** Check if two normals are parallel (same or opposite direction) */
    private _normalIsParallel(a: Vector, b: Vector): boolean
    {
        const angle = a.angle(b);
        return angle < Selector.ANGLE_TOLERANCE || Math.abs(angle - 180) < Selector.ANGLE_TOLERANCE;
    }

    /** Get the reference normal from params (axis or plane) */
    private _refNormal(): Vector
    {
        if (this.params.axis) return new Vector(this.params.axis as Axis);
        if (this.params.plane) return new Vector(this.params.plane.normal);
        return new Vector(0, 0, 1);
    }

    /** Get the coordinate of a point along an axis */
    private _axisCoord(p: Point, axis: Axis): number
    {
        switch (axis) {
            case 'x': return p.x;
            case 'y': return p.y;
            case 'z': return p.z;
        }
    }

    /** Compute distance from a point to the reference (point, axis, or plane) */
    private _distanceToRef(p: Point): number
    {
        if (this.params.point)
        {
            return p.distance(this.params.point);
        }
        if (this.params.axis)
        {
            // Distance to an axis line through the origin
            const axis = this.params.axis as Axis;
            switch (axis)
            {
                case 'x': return Math.sqrt(p.y * p.y + p.z * p.z);
                case 'y': return Math.sqrt(p.x * p.x + p.z * p.z);
                case 'z': return Math.sqrt(p.x * p.x + p.y * p.y);
            }
        }
        if (this.params.plane)
        {
            // Signed distance to a plane through the origin
            const n = new Vector(this.params.plane.normal).normalize();
            return Math.abs(p.x * n.x + p.y * n.y + p.z * n.z);
        }
        return 0;
    }

    //// PARSING ////

    /**
     *  Build a regex from a SELECTORS pattern string.
     *  Replaces each `{{param1|param2}}` slot with a capture group
     *  whose alternatives are the allowed values from the param definitions.
     *  Returns the compiled regex and the parameter names for each slot.
     */
    private _buildRegex(
        pattern: string,
        paramDefs: Record<string, any>
    ): { regex: RegExp; slotNames: string[][] }
    {
        const slotPattern = /\{\{([^}]+)\}\}/g;
        const slotNames: string[][] = [];
        const parts: string[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = slotPattern.exec(pattern)) !== null)
        {
            // Escape the literal text between slots
            if (match.index > lastIndex)
            {
                parts.push(this._escapeRegex(pattern.slice(lastIndex, match.index)));
            }

            const names = match[1].split('|');
            slotNames.push(names);

            // Collect allowed values and detect function validators
            const allValues: string[] = [];
            let hasFunction = false;

            for (const paramName of names)
            {
                const def = paramDefs[paramName];
                if (typeof def === 'function') { hasFunction = true; }
                else if (Array.isArray(def))
                {
                    allValues.push(...def);
                    if (paramName === 'shape')
                    {
                        allValues.push(...Object.keys(SHAPE_SHORTCUTS));
                    }
                }
                else if (typeof def === 'object' && def !== null) { allValues.push(...Object.keys(def)); }
            }

            // If any alternative is a function validator, use a catch-all group;
            // otherwise enumerate the concrete values.
            if (hasFunction)
            {
                parts.push('(.+)');
            }
            else
            {
                parts.push(`(${allValues.map(v => this._escapeRegex(v)).join('|')})`);
            }

            lastIndex = match.index + match[0].length;
        }

        // Trailing literal
        if (lastIndex < pattern.length)
        {
            parts.push(this._escapeRegex(pattern.slice(lastIndex)));
        }

        return { regex: new RegExp(`^${parts.join('')}$`), slotNames };
    }

    /**
     *  Resolve a captured value against the slot's parameter definitions.
     *  Tries concrete matchers (arrays / objects) first, then function validators.
     */
    private _resolveSlot(
        value: string,
        names: string[],
        paramDefs: Record<string, any>
    ): SlotMatch | null
    {
        // Try non-function params first for deterministic matching
        // (e.g. "x" should match axis before falling through to isPointLike)
        const deferred: string[] = [];

        for (const paramName of names)
        {
            const def = paramDefs[paramName];
            const resolvedValue = paramName === 'shape' ? this._normalizeShape(value) : value;
            if (typeof def === 'function')
            {
                deferred.push(paramName);
                continue;
            }
            if (Array.isArray(def) && def.includes(resolvedValue))
            {
                return { param: paramName, raw: value, value: resolvedValue };
            }
            if (typeof def === 'object' && def !== null && value in def)
            {
                return { param: paramName, raw: value, value: def[value] };
            }
        }

        // Fall back to function validators (e.g. isPointLike)
        for (const paramName of deferred)
        {
            const validator = paramDefs[paramName] as Function;
            // Try JSON-parsing first (handles "[1,2,3]" or "{x:1,...}" style strings)
            try
            {
                const parsed = JSON.parse(value);
                if (validator(parsed))
                {
                    return { param: paramName, raw: value, value: parsed };
                }
            }
            catch { /* not valid JSON — try the raw string */ }

            if (validator(value))
            {
                return { param: paramName, raw: value, value };
            }
        }

        return null;
    }

    /**
     *  Try every selector pattern (in definition order), stop at the first match,
     *  validate captured groups and populate `this.type` and `this.params`.
     */
    private _parse(input: string): void
    {
        for (const [name, config] of Object.entries(SELECTORS))
        {
            const { pattern, ...paramDefs } = config;
            const { regex, slotNames } = this._buildRegex(pattern, paramDefs);
            const match = regex.exec(input);

            if (!match) continue;

            // Validate each captured group
            const resolved: Record<string, any> = {};
            let valid = true;

            for (let i = 0; i < slotNames.length; i++)
            {
                const captured = match[i + 1];
                const slot = this._resolveSlot(captured, slotNames[i], paramDefs);
                if (!slot) { valid = false; break; }
                resolved[slot.param] = slot.value;
            }

            if (!valid) continue;

            this.type = name as SelectorType;
            this.params = resolved;
            this._parsed = true;
            return;
        }

        throw new Error(`Selector: Unrecognized selector string: "${input}"`);
    }

    //// UTILS ////

    /** Escape special regex characters in a literal string */
    private _escapeRegex(str: string): string
    {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /** Normalize shape shortcuts (F/E/W/V/M/C) to full shape names */
    private _normalizeShape(value: string): string
    {
        return SHAPE_SHORTCUTS[value.toUpperCase()] || value;
    }
}