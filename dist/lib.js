const METRIC = 60000; // 1 minute in milliseconds
export function getCacheKey(key) {
    return key.join(':');
}
function check_ttl_for_cache(v, key, adapter) {
    if (!v) {
        return undefined;
    }
    try {
        const now = Date.now();
        if (v.expiry && v.expiry < now) {
            adapter.del(key);
            return undefined;
        }
        return v;
    }
    catch {
        return undefined;
    }
}
function add_ttl_for_cache(v, ttlMinutes = 5) {
    // Convert minutes to milliseconds when setting expiry
    return { value: v, expiry: Date.now() + ttlMinutes * METRIC };
}
const evntListners = new Map();
export class QueryClient {
    setupEventListeners() {
        if (this.refetch.onWindowFocus === true || this.refetch.onReconnect === true) {
            let listener = evntListners.get(this.currentKey);
            if (listener) {
                window.removeEventListener('focus', listener.focus);
                window.removeEventListener('online', listener.online);
            }
            listener = {
                focus: () => {
                    if (document.visibilityState === 'visible') {
                        this.refetchData(...this.lastArgs);
                    }
                },
                online: () => {
                    this.refetchData(...this.lastArgs);
                }
            };
            if (this.refetch.onWindowFocus === true) {
                window.addEventListener('focus', listener.focus);
            }
            if (this.refetch.onReconnect === true) {
                window.addEventListener('online', listener.online);
            }
            evntListners.set(this.currentKey, listener);
        }
    }
    async fetchData(type, ...args) {
        if (this.l) {
            return;
        }
        try {
            this.l = true;
            this.pending = true;
            this.on.loading(true);
            if (this.fetchedOnce === true) {
                if (type === 'refetch') {
                    if (this.options.staleTime !== undefined &&
                        Date.now() - this.lastFetchedTime < this.options.staleTime * METRIC) {
                        return;
                    }
                }
                else if (type === 'normal') {
                    if (this.isQueued === true) {
                        return;
                    }
                    if (await this.setFromCache()) {
                        return;
                    }
                }
            }
            else if (type === 'refetch') {
                return;
            }
            this.lastArgs = args;
            const fetchedData = await this.options.fn(...args);
            this.onData(fetchedData);
            this.options.cacheAdapter.set(this.currentKey, add_ttl_for_cache(fetchedData, this.options.cacheTime));
            this.setupStaleTimer();
            return this.d;
        }
        catch (err) {
            this.e = err instanceof Error ? err : new Error(String(err));
            this.on.error?.(this.e);
            return undefined;
        }
        finally {
            this.l = false;
            this.on.loading(false);
            this.setInitialFetch();
            this.processQ();
        }
    }
    constructor(options) {
        this.l = false;
        this.e = null;
        this.lastArgs = [];
        this.isQueued = false;
        this.lastFetchedTime = 0;
        this.fetchedOnce = false;
        this.q = new Set();
        this.pending = false;
        this.options = options;
        this.options.staleTime = options.staleTime ?? 30;
        this.options.cacheTime = options.cacheTime ?? 30;
        this.refetch = {
            onWindowFocus: options.refetch?.onWindowFocus ?? false,
            onReconnect: options.refetch?.onReconnect ?? true
        };
        this.initial = {
            value: options.initial?.value ?? undefined,
            cacheFirst: options.initial?.cacheFirst ?? true,
            alwaysFetch: options.initial?.alwaysFetch ?? true,
            manualFetch: options.initial?.manualFetch ?? false
        };
        this.on = {
            loading: options.on?.loading ?? (() => { }),
            error: options.on?.error ?? (() => { }),
            success: options.on?.success ?? (() => { })
        };
        this.currentKey = getCacheKey(options.keys);
        if (this.initial.value) {
            this.d = this.initial.value;
        }
        if (this.initial.cacheFirst === true) {
            this.pending = true;
            this.setFromCache().then((v) => {
                this.setupStaleTimer();
                if (this.initial.alwaysFetch === true) {
                    this.isQueued = false;
                }
                else if (v) {
                    this.setInitialFetch();
                }
                this.processQ();
            });
        }
        if (this.initial.manualFetch === false) {
            this.fetch(...this.lastArgs);
        }
        this.setupEventListeners();
    }
    setInitialFetch() {
        if (this.fetchedOnce === false) {
            this.fetchedOnce = true;
        }
    }
    onData(d) {
        this.d = d;
        this.e = null;
        this.on.success(d);
    }
    setData(d) {
        this.onData(d);
        this.on.loading(false);
        this.l = false;
    }
    async setFromCache() {
        let cachedData = await this.options.cacheAdapter.get(this.currentKey);
        if (cachedData) {
            if (this.initial.cacheFirst === true && this.fetchedOnce === false) {
                this.setData(cachedData.value);
            }
            else {
                cachedData = check_ttl_for_cache(cachedData, this.currentKey, this.options.cacheAdapter);
                if (cachedData) {
                    this.setData(cachedData.value);
                }
            }
        }
        return cachedData;
    }
    cleanupStaleTimer() {
        if (this.staleTimer !== undefined) {
            clearTimeout(this.staleTimer);
            this.staleTimer = undefined;
        }
    }
    setupStaleTimer() {
        this.lastFetchedTime = Date.now();
        this.cleanupStaleTimer();
        if (this.options.staleTime > 0) {
            this.isQueued = true;
            this.staleTimer = setTimeout(() => this.refresh(...this.lastArgs), this.options.staleTime * METRIC /* Convert minutes to milliseconds */);
        }
    }
    get data() {
        return this.d;
    }
    get error() {
        return this.e;
    }
    get loading() {
        return this.l;
    }
    add_to_pending_q(f) {
        return new Promise((rs, rj) => {
            this.q.add(() => f().then(rs).catch(rj));
        });
    }
    fetch(...args) {
        const fn = () => this.fetchData('normal', ...args);
        if (this.pending === true) {
            return this.add_to_pending_q(fn);
        }
        return fn();
    }
    refetchData(...args) {
        const fn = () => this.fetchData('refetch', ...args);
        if (this.pending === true) {
            return this.add_to_pending_q(fn);
        }
        return fn();
    }
    refresh(...args) {
        const fn = () => this.fetchData('refresh', ...args);
        if (this.pending === true) {
            return this.add_to_pending_q(fn);
        }
        return fn();
    }
    updateKeys(newKey) {
        const newGeneratedKey = getCacheKey(newKey);
        if (newGeneratedKey !== this.currentKey) {
            this.isQueued = false;
            this.currentKey = newGeneratedKey;
            this.d = undefined;
            this.e = null;
        }
        return (...args) => this.fetch(...args);
    }
    processQ() {
        this.pending = false;
        if (this.q.size > 0) {
            const fn = this.q.values().next().value;
            if (fn) {
                this.q.delete(fn);
                this.pending = true;
                fn();
            }
        }
    }
}
export class MutationClient {
    constructor(initial, options) {
        this.l = false;
        this.e = null;
        this.options = options;
        this.options.cacheTime = this.options.cacheTime ?? 30;
        this.cacheKey = this.options.keys ? getCacheKey(this.options.keys) : crypto.randomUUID();
        if (initial) {
            this.options.cacheAdapter.set(this.cacheKey, add_ttl_for_cache(initial, this.options.cacheTime));
        }
    }
    get loading() {
        return this.l;
    }
    get error() {
        return this.e;
    }
    mutate(value) {
        const { on, patch, cacheAdapter } = this.options;
        const v = on.mutate(value);
        this.l = true;
        on.loading?.(true);
        return new Promise((resolve, reject) => {
            patch(v)
                .then((res) => {
                cacheAdapter.set(this.cacheKey, add_ttl_for_cache(v, this.options.cacheTime));
                resolve(res);
                on.success?.(res);
            })
                .catch(async (err) => {
                this.e = err instanceof Error ? err : new Error(String(err));
                const cachedData = await cacheAdapter.get(this.cacheKey);
                // Attempt to get old value from cache to rollback
                if (cachedData) {
                    on.error(this.e, cachedData.value);
                }
                reject(err);
            })
                .finally(() => {
                this.l = false;
                on.loading?.(false);
            });
        });
    }
}
