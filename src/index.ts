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
export { Bbox } from './Bbox';
export { OBbox } from './OBbox';
export { SceneNode } from './SceneNode';
export type { SceneNodeShape } from './SceneNode';
export { GLTFBuilder } from './GLTFBuilder';

/** Convenience type alias for the meshup module namespace itself. */
export type Meshup = typeof import('./index')