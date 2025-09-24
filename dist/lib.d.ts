export type NotUndefined<T> = T extends undefined ? never : T;
export type CacheAdapter = {
    get: (key: string) => Promise<any | undefined>;
    set: (key: string, value: any) => void;
    del: (key: string) => void;
};
export declare function getCacheKey(key: Array<string>): string;
export interface QueryOptions<T, Args extends any[] = []> {
    keys: Array<string>;
    fn: (...args: Args) => Promise<T>;
    cacheAdapter: CacheAdapter;
    staleTime?: number;
    cacheTime?: number;
    on: {
        loading: (isLoading: boolean) => void;
        error?: (error: Error) => void;
        success: (data: T) => void;
    };
    refetch?: {
        onWindowFocus?: boolean;
        onReconnect?: boolean;
    };
    initial?: {
        value?: T | undefined;
        cacheFirst?: boolean;
        manualFetch?: boolean;
        alwaysFetch?: boolean;
    };
}
export declare class QueryClient<T, Args extends any[] = []> {
    private l;
    private d;
    private e;
    private currentKey;
    private lastArgs;
    private isQueued;
    private lastFetchedTime;
    private fetchedOnce;
    private staleTimer;
    private options;
    private initial;
    private refetch;
    private on;
    private q;
    private pending;
    private setupEventListeners;
    private fetchData;
    constructor(options: QueryOptions<T, Args>);
    private setInitialFetch;
    private onData;
    private setData;
    private setFromCache;
    private cleanupStaleTimer;
    private setupStaleTimer;
    get data(): T | undefined;
    get error(): Error | null;
    get loading(): boolean;
    private add_to_pending_q;
    fetch(...args: Args): Promise<T | undefined>;
    private refetchData;
    refresh(...args: Args): Promise<T | undefined>;
    updateKeys(newKey: Array<string>): (...args: Args) => Promise<T | undefined>;
    private processQ;
}
type Mutator<T> = (v: T) => T;
export type MutationOptions<T, V> = {
    patch: (v: V) => Promise<any>;
    cacheAdapter: CacheAdapter;
    cacheTime?: number;
    keys?: Array<string>;
    on: {
        loading?: (isLoading: boolean) => void;
        mutate: (v: V | Mutator<V>) => V;
        error: (error: Error, oldValue?: T) => void;
        success?: (variables: V) => void;
    };
};
export type MutationResult<T, V> = {
    mutate: (variables: V | Mutator<V>) => Promise<T | undefined>;
    loading: boolean;
    error: Error | null;
};
export declare class MutationClient<T, V> implements MutationResult<T, V> {
    private l;
    private e;
    private cacheKey;
    private options;
    constructor(initial: T | undefined, options: MutationOptions<T, V>);
    get loading(): boolean;
    get error(): Error | null;
    mutate(value: V | Mutator<V>): Promise<T | undefined>;
}
export {};
