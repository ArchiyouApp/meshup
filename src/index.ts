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

export async function init(): Promise<void> 
{
    if (!_csgrs)
    {
        const t = performance.now();
        _csgrs = await loadAsync();
        console.info(`Meshup WASM loaded successfully in ${Math.round(performance.now() - t)} ms.`);
    }
    else
    {
        console.info('Meshup already initialized. Returning existing instance.');
    }
}

/** @alias: init (backward compatibility) */
export async function initAsync(): Promise<void>
{
    await init();
}

export function isInitialized(): boolean 
{
    return _csgrs !== null;
}

//// RE-EXPORTS ////
/* To enable to load from main module
    TODO: All other classes too?
*/

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