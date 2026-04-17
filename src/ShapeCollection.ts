/**
 *  ShapeCollection.ts
 *
 *  A generic, typed collection of Shape instances.
 *
 *  ShapeCollection<S extends Shape = Shape> is the single collection class.
 *  Use ShapeCollection<Mesh> or ShapeCollection<Curve> for typed access.
 *  Curve-specific and Mesh-specific methods are included here; they throw
 *  or no-op when called on the wrong shape type.
 */

import type { Axis, PointLike, ProjectEdgeOptions, RaycastHit } from './types';

import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Shape } from './Shape';
import { Point } from './Point';
import { Bbox } from './Bbox';

import { MeshJs } from './wasm/csgrs';
import { GLTFBuilder } from './GLTFBuilder';

export class ShapeCollection<S extends Shape = Shape>
{
    _shapes: Array<S> = [];
    _groups = new Map<string, ShapeCollection<S>>();

    constructor(...args: Array<S | Array<any> | ShapeCollection<any>>)
    {
        args.forEach(arg => this.add(arg as any));
    }

    //// STATIC FACTORIES ////

    static isShapeCollection(obj: any): obj is ShapeCollection
    {
        return obj instanceof ShapeCollection;
    }

    static generate<S extends Shape>(count: number, generator: (index: number) => S): ShapeCollection<S>
    {
        return new ShapeCollection<S>(...new Array(count).fill(null).map((_, i) => generator(i)));
    }

    //// COLLECTION MANAGEMENT ////

    update(shapes: Array<S> | ShapeCollection<S>): void
    {
        this._shapes = ShapeCollection.isShapeCollection(shapes) ? shapes.toArray() : shapes;
    }

    add(shapes: S | ShapeCollection<any> | Array<any>): this
    {
        if (Shape.isShape(shapes))
        {
            this._shapes.push(shapes as S);
        }
        else if (Array.isArray(shapes) || ShapeCollection.isShapeCollection(shapes))
        {
            const addShapes: S[] = ShapeCollection.isShapeCollection(shapes)
                ? shapes.toArray() as S[]
                : (shapes as any[]).filter(s => Shape.isShape(s)) as S[];
            this._shapes.push(...addShapes);
        }
        else
        {
            console.error(`ShapeCollection::add(): Invalid shape(s). Supply something [<Shape>|<ShapeCollection>|Array<Shape>]. Skipping:`, shapes);
        }
        return this;
    }

    push(shapes: S | ShapeCollection<any>): void
    {
        this.add(shapes);
    }

    //// GROUPS ////

    addGroup(groupName: string, shapes: S | ShapeCollection<S>): this
    {
        this.add(shapes);
        if (!this._groups.has(groupName)) this._groups.set(groupName, new ShapeCollection<S>());
        this._groups.get(groupName)?.add(shapes);
        return this;
    }

    removeGroup(groupName: string): void
    {
        const groupedShapes = this._groups.get(groupName);
        if (!groupedShapes)
        {
            console.error(`ShapeCollection::removeGroup(): No group '${groupName}'. Available:`, Array.from(this._groups.keys()));
            return;
        }
        this.remove(groupedShapes);
        this._groups.delete(groupName);
    }

    group(groupName: string): ShapeCollection<S> | undefined
    {
        const g = this._groups.get(groupName);
        if (!g) { console.error(`ShapeCollection::group(): No group '${groupName}'. Available:`, Array.from(this._groups.keys())); return undefined; }
        return g;
    }

    //// TYPE FILTERS ////

    meshes(): ShapeCollection<Mesh>
    {
        return new ShapeCollection<Mesh>(...this._shapes.filter(s => s instanceof Mesh) as Mesh[]);
    }

    curves(): ShapeCollection<Curve>
    {
        return new ShapeCollection<Curve>(...this._shapes.filter(s => s instanceof Curve) as Curve[]);
    }

    //// COPY / CLONE ////

    copy(): ShapeCollection<S>
    {
        return new ShapeCollection<S>(...this._shapes.map(s => s.copy() as S));
    }

    clone(): ShapeCollection<S>
    {
        return new ShapeCollection<S>(...this._shapes);
    }

    //// REMOVE ////

    remove(shape: S | ShapeCollection<S>): void
    {
        if (ShapeCollection.isShapeCollection(shape))
        {
            shape.shapes().forEach(s => this.remove(s as S));
        }
        else if (Shape.isShape(shape))
        {
            this._shapes = this._shapes.filter(s => s !== shape);
        }
    }

