/**
 *  Polygon.ts
 *
 *  A TypeScript wrapper around PolygonJs with convenient construction
 *  and a TypeScript-level extrude method.
 */

import type { PointLike } from './types';
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Mesh } from './Mesh';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { PolygonJs, VertexJs } from './wasm/csgrs';

export class Polygon
{
    _polygon: PolygonJs;

    /**
     * Create a Polygon from an array of PointLike or Vertex values.
     * @param vertices  At least 3 vertices defining the polygon boundary.
     * @param metadata  Optional JSON-serializable metadata.
     */
    constructor(vertices: Array<PointLike | Vertex>, metadata: any = {})
    {
        if (!Array.isArray(vertices) || vertices.length < 3)
        {
            throw new Error('Polygon::constructor(): Need at least 3 vertices.');
        }
        const verts: VertexJs[] = vertices.map(v =>
            v instanceof Vertex ? (v.inner as VertexJs) : new Vertex(v as PointLike)
        );
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
            poly._polygon = new PolygonJs(p.map(v => new Vertex(v as PointLike)), {});
        }
        return poly;
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

    /** Get metadata as a JSON string, or undefined if none */
    metadata(): string | undefined
    {
        return this._polygon.metadata();
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
        const verts: VertexJs[] = holeVertices.map(v =>
            v instanceof Vertex ? (v.inner as VertexJs) : new Vertex(v as PointLike)
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
        const dir = new Vector(direction).normalize().scale(length);
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
