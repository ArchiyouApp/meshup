let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

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

const Matrix4JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_matrix4js_free(ptr >>> 0, 1));

const MeshJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_meshjs_free(ptr >>> 0, 1));

const PlaneJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_planejs_free(ptr >>> 0, 1));

const Point3JsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_point3js_free(ptr >>> 0, 1));

const PolygonJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_polygonjs_free(ptr >>> 0, 1));

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
 * Chroma subsampling format
 * @enum {0 | 1 | 2 | 3}
 */
export const ChromaSampling = Object.freeze({
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420: 0, "0": "Cs420",
    /**
     * Horizontally subsampled.
     */
    Cs422: 1, "1": "Cs422",
    /**
     * Not subsampled.
     */
    Cs444: 2, "2": "Cs444",
    /**
     * Monochrome.
     */
    Cs400: 3, "3": "Cs400",
});

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
    constructor() {
        const ret = wasm.meshjs_new();
        this.__wbg_ptr = ret >>> 0;
        MeshJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
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
     * Return an interleaved array of vertex positions (x,y,z)*.
     * @returns {Float64Array}
     */
    positions() {
        const ret = wasm.meshjs_positions(this.__wbg_ptr);
        return ret;
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
     * Return triangle indices (u32).
     * @returns {Uint32Array}
     */
    indices() {
        const ret = wasm.meshjs_indices(this.__wbg_ptr);
        return ret;
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
     * @returns {number}
     */
    vertexCount() {
        const ret = wasm.meshjs_vertexCount(this.__wbg_ptr);
        return ret >>> 0;
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
     * @returns {any}
     */
    vertices() {
        const ret = wasm.meshjs_vertices(this.__wbg_ptr);
        return ret;
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
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    union(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_union(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
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
     * @param {MeshJs} other
     * @returns {MeshJs}
     */
    intersection(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_intersection(this.__wbg_ptr, other.__wbg_ptr);
        return MeshJs.__wrap(ret);
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
     * @param {Matrix4Js} mat
     * @returns {MeshJs}
     */
    transform(mat) {
        _assertClass(mat, Matrix4Js);
        const ret = wasm.meshjs_transform(this.__wbg_ptr, mat.__wbg_ptr);
        return MeshJs.__wrap(ret);
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
     * @param {Vector3Js} offset
     * @returns {MeshJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.meshjs_translate(this.__wbg_ptr, offset.__wbg_ptr);
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
     * @returns {MeshJs}
     */
    center() {
        const ret = wasm.meshjs_center(this.__wbg_ptr);
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
     * @returns {MeshJs}
     */
    inverse() {
        const ret = wasm.meshjs_inverse(this.__wbg_ptr);
        return MeshJs.__wrap(ret);
    }
    /**
     * @returns {MeshJs}
     */
    convexHull() {
        const ret = wasm.meshjs_convexHull(this.__wbg_ptr);
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
     * @returns {SketchJs}
     */
    flatten() {
        const ret = wasm.meshjs_flatten(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
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
     * @param {number} min_quality
     * @returns {MeshJs}
     */
    removePoorTriangles(min_quality) {
        const ret = wasm.meshjs_removePoorTriangles(this.__wbg_ptr, min_quality);
        return MeshJs.__wrap(ret);
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
     * @returns {any}
     */
    boundingBox() {
        const ret = wasm.meshjs_boundingBox(this.__wbg_ptr);
        return ret;
    }
    invalidateBoundingBox() {
        wasm.meshjs_invalidateBoundingBox(this.__wbg_ptr);
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
     * @param {string} object_name
     * @returns {string}
     */
    toGLTF(object_name) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(object_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.meshjs_toGLTF(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
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
     * @param {MeshJs} other
     * @returns {boolean}
     */
    sameMetadata(other) {
        _assertClass(other, MeshJs);
        const ret = wasm.meshjs_sameMetadata(this.__wbg_ptr, other.__wbg_ptr);
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
     * @param {number} density
     * @returns {any}
     */
    massProperties(density) {
        const ret = wasm.meshjs_massProperties(this.__wbg_ptr, density);
        return ret;
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
     * @param {number} size
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static cube(size, metadata) {
        const ret = wasm.meshjs_cube(size, metadata);
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
     * @param {number} radius
     * @param {any} metadata
     * @returns {MeshJs}
     */
    static octahedron(radius, metadata) {
        const ret = wasm.meshjs_octahedron(radius, metadata);
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
}
if (Symbol.dispose) MeshJs.prototype[Symbol.dispose] = MeshJs.prototype.free;

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
     * @param {Point3Js} a
     * @param {Point3Js} b
     * @param {Point3Js} c
     * @returns {PlaneJs}
     */
    static FromPoints(a, b, c) {
        _assertClass(a, Point3Js);
        _assertClass(b, Point3Js);
        _assertClass(c, Point3Js);
        const ret = wasm.planejs_FromPoints(a.__wbg_ptr, b.__wbg_ptr, c.__wbg_ptr);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {number} nx
     * @param {number} ny
     * @param {number} nz
     * @param {number} offset
     * @returns {PlaneJs}
     */
    static FromNormalComponents(nx, ny, nz, offset) {
        const ret = wasm.planejs_FromNormalComponents(nx, ny, nz, offset);
        return PlaneJs.__wrap(ret);
    }
    /**
     * @param {Vector3Js} normal
     * @param {number} offset
     * @returns {PlaneJs}
     */
    static FromNormal(normal, offset) {
        _assertClass(normal, Vector3Js);
        const ret = wasm.planejs_FromNormal(normal.__wbg_ptr, offset);
        return PlaneJs.__wrap(ret);
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
    flip() {
        wasm.planejs_flip(this.__wbg_ptr);
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
     * @param {PlaneJs} other
     * @returns {number}
     */
    orientPlane(other) {
        _assertClass(other, PlaneJs);
        const ret = wasm.planejs_orientPlane(this.__wbg_ptr, other.__wbg_ptr);
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
     * @returns {any}
     */
    toXYTransform() {
        const ret = wasm.planejs_toXYTransform(this.__wbg_ptr);
        return ret;
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
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.point3js_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.point3js_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.point3js_z(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Point3Js.prototype[Symbol.dispose] = Point3Js.prototype.free;

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
     * Get the vertices as `VertexJs[]`.
     * @returns {any}
     */
    vertices() {
        const ret = wasm.polygonjs_vertices(this.__wbg_ptr);
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
     * Flip winding order and vertex normals in place.
     */
    flip() {
        wasm.polygonjs_flip(this.__wbg_ptr);
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
     * Set metadata from any JSON-serializable JS value.
     * @param {any} metadata
     */
    setMetadata(metadata) {
        wasm.polygonjs_setMetadata(this.__wbg_ptr, metadata);
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
     * Recompute and assign a new flat normal to all vertices.
     */
    setNewNormal() {
        wasm.polygonjs_setNewNormal(this.__wbg_ptr);
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
}
if (Symbol.dispose) PolygonJs.prototype[Symbol.dispose] = PolygonJs.prototype.free;

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
    constructor() {
        const ret = wasm.meshjs_new();
        this.__wbg_ptr = ret >>> 0;
        SketchJsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {boolean}
     */
    isEmpty() {
        const ret = wasm.sketchjs_isEmpty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {any}
     */
    toArrays() {
        const ret = wasm.sketchjs_toArrays(this.__wbg_ptr);
        return ret;
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
     * @param {MeshJs} mesh_js
     * @returns {SketchJs}
     */
    static fromMesh(mesh_js) {
        _assertClass(mesh_js, MeshJs);
        const ret = wasm.sketchjs_fromMesh(mesh_js.__wbg_ptr);
        return SketchJs.__wrap(ret);
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
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    difference(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_difference(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
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
     * @param {SketchJs} other
     * @returns {SketchJs}
     */
    xor(other) {
        _assertClass(other, SketchJs);
        const ret = wasm.sketchjs_xor(this.__wbg_ptr, other.__wbg_ptr);
        return SketchJs.__wrap(ret);
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
     * @param {Vector3Js} offset
     * @returns {SketchJs}
     */
    translate(offset) {
        _assertClass(offset, Vector3Js);
        const ret = wasm.sketchjs_translate(this.__wbg_ptr, offset.__wbg_ptr);
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
     * @returns {SketchJs}
     */
    center() {
        const ret = wasm.sketchjs_center(this.__wbg_ptr);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {SketchJs}
     */
    inverse() {
        const ret = wasm.sketchjs_inverse(this.__wbg_ptr);
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
     * @param {number} height
     * @returns {MeshJs}
     */
    extrude(height) {
        const ret = wasm.sketchjs_extrude(this.__wbg_ptr, height);
        return MeshJs.__wrap(ret);
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
     * @param {Vector3Js} dir
     * @returns {MeshJs}
     */
    extrudeVector(dir) {
        _assertClass(dir, Vector3Js);
        const ret = wasm.sketchjs_extrudeVector(this.__wbg_ptr, dir.__wbg_ptr);
        return MeshJs.__wrap(ret);
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
     * @param {any} path
     * @returns {MeshJs}
     */
    sweepComponents(path) {
        const ret = wasm.sketchjs_sweepComponents(this.__wbg_ptr, path);
        return MeshJs.__wrap(ret);
    }
    /**
     * @param {number} distance
     * @returns {SketchJs}
     */
    offset(distance) {
        const ret = wasm.sketchjs_offset(this.__wbg_ptr, distance);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {number} distance
     * @returns {SketchJs}
     */
    offsetRounded(distance) {
        const ret = wasm.sketchjs_offsetRounded(this.__wbg_ptr, distance);
        return SketchJs.__wrap(ret);
    }
    /**
     * @param {boolean} orientation
     * @returns {SketchJs}
     */
    straightSkeleton(orientation) {
        const ret = wasm.sketchjs_straightSkeleton(this.__wbg_ptr, orientation);
        return SketchJs.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    boundingBox() {
        const ret = wasm.sketchjs_boundingBox(this.__wbg_ptr);
        return ret;
    }
    invalidateBoundingBox() {
        wasm.meshjs_invalidateBoundingBox(this.__wbg_ptr);
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
    static heart(width, height, segments, metadata) {
        const ret = wasm.sketchjs_heart(width, height, segments, metadata);
        return SketchJs.__wrap(ret);
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
     * @param {number} order
     * @param {number} padding
     * @returns {SketchJs}
     */
    hilbertCurve(order, padding) {
        const ret = wasm.sketchjs_hilbertCurve(this.__wbg_ptr, order, padding);
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
     * @returns {number}
     */
    get x() {
        const ret = wasm.point3js_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.point3js_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.point3js_z(this.__wbg_ptr);
        return ret;
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
     * @returns {Point3Js}
     */
    position() {
        const ret = wasm.vertexjs_position(this.__wbg_ptr);
        return Point3Js.__wrap(ret);
    }
    /**
     * @returns {Vector3Js}
     */
    normal() {
        const ret = wasm.vertexjs_normal(this.__wbg_ptr);
        return Vector3Js.__wrap(ret);
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

export function __wbg_Error_52673b7de5a0ca89(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
};

export function __wbg_Number_2d1dcfcf4ec51736(arg0) {
    const ret = Number(arg0);
    return ret;
};

export function __wbg___wbindgen_bigint_get_as_i64_6e32f5e6aff02e1d(arg0, arg1) {
    const v = arg1;
    const ret = typeof(v) === 'bigint' ? v : undefined;
    getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
};

export function __wbg___wbindgen_boolean_get_dea25b33882b895b(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
};

export function __wbg___wbindgen_debug_string_adfb662ae34724b6(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

export function __wbg___wbindgen_in_0d3e1e8f0c669317(arg0, arg1) {
    const ret = arg0 in arg1;
    return ret;
};

export function __wbg___wbindgen_is_bigint_0e1a2e3f55cfae27(arg0) {
    const ret = typeof(arg0) === 'bigint';
    return ret;
};

export function __wbg___wbindgen_is_function_8d400b8b1af978cd(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
};

export function __wbg___wbindgen_is_null_dfda7d66506c95b5(arg0) {
    const ret = arg0 === null;
    return ret;
};

export function __wbg___wbindgen_is_object_ce774f3490692386(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
};

export function __wbg___wbindgen_is_undefined_f6b95eab589e0269(arg0) {
    const ret = arg0 === undefined;
    return ret;
};

export function __wbg___wbindgen_jsval_eq_b6101cc9cef1fe36(arg0, arg1) {
    const ret = arg0 === arg1;
    return ret;
};

export function __wbg___wbindgen_jsval_loose_eq_766057600fdd1b0d(arg0, arg1) {
    const ret = arg0 == arg1;
    return ret;
};

export function __wbg___wbindgen_number_get_9619185a74197f95(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'number' ? obj : undefined;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
};

export function __wbg___wbindgen_string_get_a2a31e16edf96e42(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
};

export function __wbg___wbindgen_throw_dd24417ed36fc46e(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
};

export function __wbg_call_abb4ff46ce38be40() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments) };

export function __wbg_done_62ea16af4ce34b24(arg0) {
    const ret = arg0.done;
    return ret;
};

export function __wbg_entries_83c79938054e065f(arg0) {
    const ret = Object.entries(arg0);
    return ret;
};

export function __wbg_get_6b7bd52aca3f9671(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
};

export function __wbg_get_af9dab7e9603ea93() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments) };

export function __wbg_instanceof_ArrayBuffer_f3320d2419cd0355(arg0) {
    let result;
    try {
        result = arg0 instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
};

export function __wbg_instanceof_Float64Array_9fefccd7bfa2fefe(arg0) {
    let result;
    try {
        result = arg0 instanceof Float64Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
};

export function __wbg_instanceof_Map_084be8da74364158(arg0) {
    let result;
    try {
        result = arg0 instanceof Map;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
};

export function __wbg_instanceof_Uint32Array_0e3c035c6ed948e0(arg0) {
    let result;
    try {
        result = arg0 instanceof Uint32Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
};

export function __wbg_instanceof_Uint8Array_da54ccc9d3e09434(arg0) {
    let result;
    try {
        result = arg0 instanceof Uint8Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
};

export function __wbg_isArray_51fd9e6422c0a395(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
};

export function __wbg_isSafeInteger_ae7d3f054d55fa16(arg0) {
    const ret = Number.isSafeInteger(arg0);
    return ret;
};

export function __wbg_iterator_27b7c8b35ab3e86b() {
    const ret = Symbol.iterator;
    return ret;
};

export function __wbg_length_22ac23eaec9d8053(arg0) {
    const ret = arg0.length;
    return ret;
};

export function __wbg_length_d45040a40c570362(arg0) {
    const ret = arg0.length;
    return ret;
};

export function __wbg_matrix4js_new(arg0) {
    const ret = Matrix4Js.__wrap(arg0);
    return ret;
};

export function __wbg_new_1ba21ce319a06297() {
    const ret = new Object();
    return ret;
};

export function __wbg_new_25f239778d6112b9() {
    const ret = new Array();
    return ret;
};

export function __wbg_new_6421f6084cc5bc5a(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
};

export function __wbg_new_from_slice_9a48ef80d2a51f94(arg0, arg1) {
    const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
    return ret;
};

export function __wbg_new_from_slice_db0691b69e9d3891(arg0, arg1) {
    const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
    return ret;
};

export function __wbg_next_138a17bbf04e926c(arg0) {
    const ret = arg0.next;
    return ret;
};

export function __wbg_next_3cfe5c0fe2a4cc53() { return handleError(function (arg0) {
    const ret = arg0.next();
    return ret;
}, arguments) };

export function __wbg_point3js_new(arg0) {
    const ret = Point3Js.__wrap(arg0);
    return ret;
};

export function __wbg_point3js_unwrap(arg0) {
    const ret = Point3Js.__unwrap(arg0);
    return ret;
};

export function __wbg_polygonjs_new(arg0) {
    const ret = PolygonJs.__wrap(arg0);
    return ret;
};

export function __wbg_polygonjs_unwrap(arg0) {
    const ret = PolygonJs.__unwrap(arg0);
    return ret;
};

export function __wbg_prototypesetcall_dfe9b766cdc1f1fd(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
};

export function __wbg_push_7d9be8f38fc13975(arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
};

export function __wbg_set_781438a03c0c3c81() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(arg0, arg1, arg2);
    return ret;
}, arguments) };

export function __wbg_value_57b7b035e117f7ee(arg0) {
    const ret = arg0.value;
    return ret;
};

export function __wbg_vector3js_new(arg0) {
    const ret = Vector3Js.__wrap(arg0);
    return ret;
};

export function __wbg_vertexjs_new(arg0) {
    const ret = VertexJs.__wrap(arg0);
    return ret;
};

export function __wbg_vertexjs_unwrap(arg0) {
    const ret = VertexJs.__unwrap(arg0);
    return ret;
};

export function __wbindgen_cast_2241b6af4c4b2941(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
};

export function __wbindgen_cast_4625c577ab2ec9ee(arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
};

export function __wbindgen_cast_9ae0607507abb057(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
};

export function __wbindgen_cast_d6cd19b81560fd6e(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
};

export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
};