    //// ACCESSORS ////

    get(index: number): S | undefined { return this._shapes[index]; }
    at(index: number): S | undefined { return this.get(index); }

    first(): S
    {
        if (!this._shapes.length) throw new Error('ShapeCollection::first(): empty.');
        return this._shapes[0];
    }

    last(): S
    {
        if (!this._shapes.length) throw new Error('ShapeCollection::last(): empty.');
        return this._shapes[this._shapes.length - 1];
    }

    checkSingle(): S | this
    {
        if (this._shapes.length === 1) return this._shapes[0];
        return this;
    }

    shapes(): Array<S> { return this._shapes; }
    count(): number { return this._shapes.length; }
    get length(): number { return this._shapes.length ?? 0; }

    //// ITERATORS ////

    forEach(callback: (shape: S, index: number, array: S[]) => void): this
    {
        this._shapes.forEach(callback);
        return this;
    }

    filter(callback: (shape: S, index: number, array: S[]) => boolean): ShapeCollection<S>
    {
        return new ShapeCollection<S>(...this._shapes.filter(callback));
    }

    map<T>(callback: (shape: S, index: number, array: S[]) => T): T[]
    {
        return this._shapes.map(callback);
    }

    has(shape: S): boolean { return this._shapes.includes(shape); }

    addUnique(shapes: S | ShapeCollection<S> | Array<S>): this
    {
        const incoming = ShapeCollection.isShapeCollection(shapes)
            ? shapes.toArray()
            : Array.isArray(shapes) ? shapes : [shapes as S];
        incoming.forEach(s => { if (!this.has(s as S)) this._shapes.push(s as S); });
        return this;
    }

    pop(): S | undefined { return this._shapes.pop(); }

    //// BBOX / SPATIAL ////

    center(): Point
    {
        const bb = this.bbox();
        if (!bb) throw new Error('ShapeCollection::center(): collection is empty');
        return bb.center();
    }

    bbox(_includeAnnotations?: boolean): Bbox | undefined
    {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        this._shapes.forEach(shape =>
        {
            const bb = shape.bbox();
            if (!bb) return;
            const mn = bb.min(), mx = bb.max();
            if (mn.x < minX) minX = mn.x;  if (mx.x > maxX) maxX = mx.x;
            if (mn.y < minY) minY = mn.y;  if (mx.y > maxY) maxY = mx.y;
            if (mn.z < minZ) minZ = mn.z;  if (mx.z > maxZ) maxZ = mx.z;
        });
        if (!isFinite(minX)) return undefined;
        return new Bbox([minX, minY, minZ], [maxX, maxY, maxZ]);
    }

    //// TRANSFORMS ////

    translate(vecOrX: PointLike | number, dy?: number, dz?: number): this
    {
        this._shapes.forEach(shape => shape.translate(vecOrX, dy, dz));
        return this;
    }

    move(vecOrX: PointLike | number, dy?: number, dz?: number): this { return this.translate(vecOrX as any, dy, dz); }
    moveX(dx: number): this { return this.translate(dx, 0, 0); }
    moveY(dy: number): this { return this.translate(0, dy, 0); }
    moveZ(dz: number): this { return this.translate(0, 0, dz); }

    moveTo(...args: any[]): this
    {
        const target = Point.from(args);
        const bb = this.bbox();
        if (!bb) return this;
        const c = bb.center();
        return this.translate(target.x - c.x, target.y - c.y, target.z - c.z);
    }

    moveToX(x: number): this { const bb = this.bbox(); return bb ? this.translate(x - bb.center().x, 0, 0) : this; }
    moveToY(y: number): this { const bb = this.bbox(); return bb ? this.translate(0, y - bb.center().y, 0) : this; }
    moveToZ(z: number): this { const bb = this.bbox(); return bb ? this.translate(0, 0, z - bb.center().z) : this; }

