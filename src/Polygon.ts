/**
 *  Polygon.ts
 *
 *  A TypeScript wrapper around PolygonJs with convenient construction
 *  and a TypeScript-level extrude method.
 */

import type { PointLike, Axis } from './types';
import { Shape } from './Shape';
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Mesh } from './Mesh';
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

    //// SHAPE PROTOCOL ////

    override type(): 'Polygon'
    {
        return 'Polygon';
    }

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

    override translate(_px: PointLike | number, _dy?: number, _dz?: number): this
    {
        throw new Error('Polygon.translate(): not yet implemented');
    }

    override rotate(_angleDeg: number, _axis?: Axis | PointLike, _pivot?: PointLike): this
    {
        throw new Error('Polygon.rotate(): not yet implemented');
    }

    override rotateAround(_angleDeg: number, _axis: Axis | PointLike, _pivot?: PointLike): this
    {
        throw new Error('Polygon.rotateAround(): not yet implemented');
    }

    override rotateQuaternion(_w: number | { w: number; x: number; y: number; z: number }, _x?: number, _y?: number, _z?: number): this
    {
        throw new Error('Polygon.rotateQuaternion(): not yet implemented');
    }

    override scale(_factor: number | PointLike, _origin?: PointLike): this
    {
        throw new Error('Polygon.scale(): not yet implemented');
    }

    override mirror(_dir: Axis | PointLike, _pos?: PointLike): this
    {
        throw new Error('Polygon.mirror(): not yet implemented');
    }

    override copy(): this
    {
        const verts = this.vertices().map(p => p.toVertexJs());
        const p = Object.create(Polygon.prototype) as Polygon;
        p._polygon = new PolygonJs(verts, {});
        p.style.merge(this.style.toData());
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

    //// 3D OPERATIONS ////

    /**
     * Extrude this polygon into a closed solid Mesh.
     * @param length     Distance to extrude.
     * @param direction  Direction vector (default: +Z).
     */
    extrude(length: number, direction: PointLike = [0, 0, 1]): Mesh
    {
        const dir = Vector.from(direction).normalize().scale(length);
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
}
