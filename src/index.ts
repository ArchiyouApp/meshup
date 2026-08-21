/**
 * 
 *  Main module for Meshup library
 *  We use it as the main entrypoint for users
 *  This makes it easier to manage the wasm loading
 * 
 *  Example usage:
 *    import { init } from 'meshup';
 *    await init();
 * 
 * 
 */

import { loadAsync } from './loader'; // Loader for the WASM module
import type { InitOptions } from './loader';
import type { CsgrsModule } from './types';

// Global state
let _csgrs: CsgrsModule | null = null;

export function getCsgrs(): CsgrsModule
{
    if (!_csgrs)
    {
        throw new Error('getCsgrs(): Meshup not initialized. Call init() or await initAsync() first!');
    }
    return _csgrs;
}

//// INIT FUNCTIONS ////

/** Load the WASM kernel. Without arguments meshup finds it itself: the
 *  ./wasm/meshup_bg.wasm file next to the module when that is fetchable
 *  (browsers), the inlined base64 otherwise (Node, published tarballs).
 *  Pass `{ wasm }` to point it somewhere specific — see InitOptions. */
export async function init(options?: InitOptions): Promise<void>
{
    if (!_csgrs)
    {
        const t = performance.now();
        _csgrs = await loadAsync(options);
        console.info(`Meshup WASM loaded successfully in ${Math.round(performance.now() - t)} ms.`);
    }
    else
    {
        console.info('Meshup already initialized. Returning existing instance.');
    }
}

/** @alias: init (backward compatibility) */
export async function initAsync(options?: InitOptions): Promise<void>
{
    await init(options);
}

export function isInitialized(): boolean 
{
    return _csgrs !== null;
}

//// RE-EXPORTS ////
/* To enable to load from main module
    TODO: All other classes too?
*/

export type { InitOptions, WasmSource } from './loader';
export type { PointLike } from './types';
export { Point } from './Point';
export { Vector } from './Vector';
export { Vertex } from './Vertex';
export { Shape } from './Shape';
export { Mesh } from './Mesh';
export { Polygon } from './Polygon';
export { Curve } from './Curve';
export { ShapeCollection } from './ShapeCollection';
export { Sketch } from './Sketch';
export type { TextAlign, TextOutlineOptions, TextSolidOptions, TextStrokeOptions } from './Sketch';
export { HERSHEY_FONTS, HERSHEY_OFFSET, DEFAULT_HERSHEY_FONT } from './fonts/hershey';
export { Bbox } from './Bbox';
export { OBbox } from './OBbox';
export { SceneNode } from './SceneNode';
export type { SceneNodeShape, ComponentGraphNode } from './SceneNode';
export type { SceneNodeGraphNode, SceneNodeData } from './types';
export { GLTFBuilder } from './GLTFBuilder';
export { Importer } from './Importer';
export type { ImportFormat, ImportOptions } from './Importer';
export type { StyleData } from './Style';

/*  The pieces below used to be reachable only through deep subpath imports
    (`@archiyou/meshup/src/Color` and friends), which the `./src/*` export maps onto
    TypeScript. That works inside a monorepo and nowhere else: a published consumer would
    have to compile .ts out of node_modules. Everything the engine needs is therefore named
    here, so `@archiyou/meshup` alone is a complete import surface. */

export { Color } from './Color';
export type { ColorInput } from './Color';
export { Style } from './Style';
export { TOLERANCE, SHAPE_DEFAULT_STYLE } from './constants';
export { isPointLike } from './types';
export { ANNOTATIONS_SVG_START, ANNOTATIONS_SVG_END, ANNOTATION_MARGIN_MM } from './ShapeCollection';
export type { SpanParams, SpanPoint } from './types';
export { rad, deg, nodeToString, GLTFJsonDocumentToString } from './utils';

/*  Scene membership. A method that produces a shape has to say what becomes of it — the
    result replaces the receiver, joins the active layer, or carries its scene along — so
    these are part of the contract for anyone building shape-producing methods on meshup,
    not an internal detail. Exported as a complete family: a partial set would leave the
    choice looking arbitrary. */
export {
  activeLayerOf,
  addResultToScene,
  carryToResult,
  replaceInScene,
  sceneAdd,
  sceneCarry,
  sceneLayer,
  sceneReplace,
  sceneReplaceOrKeep,
  sceneUpdate,
  colSceneAdd,
  colSceneLayer,
  colSceneReplace,
} from './sceneDecorators';

export {
  BentleyLineStyleProperty,
  BentleyLineStyleExtension,
  PointStyleProperty,
  PointStyleExtension,
  EdgeVisibilityProperty,
  EdgeVisibilityExtension,
  dashPatternToUint16,
  computeEdgeVisibilityBitfield,
  createNodeIO,
} from './GLTFBuilder';


/*  NOTE: there used to be a `export type Meshup = typeof import('./index')` alias here.
    It is gone on purpose: a self-referential module type makes the rollup emit an
    `Object.freeze({ get Bbox() {...}, ... })` namespace object that tsup's dts
    NamespaceFixer cannot parse ("Expected a property assignment"), which broke
    `dist/index.d.ts` entirely.

    Consumers that need the module namespace as a type can spell it themselves:
        type Meshup = typeof import('@archiyou/meshup')
*/