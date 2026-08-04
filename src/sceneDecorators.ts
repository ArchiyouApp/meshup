/**
 *  sceneDecorators.ts
 *
 *  Method decorators that give Shape / ShapeCollection methods scene self-management.
 *
 *  Each decorator keys off the shape's SceneNode (`this._node`):
 *    - When the shape is tied to a scene it mutates the scene (add / replace / layer).
 *    - When it is NOT (standalone meshup, or a shape marked `tmp()`) it is a pure no-op.
 *
 *  A shape can also be scene-derived but detached: `@sceneCarry` accessors (segments/start/…)
 *  return fresh, unattached shapes carrying the source's scene root in `_scene`. Those still
 *  resolve an active layer (see activeLayerOf), which is what lets `segments().first().copy()`
 *  and a later `@sceneUpdate` land in the scene. `removeFromScene()` clears `_scene`, so a
 *  shape taken out stays out.
 *
 *  The plain kernel result is ALWAYS returned unchanged — decorators never wrap the result.
 *  This is what lets the modeler work with meshup shapes directly: `extrude()` still returns
 *  a `Mesh`, `split()` still returns a `ShapeCollection<Mesh>`, etc.
 *
 *    @sceneCarry     no scene mutation; results carry self's scene root (select, sub-shapes)
 *    @sceneReplace   add result(s) to self's own layer; detach self   (extrude, split, hull…)
 *    @sceneAdd       add result(s) to the active layer; keep self     (segment)
 *    @sceneLayer(n)  group result(s) in sub-layer 'n' of active layer (iso, elevation, section)
 *    @sceneUpdate    in-place mutator (returns this); re-attach self   (offset, cutoff, connect)
 *
 *  Scene bookkeeping only ever touches meshup's own SceneNode graph — it never calls into
 *  `_modeler` (that opaque reference is only carried/propagated so the host app can find the
 *  modeler from any shape; meshup itself never invokes it).
 */

import type { SceneNode } from './SceneNode'

// Kept loose: these decorators run on any shape/collection carrying the scene fields.
type Any = any

/** The scene root a shape belongs to: its own node's root while attached, else the root it
 *  carries from the shape it was derived from. Null when the shape has no scene at all
 *  (standalone meshup, or a shape that was explicitly removed from the scene). */
function sceneRootOf(self: Any): SceneNode | null
{
    return ((self?._node as SceneNode | null)?.root() ?? self?._scene) ?? null
}

/** The layer new results should be added to: the scene's tracked active layer, else the
 *  source shape's own parent node (sibling semantics — preserves standalone-meshup behavior,
 *  where no active layer is ever set). Null when the source is not in a scene.
 *  Also used by `Shape.copy()`, so a copy lands in the same layer a decorated result would. */
export function activeLayerOf(self: Any): SceneNode | null
{
    const node = self?._node as SceneNode | null
    if (node)
    {
        const root = node.root() as Any
        return (root?.activeLayer?.() ?? node.parent()) ?? null
    }
    // Detached but scene-derived: no parent node to fall back on, but the carried root still
    // tracks the active layer.
    return ((self?._scene as Any)?.activeLayer?.()) ?? null
}

/** The layer a REPLACE / mutation result should land on: the operand shape's OWN layer (its
 *  node's parent), so results stay where the source shape already was rather than jumping to
 *  the (possibly different) active layer. This is what makes `layer('a'); s = …; layer('b');
 *  s.subtract(cutter)` keep the pieces on 'a'. Falls back to the active layer only when self is
 *  detached-but-scene-derived (no parent node to inherit), and to null when self is not in a
 *  scene at all (standalone meshup). Used by replaceInScene() — NOT by copy()/@sceneAdd, which
 *  keep active-layer semantics via activeLayerOf. */
function replaceLayerOf(self: Any): SceneNode | null
{
    const node = self?._node as SceneNode | null
    if (node)
    {
        return (node.parent() ?? (node.root() as Any)?.activeLayer?.()) ?? null
    }
    return ((self?._scene as Any)?.activeLayer?.()) ?? null
}

/** Normalise a method result (single shape | array | ShapeCollection | null) to a flat
 *  array of shapes. */
function toShapes(result: Any): Any[]
{
    if (result == null) return []
    if (typeof result?.isShapeCollection === 'function' && result.isShapeCollection())
    {
        return result.toArray()
    }
    if (Array.isArray(result)) return result
    return [result]
}

/** Carry the opaque `_modeler` reference, the source's scene root and the sticky
 *  `_suppressScene` flag from the source onto every result shape (transitive temp-ness: ops
 *  on a `tmp()` shape yield `tmp()` results). */
