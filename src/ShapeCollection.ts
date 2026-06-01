/**
 *  ShapeCollection.ts
 *
 *  A generic, typed collection of Shape instances.
 *
 *  ShapeCollection<S extends Shape = Shape> is the single collection class.
 *  Use ShapeCollection<Mesh> or ShapeCollection<Curve> for typed access.
 *  Curve-specific and Mesh-specific methods are included here; they throw
 *  or no-op when called on the wrong shape type.
 * 
 */

import type { Axis, BasePlane, PointLike, ProjectEdgeOptions, RaycastHit } from './types';

import { Vector } from './Vector';
import { Vertex } from './Vertex';
import { Mesh } from './Mesh';
import { Curve } from './Curve';
import { Shape } from './Shape';
import { Point } from './Point';
import { Bbox } from './Bbox';

import { MeshJs } from './wasm/csgrs';
import { GLTFBuilder } from './GLTFBuilder';

import { TOLERANCE } from './constants';

/** Minimal interface a shape must satisfy to be held in a ShapeCollection. */
export interface CollectableShape {
    copy(): this
    bbox(): undefined|Bbox
    type?: string
    // Transform methods — present on all meshup shapes
    translate?(px: PointLike, dy?: PointLike, dz?: PointLike): this
    rotate?(deg: number, axis?: Axis|PointLike, origin?: PointLike): this
    rotateAround?(deg: number, axis?: Axis|PointLike, pivot?: PointLike): this
    rotateQuaternion?(qw: number|{ w: number, x: number, y: number, z: number }, x?: number, y?: number, z?: number): this
    scale?(factor: any, origin?: PointLike): this
    mirror?(dir: Axis|PointLike, pos?: PointLike): this
    // Styling
    color(c: any, g?: number, b?: number): this
    opacity?(o: number): this
    hide(): this
}

export class ShapeCollection<S extends CollectableShape = Shape>
{
    _shapes: Array<S> = [];
    _groups = new Map<string, ShapeCollection<S>>();
    private _fakeArrayLength = 0;
    private _fakeGroupKeys = new Set<string>();

    constructor(...args: Array<CollectableShape | Array<any> | ShapeCollection<any>>)
    {
        args.forEach(arg => this.add(arg as any));
        this._setFakeArrayKeys();
    }

    /** Expose shapes as numeric index properties (col[0], col[1], ...) for array-like access. */
    _setFakeArrayKeys(): void
    {
        for (let i = this._shapes.length; i < this._fakeArrayLength; i++) { delete (this as any)[i]; }
        this._shapes.forEach((shape, i) => { (this as any)[i] = shape; });
        this._fakeArrayLength = this._shapes.length;
        this._setFakeGroupKeys();
    }

    /**
     * Expose groups as instance properties (col.insulation, col.studs, ...) for
     * direct access. Points at the live group collection so mutations like
     * .hide() propagate to the real shapes. Never overwrites existing
     * (real) properties; stale keys are removed when a group is gone.
     */
    _setFakeGroupKeys(): void
    {
        // drop keys whose group no longer exists
        this._fakeGroupKeys.forEach(k =>
        {
            if (!this._groups.has(k)) { delete (this as any)[k]; this._fakeGroupKeys.delete(k); }
        });
        this._groups.forEach((groupCol, name) =>
        {
            if (this._fakeGroupKeys.has(name)) { (this as any)[name] = groupCol; return; }
            if ((this as any)[name] === undefined) // don't clobber real props (shapes, methods, ...)
            {
                (this as any)[name] = groupCol;
                this._fakeGroupKeys.add(name);
            }
            else
            {
                console.warn(
                    `ShapeCollection: group key "${name}" conflicts with an existing property or method ` +
                    `and will not be accessible as a shortcut (col.${name}). ` +
                    `Rename the group to avoid the collision.`
                );
            }
        });
    }

    //// STATIC FACTORIES ////

    static isShapeCollection(obj: any): obj is ShapeCollection
    {
        return obj instanceof ShapeCollection;
    }

    static generate<S extends CollectableShape>(count: number, generator: (index: number) => S): ShapeCollection<S>
    {
        return new ShapeCollection<S>(...new Array(count).fill(null).map((_, i) => generator(i)));
    }

