var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _StorageAdapter_idb;
import { IDB } from 'keyval-db';
export class MemoryAdapter {
    constructor() {
        this.cache = new Map();
    }
    async get(key) {
        return this.cache.get(key);
    }
    set(key, value) {
        this.cache.set(key, value);
    }
    del(key) {
        this.cache.delete(key);
    }
}
export class StorageAdapter {
    constructor() {
        _StorageAdapter_idb.set(this, void 0);
        __classPrivateFieldSet(this, _StorageAdapter_idb, new IDB('query', 'store'), "f");
    }
    get(key) {
        return __classPrivateFieldGet(this, _StorageAdapter_idb, "f").get(key);
    }
    set(key, value) {
        __classPrivateFieldGet(this, _StorageAdapter_idb, "f").set(key, value);
    }
    del(key) {
        return __classPrivateFieldGet(this, _StorageAdapter_idb, "f").del(key);
    }
}
_StorageAdapter_idb = new WeakMap();
