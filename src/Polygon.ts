/**
 *  Polygon.ts
 *
 *  A TypeScript wrapper around PolygonJs with convenient construction
 *  and a TypeScript-level extrude method.
 */

import type { PointLike, Axis } from './types';
import { isPointLike, isAxis } from './types';
import { rad } from './utils';
import { TOLERANCE } from './constants';
import { Shape } from './Shape';
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { PolygonJs, VertexJs } from './wasm/csgrs';

export class Polygon extends Shape
{
    _polygon: PolygonJs;

    /**
     * Create a Polygon from an array of PointLike or Vertex values.
     * @param vertices  At least 3 vertices defining the polygon boundary.
     * @param metadata  Optional JSON-serializable metadata.
     */
    constructor(vertices: Array<PointLike | Vertex>, metadata: any = {})
    {
        super();
        if (!Array.isArray(vertices) || vertices.length < 3)
        {
            throw new Error('Polygon::constructor(): Need at least 3 vertices.');
        }
        const verts: VertexJs[] = vertices.map(v => Point.from(v).toVertexJs());

        this._polygon = new PolygonJs(verts, metadata);
    }

    inner(): PolygonJs
    {
        if (!this._polygon)
        {
            throw new Error('Polygon::inner(): Polygon not initialized');
        }
        
        return this._polygon;
    }

    /** Wrap an existing PolygonJs instance */
    static from(p: PolygonJs | Array<PointLike>): Polygon
    {
        const poly = Object.create(Polygon.prototype) as Polygon;
        if (p instanceof PolygonJs)
        {
            poly._polygon = p;
        }
        else
        {
            poly._polygon = new PolygonJs(p.map(v => Point.from(v).toVertexJs()), {});
        }
        return poly;
    }

    /** Create a planar rectangular Polygon spanning between two points.
     *  Mirrors Mesh.planeBetween() but yields a single Polygon instead of a Mesh. */
    static planeBetween(from: PointLike, to: PointLike): Polygon
    {
        const a = Point.from(from);
        const b = Point.from(to);
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        const dz = Math.abs(b.z - a.z);
        // Pick the base plane whose normal axis spans the least between the two points
        const basePlane = (dz <= dy && dz <= dx) ? 'xy' as const
                        : (dy <= dx)              ? 'xz' as const
                        :                           'yz' as const;

        const corners = Curve.RectBetween(from, to, basePlane).points();
        // RectBetween returns a closed polyline (last point repeats the first) — drop it.
        const verts = (corners.length > 1 && corners[0].equals(corners[corners.length - 1]))
            ? corners.slice(0, -1)
            : corners;
        return new Polygon(verts);
    }

    //// SHAPE PROTOCOL ////

    override readonly type = 'Polygon' as const;

    override subtype(): string | null
    {
        return null;
    }

    override is2D(): boolean
    {
        return true;
    }


    //// ACCESSORS ////

    /** Vertices of this polygon as Points */
    vertices(): Array<Point>
    {
        return (this._polygon.vertices() as VertexJs[]).map(v => Point.from(v.position()));
    }

    /** Number of interior holes */
    holeCount(): number
    {
        return this._polygon.holeCount();
    }

    /** Whether this polygon has interior holes */
    hasHoles(): boolean
    {
        return this._polygon.hasHoles();
    }

    /** Get the polygon's plane */
    plane()
    {
        return this._polygon.plane();
    }

    normal(): Vector
    {
        return Vector.from(this._polygon.plane()?.normal());
    }

    /** Get the WASM polygon metadata as a JSON string, or undefined if none */
    polygonMetadata(): string | undefined
    {
        return this._polygon.metadata();
    }

    //// TRANSFORMS ////

