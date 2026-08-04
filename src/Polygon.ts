/**
 *  Polygon.ts
 *
 *  A TypeScript wrapper around PolygonJs with convenient construction
 *  and a TypeScript-level extrude method.
 */

import type { PointLike, Axis, OrientationXY } from './types';
import { isPointLike, isAxis } from './types';
import { rad, shortestArcAxisAngle, primaryOrthoXYAngle } from './utils';
import { TOLERANCE } from './constants';
import { Shape } from './Shape';
import { Point } from './Point';
import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { ShapeCollection } from './ShapeCollection';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Bbox } from './Bbox';
import { OBbox } from './OBbox';
import { PolygonJs, VertexJs } from './wasm/meshup';
import { Style } from './Style';
import { uuid } from './utils';
import { sceneReplace, sceneUpdate, sceneCarry } from './sceneDecorators';

/** Build a PolygonJs from vertices that were made from bare positions.
 *
 *  Point.toVertexJs() defaults its normal to (0,0,0), and a zero-normal surface takes no
 *  light: the polygon renders flat grey in any PBR viewer whatever colour it carries, and
 *  exports a useless NORMAL buffer to glTF. Every such polygon therefore gets its own
 *  plane normal — the same rule as Mesh.fromPolygons().
 *
 *  NOT for vertices that already carry meaningful normals (a transformed polygon, say):
 *  setNewNormal() would flatten them. See _applyVertexTransform(), which maps the normals
 *  itself and builds its PolygonJs directly. */