function propagate(self: Any, result: Any): void
{
    const scene = sceneRootOf(self)
    // A ShapeCollection source often has no `_modeler` of its own - fall back to its shapes
    const modeler = self?._modeler ?? self?._shapes?.find((s: Any) => s?._modeler)?._modeler ?? null
    // Carry onto the ShapeCollection itself too, so chained collection ops keep the reference
    if (result?.isShapeCollection?.() && result._modeler == null) result._modeler = modeler
    toShapes(result).forEach(s =>
    {
        if (s == null || typeof s !== 'object') return
        if (s._modeler == null) s._modeler = modeler
        if (s._scene == null) s._scene = scene
        if (self?._suppressScene) s._suppressScene = true
    })
}

/** Add every shape in `result` to `layer`. */
function addTo(layer: SceneNode | null, result: Any): void
{
    if (!layer) return
    toShapes(result).forEach(s =>
    {
        if (s?.isShapeClass?.()) (layer as Any).addShape(s)
    })
}

type Decorator = (target: Any, key: string, desc: PropertyDescriptor) => PropertyDescriptor

/** Carry-only: run; propagate `_modeler`/`_suppressScene` onto the result(s); no scene
 *  mutation. Use on sub-shape accessors (start/end/vertices/polygons/faces/…) so shapes the
 *  user chains app-methods on (`.dim()`, `.material()`) can still reach the host modeler. */
export const sceneCarry: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        propagate(this, result)
        return result
    }
    return desc
}

let _groupSeq = 0

/** Replace `self` in the scene with `result`, then detach `self`.
 *  Results land on self's OWN layer (see replaceLayerOf) so a replace/mutation stays where the
 *  source shape was, not on a later-selected active layer.
 *  A multi-shape ShapeCollection result is grouped under a fresh sub-layer of that layer
 *  (so it stays navigable in the scene graph and the host auto-namer can name the whole group,
 *  e.g. `parts = mesh.subtract(...)` → a 'parts' layer holding the pieces). A single shape (or
 *  single-item collection) is added flat, as before. */
export function replaceInScene(self: Any, result: Any): void
{
    const active = replaceLayerOf(self)
    if (active && result?.isShapeCollection?.() && result.toArray().length > 1)
    {
        const name = (result._name && result._name !== 'collection') ? result._name : `group${++_groupSeq}`
        // addLayer creates a child layer under `active` and moves the pieces into it.
        const layer = (active as Any).addLayer(name, result)
        result._layer = layer
        result._modeler = self._modeler
    }
    else
    {
        addTo(active, result)
    }
    self._node?.detach?.()
    self._node = null
}

/** Run; add result(s) to the active layer and detach self. Keeps self out of the scene. */
export const sceneReplace: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        propagate(this, result)
        if (this._node && !this._suppressScene)
        {
            replaceInScene(this, result)
        }
        return result
    }
    return desc
}

/** Run; add result(s) to the active layer; keep self in the scene. */
export const sceneAdd: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        propagate(this, result)
        if (this._node && !this._suppressScene)
        {
            addTo(activeLayerOf(this), result)
        }
        return result
    }
    return desc
}

/** Run; group result(s) in a sub-layer `name` of the ACTIVE layer (does NOT change the active
 *  layer); keep self in the scene. So `layer('test'); box(100).iso()` puts the projection in a
 *  'test/iso' group, next to the box — not in a stray top-level 'iso' layer. Falls back to the
 *  scene root when no active layer is resolvable. */
export function sceneLayer(name: string): Decorator
{
    return (_t, _k, desc) =>
    {
        const fn = desc.value
        desc.value = function (this: Any, ...args: Any[])
        {
            const result = fn.apply(this, args)
            propagate(this, result)
            if (this._node && !this._suppressScene)
            {
                const parent = (activeLayerOf(this) ?? this._node.root()) as Any
                addTo(parent?.ensureLayer?.(name) ?? null, result)
            }
            return result
        }
        return desc
    }
}

/** For hybrid boolean ops that either mutate in place (return `this`), produce new shape(s)
 *  (a different shape or a ShapeCollection), or fail (null):
 *    - `this`            → in-place update: keep self's node (no-op).
 *    - new shape(s)      → replace: add result(s) to the active layer, detach self.
 *    - null              → op failed: leave self untouched.
 *  Used by Curve.union/difference/cutoffBy, which return a single updated Curve OR a
 *  ShapeCollection of pieces OR null. */
export const sceneReplaceOrKeep: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        propagate(this, result)
        if (this._node && !this._suppressScene && result != null && result !== this)
        {
            replaceInScene(this, result)
        }
        return result
    }
    return desc
}