    /** Apply a position and normal transform function to all vertices (outer + holes) and rebuild _polygon. */
    private _applyVertexTransform(
        transformPos: (v: Vector) => Vector,
        transformNorm: (v: Vector) => Vector,
    ): void
    {
        const transformVerts = (verts: VertexJs[]): VertexJs[] =>
            verts.map(v =>
            {
                const pos  = transformPos(Vector.from(v.position().x, v.position().y, v.position().z));
                const norm = transformNorm(Vector.from(v.normal().x, v.normal().y, v.normal().z));
                return new VertexJs(pos.toPoint().toPoint3Js(), norm.toVector3Js());
            });

        const rawVerts  = this._polygon.vertices() as VertexJs[];
        const rawHoles  = this._polygon.holes()    as VertexJs[][];
        const metaStr   = this._polygon.metadata();
        const meta      = metaStr !== undefined ? JSON.parse(metaStr) : {};

        this._polygon = new PolygonJs(transformVerts(rawVerts), meta);
        for (const hole of (rawHoles || []))
        {
            this._polygon.addHole(transformVerts(hole));
        }
    }

    override translate(px: PointLike | number, dy?: number, dz?: number): this
    {
        const delta = (typeof dy === 'number')
            ? Point.from(px, dy, dz ?? 0)
            : Point.from(px);

        this._applyVertexTransform(
            pos  => Vector.from(pos.x + delta.x, pos.y + delta.y, pos.z + delta.z),
            norm => norm,
        );
        return this;
    }

    override rotate(angleDeg: number, axis: Axis | PointLike = 'z'): this
    {
        const a    = rad(angleDeg) / 2;
        const axVec = Vector.from(axis).normalize();
        const sin  = Math.sin(a);
        const w    = Math.cos(a), xv = axVec.x * sin, yv = axVec.y * sin, zv = axVec.z * sin;

        this._applyVertexTransform(
            pos  => pos.copy().rotateQuaternion(w, xv, yv, zv),
            norm => norm.copy().rotateQuaternion(w, xv, yv, zv),
        );
        return this;
    }

