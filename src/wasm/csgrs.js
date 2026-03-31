let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const BooleanRegionJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_booleanregionjs_free(ptr >>> 0, 1));

const ClosestPointResultJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_closestpointresultjs_free(ptr >>> 0, 1));

const CompoundCurve3DJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compoundcurve3djs_free(ptr >>> 0, 1));

const EdgeProjectionResultJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_edgeprojectionresultjs_free(ptr >>> 0, 1));

const Matrix4JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_matrix4js_free(ptr >>> 0, 1));

const MeshJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshjs_free(ptr >>> 0, 1));

const NurbsCurve3DJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nurbscurve3djs_free(ptr >>> 0, 1));

const NurbsSurfaceJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nurbssurfacejs_free(ptr >>> 0, 1));

const PlaneJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_planejs_free(ptr >>> 0, 1));

const Point3JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_point3js_free(ptr >>> 0, 1));

const Point4JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_point4js_free(ptr >>> 0, 1));

const PolygonJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polygonjs_free(ptr >>> 0, 1));

const RaycastHitJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_raycasthitjs_free(ptr >>> 0, 1));

const SdfSampleJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sdfsamplejs_free(ptr >>> 0, 1));

const SectionElevationResultJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sectionelevationresultjs_free(ptr >>> 0, 1));

const SketchJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sketchjs_free(ptr >>> 0, 1));

const Vector3JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vector3js_free(ptr >>> 0, 1));

const VertexJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vertexjs_free(ptr >>> 0, 1));

/**
 * Result of a boolean operation: an exterior boundary curve with zero or more interior hole curves.
 * Each region from a Clip result is represented as one BooleanRegionJs.
 */