//// COLLECTION DECORATORS ////
//
// A ShapeCollection is not a Shape (no `_node`), so the shape decorators above don't apply.
// These resolve the scene from the collection's `_layer` (scene-backed collections) or from
// its member shapes' nodes, and add result shapes to the active or a named layer. No-op when
// the collection is not attached to any scene (standalone meshup).

function colSceneRoot(self: Any): SceneNode | null
{
    const fromLayer = self?._layer?.root?.() ?? null
    if (fromLayer) return fromLayer
    const shaped = self?._shapes?.find((s: Any) => sceneRootOf(s))
    return sceneRootOf(shaped)
}

function colModeler(self: Any): Any
{
    return self?._modeler ?? self?._shapes?.find((s: Any) => s?._modeler)?._modeler ?? null
}

/** The layer the collection's shapes currently live on: its own layer node when scene-backed,
 *  else the parent layer of its first scene-attached shape. Used by @colSceneReplace so results
 *  replace in place on the source shapes' layer rather than moving to the active layer. */
function colSourceLayer(self: Any): SceneNode | null
{
    if (self?._layer) return self._layer as SceneNode
    const parent = self?._shapes
        ?.map((s: Any) => s?._node?.parent?.())
        ?.find((p: Any) => p)
    return (parent as SceneNode) ?? null
}

function addColResults(layer: SceneNode | null, result: Any, modeler: Any): void
{
    if (!layer) return
    toShapes(result).forEach((s: Any) =>
    {
        if (!s?.isShapeClass?.()) return
        if (s._modeler == null) s._modeler = modeler
        ;(layer as Any).addShape(s)
    })
}

/** Collection op: add result shape(s) to the active layer; keep self. */
export const colSceneAdd: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        const root = colSceneRoot(this)
        if (root) addColResults(root.activeLayer(), result, colModeler(this))
        return result
    }
    return desc
}

/** Collection op: group result shape(s) in a sub-layer `name` of the active layer; keep self.
 *  Mirrors @sceneLayer — see there for why the group is nested rather than top-level. */
export function colSceneLayer(name: string): Decorator
{
    return (_t, _k, desc) =>
    {
        const fn = desc.value
        desc.value = function (this: Any, ...args: Any[])
        {
            const result = fn.apply(this, args)
            const root = colSceneRoot(this) as Any
            if (root)
            {
                const parent = (root.activeLayer?.() ?? colSourceLayer(this) ?? root) as Any
                addColResults(parent.ensureLayer(name), result, colModeler(this))
            }
            return result
        }
        return desc
    }
}

/** Collection op: remove self's shapes (and layer node) from the scene, then add result
 *  shape(s) to the active layer (replace-in-place for the whole collection). */
export const colSceneReplace: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const root = colSceneRoot(this)
        const modeler = colModeler(this)
        // Capture the layer the source shapes live on BEFORE detaching them, so the results
        // stay on that layer rather than moving to the (possibly different) active layer.
        const sourceLayer = colSourceLayer(this)
        const result = fn.apply(this, args)
        if (root)
        {
            this._shapes?.forEach((s: Any) => s?._node?.detach?.())
            if (this._layer) { this._layer.detach(); this._layer = null }
            addColResults(sourceLayer ?? root.activeLayer(), result, modeler)
        }
        return result
    }
    return desc
}

/** In-place mutator returning `this`. When self is not currently in the scene (and not
 *  suppressed) re-attach it to the active layer; when it already has a node the in-place
 *  mutation keeps it in place, so this is a no-op. */
export const sceneUpdate: Decorator = (_t, _k, desc) =>
{
    const fn = desc.value
    desc.value = function (this: Any, ...args: Any[])
    {
        const result = fn.apply(this, args)
        if (!this._suppressScene && !this._node)
        {
            addTo(activeLayerOf(this), this)
        }
        return result
    }
    return desc
}

/** Add `result` to the scene the way an @sceneAdd method would, for shape *producers that are
 *  not Shapes themselves* — Bbox / OBbox, which build a Curve or Mesh from the shape they were
 *  measured on. The measured shape is the source: results carry its `_modeler`/scene root and
 *  land on the active layer, but only when the source is really in a scene and not `tmp()`. */
export function addResultToScene(source: Any, result: Any): void
{
    if (!source) return
    // A ShapeCollection has no node of its own: anchor on the first of its shapes that is in
    // the scene, so `collection.bbox().box()` lands next to the shapes it measured.
    const anchor = (source._node) ? source : (source._shapes?.find((s: Any) => s?._node) ?? source)
    propagate(anchor, result)
    if (anchor._node && !anchor._suppressScene)
    {
        addTo(activeLayerOf(anchor), result)
    }
}
