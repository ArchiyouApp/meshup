/**
 * 
 *  Main module for Meshup library
 *  We use it as the main entrypoint for users
 *  This makes it easier to manage the wasm loading
 * 
 *  Example usage:
 *    import { Meshup } from 'meshup';
 *    
 *  Initiate: 
 *    - Meshup.init()
 *    - await Meshup.initAsync();
 * 
 * 
 */

import { Curve } from './Curve';
import { loadSync, loadAsync } from './loader';
import type { CsgrsModule } from './types';

// Global state
let _csgrs: ReturnType<typeof loadSync> | null = null;

export function getCsgrs(): CsgrsModule
{
    if (!_csgrs)
    {
        throw new Error('getCsgrs(): Meshup not initialized. Call init() or await initAsync() first!');
    }
    return _csgrs;
}

//// INIT FUNCTIONS ////

export function init(): void 
{
    if (!_csgrs) {
        const t = performance.now();
        _csgrs = loadSync();
        // ...existing code...
    }
    else {
        // ...existing code...
    }
}

export async function initAsync(): Promise<void> 
{
    if (!_csgrs)
    {
        const t = performance.now();
        _csgrs = await loadAsync();
        // ...existing code...
    }
    else {
        console.info('Meshup already initialized. Returning existing instance.');
    }
}

export function isInitialized(): boolean 
{
    return _csgrs !== null;
}

//// RE-EXPORTS ////
/* To enable to load from main module
    TODO: All other classes too?
*/

export { Point } from './Point';
export { Vector } from './Vector';
export { Vertex } from './Vertex';
export { Mesh } from './Mesh';
export { Polygon } from './Polygon';
export { PolygonCollection } from './Collection';
export { Curve } from './Curve';
export { Collection, MeshCollection, CurveCollection } from './Collection';
export { Sketch } from './Sketch';
export { Bbox } from './Bbox';
export { OBbox } from './OBbox';
export {
    projectEdges,
    projectEdgesSection,
    isometricProjection,
    isometricProjectionCollection,
    polylinesToCurveCollection,
    ProjectionResult,
    SectionProjectionResult,
    resolveProjectEdgesOptions,
    type ProjectEdgesOptions,
    type ProjectSectionOptions,
} from './projections';