export class BooleanRegionJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BooleanRegionJs.prototype);
        obj.__wbg_ptr = ptr;
        BooleanRegionJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BooleanRegionJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_booleanregionjs_free(ptr, 0);
    }
    /**
     * Number of interior holes
     * @returns {number}
     */
    holeCount() {
        const ret = wasm.booleanregionjs_holeCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the interior hole curves of this region
     * @returns {CompoundCurve3DJs[]}
     */
    get holes() {
        const ret = wasm.booleanregionjs_holes(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get the exterior boundary curve of this region
     * @returns {CompoundCurve3DJs}
     */
    get exterior() {
        const ret = wasm.booleanregionjs_exterior(this.__wbg_ptr);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * Whether this region has any interior holes
     * @returns {boolean}
     */
    hasHoles() {
        const ret = wasm.booleanregionjs_hasHoles(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) BooleanRegionJs.prototype[Symbol.dispose] = BooleanRegionJs.prototype.free;

/**
 * Result of a closest-surface-point query returned to JavaScript.
 */
export class ClosestPointResultJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ClosestPointResultJs.prototype);
        obj.__wbg_ptr = ptr;
        ClosestPointResultJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClosestPointResultJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_closestpointresultjs_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get pointX() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pointY() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pointZ() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get distance() {
        const ret = wasm.closestpointresultjs_distance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalX() {
        const ret = wasm.closestpointresultjs_normal_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalY() {
        const ret = wasm.closestpointresultjs_normal_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalZ() {
        const ret = wasm.closestpointresultjs_normal_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get isInside() {
        const ret = wasm.closestpointresultjs_is_inside(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) ClosestPointResultJs.prototype[Symbol.dispose] = ClosestPointResultJs.prototype.free;

export class CompoundCurve3DJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(CompoundCurve3DJs.prototype);
        obj.__wbg_ptr = ptr;
        CompoundCurve3DJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompoundCurve3DJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compoundcurve3djs_free(ptr, 0);
    }
    /**
     * @param {number} param
     * @returns {Vector3Js}
     */
    tangentAt(param) {
        const ret = wasm.compoundcurve3djs_tangentAt(this.__wbg_ptr, param);
        return Vector3Js.__wrap(ret);
    }
    /**
     * Tessellate curve into evenly spaced points by count
     * @param {number | null} [tol]
     * @returns {Point3Js[]}
     */
    tessellate(tol) {
        const ret = wasm.compoundcurve3djs_tessellate(this.__wbg_ptr, !isLikeNone(tol), isLikeNone(tol) ? 0 : tol);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Trim the compound curve to the sub-curve between parameters t0 and t1.
     * Parameters are in the compound curve's global knot domain.
     * Returns one or more NurbsCurve3DJs segments.
     * @param {number} t0
     * @param {number} t1
     * @returns {NurbsCurve3DJs[]}
     */
    trimRange(t0, t1) {
        const ret = wasm.compoundcurve3djs_trimRange(this.__wbg_ptr, t0, t1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    knotsDomain() {
        const ret = wasm.compoundcurve3djs_knotsDomain(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Perform a boolean operation (union / intersection / difference) with a NurbsCurve3D.
     * Both curves must be planar and coplanar. The operation is performed in 2D
     * and the result is projected back to 3D.
     * Returns BooleanRegionJs results containing exterior curves and interior holes.
     * @param {NurbsCurve3DJs} other
     * @param {string} operation
     * @returns {BooleanRegionJs[]}
     */
    booleanCurve(other, operation) {
        _assertClass(other, NurbsCurve3DJs);
        const ptr0 = passStringToWasm0(operation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compoundcurve3djs_booleanCurve(this.__wbg_ptr, other.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {Point3Js} point
     * @returns {Point3Js}
     */
    closestPoint(point) {
        _assertClass(point, Point3Js);
        const ret = wasm.compoundcurve3djs_closestPoint(this.__wbg_ptr, point.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Point3Js.__wrap(ret[0]);
    }
    /**
     * Get all unique control points across all spans
     * @returns {Point3Js[]}
     */
    controlPoints() {
        const ret = wasm.compoundcurve3djs_controlPoints(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get the point at given parameter
     * @param {number} param
     * @returns {Point3Js}
     */
    pointAtParam(param) {
        const ret = wasm.compoundcurve3djs_pointAtParam(this.__wbg_ptr, param);
        return Point3Js.__wrap(ret);
    }
    /**
     * Rotate the compound curve by a unit quaternion given as components `(w, x, y, z)`.
     * The quaternion is normalized before use.
     * @param {number} w
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {CompoundCurve3DJs}
     */
    rotateQuaternion(w, x, y, z) {
        const ret = wasm.compoundcurve3djs_rotateQuaternion(this.__wbg_ptr, w, x, y, z);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * Extrude each span of this compound curve along XYZ components.
     *
     * Returns one `NurbsSurfaceJs` per span.
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {NurbsSurfaceJs[]}
     */
    extrudeComponents(dx, dy, dz) {
        const ret = wasm.compoundcurve3djs_extrudeComponents(this.__wbg_ptr, dx, dy, dz);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Find intersection points with another `CompoundCurve3DJs`.
     * Intersects each span of `self` against each span of `other`.
     * Returns the 3D intersection points.
     * @param {CompoundCurve3DJs} other
     * @returns {Point3Js[]}
     */
    intersectCompound(other) {
        _assertClass(other, CompoundCurve3DJs);
        const ret = wasm.compoundcurve3djs_intersectCompound(this.__wbg_ptr, other.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Merge consecutive collinear degree-1 spans into single polyline spans.
     *
     * Walks through all spans and checks if consecutive degree-1 spans share
     * the same direction (within a small angular tolerance). Collinear runs are
     * collapsed into one polyline keeping only start and end points. Non-degree-1
     * spans and non-collinear degree-1 spans are preserved unchanged.
     *
     * Always returns a `CompoundCurve3DJs`.
     * @param {number} colinear_tol
     * @returns {CompoundCurve3DJs}
     */
    mergeColinearLines(colinear_tol) {
        const ret = wasm.compoundcurve3djs_mergeColinearLines(this.__wbg_ptr, colinear_tol);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * Perform a boolean operation (union / intersection / difference) with another CompoundCurve3D.
     * Both curves must be planar and coplanar. The operation is performed in 2D
     * and the result is projected back to 3D.
     * Returns BooleanRegionJs results containing exterior curves and interior holes.
     * @param {CompoundCurve3DJs} other
     * @param {string} operation
     * @returns {BooleanRegionJs[]}
     */
    booleanCompoundCurve(other, operation) {
        _assertClass(other, CompoundCurve3DJs);
        const ptr0 = passStringToWasm0(operation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compoundcurve3djs_booleanCompoundCurve(this.__wbg_ptr, other.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Find the closest parameter on this compound curve to the given point.
     * Iterates over all spans and returns the parameter with the minimum distance.
     * @param {Point3Js} point
     * @returns {number}
     */
    paramClosestToPoint(point) {
        _assertClass(point, Point3Js);
        const ret = wasm.compoundcurve3djs_paramClosestToPoint(this.__wbg_ptr, point.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {NurbsCurve3DJs[]} spans
     */
    constructor(spans) {
        const ptr0 = passArrayJsValueToWasm0(spans, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compoundcurve3djs_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        CompoundCurve3DJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Point3Js[]}
     */
    bbox() {
        const ret = wasm.compoundcurve3djs_bbox(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {CompoundCurve3DJs}
     */
    clone() {
        const ret = wasm.compoundcurve3djs_clone(this.__wbg_ptr);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * Scale the compound curve by factors along the X, Y, and Z axes
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {CompoundCurve3DJs}
     */
    scale(sx, sy, sz) {
        const ret = wasm.compoundcurve3djs_scale(this.__wbg_ptr, sx, sy, sz);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * PROPERTIES ///
     * @returns {NurbsCurve3DJs[]}
     */
    spans() {
        const ret = wasm.compoundcurve3djs_spans(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Split the compound curve at parameter t, returning [left, right] as CompoundCurve3DJs.
     * @param {number} t
     * @returns {CompoundCurve3DJs[]}
     */
    split(t) {
        const ret = wasm.compoundcurve3djs_split(this.__wbg_ptr, t);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number | null} [tol]
     * @returns {boolean}
     */
    closed(tol) {
        const ret = wasm.compoundcurve3djs_closed(this.__wbg_ptr, !isLikeNone(tol), isLikeNone(tol) ? 0 : tol);
        return ret !== 0;
    }
    /**
     * Extend the compound curve at one or both ends.
     *
     * - **Degree-1 boundary spans** are extended inline (new control point).
     * - **Higher-degree boundary spans** get a tangent line segment prepended/appended.
     *
     * # Arguments
     * * `distance` – how far to extend (world units)
     * * `side`     – `"end"` (default), `"start"`, or `"both"`
     * @param {number} distance
     * @param {string | null} [side]
     * @returns {CompoundCurve3DJs}
     */
    extend(distance, side) {
        var ptr0 = isLikeNone(side) ? 0 : passStringToWasm0(side, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.compoundcurve3djs_extend(this.__wbg_ptr, distance, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * @returns {number}
     */
    length() {
        const ret = wasm.compoundcurve3djs_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * Offset the compound curve by a distance with the specified corner type ('sharp','round','smooth').
     * The curve must already lie in the XY plane (z = 0).
     * @param {number} distance
     * @param {string} corner_type
     * @returns {CompoundCurve3DJs}
     */
    offset(distance, corner_type) {
        const ptr0 = passStringToWasm0(corner_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compoundcurve3djs_offset(this.__wbg_ptr, distance, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * Rotate the compound curve by Euler angles (in radians) around the X, Y, and Z axes
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @returns {CompoundCurve3DJs}
     */
    rotate(ax, ay, az) {
        const ret = wasm.compoundcurve3djs_rotate(this.__wbg_ptr, ax, ay, az);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * Extrude each span of this compound curve along a direction vector.
     *
     * Returns one `NurbsSurfaceJs` per span. The surfaces share boundaries at
     * span junctions and together form a continuous ruled solid.
     * @param {Vector3Js} direction
     * @returns {NurbsSurfaceJs[]}
     */
    extrude(direction) {
        _assertClass(direction, Vector3Js);
        const ret = wasm.compoundcurve3djs_extrude(this.__wbg_ptr, direction.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Reverse the direction of the compound curve (swap start/end).
     * Returns a new reversed copy.
     * @returns {CompoundCurve3DJs}
     */
    reverse() {
        const ret = wasm.compoundcurve3djs_reverse(this.__wbg_ptr);
        return CompoundCurve3DJs.__wrap(ret);
    }
    /**
     * @param {number} param
     * @returns {NurbsCurve3DJs}
     */
    find_span(param) {
        const ret = wasm.compoundcurve3djs_find_span(this.__wbg_ptr, param);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * Find intersection points with a `NurbsCurve3DJs`.
     * Intersects each span of `self` against `other`.
     * Returns the 3D intersection points.
     * @param {NurbsCurve3DJs} other
     * @returns {Point3Js[]}
     */
    intersect(other) {
        _assertClass(other, NurbsCurve3DJs);
        const ret = wasm.compoundcurve3djs_intersect(this.__wbg_ptr, other.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Translate the compound curve by a Vector3Js offset
     * @param {Vector3Js} offset
     * @returns {CompoundCurve3DJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.compoundcurve3djs_translate(this.__wbg_ptr, offset.__wbg_ptr);
        return CompoundCurve3DJs.__wrap(ret);
    }
}
if (Symbol.dispose) CompoundCurve3DJs.prototype[Symbol.dispose] = CompoundCurve3DJs.prototype.free;

/**
 * Edge projection result returned to JavaScript.
 *
 * Call `visiblePolylines()` / `hiddenPolylines()` to get the serialised
 * polyline data as a JS array of arrays of `[x, y, z]` triplets.
 */
export class EdgeProjectionResultJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(EdgeProjectionResultJs.prototype);
        obj.__wbg_ptr = ptr;
        EdgeProjectionResultJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EdgeProjectionResultJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_edgeprojectionresultjs_free(ptr, 0);
    }
    /**
     * Returns hidden polylines as a JS value.
     *
     * Shape: `Array< Array<[x: number, y: number, z: number]> >`
     * @returns {any}
     */
    hiddenPolylines() {
        const ret = wasm.edgeprojectionresultjs_hiddenPolylines(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns visible polylines as a JS value.
     *
     * Shape: `Array< Array<[x: number, y: number, z: number]> >`
     * @returns {any}
     */
    visiblePolylines() {
        const ret = wasm.edgeprojectionresultjs_visiblePolylines(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) EdgeProjectionResultJs.prototype[Symbol.dispose] = EdgeProjectionResultJs.prototype.free;

export class Matrix4Js {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Matrix4Js.prototype);
        obj.__wbg_ptr = ptr;
        Matrix4JsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Matrix4JsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_matrix4js_free(ptr, 0);
    }
    /**
     * @param {number} m11
     * @param {number} m12
     * @param {number} m13
     * @param {number} m20
     * @param {number} m21
     * @param {number} m22
     * @param {number} m23
     * @param {number} m30
     * @param {number} m31
     * @param {number} m32
     * @param {number} m33
     * @param {number} m34
     * @param {number} m41
     * @param {number} m42
     * @param {number} m43
     * @param {number} m44
     */
    constructor(m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33, m34, m41, m42, m43, m44) {
        const ret = wasm.matrix4js_new(m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33, m34, m41, m42, m43, m44);
        this.__wbg_ptr = ret >>> 0;
        Matrix4JsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    toArray() {
        const ret = wasm.matrix4js_toArray(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) Matrix4Js.prototype[Symbol.dispose] = Matrix4Js.prototype.free;

export class MeshJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MeshJs.prototype);
        obj.__wbg_ptr = ptr;
        MeshJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof MeshJs)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MeshJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_meshjs_free(ptr, 0);
    }
    /**
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    difference(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_difference(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static octahedron(radius, metadata) {
        const ret = wasm.meshjs_octahedron(radius, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {any} points
     * @param {any} faces
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static polyhedron(points, faces, metadata) {
        const ret = wasm.meshjs_polyhedron(points, faces, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MeshJs.__wrap(ret[0]);
    }
    /**
     * @returns {MeshJs}
     */
    convexHull() {
        const ret = wasm.meshjs_convexHull(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {SketchJs} sketch_js
     * @returns {MeshJs}
     */
    static fromSketch(sketch_js) {
        _assertClass(sketch_js, SketchJs);
        const ret = wasm.meshjs_fromSketch(sketch_js.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} start
     * @param {Point3Js} end
     * @param {number} radius1
     * @param {number} radius2
     * @param {number} segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static frustum_ptp(start, end, radius1, radius2, segments, metadata) {
        _assertClass(start, Point3Js);
        _assertClass(end, Point3Js);
        const ret = wasm.meshjs_frustum_ptp(start.__wbg_ptr, end.__wbg_ptr, radius1, radius2, segments, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static icosahedron(radius, metadata) {
        const ret = wasm.meshjs_icosahedron(radius, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    renormalize() {
        const ret = wasm.meshjs_renormalize(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    triangulate() {
        const ret = wasm.meshjs_triangulate(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    boundingBox() {
        const ret = wasm.meshjs_boundingBox(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    intersection(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_intersection(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    toSTLASCII() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.meshjs_toSTLASCII(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    vertexCount() {
        const ret = wasm.meshjs_vertexCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {PolygonJs[]} polygons
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static fromPolygons(polygons, metadata) {
        const ptr0 = passArrayJsValueToWasm0(polygons, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.meshjs_fromPolygons(ptr0, len0, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    minkowskiSum(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_minkowskiSum(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {MeshJs} other
     * @returns {boolean}
     */
    sameMetadata(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_sameMetadata(this.__wbg_ptr, other.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Sample the signed distance field at a query point.
     *
     * Returns a **negative** signed distance when inside the mesh.
     * Returns `undefined` if the mesh has no polygons.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {SdfSampleJs | undefined}
     */
    sampleSdf(x, y, z) {
        const ret = wasm.meshjs_sampleSdf(this.__wbg_ptr, x, y, z);
        return ret === 0 ? undefined : SdfSampleJs.__wrap(ret);
    }
    /**
     * @param {number} lambda
     * @param {number} mu
     * @param {number} iterations
     * @param {boolean} preserve_boundaries
     * @returns {MeshJs}
     */
    taubinSmooth(lambda, mu, iterations, preserve_boundaries) {
        const ret = wasm.meshjs_taubinSmooth(this.__wbg_ptr, lambda, mu, iterations, preserve_boundaries);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {Uint8Array}
     */
    toSTLBinary() {
        const ret = wasm.meshjs_toSTLBinary(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Minimum separating distance between this mesh and another.
     *
     * Returns `0.0` if they intersect.
     * @param {MeshJs} other
     * @returns {number}
     */
    distanceTo(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_distanceTo(this.__wbg_ptr, other.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} count
     * @param {number} radius
     * @param {number} start_angle
     * @param {number} end_angle
     * @returns {MeshJs}
     */
    distributeArc(count, radius, start_angle, end_angle) {
        const ret = wasm.meshjs_distributeArc(this.__wbg_ptr, count, radius, start_angle, end_angle);
        return MeshJs.__wrap(ret);
    }
    /**
     * All-hits raycast: every triangle intersection along the ray, sorted by distance.
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} max_dist
     * @returns {RaycastHitJs[]}
     */
    raycastAll(ox, oy, oz, dx, dy, dz, max_dist) {
        const ret = wasm.meshjs_raycastAll(this.__wbg_ptr, ox, oy, oz, dx, dy, dz, max_dist);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Number of triangles (handy to sanity-check).
     * @returns {number}
     */
    triangleCount() {
        const ret = wasm.meshjs_triangleCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} quality_threshold
     * @param {number} max_edge_length
     * @param {number} curvature_threshold_deg
     * @returns {MeshJs}
     */
    adaptiveRefine(quality_threshold, max_edge_length, curvature_threshold_deg) {
        const ret = wasm.meshjs_adaptiveRefine(this.__wbg_ptr, quality_threshold, max_edge_length, curvature_threshold_deg);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} p
     * @returns {boolean}
     */
    containsVertex(p) {
        _assertClass(p, Point3Js);
        const ret = wasm.meshjs_containsVertex(this.__wbg_ptr, p.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} rows
     * @param {number} cols
     * @param {number} row_spacing
     * @param {number} col_spacing
     * @returns {MeshJs}
     */
    distributeGrid(rows, cols, row_spacing, col_spacing) {
        const ret = wasm.meshjs_distributeGrid(this.__wbg_ptr, rows, cols, row_spacing, col_spacing);
        return MeshJs.__wrap(ret);
    }
    /**
     * Find intersection points between a NURBS curve and this Mesh.
     * The curve is tessellated into a polyline (using the given tolerance),
     * then each segment is tested against the mesh triangles.
     *
     * # Arguments
     * - `curve`: A `NurbsCurve3DJs` to intersect with this mesh.
     * - `tolerance`: Optional tessellation tolerance for the curve (default: 1e-4).
     *
     * # Returns
     * A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
     * @param {NurbsCurve3DJs} curve
     * @param {number | null} [tolerance]
     * @returns {Point3Js[]}
     */
    intersectCurve(curve, tolerance) {
        _assertClass(curve, NurbsCurve3DJs);
        const ret = wasm.meshjs_intersectCurve(this.__wbg_ptr, curve.__wbg_ptr, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} density
     * @returns {any}
     */
    massProperties(density) {
        const ret = wasm.meshjs_massProperties(this.__wbg_ptr, density);
        return ret;
    }
    /**
     * Project a query point onto the nearest mesh surface (BVH-accelerated).
     *
     * Returns `undefined` if the mesh has no polygons.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {ClosestPointResultJs | undefined}
     */
    closestPoint(x, y, z) {
        const ret = wasm.meshjs_closestPoint(this.__wbg_ptr, x, y, z);
        return ret === 0 ? undefined : ClosestPointResultJs.__wrap(ret);
    }
    /**
     * @param {number} lambda
     * @param {number} iterations
     * @param {boolean} preserve_boundaries
     * @returns {MeshJs}
     */
    laplacianSmooth(lambda, iterations, preserve_boundaries) {
        const ret = wasm.meshjs_laplacianSmooth(this.__wbg_ptr, lambda, iterations, preserve_boundaries);
        return MeshJs.__wrap(ret);
    }
    /**
     * BVH-accelerated edge projection with hidden-line removal.
     *
     * - `(vx, vy, vz)` – view direction (normalised internally).
     * - `(ox, oy, oz)` – projection plane origin.
     * - `(nx, ny, nz)` – projection plane normal.
     * - `feature_angle_deg` – crease angle threshold in degrees (e.g. `15.0`).
     * - `n_samples` – HLR ray samples per edge segment (e.g. `8`).
     * - `occluders` – additional meshes that can occlude edges of `self`;
     *   `self` is always included as an occluder.
     * @param {number} vx
     * @param {number} vy
     * @param {number} vz
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} feature_angle_deg
     * @param {number} n_samples
     * @param {MeshJs[]} occluders
     * @returns {EdgeProjectionResultJs}
     */
    projectEdges(vx, vy, vz, ox, oy, oz, nx, ny, nz, feature_angle_deg, n_samples, occluders) {
        const ptr0 = passArrayJsValueToWasm0(occluders, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.meshjs_projectEdges(this.__wbg_ptr, vx, vy, vz, ox, oy, oz, nx, ny, nz, feature_angle_deg, n_samples, ptr0, len0);
        return EdgeProjectionResultJs.__wrap(ret);
    }
    /**
     * BVH-accelerated first-hit raycast.
     *
     * Returns the closest intersection along `origin + t * direction` where
     * `t ∈ [0, max_dist]`, or `undefined` if there is no hit.
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} max_dist
     * @returns {RaycastHitJs | undefined}
     */
    raycastFirst(ox, oy, oz, dx, dy, dz, max_dist) {
        const ret = wasm.meshjs_raycastFirst(this.__wbg_ptr, ox, oy, oz, dx, dy, dz, max_dist);
        return ret === 0 ? undefined : RaycastHitJs.__wrap(ret);
    }
    /**
     * @param {number} normal_x
     * @param {number} normal_y
     * @param {number} normal_z
     * @param {number} offset
     * @returns {SketchJs}
     */
    sliceComponents(normal_x, normal_y, normal_z, offset) {
        const ret = wasm.meshjs_sliceComponents(this.__wbg_ptr, normal_x, normal_y, normal_z, offset);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} count
     * @param {Vector3Js} direction
     * @param {number} spacing
     * @returns {MeshJs}
     */
    distributeLinear(count, direction, spacing) {
        _assertClass(direction, Vector3Js);
        const ret = wasm.meshjs_distributeLinear(this.__wbg_ptr, count, direction.__wbg_ptr, spacing);
        return MeshJs.__wrap(ret);
    }
    /**
     * Rotate this mesh by a unit quaternion given as components `(w, x, y, z)`.
     * The quaternion is normalized before use, so non-unit input is safe.
     * @param {number} w
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {MeshJs}
     */
    rotateQuaternion(w, x, y, z) {
        const ret = wasm.meshjs_rotateQuaternion(this.__wbg_ptr, w, x, y, z);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} height
     * @param {number} shape_segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static teardropCylinder(width, length, height, shape_segments, metadata) {
        const ret = wasm.meshjs_teardropCylinder(width, length, height, shape_segments, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {string} object_name
     * @param {string} units
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @returns {string}
     */
    toAMFWithColor(object_name, units, r, g, b) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(object_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(units, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.meshjs_toAMFWithColor(this.__wbg_ptr, ptr0, len0, ptr1, len1, r, g, b);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Create a mesh from pre-sampled SDF values on a regular grid.
     *
     * `values` must be laid out as `[z * res_y * res_x + y * res_x + x, ...]`.
     * `iso_value` is the isosurface threshold (typically `0.0`).
     * @param {Float64Array} values
     * @param {number} res_x
     * @param {number} res_y
     * @param {number} res_z
     * @param {number} min_x
     * @param {number} min_y
     * @param {number} min_z
     * @param {number} max_x
     * @param {number} max_y
     * @param {number} max_z
     * @param {number} iso_value
     * @returns {MeshJs}
     */
    static fromSdfValues(values, res_x, res_y, res_z, min_x, min_y, min_z, max_x, max_y, max_z, iso_value) {
        const ret = wasm.meshjs_fromSdfValues(values, res_x, res_y, res_z, min_x, min_y, min_z, max_x, max_y, max_z, iso_value);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} module_
     * @param {number} teeth
     * @param {number} pressure_angle_deg
     * @param {number} clearance
     * @param {number} backlash
     * @param {number} segments_per_flank
     * @param {number} thickness
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static spurGearInvolute(module_, teeth, pressure_angle_deg, clearance, backlash, segments_per_flank, thickness, metadata) {
        const ret = wasm.meshjs_spurGearInvolute(module_, teeth, pressure_angle_deg, clearance, backlash, segments_per_flank, thickness, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * Orthographically project every vertex of this mesh onto a plane.
     *
     * `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @returns {MeshJs}
     */
    projectToPlane(ox, oy, oz, nx, ny, nz) {
        const ret = wasm.meshjs_projectToPlane(this.__wbg_ptr, ox, oy, oz, nx, ny, nz);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} levels
     * @returns {MeshJs}
     */
    subdivideTriangles(levels) {
        const ret = wasm.meshjs_subdivideTriangles(this.__wbg_ptr, levels);
        return MeshJs.__wrap(ret);
    }
    /**
     * Minimum absolute distance from any mesh vertex to a plane.
     *
     * `(ox, oy, oz)` is a point on the plane; `(nx, ny, nz)` is its normal.
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @returns {number}
     */
    distanceToPlane(ox, oy, oz, nx, ny, nz) {
        const ret = wasm.meshjs_distanceToPlane(this.__wbg_ptr, ox, oy, oz, nx, ny, nz);
        return ret;
    }
    /**
     * @param {number} m00
     * @param {number} m01
     * @param {number} m02
     * @param {number} m03
     * @param {number} m10
     * @param {number} m11
     * @param {number} m12
     * @param {number} m13
     * @param {number} m20
     * @param {number} m21
     * @param {number} m22
     * @param {number} m23
     * @param {number} m30
     * @param {number} m31
     * @param {number} m32
     * @param {number} m33
     * @returns {MeshJs}
     */
    transformComponents(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
        const ret = wasm.meshjs_transformComponents(this.__wbg_ptr, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {MeshJs}
     */
    translateComponents(dx, dy, dz) {
        const ret = wasm.meshjs_translateComponents(this.__wbg_ptr, dx, dy, dz);
        return MeshJs.__wrap(ret);
    }
    /**
     * Find intersection points between a raw polyline (array of Point3Js) and this Mesh.
     * Each consecutive pair of points defines a segment tested against the mesh.
     *
     * # Arguments
     * - `points`: Ordered 3D points forming a polyline.
     *
     * # Returns
     * A `Vec<Point3Js>` of 3D intersection points, in polyline order.
     * @param {Point3Js[]} points
     * @returns {Point3Js[]}
     */
    intersectPolyline(points) {
        const ptr0 = passArrayJsValueToWasm0(points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.meshjs_intersectPolyline(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {number} min_quality
     * @returns {MeshJs}
     */
    removePoorTriangles(min_quality) {
        const ret = wasm.meshjs_removePoorTriangles(this.__wbg_ptr, min_quality);
        return MeshJs.__wrap(ret);
    }
    /**
     * Create a triangulated mesh from a planar polygon (flat [x,y,z,...] outer boundary)
     * with interior holes (array of flat [x,y,z,...] arrays).
     *
     * The normal for each vertex is computed from the outer boundary.
     * @param {Float64Array} outer_points
     * @param {Float64Array[]} hole_arrays
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static fromPointsWithHoles(outer_points, hole_arrays, metadata) {
        const ptr0 = passArrayF64ToWasm0(outer_points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(hole_arrays, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.meshjs_fromPointsWithHoles(ptr0, len0, ptr1, len1, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} start_x
     * @param {number} start_y
     * @param {number} start_z
     * @param {number} end_x
     * @param {number} end_y
     * @param {number} end_z
     * @param {number} radius1
     * @param {number} radius2
     * @param {number} segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static frustum_ptpComponents(start_x, start_y, start_z, end_x, end_y, end_z, radius1, radius2, segments, metadata) {
        const ret = wasm.meshjs_frustum_ptpComponents(start_x, start_y, start_z, end_x, end_y, end_z, radius1, radius2, segments, metadata);
        return MeshJs.__wrap(ret);
    }
    invalidateBoundingBox() {
        wasm.meshjs_invalidateBoundingBox(this.__wbg_ptr);
    }
    /**
     * Find intersection points between a compound curve and this Mesh.
     * Each span of the compound curve is tessellated and tested against the mesh.
     *
     * # Arguments
     * - `curve`: A `CompoundCurve3DJs` to intersect with this mesh.
     * - `tolerance`: Optional tessellation tolerance (default: 1e-4).
     *
     * # Returns
     * A `Vec<Point3Js>` of 3D intersection points, in order along the curve.
     * @param {CompoundCurve3DJs} curve
     * @param {number | null} [tolerance]
     * @returns {Point3Js[]}
     */
    intersectCompoundCurve(curve, tolerance) {
        _assertClass(curve, CompoundCurve3DJs);
        const ret = wasm.meshjs_intersectCompoundCurve(this.__wbg_ptr, curve.__wbg_ptr, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Slice at a section plane and return visible/hidden edge projections plus
     * the cut sketch.
     *
     * - `(snx, sny, snz)` / `section_offset` – section plane normal + d offset.
     * - `(vx, vy, vz)` – view direction.
     * - `(ox, oy, oz)` / `(nx, ny, nz)` – projection plane origin + normal.
     * - `feature_angle_deg`, `n_samples`, `occluders` – as in `projectEdges`.
     * @param {number} snx
     * @param {number} sny
     * @param {number} snz
     * @param {number} section_offset
     * @param {number} vx
     * @param {number} vy
     * @param {number} vz
     * @param {number} ox
     * @param {number} oy
     * @param {number} oz
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} feature_angle_deg
     * @param {number} n_samples
     * @param {MeshJs[]} occluders
     * @returns {SectionElevationResultJs}
     */
    projectEdgesSection(snx, sny, snz, section_offset, vx, vy, vz, ox, oy, oz, nx, ny, nz, feature_angle_deg, n_samples, occluders) {
        const ptr0 = passArrayJsValueToWasm0(occluders, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.meshjs_projectEdgesSection(this.__wbg_ptr, snx, sny, snz, section_offset, vx, vy, vz, ox, oy, oz, nx, ny, nz, feature_angle_deg, n_samples, ptr0, len0);
        return SectionElevationResultJs.__wrap(ret);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    containsVertexComponents(x, y, z) {
        const ret = wasm.meshjs_containsVertexComponents(this.__wbg_ptr, x, y, z);
        return ret !== 0;
    }
    /**
     * @param {any} needle
     * @returns {MeshJs}
     */
    filterPolygonsByMetadata(needle) {
        const ret = wasm.meshjs_filterPolygonsByMetadata(this.__wbg_ptr, needle);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} count
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @param {number} spacing
     * @returns {MeshJs}
     */
    distributeLinearComponents(count, dx, dy, dz, spacing) {
        const ret = wasm.meshjs_distributeLinearComponents(this.__wbg_ptr, count, dx, dy, dz, spacing);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} revolve_segments
     * @param {number} outline_segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static egg(width, length, revolve_segments, outline_segments, metadata) {
        const ret = wasm.meshjs_egg(width, length, revolve_segments, outline_segments, metadata);
        return MeshJs.__wrap(ret);
    }
    constructor() {
        const ret = wasm.meshjs_new();
        this.__wbg_ptr = ret >>> 0;
        MeshJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    xor(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_xor(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} size
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static cube(size, metadata) {
        const ret = wasm.meshjs_cube(size, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} start
     * @param {Vector3Js} direction
     * @param {number} segments
     * @param {boolean} orientation
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static arrow(start, direction, segments, orientation, metadata) {
        _assertClass(start, Point3Js);
        _assertClass(direction, Vector3Js);
        const ret = wasm.meshjs_arrow(start.__wbg_ptr, direction.__wbg_ptr, segments, orientation, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    clone() {
        const ret = wasm.meshjs_clone(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    float() {
        const ret = wasm.meshjs_float(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {MeshJs}
     */
    scale(sx, sy, sz) {
        const ret = wasm.meshjs_scale(this.__wbg_ptr, sx, sy, sz);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {PlaneJs} plane
     * @returns {SketchJs}
     */
    slice(plane) {
        _assertClass(plane, PlaneJs);
        const ret = wasm.meshjs_slice(this.__wbg_ptr, plane.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} major_r
     * @param {number} minor_r
     * @param {number} segments_major
     * @param {number} segments_minor
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static torus(major_r, minor_r, segments_major, segments_minor, metadata) {
        const ret = wasm.meshjs_torus(major_r, minor_r, segments_major, segments_minor, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    union(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_union(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    center() {
        const ret = wasm.meshjs_center(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} height
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static cuboid(width, length, height, metadata) {
        const ret = wasm.meshjs_cuboid(width, length, height, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} resolution
     * @param {number} scale
     * @param {number} iso_value
     * @param {any} metadata
     * @returns {MeshJs}
     */
    gyroid(resolution, scale, iso_value, metadata) {
        const ret = wasm.meshjs_gyroid(this.__wbg_ptr, resolution, scale, iso_value, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {PlaneJs} plane
     * @returns {MeshJs}
     */
    mirror(plane) {
        _assertClass(plane, PlaneJs);
        const ret = wasm.meshjs_mirror(this.__wbg_ptr, plane.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} rx
     * @param {number} ry
     * @param {number} rz
     * @returns {MeshJs}
     */
    rotate(rx, ry, rz) {
        const ret = wasm.meshjs_rotate(this.__wbg_ptr, rx, ry, rz);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {number} segments_u
     * @param {number} segments_v
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static sphere(radius, segments_u, segments_v, metadata) {
        const ret = wasm.meshjs_sphere(radius, segments_u, segments_v, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {string} object_name
     * @param {string} units
     * @returns {string}
     */
    toAMF(object_name, units) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(object_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(units, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.meshjs_toAMF(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @returns {SketchJs}
     */
    flatten() {
        const ret = wasm.meshjs_flatten(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} radius1
     * @param {number} radius2
     * @param {number} height
     * @param {number} segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static frustum(radius1, radius2, height, segments, metadata) {
        const ret = wasm.meshjs_frustum(radius1, radius2, height, segments, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * Test whether this mesh physically overlaps another (BVH-accelerated).
     * @param {MeshJs} other
     * @returns {boolean}
     */
    hits(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_hits(this.__wbg_ptr, other.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Return triangle indices (u32).
     * @returns {Uint32Array}
     */
    indices() {
        const ret = wasm.meshjs_indices(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {MeshJs}
     */
    inverse() {
        const ret = wasm.meshjs_inverse(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * Return an interleaved array of vertex normals (nx,ny,nz)*.
     * @returns {Float64Array}
     */
    normals() {
        const ret = wasm.meshjs_normals(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} object_name
     * @param {string} up_axis
     * @returns {string}
     */
    toGLTF(object_name, up_axis) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(object_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(up_axis, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.meshjs_toGLTF(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {number} radius
     * @param {number} height
     * @param {number} segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static cylinder(radius, height, segments, metadata) {
        const ret = wasm.meshjs_cylinder(radius, height, segments, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * +MESHUP
     * @returns {PolygonJs[]}
     */
    polygons() {
        const ret = wasm.meshjs_polygons(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} revolve_segments
     * @param {number} shape_segments
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static teardrop(width, length, revolve_segments, shape_segments, metadata) {
        const ret = wasm.meshjs_teardrop(width, length, revolve_segments, shape_segments, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    vertices() {
        const ret = wasm.meshjs_vertices(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} rx
     * @param {number} ry
     * @param {number} rz
     * @param {number} segments
     * @param {number} stacks
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static ellipsoid(rx, ry, rz, segments, stacks, metadata) {
        const ret = wasm.meshjs_ellipsoid(rx, ry, rz, segments, stacks, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * Return an interleaved array of vertex positions (x,y,z)*.
     * @returns {Float64Array}
     */
    positions() {
        const ret = wasm.meshjs_positions(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} resolution
     * @param {number} scale
     * @param {number} iso_value
     * @param {any} metadata
     * @returns {MeshJs}
     */
    schwarzD(resolution, scale, iso_value, metadata) {
        const ret = wasm.meshjs_schwarzD(this.__wbg_ptr, resolution, scale, iso_value, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} resolution
     * @param {number} scale
     * @param {number} iso_value
     * @param {any} metadata
     * @returns {MeshJs}
     */
    schwarzP(resolution, scale, iso_value, metadata) {
        const ret = wasm.meshjs_schwarzP(this.__wbg_ptr, resolution, scale, iso_value, metadata);
        return MeshJs.__wrap(ret);
    }
    /**
     * Convert a mesh to arrays of positions, normals, and indices
     * @returns {object}
     */
    toArrays() {
        const ret = wasm.meshjs_toArrays(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Matrix4Js} mat
     * @returns {MeshJs}
     */
    transform(mat) {
        _assertClass(mat, Matrix4Js);
        const ret = wasm.meshjs_transform(this.__wbg_ptr, mat.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {Vector3Js} offset
     * @returns {MeshJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.meshjs_translate(this.__wbg_ptr, offset.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
}
if (Symbol.dispose) MeshJs.prototype[Symbol.dispose] = MeshJs.prototype.free;

export class NurbsCurve3DJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(NurbsCurve3DJs.prototype);
        obj.__wbg_ptr = ptr;
        NurbsCurve3DJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof NurbsCurve3DJs)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NurbsCurve3DJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nurbscurve3djs_free(ptr, 0);
    }
    /**
     * @param {number} param
     * @returns {Vector3Js}
     */
    tangentAt(param) {
        const ret = wasm.nurbscurve3djs_tangentAt(this.__wbg_ptr, param);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {number | null} [tol]
     * @returns {Point3Js[]}
     */
    tessellate(tol) {
        const ret = wasm.nurbscurve3djs_tessellate(this.__wbg_ptr, !isLikeNone(tol), isLikeNone(tol) ? 0 : tol);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Trim the curve to the sub-curve between parameters t0 and t1.
     * When t0 < t1, returns the "inside" portion.
     * Returns one or more NurbsCurve3DJs segments.
     * @param {number} t0
     * @param {number} t1
     * @returns {NurbsCurve3DJs[]}
     */
    trimRange(t0, t1) {
        const ret = wasm.nurbscurve3djs_trimRange(this.__wbg_ptr, t0, t1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Create an exact NURBS circle.
     *
     * # Arguments
     *
     * * `radius`  – radius of the circle (required)
     * * `center`  – centre point; defaults to the origin
     * * `normal`  – plane normal; defaults to `(0, 0, 1)` (XY-plane).
     *               The X and Y axes of the circle plane are derived from this vector.
     *
     * Returns a closed degree-2 NURBS curve that is an exact rational circle.
     * @param {number} radius
     * @param {Point3Js | null} [center]
     * @param {Vector3Js | null} [normal]
     * @returns {NurbsCurve3DJs}
     */
    static makeCircle(radius, center, normal) {
        let ptr0 = 0;
        if (!isLikeNone(center)) {
            _assertClass(center, Point3Js);
            ptr0 = center.__destroy_into_raw();
        }
        let ptr1 = 0;
        if (!isLikeNone(normal)) {
            _assertClass(normal, Vector3Js);
            ptr1 = normal.__destroy_into_raw();
        }
        const ret = wasm.nurbscurve3djs_makeCircle(radius, ptr0, ptr1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return NurbsCurve3DJs.__wrap(ret[0]);
    }
    /**
     * Get the plane the curve lies on, returned as [normal, localX, localY].
     * Returns an empty array if the curve is not planar.
     * Local axes are aligned to the closest global axes for consistency.
     * @param {number | null} [tolerance]
     * @returns {Vector3Js[]}
     */
    getOnPlane(tolerance) {
        const ret = wasm.nurbscurve3djs_getOnPlane(this.__wbg_ptr, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    knotsDomain() {
        const ret = wasm.nurbscurve3djs_knotsDomain(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Perform a boolean operation (union / intersection / difference) with another NurbsCurve3D.
     * Both curves must be planar and coplanar. The operation is performed in 2D
     * and the result is projected back to 3D.
     * Returns BooleanRegionJs results containing exterior curves and interior holes.
     * @param {NurbsCurve3DJs} other
     * @param {string} operation
     * @returns {BooleanRegionJs[]}
     */
    booleanCurve(other, operation) {
        _assertClass(other, NurbsCurve3DJs);
        const ptr0 = passStringToWasm0(operation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_booleanCurve(this.__wbg_ptr, other.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {Point3Js[]} points
     * @param {boolean} normalize
     * @returns {NurbsCurve3DJs}
     */
    static makePolyline(points, normalize) {
        const ptr0 = passArrayJsValueToWasm0(points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_makePolyline(ptr0, len0, normalize);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * PROPERTIES ///
     * @returns {Point3Js[]}
     */
    controlPoints() {
        const ret = wasm.nurbscurve3djs_controlPoints(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get the point at given parameter
     * @param {number} param
     * @returns {Point3Js}
     */
    pointAtParam(param) {
        const ret = wasm.nurbscurve3djs_pointAtParam(this.__wbg_ptr, param);
        return Point3Js.__wrap(ret);
    }
    /**
     * @param {number} length
     * @returns {number}
     */
    paramAtLength(length) {
        const ret = wasm.nurbscurve3djs_paramAtLength(this.__wbg_ptr, length);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {number} radius
     * @param {Float64Array} at
     * @returns {CompoundCurve3DJs}
     */
    filletAtParams(radius, at) {
        const ptr0 = passArrayF64ToWasm0(at, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_filletAtParams(this.__wbg_ptr, radius, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * Create NURBS Curve (degree 3) passing through given control points
     *
     *  # Arguments
     *
     * * `points` - Control points to interpolate through (x,y,z)
     *
     * @param {Point3Js[]} points
     * @param {number} degree
     * @returns {NurbsCurve3DJs}
     */
    static makeInterpolated(points, degree) {
        const ptr0 = passArrayJsValueToWasm0(points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_makeInterpolated(ptr0, len0, degree);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return NurbsCurve3DJs.__wrap(ret[0]);
    }
    /**
     * Rotate the curve by a unit quaternion given as components `(w, x, y, z)`.
     * The quaternion is normalized before use.
     * @param {number} w
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {NurbsCurve3DJs}
     */
    rotateQuaternion(w, x, y, z) {
        const ret = wasm.nurbscurve3djs_rotateQuaternion(this.__wbg_ptr, w, x, y, z);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * Extrude this curve along XYZ components to create a `NurbsSurfaceJs`.
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {NurbsSurfaceJs}
     */
    extrudeComponents(dx, dy, dz) {
        const ret = wasm.nurbscurve3djs_extrudeComponents(this.__wbg_ptr, dx, dy, dz);
        return NurbsSurfaceJs.__wrap(ret);
    }
    /**
     * Find intersection points with a `CompoundCurve3DJs`.
     * Intersects `self` against each span of the compound curve.
     * Returns the 3D intersection points.
     * @param {CompoundCurve3DJs} other
     * @returns {Point3Js[]}
     */
    intersectCompound(other) {
        _assertClass(other, CompoundCurve3DJs);
        const ret = wasm.nurbscurve3djs_intersectCompound(this.__wbg_ptr, other.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Perform a boolean operation (union / intersection / difference) with a CompoundCurve3D.
     * Both curves must be planar and coplanar. The operation is performed in 2D
     * and the result is projected back to 3D.
     * Returns BooleanRegionJs results containing exterior curves and interior holes.
     * @param {CompoundCurve3DJs} other
     * @param {string} operation
     * @returns {BooleanRegionJs[]}
     */
    booleanCompoundCurve(other, operation) {
        _assertClass(other, CompoundCurve3DJs);
        const ptr0 = passStringToWasm0(operation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_booleanCompoundCurve(this.__wbg_ptr, other.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {Point3Js} point
     * @returns {number}
     */
    paramClosestToPoint(point) {
        _assertClass(point, Point3Js);
        const ret = wasm.nurbscurve3djs_paramClosestToPoint(this.__wbg_ptr, point.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {number} degree
     * @param {Point3Js[]} control_points
     * @param {Float64Array | null | undefined} weights
     * @param {Float64Array} knots
     */
    constructor(degree, control_points, weights, knots) {
        const ptr0 = passArrayJsValueToWasm0(control_points, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(weights) ? 0 : passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(knots, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_new(degree, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        NurbsCurve3DJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Point3Js[]}
     */
    bbox() {
        const ret = wasm.nurbscurve3djs_bbox(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Loft through an ordered array of curves to create a `NurbsSurfaceJs`.
     *
     * Static method — call as `NurbsCurve3DJs.loft(curves, degreeV?)`.
     *
     * # Arguments
     * * `curves`   – ordered array of profile curves
     * * `degree_v` – optional degree for the loft direction
     * @param {NurbsCurve3DJs[]} curves
     * @param {number | null} [degree_v]
     * @returns {NurbsSurfaceJs}
     */
    static loft(curves, degree_v) {
        const ptr0 = passArrayJsValueToWasm0(curves, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_loft(ptr0, len0, isLikeNone(degree_v) ? 0x100000001 : (degree_v) >>> 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return NurbsSurfaceJs.__wrap(ret[0]);
    }
    /**
     * @returns {NurbsCurve3DJs}
     */
    clone() {
        const ret = wasm.nurbscurve3djs_clone(this.__wbg_ptr);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * @returns {Float64Array}
     */
    knots() {
        const ret = wasm.nurbscurve3djs_knots(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Scale the curve by factors along the X, Y, and Z axes
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {NurbsCurve3DJs}
     */
    scale(sx, sy, sz) {
        const ret = wasm.nurbscurve3djs_scale(this.__wbg_ptr, sx, sy, sz);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * Split the curve at parameter t, returning [left, right].
     * @param {number} t
     * @returns {NurbsCurve3DJs[]}
     */
    split(t) {
        const ret = wasm.nurbscurve3djs_split(this.__wbg_ptr, t);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Sweep this curve (as profile) along a `rail` curve to create a `NurbsSurfaceJs`.
     *
     * # Arguments
     * * `rail`     – the path curve
     * * `degree_v` – optional degree for the sweep direction
     * @param {NurbsCurve3DJs} rail
     * @param {number | null} [degree_v]
     * @returns {NurbsSurfaceJs}
     */
    sweep(rail, degree_v) {
        _assertClass(rail, NurbsCurve3DJs);
        const ret = wasm.nurbscurve3djs_sweep(this.__wbg_ptr, rail.__wbg_ptr, isLikeNone(degree_v) ? 0x100000001 : (degree_v) >>> 0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return NurbsSurfaceJs.__wrap(ret[0]);
    }
    /**
     * @returns {boolean}
     */
    closed() {
        const ret = wasm.nurbscurve3djs_closed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get the degree of the curve
     * @returns {number}
     */
    degree() {
        const ret = wasm.nurbscurve3djs_degree(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Extend a curve at one or both ends.
     *
     * - **Degree 1 (polyline)**: appends/prepends a new control point along the last/first segment direction.
     * - **Degree > 1**: adds a straight-line segment tangent to the curve at the boundary.
     *
     * Always returns a `CompoundCurve3DJs` (single-span for extended polylines).
     *
     * # Arguments
     * * `distance` – how far to extend (world units)
     * * `side`     – `"end"` (default), `"start"`, or `"both"`
     * @param {number} distance
     * @param {string | null} [side]
     * @returns {CompoundCurve3DJs}
     */
    extend(distance, side) {
        var ptr0 = isLikeNone(side) ? 0 : passStringToWasm0(side, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_extend(this.__wbg_ptr, distance, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * @param {number} radius
     * @param {Point3Js[] | null} [at]
     * @returns {CompoundCurve3DJs}
     */
    fillet(radius, at) {
        var ptr0 = isLikeNone(at) ? 0 : passArrayJsValueToWasm0(at, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_fillet(this.__wbg_ptr, radius, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * @returns {number}
     */
    length() {
        const ret = wasm.nurbscurve3djs_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * Offset the curve by a distance in the specified corner type ('sharp','round', 'smooth').
     * The curve must already lie in the XY plane (z = 0).
     * @param {number} distance
     * @param {string} corner_type
     * @returns {CompoundCurve3DJs}
     */
    offset(distance, corner_type) {
        const ptr0 = passStringToWasm0(corner_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.nurbscurve3djs_offset(this.__wbg_ptr, distance, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CompoundCurve3DJs.__wrap(ret[0]);
    }
    /**
     * Rotate the curve by Euler angles (in radians) around the X, Y, and Z axes
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @returns {NurbsCurve3DJs}
     */
    rotate(ax, ay, az) {
        const ret = wasm.nurbscurve3djs_rotate(this.__wbg_ptr, ax, ay, az);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * Extrude this curve along a direction vector to create a `NurbsSurfaceJs`.
     * @param {Vector3Js} direction
     * @returns {NurbsSurfaceJs}
     */
    extrude(direction) {
        _assertClass(direction, Vector3Js);
        const ret = wasm.nurbscurve3djs_extrude(this.__wbg_ptr, direction.__wbg_ptr);
        return NurbsSurfaceJs.__wrap(ret);
    }
    /**
     * Reverse the direction of this curve (swap start/end).
     * Returns a new reversed copy.
     * @returns {NurbsCurve3DJs}
     */
    reverse() {
        const ret = wasm.nurbscurve3djs_reverse(this.__wbg_ptr);
        return NurbsCurve3DJs.__wrap(ret);
    }
    /**
     * @returns {Float64Array}
     */
    weights() {
        const ret = wasm.nurbscurve3djs_weights(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Find intersection points with another `NurbsCurve3DJs`.
     * Returns the 3D intersection points.
     * @param {NurbsCurve3DJs} other
     * @returns {Point3Js[]}
     */
    intersect(other) {
        _assertClass(other, NurbsCurve3DJs);
        const ret = wasm.nurbscurve3djs_intersect(this.__wbg_ptr, other.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Check if all control points lie on a single plane
     * @param {number | null} [tolerance]
     * @returns {boolean}
     */
    isPlanar(tolerance) {
        const ret = wasm.nurbscurve3djs_isPlanar(this.__wbg_ptr, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
        return ret !== 0;
    }
    /**
     * Translate the curve by a Vector3Js offset
     * @param {Vector3Js} offset
     * @returns {NurbsCurve3DJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.nurbscurve3djs_translate(this.__wbg_ptr, offset.__wbg_ptr);
        return NurbsCurve3DJs.__wrap(ret);
    }
}
if (Symbol.dispose) NurbsCurve3DJs.prototype[Symbol.dispose] = NurbsCurve3DJs.prototype.free;

/**
 * JavaScript wrapper around Curvo's `NurbsSurface3D`.
 *
 * ## Construction
 * Surfaces are obtained from the curve classes:
 * - `curve.extrude(direction)` / `curve.extrudeComponents(dx, dy, dz)` on `NurbsCurve3DJs`
 * - `curve.sweep(rail, degreeV?)` on `NurbsCurve3DJs`
 * - `NurbsCurve3DJs.loft(curves, degreeV?)` static method
 * - `compound.extrude(direction)` / `compound.extrudeComponents(dx, dy, dz)` on `CompoundCurve3DJs`
 *
 * ## Output
 * Call `toArrays(tolerance?)` to get `{ positions, normals, indices }` typed arrays
 * suitable for direct use in WebGL / Three.js buffer geometries.
 */
export class NurbsSurfaceJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(NurbsSurfaceJs.prototype);
        obj.__wbg_ptr = ptr;
        NurbsSurfaceJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NurbsSurfaceJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nurbssurfacejs_free(ptr, 0);
    }
    /**
     * Knot domains as [u_min, u_max, v_min, v_max]
     * @returns {Float64Array}
     */
    knotsDomain() {
        const ret = wasm.nurbssurfacejs_knotsDomain(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Return a regular (uniform grid) tessellation as `{ positions, normals, indices }`.
     *
     * # Arguments
     * * `divs_u` – number of divisions in the U direction
     * * `divs_v` – number of divisions in the V direction
     * @param {number} divs_u
     * @param {number} divs_v
     * @returns {any}
     */
    toArraysRegular(divs_u, divs_v) {
        const ret = wasm.nurbssurfacejs_toArraysRegular(this.__wbg_ptr, divs_u, divs_v);
        return ret;
    }
    /**
     * Scale the surface by per-axis factors
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {NurbsSurfaceJs}
     */
    scale(sx, sy, sz) {
        const ret = wasm.nurbssurfacejs_scale(this.__wbg_ptr, sx, sy, sz);
        return NurbsSurfaceJs.__wrap(ret);
    }
    /**
     * Rotate the surface by Euler angles (radians)
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @returns {NurbsSurfaceJs}
     */
    rotate(ax, ay, az) {
        const ret = wasm.nurbssurfacejs_rotate(this.__wbg_ptr, ax, ay, az);
        return NurbsSurfaceJs.__wrap(ret);
    }
    /**
     * Point on surface at parameters (u, v)
     * @param {number} u
     * @param {number} v
     * @returns {Point3Js}
     */
    pointAt(u, v) {
        const ret = wasm.nurbssurfacejs_pointAt(this.__wbg_ptr, u, v);
        return Point3Js.__wrap(ret);
    }
    /**
     * U-direction degree of the surface
     * @returns {number}
     */
    uDegree() {
        const ret = wasm.nurbssurfacejs_uDegree(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * V-direction degree of the surface
     * @returns {number}
     */
    vDegree() {
        const ret = wasm.nurbssurfacejs_vDegree(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Normal vector at parameters (u, v)
     * @param {number} u
     * @param {number} v
     * @returns {Vector3Js}
     */
    normalAt(u, v) {
        const ret = wasm.nurbssurfacejs_normalAt(this.__wbg_ptr, u, v);
        return Vector3Js.__wrap(ret);
    }
    /**
     * Tessellate the surface and return `{ positions, normals, indices }` flat typed arrays.
     *
     * # Arguments
     * * `tolerance` – adaptive tessellation normal-tolerance (default `1e-2`).
     *                 Smaller values produce a finer mesh.
     * @param {number | null} [tolerance]
     * @returns {any}
     */
    toArrays(tolerance) {
        const ret = wasm.nurbssurfacejs_toArrays(this.__wbg_ptr, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
        return ret;
    }
    /**
     * Translate the surface by a vector
     * @param {Vector3Js} offset
     * @returns {NurbsSurfaceJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.nurbssurfacejs_translate(this.__wbg_ptr, offset.__wbg_ptr);
        return NurbsSurfaceJs.__wrap(ret);
    }
}
if (Symbol.dispose) NurbsSurfaceJs.prototype[Symbol.dispose] = NurbsSurfaceJs.prototype.free;

export class PlaneJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(PlaneJs.prototype);
        obj.__wbg_ptr = ptr;
        PlaneJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PlaneJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_planejs_free(ptr, 0);
    }
    /**
     * @param {Vector3Js} normal
     * @param {number} offset
     * @returns {PlaneJs}
     */
    static fromNormal(normal, offset) {
        _assertClass(normal, Vector3Js);
        const ret = wasm.planejs_fromNormal(normal.__wbg_ptr, offset);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} a
     * @param {Point3Js} b
     * @param {Point3Js} c
     * @returns {PlaneJs}
     */
    static fromPoints(a, b, c) {
        _assertClass(a, Point3Js);
        _assertClass(b, Point3Js);
        _assertClass(c, Point3Js);
        const ret = wasm.planejs_fromPoints(a.__wbg_ptr, b.__wbg_ptr, c.__wbg_ptr);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {PlaneJs} other
     * @returns {number}
     */
    orientPlane(other) {
        _assertClass(other, PlaneJs);
        const ret = wasm.planejs_orientPlane(this.__wbg_ptr, other.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Point3Js} p
     * @returns {number}
     */
    orientPoint(p) {
        _assertClass(p, Point3Js);
        const ret = wasm.planejs_orientPoint(this.__wbg_ptr, p.__wbg_ptr);
        return ret;
    }
    /**
     * @param {VertexJs[]} vertices
     * @returns {PlaneJs}
     */
    static FromVertices(vertices) {
        const ptr0 = passArrayJsValueToWasm0(vertices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.planejs_FromVertices(ptr0, len0);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {number} ax
     * @param {number} ay
     * @param {number} az
     * @param {number} bx
     * @param {number} by
     * @param {number} bz
     * @param {number} cx
     * @param {number} cy
     * @param {number} cz
     * @returns {PlaneJs}
     */
    static FromComponents(ax, ay, az, bx, by, bz, cx, cy, cz) {
        const ret = wasm.planejs_FromComponents(ax, ay, az, bx, by, bz, cx, cy, cz);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    toXYTransform() {
        const ret = wasm.planejs_toXYTransform(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {PolygonJs} polygon_js
     * @returns {number}
     */
    classifyPolygon(polygon_js) {
        _assertClass(polygon_js, PolygonJs);
        const ret = wasm.planejs_classifyPolygon(this.__wbg_ptr, polygon_js.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} offset
     * @returns {PlaneJs}
     */
    static fromNormalComponents(nx, ny, nz, offset) {
        const ret = wasm.planejs_fromNormalComponents(nx, ny, nz, offset);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {number}
     */
    orientPointComponents(x, y, z) {
        const ret = wasm.planejs_orientPointComponents(this.__wbg_ptr, x, y, z);
        return ret;
    }
    /**
     * @param {VertexJs[]} vertices
     */
    constructor(vertices) {
        const ptr0 = passArrayJsValueToWasm0(vertices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.planejs_FromVertices(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        PlaneJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    flip() {
        wasm.planejs_flip(this.__wbg_ptr);
    }
    /**
     * @returns {Vector3Js}
     */
    normal() {
        const ret = wasm.planejs_normal(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    offset() {
        const ret = wasm.planejs_offset(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Point3Js[]}
     */
    points() {
        const ret = wasm.planejs_points(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) PlaneJs.prototype[Symbol.dispose] = PlaneJs.prototype.free;

export class Point3Js {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Point3Js.prototype);
        obj.__wbg_ptr = ptr;
        Point3JsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof Point3Js)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Point3JsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_point3js_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.point3js_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    constructor(x, y, z) {
        const ret = wasm.point3js_new(x, y, z);
        this.__wbg_ptr = ret >>> 0;
        Point3JsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Point3Js.prototype[Symbol.dispose] = Point3Js.prototype.free;

export class Point4Js {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Point4JsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_point4js_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.point4js_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get w() {
        const ret = wasm.closestpointresultjs_normal_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} w
     */
    constructor(x, y, z, w) {
        const ret = wasm.point4js_new(x, y, z, w);
        this.__wbg_ptr = ret >>> 0;
        Point4JsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Point4Js.prototype[Symbol.dispose] = Point4Js.prototype.free;

export class PolygonJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(PolygonJs.prototype);
        obj.__wbg_ptr = ptr;
        PolygonJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof PolygonJs)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PolygonJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_polygonjs_free(ptr, 0);
    }
    /**
     * Number of holes.
     * @returns {number}
     */
    holeCount() {
        const ret = wasm.polygonjs_holeCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Triangulate this polygon into a list of triangular polygons.
     *
     * Returns `PolygonJs[]`, each of which is a triangle.
     * @returns {PolygonJs[]}
     */
    triangulate() {
        const ret = wasm.polygonjs_triangulate(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Axis-aligned bounding box of this polygon as `{ min: Point3Js, max: Point3Js }`.
     * @returns {any}
     */
    boundingBox() {
        const ret = wasm.polygonjs_boundingBox(this.__wbg_ptr);
        return ret;
    }
    /**
     * Set metadata from any JSON-serializable JS value.
     * @param {any} metadata
     */
    setMetadata(metadata) {
        wasm.polygonjs_setMetadata(this.__wbg_ptr, metadata);
    }
    /**
     * Construct from vertices (same as constructor, but named).
     * @param {VertexJs[]} vertices
     * @param {any} metadata
     * @returns {PolygonJs}
     */
    static fromVertices(vertices, metadata) {
        const ptr0 = passArrayJsValueToWasm0(vertices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.polygonjs_fromVertices(ptr0, len0, metadata);
        return PolygonJs.__wrap(ret);
    }
    /**
     * Recompute and assign a new flat normal to all vertices.
     */
    setNewNormal() {
        wasm.polygonjs_setNewNormal(this.__wbg_ptr);
    }
    /**
     * Subdivide this polygon's triangles, returning the refined triangular polygons.
     *
     * If `levels` is 0, returns a single-element array containing this polygon.
     * @param {number} levels
     * @returns {PolygonJs[]}
     */
    subdivideTriangles(levels) {
        const ret = wasm.polygonjs_subdivideTriangles(this.__wbg_ptr, levels);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Recalculate a normal from all vertices and return it.
     * @returns {Vector3Js}
     */
    calculateNewNormal() {
        const ret = wasm.polygonjs_calculateNewNormal(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * Construct a polygon from a list of vertices and optional metadata.
     *
     * Metadata may be any JSON-serializable value; it is stored as a JSON string
     * in the underlying Rust `Polygon<String>`.
     * @param {VertexJs[]} vertices
     * @param {any} metadata
     */
    constructor(vertices, metadata) {
        const ptr0 = passArrayJsValueToWasm0(vertices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.polygonjs_new(ptr0, len0, metadata);
        this.__wbg_ptr = ret >>> 0;
        PolygonJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Flip winding order and vertex normals in place.
     */
    flip() {
        wasm.polygonjs_flip(this.__wbg_ptr);
    }
    /**
     * Get the holes as an array of `VertexJs[][]`.
     * @returns {any}
     */
    holes() {
        const ret = wasm.polygonjs_holes(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get the polygon's plane as a `PlaneJs`.
     * @returns {PlaneJs}
     */
    plane() {
        const ret = wasm.polygonjs_plane(this.__wbg_ptr);
        return PlaneJs.__wrap(ret);
    }
    /**
     * Add a hole defined by vertices.
     * @param {VertexJs[]} hole_vertices
     */
    addHole(hole_vertices) {
        const ptr0 = passArrayJsValueToWasm0(hole_vertices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.polygonjs_addHole(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Get metadata as a JSON string, or `null` if none.
     * @returns {string | undefined}
     */
    metadata() {
        const ret = wasm.polygonjs_metadata(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Flatten all vertices to a single Float64 array:
     * `[x, y, z, nx, ny, nz, x, y, z, nx, ny, nz, ...]`
     * @returns {Float64Array}
     */
    toArray() {
        const ret = wasm.polygonjs_toArray(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Get the vertices as `VertexJs[]`.
     * @returns {any}
     */
    vertices() {
        const ret = wasm.polygonjs_vertices(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns `true` if this polygon has interior holes.
     * @returns {boolean}
     */
    hasHoles() {
        const ret = wasm.polygonjs_hasHoles(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) PolygonJs.prototype[Symbol.dispose] = PolygonJs.prototype.free;

/**
 * Result of a BVH-accelerated first-hit raycast returned to JavaScript.
 */
export class RaycastHitJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RaycastHitJs.prototype);
        obj.__wbg_ptr = ptr;
        RaycastHitJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RaycastHitJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_raycasthitjs_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get triangleIndex() {
        const ret = wasm.raycasthitjs_triangle_index(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get pointX() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pointY() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pointZ() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get distance() {
        const ret = wasm.closestpointresultjs_distance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalX() {
        const ret = wasm.closestpointresultjs_normal_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalY() {
        const ret = wasm.closestpointresultjs_normal_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get normalZ() {
        const ret = wasm.closestpointresultjs_normal_z(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) RaycastHitJs.prototype[Symbol.dispose] = RaycastHitJs.prototype.free;

/**
 * SDF sample result returned to JavaScript.
 */
export class SdfSampleJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(SdfSampleJs.prototype);
        obj.__wbg_ptr = ptr;
        SdfSampleJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SdfSampleJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sdfsamplejs_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get distance() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get closestX() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get closestY() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get closestZ() {
        const ret = wasm.closestpointresultjs_normal_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get isInside() {
        const ret = wasm.sdfsamplejs_is_inside(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) SdfSampleJs.prototype[Symbol.dispose] = SdfSampleJs.prototype.free;

/**
 * Section-elevation result (cut sketch + visible/hidden edge polylines).
 */
export class SectionElevationResultJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(SectionElevationResultJs.prototype);
        obj.__wbg_ptr = ptr;
        SectionElevationResultJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SectionElevationResultJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sectionelevationresultjs_free(ptr, 0);
    }
    /**
     * @returns {SketchJs}
     */
    cutSketch() {
        const ret = wasm.sectionelevationresultjs_cutSketch(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    hiddenPolylines() {
        const ret = wasm.sectionelevationresultjs_hiddenPolylines(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {any}
     */
    visiblePolylines() {
        const ret = wasm.sectionelevationresultjs_visiblePolylines(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) SectionElevationResultJs.prototype[Symbol.dispose] = SectionElevationResultJs.prototype.free;

export class SketchJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(SketchJs.prototype);
        obj.__wbg_ptr = ptr;
        SketchJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SketchJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sketchjs_free(ptr, 0);
    }
    /**
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    difference(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_difference(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} a
     * @param {number} b
     * @param {number} m
     * @param {number} n1
     * @param {number} n2
     * @param {number} n3
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static supershape(a, b, m, n1, n2, n3, segments, metadata) {
        const ret = wasm.sketchjs_supershape(a, b, m, n1, n2, n3, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {SketchJs}
     */
    renormalize() {
        const ret = wasm.sketchjs_renormalize(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    boundingBox() {
        const ret = wasm.sketchjs_boundingBox(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    intersection(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_intersection(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} sides
     * @param {number} radius
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static regularNGon(sides, radius, metadata) {
        const ret = wasm.sketchjs_regularNGon(sides, radius, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} max_camber
     * @param {number} camber_position
     * @param {number} thickness
     * @param {number} chord
     * @param {number} samples
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static airfoilNACA4(max_camber, camber_position, thickness, chord, samples, metadata) {
        const ret = wasm.sketchjs_airfoilNACA4(max_camber, camber_position, thickness, chord, samples, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} module_
     * @param {number} teeth
     * @param {number} pressure_angle_deg
     * @param {number} clearance
     * @param {number} backlash
     * @param {number} segments_per_flank
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static involuteGear(module_, teeth, pressure_angle_deg, clearance, backlash, segments_per_flank, metadata) {
        const ret = wasm.sketchjs_involuteGear(module_, teeth, pressure_angle_deg, clearance, backlash, segments_per_flank, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * Return a human-readable summary of every ring coordinate in the
     * underlying `geo::GeometryCollection`.  Useful for debugging sketch
     * content from TypeScript without having to read raw buffers.
     *
     * Example output:
     * ```
     * Geometry[0] Polygon
     *   exterior (6 pts): [0.00,0.00] [1.00,0.00] ...
     *   hole[0]   (5 pts): [0.25,0.25] ...
     * Geometry[1] LineString
     *   (3 pts): [0.00,0.00] [5.00,5.00] ...
     * ```
     * @returns {string}
     */
    debugGeometry() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sketchjs_debugGeometry(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {Vector3Js} dir
     * @returns {MeshJs}
     */
    extrudeVector(dir) {
        _assertClass(dir, Vector3Js);
        const ret = wasm.sketchjs_extrudeVector(this.__wbg_ptr, dir.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static rightTriangle(width, height, metadata) {
        const ret = wasm.sketchjs_rightTriangle(width, height, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    toMultiPolygon() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sketchjs_toMultiPolygon(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} radius
     * @param {number} segments
     * @param {number} flat_dist
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static circleWithFlat(radius, segments, flat_dist, metadata) {
        const ret = wasm.sketchjs_circleWithFlat(radius, segments, flat_dist, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {any} path
     * @returns {MeshJs}
     */
    sweepComponents(path) {
        const ret = wasm.sketchjs_sweepComponents(this.__wbg_ptr, path);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {number} corner_radius
     * @param {number} corner_segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static roundedRectangle(width, height, corner_radius, corner_segments, metadata) {
        const ret = wasm.sketchjs_roundedRectangle(width, height, corner_radius, corner_segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {number} segments
     * @param {number} key_width
     * @param {number} key_depth
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static circleWithKeyway(radius, segments, key_width, key_depth, metadata) {
        const ret = wasm.sketchjs_circleWithKeyway(radius, segments, key_width, key_depth, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} m00
     * @param {number} m01
     * @param {number} m02
     * @param {number} m03
     * @param {number} m10
     * @param {number} m11
     * @param {number} m12
     * @param {number} m13
     * @param {number} m20
     * @param {number} m21
     * @param {number} m22
     * @param {number} m23
     * @param {number} m30
     * @param {number} m31
     * @param {number} m32
     * @param {number} m33
     * @returns {SketchJs}
     */
    transformComponents(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
        const ret = wasm.sketchjs_transformComponents(this.__wbg_ptr, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {SketchJs}
     */
    translateComponents(dx, dy, dz) {
        const ret = wasm.sketchjs_translateComponents(this.__wbg_ptr, dx, dy, dz);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {number} segments
     * @param {number} flat_dist
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static circleWithTwoFlats(radius, segments, flat_dist, metadata) {
        const ret = wasm.sketchjs_circleWithTwoFlats(radius, segments, flat_dist, metadata);
        return SketchJs.__wrap(ret);
    }
    invalidateBoundingBox() {
        wasm.meshjs_invalidateBoundingBox(this.__wbg_ptr);
    }
    /**
     * @param {number} dx
     * @param {number} dy
     * @param {number} dz
     * @returns {MeshJs}
     */
    extrudeVectorComponents(dx, dy, dz) {
        const ret = wasm.sketchjs_extrudeVectorComponents(this.__wbg_ptr, dx, dy, dz);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static egg(width, length, segments, metadata) {
        const ret = wasm.sketchjs_egg(width, length, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    constructor() {
        const ret = wasm.meshjs_new();
        this.__wbg_ptr = ret >>> 0;
        SketchJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    xor(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_xor(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} id
     * @param {number} thickness
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static ring(id, thickness, segments, metadata) {
        const ret = wasm.sketchjs_ring(id, thickness, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} num_points
     * @param {number} outer_radius
     * @param {number} inner_radius
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static star(num_points, outer_radius, inner_radius, metadata) {
        const ret = wasm.sketchjs_star(num_points, outer_radius, inner_radius, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} shaft_length
     * @param {number} shaft_width
     * @param {number} head_length
     * @param {number} head_width
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static arrow(shaft_length, shaft_width, head_length, head_width, metadata) {
        const ret = wasm.sketchjs_arrow(shaft_length, shaft_width, head_length, head_width, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static heart(width, height, segments, metadata) {
        const ret = wasm.sketchjs_heart(width, height, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @returns {SketchJs}
     */
    scale(sx, sy, sz) {
        const ret = wasm.sketchjs_scale(this.__wbg_ptr, sx, sy, sz);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {Point3Js[]} path
     * @returns {MeshJs}
     */
    sweep(path) {
        const ptr0 = passArrayJsValueToWasm0(path, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sketchjs_sweep(this.__wbg_ptr, ptr0, len0);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    union(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_union(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {any} control
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static bezier(control, segments, metadata) {
        const ret = wasm.sketchjs_bezier(control, segments, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SketchJs.__wrap(ret[0]);
    }
    /**
     * @returns {SketchJs}
     */
    center() {
        const ret = wasm.sketchjs_center(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static circle(radius, segments, metadata) {
        const ret = wasm.sketchjs_circle(radius, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} rx
     * @param {number} ry
     * @param {number} rz
     * @returns {SketchJs}
     */
    rotate(rx, ry, rz) {
        const ret = wasm.sketchjs_rotate(this.__wbg_ptr, rx, ry, rz);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static square(width, metadata) {
        const ret = wasm.sketchjs_square(width, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    toSVG() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sketchjs_toSVG(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {any} control
     * @param {number} p
     * @param {number} segments_per_span
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static bspline(control, p, segments_per_span, metadata) {
        const ret = wasm.sketchjs_bspline(control, p, segments_per_span, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SketchJs.__wrap(ret[0]);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static ellipse(width, height, segments, metadata) {
        const ret = wasm.sketchjs_ellipse(width, height, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} height
     * @returns {MeshJs}
     */
    extrude(height) {
        const ret = wasm.sketchjs_extrude(this.__wbg_ptr, height);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {SketchJs}
     */
    inverse() {
        const ret = wasm.sketchjs_inverse(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} circle_radius
     * @param {number} handle_width
     * @param {number} handle_height
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static keyhole(circle_radius, handle_width, handle_height, segments, metadata) {
        const ret = wasm.sketchjs_keyhole(circle_radius, handle_width, handle_height, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {any} points
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static polygon(points, metadata) {
        const ret = wasm.sketchjs_polygon(points, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SketchJs.__wrap(ret[0]);
    }
    /**
     * @param {number} angle_degrees
     * @param {number} segments
     * @returns {MeshJs}
     */
    revolve(angle_degrees, segments) {
        const ret = wasm.sketchjs_revolve(this.__wbg_ptr, angle_degrees, segments);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MeshJs.__wrap(ret[0]);
    }
    /**
     * @param {number} outer_r
     * @param {number} inner_r
     * @param {number} offset
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static crescent(outer_r, inner_r, offset, segments, metadata) {
        const ret = wasm.sketchjs_crescent(outer_r, inner_r, offset, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {string} geo_json
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static fromGeo(geo_json, metadata) {
        const ptr0 = passStringToWasm0(geo_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sketchjs_fromGeo(ptr0, len0, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SketchJs.__wrap(ret[0]);
    }
    /**
     * @param {string} svg_data
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static fromSVG(svg_data, metadata) {
        const ptr0 = passStringToWasm0(svg_data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sketchjs_fromSVG(ptr0, len0, metadata);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SketchJs.__wrap(ret[0]);
    }
    /**
     * @returns {boolean}
     */
    isEmpty() {
        const ret = wasm.sketchjs_isEmpty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} sides
     * @param {number} diameter
     * @param {number} circle_segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static reuleaux(sides, diameter, circle_segments, metadata) {
        const ret = wasm.sketchjs_reuleaux(sides, diameter, circle_segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static squircle(width, height, segments, metadata) {
        const ret = wasm.sketchjs_squircle(width, height, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static teardrop(width, length, segments, metadata) {
        const ret = wasm.sketchjs_teardrop(width, length, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {MeshJs} mesh_js
     * @returns {SketchJs}
     */
    static fromMesh(mesh_js) {
        _assertClass(mesh_js, MeshJs);
        const ret = wasm.sketchjs_fromMesh(mesh_js.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} radius
     * @param {number} start_angle_deg
     * @param {number} end_angle_deg
     * @param {number} segments
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static pieSlice(radius, start_angle_deg, end_angle_deg, segments, metadata) {
        const ret = wasm.sketchjs_pieSlice(radius, start_angle_deg, end_angle_deg, segments, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} width
     * @param {number} length
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static rectangle(width, length, metadata) {
        const ret = wasm.sketchjs_rectangle(width, length, metadata);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    toArrays() {
        const ret = wasm.sketchjs_toArrays(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Matrix4Js} mat
     * @returns {SketchJs}
     */
    transform(mat) {
        _assertClass(mat, Matrix4Js);
        const ret = wasm.sketchjs_transform(this.__wbg_ptr, mat.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {Vector3Js} offset
     * @returns {SketchJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.sketchjs_translate(this.__wbg_ptr, offset.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} top_width
     * @param {number} bottom_width
     * @param {number} height
     * @param {number} top_offset
     * @param {any} metadata
     * @returns {SketchJs}
     */
    static trapezoid(top_width, bottom_width, height, top_offset, metadata) {
        const ret = wasm.sketchjs_trapezoid(top_width, bottom_width, height, top_offset, metadata);
        return SketchJs.__wrap(ret);
    }
}
if (Symbol.dispose) SketchJs.prototype[Symbol.dispose] = SketchJs.prototype.free;

export class Vector3Js {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Vector3Js.prototype);
        obj.__wbg_ptr = ptr;
        Vector3JsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Vector3JsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vector3js_free(ptr, 0);
    }
    /**
     * @param {number} tolerance
     * @returns {boolean}
     */
    isOrthogonal(tolerance) {
        const ret = wasm.vector3js_isOrthogonal(this.__wbg_ptr, tolerance);
        return ret !== 0;
    }
    /**
     * Compute the shortest-arc unit quaternion that rotates `self` to align with `other`.
     * Returns a plain JS object `{ w, x, y, z }`.
     * For anti-parallel vectors, a 180° rotation around a perpendicular axis is chosen.
     * @param {Vector3Js} other
     * @returns {any}
     */
    rotationBetween(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_rotationBetween(this.__wbg_ptr, other.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Rotate this vector by a unit quaternion given as components `(w, x, y, z)`.
     * The quaternion is expected to be unit-length.
     * @param {number} w
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {Vector3Js}
     */
    rotateQuaternion(w, x, y, z) {
        const ret = wasm.vector3js_rotateQuaternion(this.__wbg_ptr, w, x, y, z);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.closestpointresultjs_point_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.closestpointresultjs_point_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.closestpointresultjs_point_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Vector3Js}
     */
    abs() {
        const ret = wasm.vector3js_abs(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {Vector3Js} other
     * @returns {Vector3Js}
     */
    add(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_add(this.__wbg_ptr, other.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {Vector3Js} other
     * @returns {number}
     */
    dot(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_dot(this.__wbg_ptr, other.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    constructor(x, y, z) {
        const ret = wasm.point3js_new(x, y, z);
        this.__wbg_ptr = ret >>> 0;
        Vector3JsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Vector3Js} other
     * @returns {number}
     */
    angle(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_angle(this.__wbg_ptr, other.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Vector3Js} other
     * @returns {Vector3Js}
     */
    cross(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_cross(this.__wbg_ptr, other.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {number} factor
     * @returns {Vector3Js}
     */
    scale(factor) {
        const ret = wasm.vector3js_scale(this.__wbg_ptr, factor);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {Vector3Js} other
     * @returns {boolean}
     */
    equals(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_equals(this.__wbg_ptr, other.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    length() {
        const ret = wasm.vector3js_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Vector3Js} axis
     * @param {number} angle
     * @returns {Vector3Js}
     */
    rotate(axis, angle) {
        _assertClass(axis, Vector3Js);
        const ret = wasm.vector3js_rotate(this.__wbg_ptr, axis.__wbg_ptr, angle);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @returns {Vector3Js}
     */
    reverse() {
        const ret = wasm.vector3js_reverse(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @param {Vector3Js} other
     * @returns {Vector3Js}
     */
    subtract(other) {
        _assertClass(other, Vector3Js);
        const ret = wasm.vector3js_subtract(this.__wbg_ptr, other.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @returns {Vector3Js}
     */
    normalize() {
        const ret = wasm.vector3js_normalize(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
}
if (Symbol.dispose) Vector3Js.prototype[Symbol.dispose] = Vector3Js.prototype.free;

export class VertexJs {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(VertexJs.prototype);
        obj.__wbg_ptr = ptr;
        VertexJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    static __unwrap(jsValue) {
        if (!(jsValue instanceof VertexJs)) {
            return 0;
        }
        return jsValue.__destroy_into_raw();
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VertexJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vertexjs_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.vertexjs_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {VertexJs}
     */
    static fromComponents(x, y, z) {
        const ret = wasm.vertexjs_fromComponents(x, y, z);
        return VertexJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} position
     * @param {Vector3Js} normal
     * @returns {VertexJs}
     */
    static fromPositionNormal(position, normal) {
        _assertClass(position, Point3Js);
        _assertClass(normal, Vector3Js);
        const ret = wasm.vertexjs_fromPositionNormal(position.__wbg_ptr, normal.__wbg_ptr);
        return VertexJs.__wrap(ret);
    }
    /**
     * @param {Point3Js} position
     * @param {Vector3Js} normal
     */
    constructor(position, normal) {
        _assertClass(position, Point3Js);
        _assertClass(normal, Vector3Js);
        const ret = wasm.vertexjs_new(position.__wbg_ptr, normal.__wbg_ptr);
        this.__wbg_ptr = ret >>> 0;
        VertexJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Vector3Js}
     */
    normal() {
        const ret = wasm.vertexjs_normal(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
    }
    /**
     * @returns {Point3Js}
     */
    position() {
        const ret = wasm.vertexjs_position(this.__wbg_ptr);
        return Point3Js.__wrap(ret);
    }
    /**
     * @returns {Float64Array}
     */
    toArray() {
        const ret = wasm.vertexjs_toArray(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) VertexJs.prototype[Symbol.dispose] = VertexJs.prototype.free;

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_Error_52673b7de5a0ca89 = function(arg0, arg1) {
        const ret = Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_Number_2d1dcfcf4ec51736 = function(arg0) {
        const ret = Number(arg0);
        return ret;
    };
    imports.wbg.__wbg___wbindgen_bigint_get_as_i64_6e32f5e6aff02e1d = function(arg0, arg1) {
        const v = arg1;
        const ret = typeof(v) === 'bigint' ? v : undefined;
        getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_boolean_get_dea25b33882b895b = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? v : undefined;
        return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
    };
    imports.wbg.__wbg___wbindgen_debug_string_adfb662ae34724b6 = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_in_0d3e1e8f0c669317 = function(arg0, arg1) {
        const ret = arg0 in arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_bigint_0e1a2e3f55cfae27 = function(arg0) {
        const ret = typeof(arg0) === 'bigint';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_null_dfda7d66506c95b5 = function(arg0) {
        const ret = arg0 === null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_ce774f3490692386 = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_undefined_f6b95eab589e0269 = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_eq_b6101cc9cef1fe36 = function(arg0, arg1) {
        const ret = arg0 === arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_loose_eq_766057600fdd1b0d = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_number_get_9619185a74197f95 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_string_get_a2a31e16edf96e42 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_booleanregionjs_new = function(arg0) {
        const ret = BooleanRegionJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_call_abb4ff46ce38be40 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_compoundcurve3djs_new = function(arg0) {
        const ret = CompoundCurve3DJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_done_62ea16af4ce34b24 = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_entries_83c79938054e065f = function(arg0) {
        const ret = Object.entries(arg0);
        return ret;
    };
    imports.wbg.__wbg_getRandomValues_1c61fac11405ffdc = function() { return handleError(function (arg0, arg1) {
        globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
    }, arguments) };
    imports.wbg.__wbg_get_6b7bd52aca3f9671 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_af9dab7e9603ea93 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_instanceof_ArrayBuffer_f3320d2419cd0355 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Float64Array_9fefccd7bfa2fefe = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Float64Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Map_084be8da74364158 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Map;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint32Array_0e3c035c6ed948e0 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint32Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_da54ccc9d3e09434 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_51fd9e6422c0a395 = function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
    };
    imports.wbg.__wbg_isSafeInteger_ae7d3f054d55fa16 = function(arg0) {
        const ret = Number.isSafeInteger(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_27b7c8b35ab3e86b = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_22ac23eaec9d8053 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_406f6daaaa453057 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_d45040a40c570362 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_matrix4js_new = function(arg0) {
        const ret = Matrix4Js.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_meshjs_unwrap = function(arg0) {
        const ret = MeshJs.__unwrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_1ba21ce319a06297 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_25f239778d6112b9 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_6421f6084cc5bc5a = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_9a48ef80d2a51f94 = function(arg0, arg1) {
        const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_from_slice_db0691b69e9d3891 = function(arg0, arg1) {
        const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_new_no_args_cb138f77cf6151ee = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_next_138a17bbf04e926c = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_next_3cfe5c0fe2a4cc53 = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_now_8cf15d6e317793e1 = function(arg0) {
        const ret = arg0.now();
        return ret;
    };
    imports.wbg.__wbg_nurbscurve3djs_new = function(arg0) {
        const ret = NurbsCurve3DJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_nurbscurve3djs_unwrap = function(arg0) {
        const ret = NurbsCurve3DJs.__unwrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_nurbssurfacejs_new = function(arg0) {
        const ret = NurbsSurfaceJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_point3js_new = function(arg0) {
        const ret = Point3Js.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_point3js_unwrap = function(arg0) {
        const ret = Point3Js.__unwrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_polygonjs_new = function(arg0) {
        const ret = PolygonJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_polygonjs_unwrap = function(arg0) {
        const ret = PolygonJs.__unwrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_prototypesetcall_d3c4edbb4ef96ca1 = function(arg0, arg1, arg2) {
        Float64Array.prototype.set.call(getArrayF64FromWasm0(arg0, arg1), arg2);
    };
    imports.wbg.__wbg_prototypesetcall_dfe9b766cdc1f1fd = function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    };
    imports.wbg.__wbg_push_7d9be8f38fc13975 = function(arg0, arg1) {
        const ret = arg0.push(arg1);
        return ret;
    };
    imports.wbg.__wbg_raycasthitjs_new = function(arg0) {
        const ret = RaycastHitJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_set_781438a03c0c3c81 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_static_accessor_GLOBAL_769e6b65d6557335 = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_60cf02db4de8e1c1 = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_08f5a74c69739274 = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_a8924b26aa92d024 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_value_57b7b035e117f7ee = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbg_vector3js_new = function(arg0) {
        const ret = Vector3Js.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_vertexjs_new = function(arg0) {
        const ret = VertexJs.__wrap(arg0);
        return ret;
    };
    imports.wbg.__wbg_vertexjs_unwrap = function(arg0) {
        const ret = VertexJs.__unwrap(arg0);
        return ret;
    };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_cast_4625c577ab2ec9ee = function(arg0) {
        // Cast intrinsic for `U64 -> Externref`.
        const ret = BigInt.asUintN(64, arg0);
        return ret;
    };
    imports.wbg.__wbindgen_cast_9ae0607507abb057 = function(arg0) {
        // Cast intrinsic for `I64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('csgrs_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