    override rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot?: PointLike): this
    {
        const p = pivot ? Point.from(pivot) : this.center();
        this.translate(-p.x, -p.y, -p.z);
        this.rotate(angleDeg, axis);
        this.translate(p.x, p.y, p.z);
        return this;
    }

    override rotateQuaternion(wOrObj: number | { w: number; x: number; y: number; z: number }, x?: number, y?: number, z?: number): this
    {
        const originalCenter = this.center();
        const w  = typeof wOrObj === 'object' ? wOrObj.w : wOrObj;
        const xv = typeof wOrObj === 'object' ? wOrObj.x : (x ?? 0);
        const yv = typeof wOrObj === 'object' ? wOrObj.y : (y ?? 0);
        const zv = typeof wOrObj === 'object' ? wOrObj.z : (z ?? 0);

        this._applyVertexTransform(
            pos  => pos.copy().rotateQuaternion(w, xv, yv, zv),
            norm => norm.copy().rotateQuaternion(w, xv, yv, zv),
        );

        // Preserve center (match Mesh.rotateQuaternion behavior)
        const newCenter = this.center();
        this.translate(
            originalCenter.x - newCenter.x,
            originalCenter.y - newCenter.y,
            originalCenter.z - newCenter.z,
        );
        return this;
    }

    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number')
            ? [factor, factor, factor]
            : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];

        const o = origin ? Point.from(origin) : new Point(0, 0, 0);

        this._applyVertexTransform(
            pos  => Vector.from(
                o.x + (pos.x - o.x) * sx,
                o.y + (pos.y - o.y) * sy,
                o.z + (pos.z - o.z) * sz,
            ),
            norm => norm, // normals stay unit vectors
        );
        return this;
    }

    override mirror(dir: Axis | PointLike, pos?: number | PointLike): this
    {
        const planeNormal = isPointLike(dir)
            ? Point.from(dir as PointLike).toVector()
            : Vector.from(dir as Axis);

        let planePosition: Point;
        if ((planeNormal.length() - 1) > TOLERANCE && pos === undefined)
        {
            planePosition = Point.from(planeNormal.toArray() as PointLike);
            planeNormal.normalize();
        }
        else
        {
            planeNormal.normalize();
            planePosition = pos
                ? (isAxis(dir) && typeof pos === 'number')
                    ? new Point(0, 0, 0).setComponent(dir as Axis, pos)
                    : Point.from(pos as PointLike)
                : this.center();
        }

        this._applyVertexTransform(
            pos =>
            {
                const rel = Vector.from(pos.x - planePosition.x, pos.y - planePosition.y, pos.z - planePosition.z);
                const d   = rel.dot(planeNormal.inner());
                return Vector.from(
                    pos.x - 2 * d * planeNormal.x,
                    pos.y - 2 * d * planeNormal.y,
                    pos.z - 2 * d * planeNormal.z,
                );
            },
            norm =>
            {
                const dn = norm.dot(planeNormal.inner());
                return Vector.from(
                    norm.x - 2 * dn * planeNormal.x,
                    norm.y - 2 * dn * planeNormal.y,
                    norm.z - 2 * dn * planeNormal.z,
                );
            },
        );
        return this;
    }

    override mirrorX(x?: number): this { return this.mirror('x', x ?? 0); }
    override mirrorY(y?: number): this { return this.mirror('y', y ?? 0); }
    override mirrorZ(z?: number): this { return this.mirror('z', z ?? 0); }

    override copy(): this
    {
        const verts = this.vertices().map(p => p.toVertexJs());
        const p = new Polygon(this.vertices());
        p._polygon = new PolygonJs(verts, {});
        p.style.merge(this.style.explicitData() as any);
        p.metadata = { ...this.metadata };

        if (this.node())
        {
            const parent = this.node()?.parent() || this.node();
            if (parent)
            {
                parent.addShape(p);
            }
        }

        return p as this;
    }

    //// GEOMETRY ////

    /** Centroid of the polygon (average of vertex positions) */
    center(): Point
    {
        const verts = this.vertices();
        const sx = verts.reduce((acc, v) => acc + v.x, 0);
        const sy = verts.reduce((acc, v) => acc + v.y, 0);
        const sz = verts.reduce((acc, v) => acc + v.z, 0);
        const n = verts.length;
        return new Point(sx / n, sy / n, sz / n);
    }

    /** Axis-aligned bounding box of this polygon */
    bbox(): Bbox
    {
        const bb = this._polygon.boundingBox() as { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
        return new Bbox(
            [bb.min.x, bb.min.y, bb.min.z],
            [bb.max.x, bb.max.y, bb.max.z]
        );
    }

    /** Oriented bounding box of this polygon (minimum-volume via PCA) */
    obbox(): OBbox
    {
        return OBbox.fromPoints(this.vertices());
    }

    /** Minimum distance from this polygon surface to a point, mesh, or curve. */
    distance(other: PointLike | Mesh | Curve): number
    {
        if (isPointLike(other))
        {
            return this.toMesh().distance(Point.from(other));
        }

        if (other instanceof Mesh || other instanceof Curve)
        {
            return this.toMesh().distance(other);
        }

        throw new Error('Polygon.distance(): Unsupported type. Expected PointLike, Mesh, or Curve.');
    }

    //// MEASUREMENTS ////

    /** Total perimeter — sum of all edge lengths */
    perimeter(): number
    {
        const verts = this.vertices();
        const n = verts.length;
        let total = 0;
        for (let i = 0; i < n; i++)
        {
            const a = verts[i], b = verts[(i + 1) % n];
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return total;
    }

    /** Alias for perimeter */
    length(): number 
    { 
        console.warn(`Polygon.length() is an alias for perimeter(); use perimeter() for clarity.`);
        return this.perimeter(); 
    }

    override volume(): undefined 
    { 
        console.warn('Polygon.volume() is undefined since a polygon is 2D; use area() instead.');
        return undefined; 
    }

    /** Area using triangle-fan cross-product method (works for planar polygons in 3D) */
    area(): number
    {
        const verts = this.vertices();
        const n = verts.length;
        if (n < 3) return 0;
        const v0 = verts[0];
        let ax = 0, ay = 0, az = 0;
        for (let i = 1; i < n - 1; i++)
        {
            const a = verts[i], b = verts[i + 1];
            const ux = a.x - v0.x, uy = a.y - v0.y, uz = a.z - v0.z;
            const vx = b.x - v0.x, vy = b.y - v0.y, vz = b.z - v0.z;
            ax += uy * vz - uz * vy;
            ay += uz * vx - ux * vz;
            az += ux * vy - uy * vx;
        }
        // TODO: move this to csgrs 
        // TODO: subtract holes?

        return 0.5 * Math.sqrt(ax * ax + ay * ay + az * az);
    }



    //// MUTATIONS (return this for chaining) ////

    /** Flip winding order and vertex normals in place */
    flip(): this
    {
        this._polygon.flip();
        return this;
    }

    /** Set JSON-serializable metadata */
    setMetadata(data: any): this
    {
        this._polygon.setMetadata(data);
        return this;
    }

    /** Add a hole defined by an array of PointLike vertices */
    addHole(holeVertices: Array<PointLike | Vertex>): this
    {
        const verts: VertexJs[] = holeVertices.map(v => Point.from(v).toVertexJs()
        );
        this._polygon.addHole(verts);
        return this;
    }

    //// DERIVED ////

    /** Triangulate this polygon into triangular polygons */
    triangulate(): Array<Polygon>
    {
        return this._polygon.triangulate().map(p => Polygon.from(p));
    }

    /** Subdivide triangles by the given number of levels */
    subdivideTriangles(levels: number): Array<Polygon>
    {
        return this._polygon.subdivideTriangles(levels).map(p => Polygon.from(p));
    }

    /**
     * Offset this polygon's boundary by `distance` (positive = outward, negative = inward).
     *
     * Polygons have no native offset, so we route through Curve: the boundary is
     * converted to a closed planar Curve, offset there, then converted back to a
     * Polygon. Returns null when the offset fails or degenerates.
     *
     * @param distance    Offset distance; positive grows the polygon, negative shrinks it.
     * @param cornerType  How to treat convex corners (passed through to Curve.offset).
     */
    offset(distance: number, cornerType: 'sharp' | 'round' | 'smooth' = 'sharp'): this | null
    {
        // TODO: offset interior holes too (inward, with negated distance)
        if (this.hasHoles())
        {
            console.warn('Polygon.offset(): interior holes are not yet offset; only the outer boundary is processed.');
        }

        const boundary = Curve.Polyline(this.vertices()).close();
        const offsetCurve = boundary.offset(distance, cornerType);
        if (!offsetCurve)
        {
            console.warn('Polygon.offset(): Curve.offset() failed; polygon left unchanged.');
            return null;
        }

        let pts = offsetCurve.points();
        // A closed curve repeats its start point at the end — drop the duplicate.
        if (pts.length > 1 && pts[0].equals(pts[pts.length - 1]))
        {
            pts = pts.slice(0, -1);
        }
        if (pts.length < 3)
        {
            console.warn(`Polygon.offset(): offset produced ${pts.length} vertices (<3); polygon left unchanged.`);
            return null;
        }

        // Mutate in place: replace the inner PolygonJs with the offset boundary.
        // `style` lives on the Shape base and is preserved untouched.
        const verts: VertexJs[] = pts.map(p => Point.from(p).toVertexJs());
        this._polygon = new PolygonJs(verts, {});
        return this;
    }

    //// 3D OPERATIONS ////

    /**
     * Extrude this polygon into a closed solid Mesh.
     * @param length     Distance to extrude.
     * @param direction  Direction vector (default: polygon normal).
     */
    extrude(length: number, direction?: PointLike): Mesh
    {
        const baseDirection = direction ? Vector.from(direction) : this.normal();
        const dir = baseDirection.normalize().scale(length);

        const bottom: Point[] = this.vertices();
        const top: Point[] = bottom.map(p =>
            new Point(p.x + dir.x, p.y + dir.y, p.z + dir.z)
        );

        const faces: Array<Array<PointLike>> = [];

        // Bottom cap — reverse winding so normal faces outward (away from extrusion)
        faces.push([...bottom].reverse());
        // Top cap
        faces.push([...top]);
        // Side walls
        const n = bottom.length;
        Array.from({ length: n }, (_, i) =>
        {
            const j = (i + 1) % n;
            faces.push([bottom[i], bottom[j], top[j], top[i]]);
        });

        return Mesh.fromPolygons(faces);
    }

    //// EXPORT ////

    /** Polygon is basically Mesh with one polygon */
    toMesh(): Mesh
    {
        return Mesh.fromPolygons([this.vertices()]);
    }

    async toGLTF(up: Axis = 'z'): Promise<string | undefined>
    {
        return this.toMesh().toGLTF(up);
    }

    async toGLB(up: Axis = 'z'): Promise<Uint8Array | undefined>
    {
        return this.toMesh().toGLB(up);
    }
}