    rotateX(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'x', origin); }
    rotateY(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'y', origin); }
    rotateZ(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'z', origin); }

    rotate(angleDeg: number, axis: Axis = 'z', origin: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.rotate(angleDeg, axis, origin));
        return this;
    }

    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.rotateAround(angleDeg, axis, pivot));
        return this;
    }

    rotateQuaternion(wOrObj: number | { w: number, x: number, y: number, z: number }, x?: number, y?: number, z?: number): this
    {
        this.forEach(shape => shape.rotateQuaternion(wOrObj as any, x as any, y as any, z as any));
        return this;
    }

    scale(factor: number | PointLike, origin: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.scale(factor, origin));
        return this;
    }

    mirror(dir: Axis | PointLike, pos?: PointLike): this
    {
        this._shapes.forEach(shape => shape.mirror(dir, pos));
        return this;
    }

    offset(distance: number, cornerType: 'sharp' | 'round' | 'smooth' = 'sharp'): ShapeCollection<Curve>
    {
        console.warn('ShapeCollection::offset(): Only Curve shapes are offset! Non-curve shapes will be ignored. TODO');

        return new ShapeCollection<Curve>(
            ...(this._shapes as any[])
                .map(curve => (curve as any).offset?.(distance, cornerType))
                .filter((r: any): r is Curve => r !== null && r !== undefined)
        );
    }

    //// STYLING ////

    color(c: string | [number, number, number]): this
    {
        this._shapes.forEach(shape => shape.color(c as any));
        return this;
    }

    opacity(opacity: number): this
    {
        this._shapes.forEach(shape => shape.opacity(opacity));
        return this;
    }

    alpha(a: number): this { return this.opacity(a); }

    /** Set dashed line */
    dashed(dash: number[] = [2, 2]): this
    {
        this._shapes.forEach(shape => (shape as any).dashed?.(dash));
        return this;
    }

    //// BOOLEAN OPERATIONS ////

    merge(): Mesh
    {
        const allPolygons = this._shapes
            .filter(shape => shape instanceof Mesh)
            .flatMap(shape =>
            {
                const inner = (shape as Mesh).inner();
                return inner ? inner.polygons() : [];
            });
        if (!allPolygons.length) { console.error('ShapeCollection::merge(): No meshes. Returning empty mesh.'); return new Mesh(); }
        return Mesh.from(MeshJs.fromPolygons(allPolygons, {}));
    }

    union(other?: Mesh | ShapeCollection<Mesh>): Mesh
    {
        const meshesToUnion = this.meshes().toArray();
        if (other instanceof Mesh) meshesToUnion.push(other);
        else if (ShapeCollection.isShapeCollection(other)) meshesToUnion.push(...other.meshes().toArray());
        else if (other !== undefined) console.warn(`ShapeCollection::union(): Invalid argument. Only Mesh or ShapeCollection allowed.`, other);
        if (!meshesToUnion.length) { console.warn('ShapeCollection::union(): No meshes. Returning empty mesh.'); return new Mesh(); }
        return meshesToUnion.slice(1).reduce((acc, mesh) => acc.union(mesh), meshesToUnion[0]);
    }

    subtract(other: Mesh | ShapeCollection<Mesh>): this
    {
        const otherMeshes = ShapeCollection.isShapeCollection(other)
            ? other.meshes()
            : (other instanceof Mesh ? [other] : []);
        if (!otherMeshes.length) { console.warn('ShapeCollection::subtract(): No valid meshes. Returning original.'); return this; }
        this.forEach(shape =>
        {
            if (!(shape instanceof Mesh)) return;
            (otherMeshes as any[]).forEach(otherMesh => (shape as Mesh).subtract(otherMesh));
        });
        return this;
    }

    /** Union all Mesh shapes into a single Mesh */
    mergeAll(): Mesh
    {
        const meshes = this.meshes().toArray();
        if (!meshes.length) { console.warn('ShapeCollection::mergeAll(): No meshes. Returning empty mesh.'); return new Mesh(); }
        return meshes.slice(1).reduce((acc, mesh) => acc.union(mesh), meshes[0]);
    }

    /** Union all Curve shapes sequentially (curve boolean union) */
    unionAll(): Array<Curve> | null
    {
        const curves = this.curves();
        if (!curves.length) return null;
        return curves.toArray().slice(1).reduce<Array<Curve>>(
            (acc, curve) =>
            {
                const next = (acc[0] as any)?.union(curve) as Array<Curve> | null;
                return next ?? acc;
            },
            [curves.get(0)!]
        );
    }

    intersecting(other: S): ShapeCollection
    {
        throw new Error('ShapeCollection::intersecting(): not yet implemented');
    }

    intersections(other: S): ShapeCollection
    {
        throw new Error('ShapeCollection::_intersections(): not yet implemented');
    }

    //// ISOMETRY ////

    isometry(cam: PointLike = [-1, -1, 1], includeHidden: boolean = true): ShapeCollection<Shape>
    {
        return this.merge().isometry(cam, includeHidden);
    }

    //// OUTPUTS ////

    toSVG(): string
    {
        console.warn('ShapeCollection::toSVG(): Only 2D Curves are outputted!');

        const curves = this.curves();
        if (curves.length === 0)
        {
            console.warn(`ShapeCollection::toSVG(): Exporting with ${curves.length} curves. Only curves will be exported to SVG.`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 20">
                            <text x="4" y="15" font-size="12" fill="red">ShapeCollection::toSVG() — no curves</text></svg>`;
        }

        const paths: string[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        curves.forEach(curve =>
        {
            const svg = (curve as any).toSVG();
            const innerMatch = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
            const vbMatch = svg.match(/viewBox="([^"]*)"/);
            if (!innerMatch?.[1]) return;
            paths.push(innerMatch[1]);
            if (vbMatch)
            {
                const [vx, vy, vw, vh] = vbMatch[1].split(' ').map(Number);
                if (vx < minX) minX = vx;   if (vy < minY) minY = vy;
                if (vx + vw > maxX) maxX = vx + vw;  if (vy + vh > maxY) maxY = vy + vh;
            }
        });

        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
        const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${paths.join('')}</svg>`;
    }


    /** Returns all start/end vertices of curves in this collection */
    vertices(): Array<Vertex>
    {
        const pts: Vertex[] = [];
        this._shapes.forEach(c => { pts.push((c as any).start?.(), (c as any).end?.()); });
        return pts.filter(Boolean);
    }

    toMesh(): ShapeCollection<Mesh>
    {
        const meshes = this._shapes
            .map(curve => (curve as any).toMesh?.())
            .filter((mesh: any) => mesh?.validate?.()) as Mesh[];
        return new ShapeCollection<Mesh>(...meshes);
    }


    //// CURVE-SPECIFIC ////

    /** Merge connected curves in this collection into as few Curve/CompoundCurve objects as possible. */
    combine(): ShapeCollection<Curve>
    {
        const curves = this.curves().toArray();
        if (curves.length === 0) return new ShapeCollection<Curve>();
        if (curves.length === 1) return new ShapeCollection<Curve>(curves[0]);

        const chains = this._buildChains(curves.map(c => [c]) as Curve[][]);
        const combined = chains.map(chain => this._chainToCurve(chain));
        return new ShapeCollection<Curve>(...combined);
    }

    /** Connect curves in this collection into one, bridging small gaps where needed. */
    connect(): ShapeCollection<Curve>
    {
        const combined = this.combine();

        const endpoints = combined.curves().toArray().flatMap(curve =>
        {
            const start = curve.start();
            const end   = curve.end();
            return [
                { point: start, otherPoint: end,   curve },
                { point: end,   otherPoint: start,  curve },
            ] as Array<{ point: Vertex; otherPoint: Vertex; curve: Curve } | null>;
        });

        const connectingLines: Curve[] = [];

        endpoints.forEach((curEndPoint, p) =>
        {
            if (curEndPoint === null) return;

            const closest = { endpoint: null as { point: Vertex; curve: Curve } | null, dist: Infinity, index: undefined as number | undefined };

            endpoints.forEach((ep, idx) =>
            {
                if (ep === null) return;
                if (curEndPoint.point !== ep.point && curEndPoint.otherPoint !== ep.point)
                {
                    const d1 = new Point(curEndPoint.point).distance(new Point(ep.point));
                    const d2 = new Point(curEndPoint.otherPoint).distance(new Point(ep.point));
                    if (d1 < closest.dist && d1 !== 0 && d1 < d2)
                    {
                        closest.dist = d1;
                        closest.endpoint = ep;
                        closest.index = idx;
                    }
                }
            });

            if (closest.endpoint)
            {
                connectingLines.push(Curve.Line(curEndPoint.point, closest.endpoint.point));
                if (closest.index !== undefined)
                {
                    endpoints[p] = null;
                    endpoints[closest.index] = null;
                }
            }
        });

        console.info(`Connecting ${connectingLines.length} pairs of endpoints with lines.`);

        return new ShapeCollection<Curve>(
            ...combined.curves().toArray(),
            ...connectingLines,
        ).combine();
    }

    /**
     *  Group curves into ordered end-to-start connected chains.
     *  Tries both orientations of each candidate.
     */
    private _buildChains(chains: Array<Array<Curve>>, tolerance: number = 1e-3): Array<Array<Curve>>
    {
        const startNumChains = chains.length;
        let newChains: Array<Array<Curve>> = [];

        chains.forEach((curChain, i) =>
        {
            if (curChain.length)
            {
                if (i === 0) newChains.push(curChain);
                chains[i] = [];

                const curStart = curChain[0].start();
                const curEnd   = curChain.at(-1)!.end();

                chains.forEach((otherChain, j) =>
                {
                    if (otherChain.length === 0 || otherChain === curChain) return;

                    const otherStart = otherChain[0].start();
                    const otherEnd   = otherChain.at(-1)!.end();

                    chains[j] = [];

                    if (new Point(curStart).distance(new Point(otherStart)) <= tolerance)
                    {
                        newChains[i]?.unshift(...otherChain.map(c => c.copy().reverse()).reverse());
                    }
                    else if (new Point(curStart).distance(new Point(otherEnd)) <= tolerance)
                    {
                        newChains[i]?.unshift(...otherChain);
                    }
                    else if (new Point(curEnd).distance(new Point(otherStart)) <= tolerance)
                    {
                        newChains[i]?.push(...otherChain);
                    }
                    else if (new Point(curEnd).distance(new Point(otherEnd)) <= tolerance)
                    {
                        newChains[i]?.push(...otherChain.map(c => c.copy().reverse()).reverse());
                    }
                    else
                    {
                        newChains.push(otherChain);
                    }
                });
            }
        });

        if (newChains.length < startNumChains)
        {
            newChains = this._buildChains(newChains, tolerance);
        }
        return newChains;
    }

    /**
     *  Convert a connected chain into the simplest representation:
     *   - Single curve          → as-is
     *   - All collinear degree-1 → single Polyline
     *   - Mixed / non-linear    → CompoundCurve
     */
    private _chainToCurve(chain: Array<Curve>): Curve
    {
        if (chain.length === 1) return chain[0];
        const merged = this._mergeCollinearSegments(chain);
        if (merged.length === 1) return merged[0];
        return Curve.Compound(merged);
    }

    /**
     *  Walk a chain and merge consecutive collinear degree-1 segments into single polylines.
     */
    private _mergeCollinearSegments(chain: Array<Curve>): Array<Curve>
    {
        const TOLERANCE = 1e-6;
        const result: Curve[] = [];
        let run: Point[] = [];

        const flushRun = () =>
        {
            if (run.length >= 2) result.push(Curve.Polyline(run));
            run = [];
        };

        chain.forEach(curve =>
        {
            if (!curve.isCompound() && curve.degree() === 1)
            {
                const cps = curve.controlPoints();
                cps.slice(0, -1).forEach((segStart, k) =>
                {
                    const segEnd = cps[k + 1];
                    const dx = segEnd.x - segStart.x;
                    const dy = segEnd.y - segStart.y;
                    const dz = segEnd.z - segStart.z;
                    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (len < TOLERANCE) return;
                    const segDir = new Vector(dx / len, dy / len, dz / len);

                    if (run.length === 0)
                    {
                        run.push(segStart, segEnd);
                    }
                    else
                    {
                        const prev = run.at(-2)!;
                        const last = run.at(-1)!;
                        const px = last.x - prev.x;
                        const py = last.y - prev.y;
                        const pz = last.z - prev.z;
                        const plen = Math.sqrt(px * px + py * py + pz * pz);
                        const prevDir = plen > TOLERANCE
                            ? new Vector(px / plen, py / plen, pz / plen)
                            : segDir;

                        const cross = prevDir.copy().cross(segDir);
                        if (cross.length() < TOLERANCE)
                        {
                            run.push(segEnd);
                        }
                        else
                        {
                            flushRun();
                            run.push(segStart, segEnd);
                        }
                    }
                });
            }
            else
            {
                flushRun();
                result.push(curve);
            }
        });
        flushRun();
        return result;
    }

    //// MESH-SPECIFIC (BVH) ////

    hits(other: Mesh | ShapeCollection<Mesh>): Array<[Mesh, Mesh]>
    {
        const aList = this.meshes().toArray();
        const bList = other instanceof Mesh ? [other] : other.meshes().toArray();
        return aList.flatMap(a => bList.filter(b => a.hits(b)).map(b => [a, b] as [Mesh, Mesh]));
    }

    raycast(
        origin: [number, number, number],
        direction: [number, number, number],
        maxDist = Infinity,
        all = true,
    ): Array<{ mesh: Mesh; hit: RaycastHit }> | { mesh: Mesh; hit: RaycastHit } | null
    {
        const results = this.meshes().toArray()
            .map(mesh => ({ mesh, hit: mesh.raycast(origin, direction, maxDist, false) }))
            .filter((r): r is { mesh: Mesh; hit: RaycastHit } => r.hit !== null)
            .sort((a, b) => a.hit.distance - b.hit.distance);
        if (all) return results;
        return results[0] ?? null;
    }

    distanceTo(other: Mesh | ShapeCollection<Mesh>): number
    {
        const aList = this.meshes().toArray();
        const bList = other instanceof Mesh ? [other] : other.meshes().toArray();
        return aList.reduce((minSoFar, a) =>
        {
            if (minSoFar === 0) return 0;
            return bList.reduce((m, b) => { if (m === 0) return 0; return Math.min(m, a.distanceTo(b)); }, minSoFar);
        }, Infinity);
    }

    closestPair(other: ShapeCollection<Mesh>): { mesh1: Mesh; mesh2: Mesh; distance: number } | null
    {
        const aList = this.meshes().toArray();
        const bList = other.meshes().toArray();
        if (!aList.length || !bList.length) return null;
        return aList.flatMap(a => bList.map(b => ({ mesh1: a, mesh2: b, distance: a.distanceTo(b) })))
            .reduce((best, pair) => best === null || pair.distance < best.distance ? pair : best, null as { mesh1: Mesh; mesh2: Mesh; distance: number } | null);
    }

    _projectEdges(_options: ProjectEdgeOptions): void
    {
        throw new Error('ShapeCollection::_projectEdges(): not yet implemented');
    }

    //// PATTERNS ////

    /** Copy this collection count times in a line along direction, spaced by spacing */
    row(count: number, spacing: number = 10, direction: PointLike | Axis = 'x'): ShapeCollection<S>
    {
        const dir: PointLike = direction === 'x' ? [1, 0, 0]
                             : direction === 'y' ? [0, 1, 0]
                             : direction === 'z' ? [0, 0, 1]
                             : direction as PointLike;
        const result = new ShapeCollection<S>();
        for (let i = 0; i < count; i++)
        {
            const delta: PointLike = [(dir as number[])[0] * spacing * i, (dir as number[])[1] * spacing * i, (dir as number[])[2] * spacing * i];
            result.add(this.copy().translate(delta));
        }
        return result;
    }

    /** Copy this collection in a 3D grid, spaced uniformly */
    grid(cx: number = 2, cy: number = 2, cz: number = 1, spacing: number = 10): ShapeCollection<S>
    {
        const result = new ShapeCollection<S>();
        for (let iz = 0; iz < cz; iz++)
        for (let iy = 0; iy < cy; iy++)
        for (let ix = 0; ix < cx; ix++)
        {
            result.add(this.copy().translate(ix * spacing, iy * spacing, iz * spacing));
        }
        return result;
    }

    replicate(num: number, transform: (collection: ShapeCollection<S>, index: number, prev: ShapeCollection<S> | undefined) => ShapeCollection<S>): ShapeCollection<S>
    {
        const { shapes } = Array.from({ length: num }, (_, i) => i).reduce<{ shapes: S[]; prev: ShapeCollection<S> | undefined }>(
            ({ shapes, prev }, i) =>
            {
                const transformed = transform(this.copy(), i, prev);
                return { shapes: [...shapes, ...transformed.toArray()], prev: transformed };
            },
            { shapes: [], prev: undefined }
        );
        return new ShapeCollection<S>(...shapes);
    }

    //// EXPORT ////

    toString(): string
    {
        return `<ShapeCollection shapes="${this._shapes.length}"${(Array.from(this._groups.keys()).length > 0) ? 'groups="' + Array.from(this._groups.keys()).join(',') + '"' : ''} types="${[...new Set(this._shapes.map(s => s.type()))].join(',')}">`;
    }

    async toGLTF(up: Axis = 'z'): Promise<string>
    {
        const builder = new GLTFBuilder(up, 'scene');
        this._shapes.forEach((shape, i) => builder.add(shape as any, `shape_${i}`));
        if (builder.isEmpty()) console.warn('ShapeCollection::toGLTF(): No exportable shapes found.');
        return builder.applyExtensions().toGLTF();
    }

    async toGLB(up: Axis = 'z'): Promise<Uint8Array>
    {
        const builder = new GLTFBuilder(up, 'scene');
        this._shapes.forEach((shape, i) => builder.add(shape as any, `shape_${i}`));
        if (builder.isEmpty()) console.warn('ShapeCollection::toGLB(): No exportable shapes found.');
        return builder.applyExtensions().toGLB();
    }

    toArray(): Array<S> 
    { 
        return this.shapes(); 
    }
}
