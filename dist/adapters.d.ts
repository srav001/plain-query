export type CacheAdapter = {
    get: (key: string) => Promise<any | undefined>;
    set: (key: string, value: any) => void;
    del: (key: string) => void;
};
export declare class MemoryAdapter implements CacheAdapter {
    private cache;
    get(key: string): Promise<any | undefined>;
    set(key: string, value: any): void;
    del(key: string): void;
}
export declare class StorageAdapter implements CacheAdapter {
    #private;
    constructor();
    get(key: string): Promise<any | undefined>;
    set(key: string, value: any): void;
    del(key: string): Promise<true>;
}
