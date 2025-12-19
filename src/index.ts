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

import { loadSync, loadAsync } from './loader';
import { Mesh } from './internal';
import type { CsgrsModule } from './internal';

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
        console.log(`Meshup initialized synchronously in ${(performance.now() - t).toFixed(2)} ms`);
    }
    else {
        console.info('Meshup already initialized. Returning existing instance.');
    }
}

export async function initAsync(): Promise<void> 
{
    if (!_csgrs)
    {
        const t = performance.now();
        _csgrs = await loadAsync();
        console.log(`Meshup initialized asynchronously in ${(performance.now() - t).toFixed(2)} ms`);
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

export * from './internal';