function polygonFromPositions(verts: VertexJs[], metadata: any = {}): PolygonJs
{
    const polygon = new PolygonJs(verts, metadata);
    polygon.setNewNormal();
    return polygon;
}

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

        this._polygon = polygonFromPositions(verts, metadata);
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
        // Object.create bypasses the constructor, so manually initialize Shape fields
        (poly as any)['_id'] = uuid();
        (poly as any)['type'] = 'Polygon';
        poly._node = null;
        poly.style = new Style();
        poly.metadata = {};
        if (p instanceof PolygonJs)
        {
            poly._polygon = p;
        }
        else
        {
            poly._polygon = polygonFromPositions(p.map(v => Point.from(v).toVertexJs()));
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

    /** Vertices of this polygon as a ShapeCollection of Vertices (position + normal preserved) */
    vertices(): ShapeCollection<Vertex>
    {
        return new ShapeCollection<Vertex>(
            (this._polygon.vertices() as VertexJs[]).map(v => Vertex.from(v)),
        );
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

    /** Scale Polygon with a uniform factor or per-axis [sx, sy, sz] around an origin (default: center of this Polygon) */
    override scale(factor: number | PointLike, origin?: PointLike): this
    {
        const [sx, sy, sz] = (typeof factor === 'number')
            ? [factor, factor, factor]
            : [Point.from(factor).x, Point.from(factor).y, Point.from(factor).z];

        const o = origin ? Point.from(origin) : this.center();

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

    override _copy(): this
    {
        const vertList = this.vertices().toArray();
        const verts = vertList.map(v => v.inner());
        const p = new Polygon(vertList);
        p._polygon = new PolygonJs(verts, {});
        p.style.merge(this.style.explicitData() as any);
        p.metadata = { ...this.metadata };

        // Scene registration is handled by Shape.copy() — _copy() is the pure clone.
        return p as this;
    }

    //// GEOMETRY ////

    /** Centroid of the polygon (average of vertex positions) */
    center(): Point
    {
        const verts = this.vertices().toArray();
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
        )._fromShape(this);
    }

    /** Rotate this Polygon so vector `from` points along `to`, around `pivot` (default: center) */
    rotateVecToVec(from: PointLike, to: PointLike, pivot?: PointLike): this
    {
        const { axis, angle } = shortestArcAxisAngle(Vector.from(from as any), Vector.from(to as any));
        if (angle === 0) { return this; }
        return this.rotateAround(angle, axis, pivot ?? this.center());
    }

    /** Rotate this Polygon so its oriented bounding box lines up with the world axes:
     *  the OBB's thinnest axis onto +Z first, then its longest axis onto +X.
     *  A Polygon is planar, so its thinnest axis is the plane normal: this lays it flat on
     *  the XY plane (without moving it there — use layflat() for that).
     *  Position of the center is kept. */
    rotateToAxesOBbox(): this
    {
        const center = this.center();
        // axes()[2] = least variance (the plane normal), axes()[0] = greatest
        this.rotateVecToVec(this.obbox().axes()[2], [0, 0, 1], center);
        // NOTE: the OBB is recomputed — its axes turned with the polygon in the step above
        this.rotateVecToVec(this.obbox().axes()[0], [1, 0, 0], center);
        return this;
    }

    /** Rotate this Polygon to align it with the world axes as much as possible.
     *
     *  First `rotateToAxesOBbox()` lays the polygon flat on the XY plane, then it is turned
     *  around Z so its dominant edge direction lands on the X or Y axis. The second step only
     *  ever turns around Z (by at most a quarter turn), so it can never undo the first.
     *
     *  @param o  'vertical' (default) puts the dominant edge direction on the Y axis,
     *            'horizontal' puts it on the X axis
     */
    rotateToOrtho(o: OrientationXY = 'vertical'): this
    {
        this.rotateToAxesOBbox();

        const edges = this.edges().toArray().map(e =>
        {
            const d = e.direction();
            return { x: d.x, y: d.y, z: d.z, length: e.length() };
        });

        const angle = primaryOrthoXYAngle(edges, o);
        return (angle === 0) ? this : this.rotateZ(angle, this.center());
    }

    /** Rotate this Polygon to align as much as possible to the world axes.
     *  Alias for rotateToOrtho() */
    autoRotate(o: OrientationXY = 'vertical'): this
    {
        return this.rotateToOrtho(o);
    }

    /** Oriented bounding box of this polygon: the tightest (minimum-area) box around it.
     *  A Polygon is planar by construction, so the exact route always applies — no need to
     *  drop duplicate vertices first the way Curve does, since the hull ignores them. */
    obbox(): OBbox
    {
        return OBbox.fromPlanarPoints(this.vertices().toArray())._fromShape(this);
    }

    /** Minimum distance from this polygon surface to a point, vertex, curve, polygon, or mesh. */
    distance(other: PointLike | Mesh | Curve | Polygon): number
    {
        // Measure against this polygon's mesh; Mesh.distanceTo() handles every supported
        // type (Point/Vertex/Curve/Polygon/Mesh), so we just reduce the point-like case.
        const target = isPointLike(other) ? Point.from(other) : other;

        if (target instanceof Point || target instanceof Mesh || target instanceof Curve || target instanceof Polygon)
        {
            return this.toMesh().distanceTo(target);
        }

        throw new Error('Polygon.distance(): Unsupported type. Expected PointLike, Vertex, Curve, Polygon, or Mesh.');
    }

    //// MEASUREMENTS ////

    /** Total perimeter — sum of all edge lengths */
    perimeter(): number
    {
        const verts = this.vertices().toArray();
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
        const verts = this.vertices().toArray();
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
    @sceneUpdate
    offset(distance: number, cornerType: 'sharp' | 'round' | 'smooth' = 'sharp'): this | null
    {
        // TODO: offset interior holes too (inward, with negated distance)
        if (this.hasHoles())
        {
            console.warn('Polygon.offset(): interior holes are not yet offset; only the outer boundary is processed.');
        }

        const boundary = Curve.Polyline(this.vertices().toArray()).close();
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
        this._polygon = polygonFromPositions(verts);
        return this;
    }

    /** Build a large closed region covering one side of an open spine polyline (used by
     *  split()). One edge of the region runs along the spine, offset inward by `near` (the
     *  half-gap); the opposite edge runs `far` away on the chosen side, so the region acts
     *  as a half-plane clipped to a big rectangle. The spine ends are extended by `far` so
     *  the region fully spans the polygon.
     *  @param spinePts  Ordered points along the cut, already projected onto the plane.
     *  @param normal    Unit plane normal.
     *  @param near      Offset of the inner (spine-side) edge; 0 for an exact split.
     *  @param far       Offset of the outer edge (large enough to cover the polygon).
     *  @param side      +1 or -1 — which side of the spine the region covers.
     */
    private _buildSideRegion(spinePts: Array<Point>, normal: Vector, near: number, far: number, side: number): Curve
    {
        const pts = spinePts.map(p => p.copy());

        // Extend both ends along their end directions so the cut fully crosses the polygon.
        const dirFrom = (a: Point, b: Point) => a.toVector().subtract(b.toVector()).normalize().scale(far);
        const startDir = dirFrom(pts[0], pts[1]);
        const endDir   = dirFrom(pts[pts.length - 1], pts[pts.length - 2]);
        pts.unshift(new Point(pts[0].x + startDir.x, pts[0].y + startDir.y, pts[0].z + startDir.z));
        const last = pts[pts.length - 1];
        pts.push(new Point(last.x + endDir.x, last.y + endDir.y, last.z + endDir.z));

        const unitNormal = normal.copy().normalize();
        const perpAt = (i: number): Vector =>
        {
            const prev = pts[Math.max(0, i - 1)];
            const next = pts[Math.min(pts.length - 1, i + 1)];
            const tangent = next.toVector().subtract(prev.toVector()).normalize();
            return unitNormal.copy().cross(tangent).normalize().scale(side);
        };
        const offsetPt = (p: Point, perp: Vector, dist: number) =>
            new Point(p.x + perp.x * dist, p.y + perp.y * dist, p.z + perp.z * dist);

        // Inner edge follows the (curved) cut, offset by the half-gap `near`.
        const inner = pts.map((p, i) => offsetPt(p, perpAt(i), near));
        // Outer edge is just the two far-offset endpoints — a single straight far boundary
        // keeps the region simple (offsetting every point by a huge `far` would fold a curve).
        const outerEnd   = offsetPt(pts[pts.length - 1], perpAt(pts.length - 1), far);
        const outerStart = offsetPt(pts[0], perpAt(0), far);

        // Closed loop: forward along the inner (cut) edge, then across to the far boundary.
        // Drop collinear intermediate points — consecutive collinear segments make curvo's
        // curve boolean flaky, and a straight cut should reduce to a clean 4-corner region.
        const loop = this._dropCollinear([...inner, outerEnd, outerStart], far * 1e-6);
        return Curve.Polyline(loop).close();
    }

    /** Remove points that lie on the straight segment between their (cyclic) neighbours,
     *  within `tol`. Used to keep knife strips free of redundant collinear vertices. */
    private _dropCollinear(points: Array<Point>, tol: number): Array<Point>
    {
        const n = points.length;
        if (n < 3) { return points; }

        const kept: Array<Point> = [];
        for (let i = 0; i < n; i++)
        {
            const prev = kept.length ? kept[kept.length - 1] : points[(i - 1 + n) % n];
            const cur  = points[i];
            const next = points[(i + 1) % n];
            const a = cur.toVector().subtract(prev.toVector());
            const b = next.toVector().subtract(cur.toVector());
            // Perpendicular distance of `cur` from the prev→next line ≈ |a × b| / |next - prev|
            const baseLen = next.toVector().subtract(prev.toVector()).length();
            const dropIt = baseLen > 1e-12 && a.cross(b).length() / baseLen <= tol;
            if (!dropIt) { kept.push(cur); }
        }
        return kept.length >= 3 ? kept : points;
    }

    /**
     * Split this polygon into two (or more) polygons with a cutting Curve or Polygon.
     *
     * The actual cutting is done by the robust Rust-layer curve boolean:
     *  - An OPEN cutter (a line/curve that crosses the polygon) is turned into two large
     *    half-plane regions, one on each side of the cut, and the polygon is intersected
     *    with each — yielding one clean piece per side. This avoids relying on a single
     *    boolean to "fall apart" into two, which the underlying curve boolean does not do
     *    reliably for axis-aligned cuts. The cut is extended past both ends so it only has
     *    to *pass through* the polygon, not reach its edges exactly.
     *  - A CLOSED cutter (closed Curve or Polygon) is subtracted directly; if it spans the
     *    polygon like a band, the result naturally falls into multiple pieces.
     *
     * Guards & warnings:
     *  - The cutter must be planar. It is projected onto this polygon's plane, so a cutter
     *    drawn on a parallel/coincident plane still works (any plane, not just XY).
     *  - Self-intersecting cutters are rejected (see Curve.selfIntersecting()) to avoid
     *    degenerate, overcomplicated split shapes.
     *  - If the result does not actually split into ≥2 pieces (e.g. the cutter misses the
     *    polygon), a warning is emitted and `null` is returned.
     *
     * @param other  Cutting Curve (open or closed) or Polygon.
     * @param gap    Optional seam width left between the pieces (default 0 = exact split,
     *               pieces meet along the cut). A positive value removes a strip of this
     *               width centred on the cut.
     * @returns ShapeCollection<Polygon> of the resulting pieces, or null if no split happened.
     */
    @sceneReplace
    split(other: Curve | Polygon, gap: number = 0): ShapeCollection<Polygon> | null
    {
        return this._split(other, gap);
    }

    /** The actual split implementation. Kept separate from the public split() so that in-place
     *  operations (cutoff/cutoffBy) can reuse the geometry without dispatching through split() —
     *  subclasses (e.g. core's SmartMeshPolygon) decorate split() with scene side effects that
     *  would otherwise pollute the scene with the intermediate pieces. */
    private _split(other: Curve | Polygon, gap: number = 0): ShapeCollection<Polygon> | null
    {
        if (!(other instanceof Curve) && !(other instanceof Polygon))
        {
            console.warn('Polygon.split(): expected a Curve or Polygon to split with. Returning null.');
            return null;
        }
        if (gap < 0)
        {
            console.warn('Polygon.split(): gap must be >= 0. Returning null.');
            return null;
        }
        if (this.hasHoles())
        {
            console.warn('Polygon.split(): polygon has interior holes; only the outer boundary is split and holes are dropped.');
        }

        // This polygon's boundary as a closed, planar Curve (same route used by offset()).
        const boundary = Curve.Polyline(this.vertices().toArray()).close();

        // The cutter as a Curve "spine". A Polygon cutter uses its closed boundary.
        // `spine` is only ever read (tessellate / isClosed / selfIntersecting), never mutated,
        // so the incoming Curve is used directly — no copy (which would leak a scene sibling).
        const spine = (other instanceof Polygon)
            ? Curve.Polyline(other.vertices().toArray()).close()
            : other;

        if (!spine.isPlanar())
        {
            console.warn('Polygon.split(): the cutting Curve is not planar; cannot split reliably. Returning null.');
            return null;
        }
        if (spine.selfIntersecting())
        {
            console.warn('Polygon.split(): the cutting Curve is self-intersecting; refusing to split to avoid degenerate shapes. Returning null.');
            return null;
        }

        // Scale reference for the safety extension / half-plane size.
        const size = this.bbox().size();
        const diag = Math.hypot(size.x, size.y, size.z) || 1;
        const far = diag * 4; // large enough that the half-plane regions cover the polygon

        // Everything happens in this polygon's plane. Projecting the cutter onto that plane
        // guarantees the boolean operands are coplanar and lets the regions be built with plain
        // vector maths (works on any plane, unlike Curve.offset() which needs the XY plane).
        const normal = this.normal().normalize();
        const planePt = this.center();
        const project = (p: Point): Point =>
        {
            const d = p.toVector().subtract(planePt.toVector()).dot(normal.inner());
            return new Point(p.x - normal.x * d, p.y - normal.y * d, p.z - normal.z * d);
        };

        // Collect the resulting piece curves.
        let regionCurves: Array<Curve>;

        if (spine.isClosed())
        {
            // Closed cutter: subtract it directly; a band-like cutter splits the polygon.
            const knife = Curve.Polyline(spine.tessellate().map(project)).close();
            const diff = boundary.difference(knife);
            if (diff === null)
            {
                console.warn('Polygon.split(): boolean subtraction failed. Returning null.');
                return null;
            }
            regionCurves = (diff instanceof Curve) ? [diff] : diff.toArray();
        }
        else
        {
            // Open cutter: intersect the polygon with a big region on each side of the cut.
            const spinePts = spine.tessellate().map(project);
            if (spinePts.length < 2)
            {
                console.warn('Polygon.split(): the cutting Curve is degenerate (fewer than 2 points). Returning null.');
                return null;
            }
            const near = gap / 2; // inner edge offset from the cut on each side (0 → exact split)
            const regionPlus  = this._buildSideRegion(spinePts, normal, near, far, +1);
            const regionMinus = this._buildSideRegion(spinePts, normal, near, far, -1);

            const pieceOf = (region: Curve): Array<Curve> =>
            {
                const r = boundary._copy().intersection(region);
                if (r === null) { return []; }
                return (r instanceof Curve) ? [r] : r.toArray();
            };
            regionCurves = [...pieceOf(regionPlus), ...pieceOf(regionMinus)];
        }

        if (regionCurves.length < 2)
        {
            console.warn('Polygon.split(): the cutter does not fully cross the polygon, so it was not split. '
                       + 'Make sure the split Curve passes all the way through the polygon. Returning null.');
            return null;
        }

        const pieces = regionCurves
            .map(c => c.toPolygon())
            .filter((p): p is Polygon => p !== undefined);

        if (pieces.length < 2)
        {
            console.warn(`Polygon.split(): only ${pieces.length} valid piece(s) could be built from the split result. Returning null.`);
            return null;
        }

        // Sanity check: the pieces should tile the polygon (their areas may sum to slightly
        // less than the original when a gap is removed, but never more). A larger sum means
        // the pieces overlap — a degenerate result the underlying boolean can produce for
        // awkward (e.g. strongly curved) cutters. Reject it rather than return garbage.
        const polyArea = this.area();
        const sumArea = pieces.reduce((s, p) => s + p.area(), 0);
        if (polyArea > 0 && sumArea > polyArea * 1.05)
        {
            console.warn('Polygon.split(): the resulting pieces overlap (combined area exceeds the polygon), '
                       + 'so a clean split could not be made with this cutter — try a simpler (e.g. straighter) cut. Returning null.');
            return null;
        }

        // Preserve this polygon's styling on each piece.
        pieces.forEach(p => p.style.merge(this.style.explicitData() as any));

        return new ShapeCollection<Polygon>(...pieces);
    }

    /**
     * Subtract a closed cutter — a closed Curve, a Polygon, or every shape in a
     * ShapeCollection — from this polygon (2D boolean difference). The cut runs on this
     * polygon's boundary curve (the same robust rust curve-boolean that split() uses) and
     * is applied in place; returns `this`.
     *
     *  - A cutter that bites into the boundary leaves a notched polygon (one piece).
     *  - A band-like cutter that crosses the whole polygon splits it; the largest piece is
     *    kept (with a warning) — use split() when you want every piece.
     *  - A cutter that lies fully inside the polygon is not a boundary op and removes no
     *    area: use addHole() for an interior hole (a warning points this out).
     *
     * The cutter must be planar; it is projected onto this polygon's plane first, so a cutter
     * drawn on a parallel/coincident plane still works. A missing/degenerate/failed cut leaves
     * the polygon unchanged (with a warning). Interior holes on this polygon are dropped.
     *
     * @param other Closed Curve, Polygon, or ShapeCollection of them.
     */
    @sceneUpdate
    difference(other: Curve | Polygon | ShapeCollection<Curve | Polygon>): this
    {
        if (ShapeCollection.isShapeCollection(other))
        {
            (other as ShapeCollection<Curve | Polygon>).toArray()
                .forEach(s => this.difference(s as Curve | Polygon));
            return this;
        }
        if (!(other instanceof Curve) && !(other instanceof Polygon))
        {
            throw new Error('Polygon::difference(): supply a closed Curve, a Polygon, or a ShapeCollection of them.');
        }

        const before = this.area();
        const pieces = this._difference(other);
        if (!pieces) { return this; } // unchanged — a warning was already emitted

        const total = pieces.reduce((s, p) => s + p.area(), 0);
        if (pieces.length === 1 && Math.abs(total - before) <= Math.max(TOLERANCE, before * 1e-6))
        {
            console.warn('Polygon.difference(): the cutter removed no area — it misses the polygon or lies fully inside it. '
                       + 'For an interior hole use addHole(). Returning unchanged.');
            return this;
        }
        if (pieces.length > 1)
        {
            console.warn(`Polygon.difference(): the cutter split the polygon into ${pieces.length} pieces; keeping the largest. `
                       + 'Use split() to keep every piece.');
        }
        return this._keepPiece(pieces, false);
    }

    /** Subtract one or more closed cutters (each a Curve, Polygon, or ShapeCollection) from
     *  this polygon in place. Alias-style convenience over difference(); returns `this`. */
    @sceneUpdate
    subtract(...others: Array<Curve | Polygon | ShapeCollection<Curve | Polygon>>): this
    {
        others.forEach(other => this.difference(other));
        return this;
    }

    /**
     * Keep only the area this polygon shares with another closed shape (planar boolean AND).
     *
     * Polygons are flat, so there is no solid boolean to fall back on: the operation runs on
     * the boundary curves, exactly like difference(). The other shape must be closed and
     * planar; it is projected onto this polygon's plane first, so a shape drawn on a
     * parallel/coincident plane still works.
     *
     * Mutates in place and returns `this` — use `poly.copy().intersection(other)` to keep the
     * original. When the shapes do not overlap, or the boolean fails, the polygon is left
     * unchanged and a warning is emitted. Interior holes on this polygon are dropped.
     *
     * @param other Closed Curve, Polygon, or ShapeCollection of them (applied in sequence).
     */
    @sceneUpdate
    intersection(other: Curve | Polygon | ShapeCollection<Curve | Polygon>): this
    {
        if (ShapeCollection.isShapeCollection(other))
        {
            (other as ShapeCollection<Curve | Polygon>).toArray()
                .forEach(s => this.intersection(s as Curve | Polygon));
            return this;
        }
        if (!(other instanceof Curve) && !(other instanceof Polygon))
        {
            throw new Error('Polygon::intersection(): supply a closed Curve, a Polygon, or a ShapeCollection of them.');
        }

        const pieces = this._boundaryBoolean(other, 'intersection');
        if (!pieces) { return this; } // unchanged — a warning was already emitted

        if (pieces.length > 1)
        {
            console.warn(`Polygon.intersection(): the shapes overlap in ${pieces.length} separate regions; keeping the largest.`);
        }
        return this._keepPiece(pieces, false);
    }

    /**
     * Merge another closed shape into this polygon (planar boolean OR). Same boundary-curve
     * contract as intersection(): closed + planar operand, projected onto this polygon's plane,
     * mutates in place and returns `this`. Shapes that do not touch cannot merge into one
     * polygon — the largest region is kept and a warning is emitted.
     *
     * @param other Closed Curve, Polygon, or ShapeCollection of them (applied in sequence).
     */
    @sceneUpdate
    union(other: Curve | Polygon | ShapeCollection<Curve | Polygon>): this
    {
        if (ShapeCollection.isShapeCollection(other))
        {
            (other as ShapeCollection<Curve | Polygon>).toArray()
                .forEach(s => this.union(s as Curve | Polygon));
            return this;
        }
        if (!(other instanceof Curve) && !(other instanceof Polygon))
        {
            throw new Error('Polygon::union(): supply a closed Curve, a Polygon, or a ShapeCollection of them.');
        }

        const pieces = this._boundaryBoolean(other, 'union');
        if (!pieces) { return this; } // unchanged — a warning was already emitted

        if (pieces.length > 1)
        {
            console.warn(`Polygon.union(): the shapes do not touch, so the result is ${pieces.length} separate regions; keeping the largest.`);
        }
        return this._keepPiece(pieces, false);
    }

    /** Boundary-curve difference for a single closed cutter. Returns the resulting polygon
     *  piece(s), or null when the cutter is unusable / the boolean failed / produced nothing.
     *  Mirrors split()'s closed-cutter branch but does not require the result to be ≥2 pieces.
     *  Internal: skips scene management (no @scene* decorators fire) so it's safe to compose
     *  inside other ops. */
    private _difference(other: Curve | Polygon): Array<Polygon> | null
    {
        return this._boundaryBoolean(other, 'difference');
    }

    /** Planar boolean between this polygon and another closed shape, done on the boundary
     *  curves (polygons are flat, so there is no solid boolean to fall back on). Returns the
     *  resulting polygon piece(s), or null when the operand is unusable / the boolean failed /
     *  produced nothing.
     *  Internal: skips scene management (no @scene* decorators fire) so it's safe to compose
     *  inside other ops. */
    private _boundaryBoolean(other: Curve | Polygon, op: 'difference' | 'intersection' | 'union'): Array<Polygon> | null
    {
        const label = `Polygon.${op}()`;

        if (this.hasHoles())
        {
            console.warn(`${label}: polygon has interior holes; only the outer boundary is used and holes are dropped.`);
        }

        // The other operand as a closed Curve. A Polygon operand uses its closed boundary.
        const spine = (other instanceof Polygon)
            ? Curve.Polyline(other.vertices().toArray()).close()
            : other;

        if (!spine.isClosed())
        {
            console.warn(`${label}: the other shape must be a closed Curve or a Polygon. Returning unchanged.`);
            return null;
        }
        if (!spine.isPlanar())
        {
            console.warn(`${label}: the other shape is not planar; cannot combine reliably. Returning unchanged.`);
            return null;
        }
        if (spine.selfIntersecting())
        {
            console.warn(`${label}: the other shape is self-intersecting; refusing to combine to avoid degenerate shapes. Returning unchanged.`);
            return null;
        }

        // Project the cutter onto this polygon's plane so the boolean operands are coplanar
        // (works on any plane, not just XY). Matches split()'s projection.
        const normal = this.normal().normalize();
        const planePt = this.center();
        const project = (p: Point): Point =>
        {
            const d = p.toVector().subtract(planePt.toVector()).dot(normal.inner());
            return new Point(p.x - normal.x * d, p.y - normal.y * d, p.z - normal.z * d);
        };
        const knifePts = spine.tessellate().map(project);
        const knife = Curve.Polyline(knifePts).close();

        // Reseam the boundary so its start/join vertex sits far from the cutter. The rust
        // curve-boolean returns the *intersection* (wrong) when the cutter overlaps the closed
        // boundary's seam vertex — a deterministic degeneracy at the curve's parameter join.
        // Starting the boundary at the vertex farthest from the cutter centroid keeps the seam
        // clear of the cut. (This polygon's boundary as a closed, planar Curve, as split() does.)
        let bverts = this.vertices().toArray();
        // vertices() repeats the first vertex at the end (the closed loop); drop it so the
        // reseam rotation below doesn't leave a zero-length segment mid-boundary (which makes
        // Curve.close() fail with "No connection found to create a compound curve").
        if (bverts.length > 1)
        {
            const f = bverts[0], l = bverts[bverts.length - 1];
            if (Math.abs(f.x - l.x) < TOLERANCE && Math.abs(f.y - l.y) < TOLERANCE && Math.abs(f.z - l.z) < TOLERANCE)
            {
                bverts = bverts.slice(0, -1);
            }
        }
        const c = knifePts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
        const n = knifePts.length || 1;
        const cx = c.x / n, cy = c.y / n, cz = c.z / n;
        let seam = 0, farDist = -1;
        bverts.forEach((v, i) =>
        {
            const d = (v.x - cx) ** 2 + (v.y - cy) ** 2 + (v.z - cz) ** 2;
            if (d > farDist) { farDist = d; seam = i; }
        });
        const reseamed = [...bverts.slice(seam), ...bverts.slice(0, seam)];
        const boundary = Curve.Polyline(reseamed).close();

        const result = (op === 'difference') ? boundary.difference(knife)
                     : (op === 'intersection') ? boundary.intersection(knife)
                     :                           boundary.union(knife);
        if (result === null || result === undefined)
        {
            console.warn(`${label}: the boundary boolean failed. Returning unchanged.`);
            return null;
        }
        const regionCurves = (result instanceof Curve) ? [result] : (result as ShapeCollection<Curve>).toArray();
        const pieces = regionCurves
            .map(c => c.toPolygon())
            .filter((p): p is Polygon => p !== undefined);

        if (pieces.length === 0)
        {
            console.warn(`${label}: no valid polygon piece could be built from the result. Returning unchanged.`);
            return null;
        }

        // Preserve this polygon's styling on each piece.
        pieces.forEach(p => p.style.merge(this.style.explicitData() as any));
        return pieces;
    }

    /** From a set of split pieces, keep the largest (or smallest) by area, applying it in
     *  place. Style stays on `this` (the Shape base), so only the geometry is swapped. */
    private _keepPiece(pieces: Array<Polygon>, keepSmallest: boolean): this
    {
        const sorted = [...pieces].sort((a, b) => b.area() - a.area()); // descending by area
        const picked = keepSmallest ? sorted[sorted.length - 1] : sorted[0];
        this._polygon = picked.inner();
        return this;
    }

    /**
     * Cut this polygon by another Polygon or Curve and keep one of the resulting pieces.
     * By default keeps the largest piece (by area); set `keepSmallest=true` to keep the
     * smallest. This is a planar (2D) cut delegated to split(), so the cutter may be open or
     * closed and is projected onto this polygon's plane (see split() for the full contract).
     *
     * Mutates in place and returns `this`. If the cutter does not split the polygon into at
     * least two pieces, a warning is emitted and the polygon is left unchanged.
     *
     * @param other        Cutting Curve (open or closed) or Polygon.
     * @param keepSmallest Keep the smallest piece instead of the largest.
     */
    @sceneUpdate
    cutoffBy(other: Curve | Polygon, keepSmallest = false): this
    {
        const pieces = this._split(other);
        if (!pieces || pieces.count() < 2)
        {
            console.warn('Polygon.cutoffBy(): the cutter did not split the polygon — nothing cut off.');
            return this;
        }
        return this._keepPiece(pieces.toArray(), keepSmallest);
    }

    /**
     * Cut off this polygon orthogonally with an axis-aligned plane and keep one piece.
     *
     * The cut is the line where the world plane `{ <at> = coord }` meets this polygon's plane
     * (its direction is polygonNormal × axisNormal). By default the largest piece (by area) is
     * kept; set `smallest=true` to keep the smallest. This is a planar (2D) cut — polygons are
     * flat, so it does not go through the solid boolean path used by Mesh.cutoff().
     *
     * Mutates in place and returns `this`. Returns unchanged (with a warning) when the plane is
     * parallel to the polygon or does not actually split it.
     *
     * @param at        World axis of the cutting plane's normal ('x' | 'y' | 'z').
     * @param coord     Position of the plane along `at` (default 0).
     * @param smallest  Keep the smallest piece instead of the largest.
     */
    @sceneUpdate
    cutoff(at: Axis, coord: number = 0, smallest: boolean = false): this
    {
        if (!isAxis(at)) { throw new Error(`Polygon.cutoff(): Invalid axis '${at}'. Use 'x', 'y', or 'z'.`); }

        // Direction of the cut line within the polygon plane. A ~zero cross product means the
        // cutting plane is parallel to the polygon, so it cannot produce a cut.
        const axisNormal = Vector.from(at);
        const lineDir = this.normal().normalize().cross(axisNormal);
        if (lineDir.length() < TOLERANCE)
        {
            console.warn(`Polygon.cutoff(): a plane with normal '${at}' is parallel to the polygon and cannot cut it — nothing cut off.`);
            return this;
        }
        lineDir.normalize();

        // Open cutting line at the requested coordinate, long enough to fully cross the polygon;
        // split() projects it onto the polygon's plane and yields one piece per side.
        const size = this.bbox().size();
        const far = (Math.hypot(size.x, size.y, size.z) || 1) * 4;
        const base = this.center().setComponent(at, coord);
        const p1 = new Point(base.x - lineDir.x * far, base.y - lineDir.y * far, base.z - lineDir.z * far);
        const p2 = new Point(base.x + lineDir.x * far, base.y + lineDir.y * far, base.z + lineDir.z * far);

        const pieces = this._split(Curve.Line(p1, p2));
        if (!pieces || pieces.count() < 2)
        {
            console.warn(`Polygon.cutoff(): plane '${at}=${coord}' does not split the polygon — nothing cut off.`);
            return this;
        }
        return this._keepPiece(pieces.toArray(), smallest);
    }

    //// 3D OPERATIONS ////

    /**
     * Extrude this polygon into a closed solid Mesh.
     * @param length     Distance to extrude.
     * @param direction  Direction vector (default: polygon normal).
     */
    @sceneReplace
    extrude(length: number, direction?: PointLike): Mesh
    {
        const normal = this.normal();
        const baseDirection = direction ? Vector.from(direction) : normal;
        const dir = baseDirection.normalize().scale(length);

        const bottom: Vertex[] = this.vertices().toArray();
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

        // The winding above only faces outward when extruding along the polygon normal.
        // When the direction opposes the normal, the whole prism comes out inverted (all
        // faces point inward). Such a mesh still reports a positive volume, but boolean ops
        // treat it as a hole — so `mesh.difference(invertedSolid)` keeps the cutter's interior
        // instead of removing it (breaking cutoffBy/intersection). Reverse every face so the
        // solid is consistently outward-facing regardless of extrusion direction.
        const along = baseDirection.normalize().dot(normal.normalize());
        const oriented = along < 0 ? faces.map(f => [...f].reverse()) : faces;

        return Mesh.fromPolygons(oriented);
    }

    /**
     * Loft from this polygon's boundary to one or more other profiles, giving a solid Mesh.
     *
     * This polygon's boundary is a closed curve, so lofting to another closed profile caps
     * both ends into a watertight solid (see Curve.loft()). Polygon profiles are used as their
     * closed boundary; open profiles are lofted as-is into a surface.
     *
     * @param others  A single Curve/Polygon or an array of them to loft through (in order).
     * @param solid   Cap the ends into a watertight solid when all profiles are closed (default true).
     */
    @sceneReplace
    loft(others: Curve | Polygon | Array<Curve | Polygon>, solid: boolean = true): Mesh | Polygon | null
    {
        const otherList = Array.isArray(others) ? others : [others];
        if (otherList.some(o => !(o instanceof Curve) && !(o instanceof Polygon)))
        {
            console.warn('Polygon.loft(): all profiles must be Curves or Polygons. Returning null.');
            return null;
        }

        const profiles = otherList.map(o => (o instanceof Polygon) ? o.toCurve() : o);
        // Curve.loft() is @sceneReplace too, but our boundary Curve is a throwaway that was
        // never added to a scene, so nothing gets replaced there - only this Polygon is.
        return this.toCurve().loft(profiles, solid);
    }

    /** Rotate this polygon so it lies flat on the XY plane (its normal pointing +Z) and drop
     *  it onto z = 0. Unlike Mesh.layflat(), which has to guess the thin axis from an oriented
     *  bounding box, a Polygon has an exact plane normal to rotate. Mutates and returns `this`. */
    @sceneUpdate
    layflat(): this
    {
        const normal = this.normal().normalize();
        const up = Vector.from(0, 0, 1);
        const dot = normal.dot(up);

        if (dot <= 1 - TOLERANCE) // already flat and facing up? then only the drop below is needed
        {
            // Flipped (facing -Z) has no unique rotation axis: turn it over around X.
            const q = (dot <= -1 + TOLERANCE)
                ? { x: 1, y: 0, z: 0, w: 0 }
                : normal.copy().rotationBetween(up);
            this.rotateQuaternion(q);
        }

        return this.translate(0, 0, -this.bbox().minZ());
    }

    //// SELECTION ////

    /** Select (sub)shapes with a selector string (see Selector.ts).
     *  Delegates to the single-polygon Mesh so all Mesh selectors work here too. */
    @sceneCarry
    select(what: string)
    {
        return this.toMesh().select(what);
    }

    /** Boundary edges of this Polygon as line Curves: the outer loop, then one loop per hole.
     *  These are the polygon's real edges — NOT the edges of its triangulation. For those
     *  (feature-angle filtered, useful for shading/silhouettes) use `toMesh().edges()`. */
    @sceneCarry
    edges(): ShapeCollection<Curve>
    {
        const loopEdges = (verts: Array<Vertex>): Array<Curve> =>
            verts
                .map((v, i) => Curve.Line(v.toPoint(), verts[(i + 1) % verts.length].toPoint()))
                .filter(c => c.length() > TOLERANCE); // drops the closing segment of a repeated first vertex

        const holes = ((this._polygon.holes() as VertexJs[][]) ?? [])
                        .flatMap(hole => loopEdges(hole.map(v => Vertex.from(v))));

        return new ShapeCollection<Curve>(...loopEdges(this._boundaryVertices()), ...holes);
    }

    /** Turn this Polygon into a plain wireframe: its boundary and hole edges as Curves, no
     *  hidden-line removal. Same edges as edges(), but this REPLACES the Polygon in the scene. */
    @sceneReplace
    wireframe(): ShapeCollection<Curve>
    {
        const wires = this.edges();
        const from = this.name() ?? this._node?.name;
        if (from) { wires.name(`${from}_wireframe`); }
        return wires;
    }

    //// EXPORT ////

    /** This polygon's outer boundary as a closed Curve. Interior holes are not included.
     *  The Curve is a fresh, scene-less shape - the caller places it if it needs to be visible. */
    toCurve(): Curve
    {
        return Curve.Polyline(this._boundaryVertices()).close();
    }

    /** Outer boundary vertices with the closing duplicate (if any) removed.
     *  vertices() can repeat the first vertex at the end to close the loop; a zero-length
     *  segment makes Curve.close() fail with "No connection found to create a compound curve". */
    private _boundaryVertices(): Array<Vertex>
    {
        const verts = this.vertices().toArray();
        if (verts.length > 1)
        {
            const f = verts[0], l = verts[verts.length - 1];
            if (Math.abs(f.x - l.x) < TOLERANCE && Math.abs(f.y - l.y) < TOLERANCE && Math.abs(f.z - l.z) < TOLERANCE)
            {
                return verts.slice(0, -1);
            }
        }
        return verts;
    }

    /** Polygon is basically Mesh with one polygon */
    @sceneCarry
    toMesh(): Mesh
    {
        return Mesh.fromPolygons([this.vertices().toArray()]);
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