    //// COLLECTION MANAGEMENT ////

    update(shapes: Array<S> | ShapeCollection<S>): void
    {
        this._shapes = (ShapeCollection.isShapeCollection(shapes) ? shapes.toArray() : shapes) as S[];
        this._setFakeArrayKeys();
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
                ? shapes.toArray() as unknown as S[]
                : (shapes as any[])
                    .filter(s => {
                        // HACKY: If you want to force any instance to be accepted as a shape, 
                        // implement isShapeClass() on it to return true, and ShapeCollection will accept it. 
                        return Shape.isShape(s) || s.isShapeClass?.();
                    }) as S[];

            this._shapes.push(...addShapes);
        }
        else
        {
            console.error(`ShapeCollection::add(): Invalid shape(s). Supply something [<Shape>|<ShapeCollection>|Array<Shape>]. Skipping:`, shapes);
        }
        this._setFakeArrayKeys();
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
        this._setFakeGroupKeys(); // group added after this.add()'s key refresh — sync now
        return this;
    }

    /** Tag shapes that are already in this collection as members of a named
     *  group, without adding duplicate references to the parent.
     *
     *  Use this for cross-cutting classifications (e.g. silhouette ⊂ visible)
     *  where the group is a logical subset of shapes already tracked elsewhere.
     *  The caller is responsible for ensuring the shapes are already in `this`.
     */
    tagGroup(groupName: string, shapes: S | ShapeCollection<S>): this
    {
        if (!this._groups.has(groupName)) this._groups.set(groupName, new ShapeCollection<S>());
        this._groups.get(groupName)?.add(shapes);
        this._setFakeGroupKeys();
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
        this._setFakeGroupKeys(); // drop the now-stale fake key
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
        else
        {
            this._shapes = this._shapes.filter(s => s !== shape);
            this._setFakeArrayKeys();
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
        this._setFakeArrayKeys();
        return this;
    }

    pop(): S | undefined
    {
        const s = this._shapes.pop();
        this._setFakeArrayKeys();
        return s;
    }

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
        this._shapes.forEach(shape => shape.translate?.(vecOrX, dy, dz));
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

    /** Place the collection on a given height based on the collection bbox,
     *  by default at 0. Used to place a set of shapes on the XY plane as one
     *  unit rather than floating each child independently.
     */
    place(z: number = 0): this
    {
        const bb = this.bbox();
        if (!bb) return this;
        return this.translate(0, 0, z - bb.min().z);
    }

    rotateX(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'x', origin); }
    rotateY(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'y', origin); }
    rotateZ(angleDeg: number, origin?: PointLike): this { return this.rotate(angleDeg, 'z', origin); }

    rotate(angleDeg: number, axis: Axis = 'z', origin: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.rotate?.(angleDeg, axis, origin));
        return this;
    }

    rotateAround(angleDeg: number, axis: Axis | PointLike = 'z', pivot: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.rotateAround?.(angleDeg, axis, pivot));
        return this;
    }

    rotateQuaternion(wOrObj: number | { w: number, x: number, y: number, z: number }, x?: number, y?: number, z?: number): this
    {
        this.forEach(shape => shape.rotateQuaternion?.(wOrObj as any, x as any, y as any, z as any));
        return this;
    }

    scale(factor: number | PointLike, origin: PointLike = { x: 0, y: 0, z: 0 }): this
    {
        this._shapes.forEach(shape => shape.scale?.(factor, origin));
        return this;
    }

    mirror(dir: Axis | PointLike, pos?: PointLike): this
    {
        this._shapes.forEach(shape => shape.mirror?.(dir, pos));
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
        this._shapes.forEach(shape => shape.opacity?.(opacity));
        return this;
    }

    alpha(a: number): this { return this.opacity(a); }

    /** Set dashed line */
    dashed(dash: number[] = [2, 2]): this
    {
        this._shapes.forEach(shape => (shape as any).dashed?.(dash));
        return this;
    }

    /** Hide Shapes in Collection */
    hide(): this
    {
        this._shapes.forEach(shape => shape.hide());
        return this;
    }

    /** Show Shapes in Collection */
    show(): this
    {
        const shapes = this._shapes as any[];
        shapes.forEach(shape => shape.show?.());
        return this;
    }


    /** Merge all polygons into one Mesh (without booleans) */
    merge(): any
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

    //// BOOLEAN OPERATIONS ////

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

    intersecting(other: S): ShapeCollection<any>
    {
        throw new Error('ShapeCollection::intersecting(): not yet implemented');
    }

    intersections(other: S): ShapeCollection<any>
    {
        throw new Error('ShapeCollection::_intersections(): not yet implemented');
    }

    private _visibleProjectionMeshes(includeHiddenShapes: boolean): Mesh[]
    {
        const shapes = this._shapes as any[];
        const projectedShapes = includeHiddenShapes
            ? shapes
            : shapes.filter(shape => shape.style?.visible !== false);

        return projectedShapes.filter((shape): shape is Mesh => shape instanceof Mesh);
    }

    private static _makeProjectionOptions(
        viewDirection: Vector,
        planeNormal: Vector,
        featureAngle: number,
        samples: number,
    ): ProjectEdgeOptions
    {
        return {
            viewDirection: viewDirection.toArray(),
            planeNormal: planeNormal.toArray(),
            planeOrigin: [0, 0, 0],
            featureAngle,
            samples,
        };
    }

    private static _bboxesTouch(a: Bbox | undefined, b: Bbox | undefined, tol: number = TOLERANCE): boolean
    {
        return !!a && !!b && a.distance(b) <= tol;
    }

    private static _appendProjectionGroups(target: ShapeCollection<any>, projected: ShapeCollection<any>): void
    {
        const hidden = projected.group('hidden');
        const visible = projected.group('visible');
        const silhouette = projected.group('silhouette');
        if (hidden?.length) target.addGroup('hidden', hidden);
        if (visible?.length) target.addGroup('visible', visible);
        // silhouette is a subset of visible — use tagGroup so the same Curve
        // objects aren't pushed into _shapes a second time (addGroup would duplicate them)
        if (silhouette?.length) target.tagGroup('silhouette', silhouette);
    }

    private static _projectMergedProjectionWithContactFaces(
        meshes: Mesh[],
        viewDir: Vector,
        planeNormal: Vector,
        hiddenLines: boolean,
        samples: number,
        featureAngle: number,
    ): ShapeCollection<any>
    {
        const merged = new ShapeCollection<Mesh>(...meshes).merge() as Mesh;
        const options = ShapeCollection._makeProjectionOptions(
            viewDir,
            planeNormal,
            featureAngle,
            samples,
        );
        const iso = merged._projectEdges(options);

        const TOL = 1e-3;
        const AXES: Array<'x'|'y'|'z'> = ['x', 'y', 'z'];
        const isCube = meshes.map(mesh => typeof (mesh as any).isCuboid === 'function'
            ? (mesh as any).isCuboid()
            : false);
        const bboxes = meshes.map(mesh => mesh.bbox());
        const sourceShift = (globalThis as any).__ISO_SHIFT__ ?? 1;
        const faceShift = viewDir.copy().scale(Math.max(TOLERANCE * 100, sourceShift)).toArray();

        const contactPoint = (
            touchAxis: 'x'|'y'|'z',
            touchPlane: number,
            u: 'x'|'y'|'z',
            uVal: number,
            v: 'x'|'y'|'z',
            vVal: number,
        ): Point =>
        {
            const coords: Record<'x'|'y'|'z', number> = { x: 0, y: 0, z: 0 };
            coords[touchAxis] = touchPlane;
            coords[u] = uVal;
            coords[v] = vVal;
            return new Point(coords.x, coords.y, coords.z);
        };

        meshes.forEach((_, index) =>
        {
            const a = bboxes[index];
            if (!a || !isCube[index]) return;

            meshes.slice(index + 1).forEach((__, offset) =>
            {
                const otherIndex = index + offset + 1;
                const b = bboxes[otherIndex];
                if (!b || !isCube[otherIndex]) return;
                if (a.distance(b) > TOL) return;

                let touchAxis: 'x'|'y'|'z'|null = null;
                let touchPlane = 0;
                AXES.some(axis =>
                {
                    const axisName = axis.toUpperCase();
                    const aMax = (a as any)['max' + axisName]();
                    const aMin = (a as any)['min' + axisName]();
                    const bMin = (b as any)['min' + axisName]();
                    const bMax = (b as any)['max' + axisName]();
                    if (Math.abs(aMax - bMin) < TOL)
                    {
                        touchAxis = axis;
                        touchPlane = aMax;
                        return true;
                    }
                    if (Math.abs(aMin - bMax) < TOL)
                    {
                        touchAxis = axis;
                        touchPlane = aMin;
                        return true;
                    }
                    return false;
                });
                if (!touchAxis) return;

                const others = AXES.filter(axis => axis !== touchAxis) as Array<'x'|'y'|'z'>;
                const u = others[0];
                const v = others[1];
                const uName = u.toUpperCase();
                const vName = v.toUpperCase();

                const cMinU = Math.max((a as any)['min' + uName](), (b as any)['min' + uName]());
                const cMaxU = Math.min((a as any)['max' + uName](), (b as any)['max' + uName]());
                const cMinV = Math.max((a as any)['min' + vName](), (b as any)['min' + vName]());
                const cMaxV = Math.min((a as any)['max' + vName](), (b as any)['max' + vName]());
                if (cMaxU - cMinU <= TOL || cMaxV - cMinV <= TOL) return;

                const p00 = contactPoint(touchAxis, touchPlane, u, cMinU, v, cMinV);
                const p10 = contactPoint(touchAxis, touchPlane, u, cMaxU, v, cMinV);
                const p11 = contactPoint(touchAxis, touchPlane, u, cMaxU, v, cMaxV);
                const p01 = contactPoint(touchAxis, touchPlane, u, cMinU, v, cMaxV);

                const face = Mesh.fromPoints([p00, p10, p11, p01])
                    .translate(faceShift[0], faceShift[1], faceShift[2]);
                const occluders = new ShapeCollection<Mesh>(merged.copy() as Mesh);
                const projected = face._projectEdges(options, occluders);
                ShapeCollection._appendProjectionGroups(iso, projected);
            });
        });

        if (!hiddenLines && iso.group('hidden'))
        {
            iso.removeGroup('hidden');
        }

        return Mesh._flattenProjectionToScreen(iso, planeNormal);
    }

    //// ISOMETRY ////

    isometry(
        cam: PointLike = [-1, -1, 1],
        hiddenLines: boolean = false,
        includeHiddenShapes: boolean = false,
        samples: number = 16,
        featureAngle: number=10,
    ): ShapeCollection<any>
    {
        const meshes = this._visibleProjectionMeshes(includeHiddenShapes);
        if (!meshes.length)
        {
            return new ShapeCollection<any>();
        }
        if (meshes.length === 1)
        {
            return meshes[0].isometry(cam, hiddenLines, false, samples, featureAngle);
        }

        const camDirVec = Point.from(cam).toVector().normalize();
        const planeNormal = camDirVec.copy(); // .reverse() removed. Now works. TODO: check why;

        // Technique: project the merged solid first, then add touching-face
        // contact edges with a second HLR pass. The older per-mesh method
        // projected each mesh against siblings and shifted touching meshes
        // toward the camera; that preserved more contact edges, but it could
        // overexpose edges that should be hidden and was slower on dense assemblies.
        return ShapeCollection._projectMergedProjectionWithContactFaces(
            meshes,
            camDirVec,
            planeNormal,
            hiddenLines,
            samples,
            featureAngle,
        );
    }
        

    iso(
        cam: PointLike = [-1, -1, 1],
        hiddenLines: boolean = false,
        includeHiddenShapes: boolean = false,
        samples: number = 16,
        featureAngle: number=10,
    ): ShapeCollection<any>
    {
        return this.isometry(cam, hiddenLines, includeHiddenShapes, samples, featureAngle);
    }

    isoTest(
        cam: PointLike = [-1, -1, 1],
        hiddenLines: boolean = false,
        includeHiddenShapes: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
    ): ShapeCollection<any>
    {
        const meshes = this._visibleProjectionMeshes(includeHiddenShapes);
        if (!meshes.length)
        {
            return new ShapeCollection<any>();
        }
        if (meshes.length === 1)
        {
            return meshes[0].isometry(cam, hiddenLines, false, samples, featureAngle);
        }

        const camDirVec = Point.from(cam).toVector().normalize();
        const planeNormal = camDirVec.copy().reverse();

        return ShapeCollection._projectMergedProjectionWithContactFaces(
            meshes,
            camDirVec,
            planeNormal,
            hiddenLines,
            samples,
            featureAngle,
        );
    }

    /** Orthographic elevation projection of every Mesh in this collection,
     *  using the merged-solid pass plus contact-face add-back.
     *  See {@link Mesh.elevation} for parameter semantics.
     */
    elevation(
        from: PointLike | BasePlane = 'front',
        hiddenLines: boolean = false,
        includeHiddenShapes: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
    ): ShapeCollection<any>
    {
        const meshes = this._visibleProjectionMeshes(includeHiddenShapes);
        if (!meshes.length)
        {
            return new ShapeCollection<any>();
        }
        if (meshes.length === 1)
        {
            return meshes[0].elevation(from, hiddenLines, samples, featureAngle);
        }

        const viewDir = Mesh._resolveViewDirection(from);
        const planeNormal = viewDir.copy().reverse();

        return ShapeCollection._projectMergedProjectionWithContactFaces(
            meshes,
            viewDir,
            planeNormal,
            hiddenLines,
            samples,
            featureAngle,
        );
    }

    /** Architectural section across every Mesh in this collection.
     *  See {@link Mesh.section} for parameter semantics.
     */
    section(
        pivot: PointLike,
        normal: PointLike | BasePlane = [0, 0, 1],
        hiddenLines: boolean = false,
        includeHiddenShapes: boolean = false,
        samples: number = 16,
        featureAngle: number = 10,
    ): ShapeCollection<any>
    {
        const meshes = this._visibleProjectionMeshes(includeHiddenShapes);
        if (!meshes.length)
        {
            return new ShapeCollection<any>();
        }
        if (meshes.length === 1)
        {
            return meshes[0].section(pivot, normal, hiddenLines, samples, featureAngle);
        }

        return new ShapeCollection<Mesh>(...meshes)
            .merge()
            .section(pivot, normal, hiddenLines, samples, featureAngle);
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
                            <text x="4" y="15" font-size="5" fill="red">ShapeCollection::toSVG() — no curves</text></svg>`;
        }

        const paths: string[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const curveToGroup = new Map<S, string>();
        this._groups.forEach((groupCol, groupName) =>
        {
            groupCol.toArray().forEach(shape => curveToGroup.set(shape as S, groupName));
        });

        curves.forEach(curve =>
        {
            const svg = (curve as any).toSVG();
            const vbMatch = svg.match(/viewBox="([^"]*)"/);
            const groupName = curveToGroup.get(curve as unknown as S);
            const cssClass = 'line' + (groupName ? ` ${groupName}` : '');
            paths.push((curve as any).toSVGElem(cssClass));
            if (vbMatch)
            {
                const [vx, vy, vw, vh] = vbMatch[1].split(' ').map(Number);
                if (vx < minX) minX = vx;   if (vy < minY) minY = vy;
                if (vx + vw > maxX) maxX = vx + vw;  if (vy + vh > maxY) maxY = vy + vh;
            }
        });

        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
        const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
        const style = '<style>.line{fill:none;stroke:black;stroke-width:0.25px}.hidden{stroke:#888;stroke-dasharray:3 2}</style>';
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${style}${paths.join('')}</svg>`;
    }


    /** Returns all start/end vertices of curves in this collection */
    curveVertices(): Array<Vertex>
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

    /** Copy this collection in a 3D grid, spaced uniformly or per axis */
    grid(cx: number = 2, cy: number = 2, cz: number = 1, spacing: number | PointLike = 10): ShapeCollection<S>
    {
        const spacingPoint = typeof spacing === 'number'
            ? [spacing, spacing, spacing] as [number, number, number]
            : Point.from(spacing).toArray() as [number, number, number]
        const result = new ShapeCollection<S>();
        for (let iz = 0; iz < cz; iz++)
        for (let iy = 0; iy < cy; iy++)
        for (let ix = 0; ix < cx; ix++)
        {
            result.add(this.copy().translate(
                ix * spacingPoint[0],
                iy * spacingPoint[1],
                iz * spacingPoint[2],
            ));
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

    //// HLR POST-PROCESSING ////

    /**
     * For every pair of touching axis-aligned cuboid meshes in `meshes`,
     * compute the perimeter of their shared face analytically and append
     * each visible perimeter edge to the `iso`/`elev` projection's 'visible'
     * group. Bypasses the HLR ray-cast for these edges, eliminating the
     * cross-mesh clip-discretisation noise that produced dangling/missing
     * contact-perimeter polylines.
     *
     * Visibility per edge is decided the same way the Rust HLR's
     * `should_keep_edge` decides it: silhouette (one adjacent face front-,
     * the other back-facing) is always visible; both-front-facing feature
     * edges (90° between adjacent cuboid faces always passes the typical
     * `featureAngle` threshold) are visible too; both-back-facing edges sit
     * behind the solid and are skipped.
     *
     * Only triggers for meshes whose `isCuboid()` is true AND whose bboxes
     * touch on exactly one axis (a face contact, not an edge or corner
     * contact). Non-axis-aligned cuboids fall back to plain HLR — this is
     * the fast common path that covers the user's beam-grid case.
     */
    static _addCuboidContactPerimeters(
        iso: ShapeCollection<any>,
        meshes: Mesh[],
        viewDir: Vector,
        planeNormal: Vector,
        featureAngle: number,
    ): void
    {
        const TOL = 1e-3;
        const FEATURE_THRESH_RAD = Math.max(featureAngle, 0) * Math.PI / 180;
        const SIN_THRESH = Math.sin(FEATURE_THRESH_RAD);
        const AXES: Array<'x'|'y'|'z'> = ['x', 'y', 'z'];

        // Cache isCuboid() + bbox(); cuboid detection tessellates.
        const isCube = meshes.map(m => typeof (m as any).isCuboid === 'function'
            ? (m as any).isCuboid()
            : false);
        const bboxes = meshes.map(m => m.bbox());

        const projectToPlane = (x: number, y: number, z: number): Point =>
        {
            const d = x * planeNormal.x + y * planeNormal.y + z * planeNormal.z;
            return new Point(x - d * planeNormal.x,
                             y - d * planeNormal.y,
                             z - d * planeNormal.z);
        };

        const isVisibleEdge = (n0: Vector, n1: Vector): boolean =>
        {
            const d0 = n0.x * viewDir.x + n0.y * viewDir.y + n0.z * viewDir.z;
            const d1 = n1.x * viewDir.x + n1.y * viewDir.y + n1.z * viewDir.z;
            // Silhouette: front+back pair → always visible.
            if (d0 * d1 < 0) return true;
            // Both back-facing: edge is behind the solid → hidden.
            if (d0 <= 0 && d1 <= 0) return false;
            // Both front-facing: visible only if it's a genuine feature
            // edge (adjacent face normals make an angle > featureAngle).
            const cross = Math.hypot(
                n0.y * n1.z - n0.z * n1.y,
                n0.z * n1.x - n0.x * n1.z,
                n0.x * n1.y - n0.y * n1.x);
            return cross > SIN_THRESH;
        };

        const addPolyline = (a: Point, b: Point) =>
        {
            const line = Curve.Line([a.x, a.y, a.z], [b.x, b.y, b.z]);
            iso.addGroup('visible', line as any);
        };

        for (let i = 0; i < meshes.length; i++)
        {
            const a = bboxes[i];
            if (!a || !isCube[i]) continue;

            for (let j = i + 1; j < meshes.length; j++)
            {
                const b = bboxes[j];
                if (!b || !isCube[j]) continue;
                if (a.distance(b) > TOL) continue;

                // Find the axis where the two bboxes touch on a face, plus
                // the sign — `+1` means a.max[t] == b.min[t], `-1` the reverse.
                let touchAxis: 'x'|'y'|'z'|null = null;
                let touchPlane = 0;
                let aOutwardSign: 1 | -1 = 1;
                for (const t of AXES)
                {
                    if (Math.abs((a as any)['max' + t.toUpperCase()]() - (b as any)['min' + t.toUpperCase()]()) < TOL)
                    {
                        touchAxis = t;
                        touchPlane = (a as any)['max' + t.toUpperCase()]();
                        aOutwardSign = 1;
                        break;
                    }
                    if (Math.abs((a as any)['min' + t.toUpperCase()]() - (b as any)['max' + t.toUpperCase()]()) < TOL)
                    {
                        touchAxis = t;
                        touchPlane = (a as any)['min' + t.toUpperCase()]();
                        aOutwardSign = -1;
                        break;
                    }
                }
                if (!touchAxis) continue; // edge/corner contact, not face — skip

                const others = AXES.filter(x => x !== touchAxis) as Array<'x'|'y'|'z'>;
                const u = others[0];
                const v = others[1];

                const aMinU = (a as any)['min' + u.toUpperCase()]();
                const aMaxU = (a as any)['max' + u.toUpperCase()]();
                const bMinU = (b as any)['min' + u.toUpperCase()]();
                const bMaxU = (b as any)['max' + u.toUpperCase()]();
                const aMinV = (a as any)['min' + v.toUpperCase()]();
                const aMaxV = (a as any)['max' + v.toUpperCase()]();
                const bMinV = (b as any)['min' + v.toUpperCase()]();
                const bMaxV = (b as any)['max' + v.toUpperCase()]();

                const cMinU = Math.max(aMinU, bMinU);
                const cMaxU = Math.min(aMaxU, bMaxU);
                const cMinV = Math.max(aMinV, bMinV);
                const cMaxV = Math.min(aMaxV, bMaxV);
                if (cMaxU - cMinU <= TOL || cMaxV - cMinV <= TOL) continue; // degenerate

                // Build the contact face's outward normal on A's side
                // (points toward B). Use that to classify each perimeter
                // edge: each is between A's contact face and an A side face.
                const makeAxisN = (axis: 'x'|'y'|'z', sign: 1 | -1): Vector =>
                    new Vector(axis === 'x' ? sign : 0,
                               axis === 'y' ? sign : 0,
                               axis === 'z' ? sign : 0);
                const nT = makeAxisN(touchAxis, aOutwardSign);

                const point = (uVal: number, vVal: number): Point =>
                {
                    const coords: Record<string, number> = { x: 0, y: 0, z: 0 };
                    coords[touchAxis!] = touchPlane;
                    coords[u] = uVal;
                    coords[v] = vVal;
                    return projectToPlane(coords.x, coords.y, coords.z);
                };

                // 4 perimeter edges of the contact rectangle. For each,
                // determine the OTHER adjacent face normal (apart from nT)
                // from A's perspective so visibility can be classified.
                const edges: Array<{ a: Point; b: Point; nSide: Vector }> = [
                    // along u at v=cMinV → adjacent to A's -v face
                    { a: point(cMinU, cMinV), b: point(cMaxU, cMinV),
                      nSide: makeAxisN(v, cMinV === aMinV ? -1 : 1) },
                    // along u at v=cMaxV → adjacent to A's +v face
                    { a: point(cMinU, cMaxV), b: point(cMaxU, cMaxV),
                      nSide: makeAxisN(v, cMaxV === aMaxV ? 1 : -1) },
                    // along v at u=cMinU → adjacent to A's -u face
                    { a: point(cMinU, cMinV), b: point(cMinU, cMaxV),
                      nSide: makeAxisN(u, cMinU === aMinU ? -1 : 1) },
                    // along v at u=cMaxU → adjacent to A's +u face
                    { a: point(cMaxU, cMinV), b: point(cMaxU, cMaxV),
                      nSide: makeAxisN(u, cMaxU === aMaxU ? 1 : -1) },
                ];

                edges.forEach(e =>
                {
                    if (isVisibleEdge(nT, e.nSide)) addPolyline(e.a, e.b);
                });
            }
        }
    }

    //// EXPORT ////

    toString(): string
    {
        return `<ShapeCollection shapes="${this._shapes.length}"${(Array.from(this._groups.keys()).length > 0) ? ' groups="' + Array.from(this._groups.keys()).join(',') + '"' : ''} types="${[...new Set(this._shapes.map(s => s.type))].join(',')}">`;
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
