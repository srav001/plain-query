import { IDB } from 'keyval-db';

export type CacheAdapter = {
	get: (key: string) => Promise<any | undefined>;
	set: (key: string, value: any) => void;
	del: (key: string) => void;
};

export class MemoryAdapter implements CacheAdapter {
	private cache = new Map<string, { value: any; expiry: number }>();

	async get(key: string): Promise<any | undefined> {
		return this.cache.get(key);
	}

	set(key: string, value: any) {
		this.cache.set(key, value);
	}

	del(key: string) {
		this.cache.delete(key);
	}
}

export class StorageAdapter implements CacheAdapter {
	#idb: IDB;

	constructor() {
		this.#idb = new IDB('query', 'store');
	}

	get(key: string): Promise<any | undefined> {
		return this.#idb.get(key);
	}

	set(key: string, value: any) {
		this.#idb.set(key, value);
	}

	del(key: string) {
		return this.#idb.del(key);
	}
}
