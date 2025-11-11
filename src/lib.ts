export type NotUndefined<T> = T extends undefined ? never : T;

const METRIC = 60_000; // 1 minute in milliseconds

export type CacheAdapter = {
	get: (key: string) => Promise<any | undefined>;
	set: (key: string, value: any) => void;
	del: (key: string) => void;
};

export function getCacheKey(key: Array<string>): string {
	return key.join(':');
}

export interface QueryOptions<T, Args extends any[] = []> {
	keys: Array<string>;
	fn: (...args: Args) => Promise<T>;

	cacheAdapter: CacheAdapter;
	/* Time in minutes to consider data stale */
	staleTime?: number;
	/* Time in minutes to keep data in cache */
	cacheTime?: number;

	on: {
		loading: (isLoading: boolean) => void;
		error?: (error: Error) => void;
		success: (data: T) => void;
		request?: (promise: Promise<T | undefined> | undefined) => void;
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

type CacheItem = { value: any; expiry: number };

function check_ttl_for_cache(
	v: {
		value: any;
		expiry: number;
	},
	key: string,
	adapter: CacheAdapter
): CacheItem | undefined {
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
	} catch {
		return undefined;
	}
}

function add_ttl_for_cache(v: any, ttlMinutes = 5): CacheItem {
	// Convert minutes to milliseconds when setting expiry
	return { value: v, expiry: Date.now() + ttlMinutes * METRIC };
}

const evntListners = new Map<
	string,
	{
		focus: () => void;
		online: () => void;
	}
>();

export class QueryClient<T, Args extends any[] = []> {
	private l = false;
	private d: T | undefined;
	private e: Error | null = null;
	private currentKey: string;
	private lastArgs: Args = [] as unknown as Args;
	private isQueued = false;
	private lastFetchedTime = 0;
	private fetchedOnce = false;
	private staleTimer: number | undefined;
	private options: Omit<QueryOptions<T, Args>, 'initial' | 'refetch' | 'on'>;
	private initial: NotUndefined<QueryOptions<T, Args>['initial']>;
	private refetch: NotUndefined<QueryOptions<T, Args>['refetch']>;
	private on: NotUndefined<QueryOptions<T, Args>['on']>;
	private q: Set<() => any> = new Set();
	private pending = false;

	private setupEventListeners(): void {
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

	private async fetchData(type: 'initial' | 'refresh' | 'refetch' | 'normal', ...args: Args): Promise<T | undefined> {
		if (this.l) {
			return;
		}

		const fetchPromise = (async () => {
			try {
				this.l = true;
				this.pending = true;
				this.on.loading(true);

				if (this.fetchedOnce === true) {
					if (type === 'refetch') {
						if (
							this.options.staleTime !== undefined &&
							Date.now() - this.lastFetchedTime < this.options.staleTime * METRIC
						) {
							return;
						}
					} else if (type === 'normal') {
						if (this.isQueued === true) {
							return;
						}

						if (await this.setFromCache()) {
							return;
						}
					}
				} else if (type === 'refetch') {
					return;
				}

				this.lastArgs = args;
				const fetchedData = await this.options.fn(...args);

				this.onData(fetchedData);
				this.options.cacheAdapter.set(this.currentKey, add_ttl_for_cache(fetchedData, this.options.cacheTime));

				this.setupStaleTimer();

				return this.d;
			} catch (err) {
				this.e = err instanceof Error ? err : new Error(String(err));
				this.on.error?.(this.e);
				return undefined;
			} finally {
				this.l = false;
				this.on.loading(false);
				this.setInitialFetch();
				this.processQ();
			}
		})();

		this.on.request?.(fetchPromise);

		try {
			return await fetchPromise;
		} finally {
			this.on.request?.(undefined);
		}
	}

	constructor(options: QueryOptions<T, Args>) {
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
			loading: options.on?.loading ?? (() => {}),
			error: options.on?.error ?? (() => {}),
			success: options.on?.success ?? (() => {}),
			request: options.on?.request ?? (() => {})
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
				} else if (v) {
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

	private setInitialFetch(): void {
		if (this.fetchedOnce === false) {
			this.fetchedOnce = true;
		}
	}

	private onData(d: T): void {
		this.d = d;
		this.e = null;
		this.on.success(d);
	}

	private setData(d: T): void {
		this.onData(d);
		this.on.loading(false);
		this.l = false;
	}

	private async setFromCache(): Promise<CacheItem | undefined> {
		let cachedData: CacheItem | undefined = await this.options.cacheAdapter.get(this.currentKey);
		if (cachedData) {
			if (this.initial.cacheFirst === true && this.fetchedOnce === false) {
				this.setData(cachedData.value);
			} else {
				cachedData = check_ttl_for_cache(cachedData, this.currentKey, this.options.cacheAdapter);
				if (cachedData) {
					this.setData(cachedData.value);
				}
			}
		}

		return cachedData;
	}

	private cleanupStaleTimer(): void {
		if (this.staleTimer !== undefined) {
			clearTimeout(this.staleTimer);
			this.staleTimer = undefined;
		}
	}

	private setupStaleTimer(): void {
		this.lastFetchedTime = Date.now();
		this.cleanupStaleTimer();

		if (this.options.staleTime! > 0) {
			this.isQueued = true;
			this.staleTimer = setTimeout(
				() => this.refresh(...this.lastArgs),
				this.options.staleTime! * METRIC /* Convert minutes to milliseconds */
			);
		}
	}

	public get data(): T | undefined {
		return this.d;
	}

	public get error(): Error | null {
		return this.e;
	}

	public get loading(): boolean {
		return this.l;
	}

	private add_to_pending_q(f: () => Promise<T | undefined>): ReturnType<typeof f> {
		return new Promise((rs, rj) => {
			this.q.add(() => f().then(rs).catch(rj));
		});
	}

	public fetch(...args: Args): Promise<T | undefined> {
		const fn = () => this.fetchData('normal', ...args);
		if (this.pending === true) {
			return this.add_to_pending_q(fn);
		}
		return fn();
	}

	private refetchData(...args: Args): Promise<T | undefined> {
		const fn = () => this.fetchData('refetch', ...args);
		if (this.pending === true) {
			return this.add_to_pending_q(fn);
		}
		return fn();
	}

	public refresh(...args: Args): Promise<T | undefined> {
		const fn = async () => {
			if (Date.now() - this.lastFetchedTime < 150) {
				return undefined;
			}

			return await this.fetchData('refresh', ...args);
		};
		if (this.pending === true) {
			return this.add_to_pending_q(fn);
		}
		return fn();
	}

	public updateKeys(newKey: Array<string>): (...args: Args) => Promise<T | undefined> {
		const newGeneratedKey = getCacheKey(newKey);

		if (newGeneratedKey !== this.currentKey) {
			this.isQueued = false;
			this.currentKey = newGeneratedKey;

			this.d = undefined;
			this.e = null;
		}
		return (...args: Args) => this.fetch(...args);
	}

	private processQ(): void {
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

export class MutationClient<T, V> implements MutationResult<T, V> {
	private l = false;
	private e: Error | null = null;
	private cacheKey: string;
	private options: MutationOptions<T, V> & {};

	constructor(initial: T | undefined, options: MutationOptions<T, V>) {
		this.options = options;
		this.options.cacheTime = this.options.cacheTime ?? 30;

		this.cacheKey = this.options.keys ? getCacheKey(this.options.keys) : crypto.randomUUID();
		if (initial) {
			this.options.cacheAdapter.set(this.cacheKey, add_ttl_for_cache(initial, this.options.cacheTime));
		}
	}

	public get loading(): boolean {
		return this.l;
	}

	public get error(): Error | null {
		return this.e;
	}

	public mutate(value: V | Mutator<V>): Promise<T | undefined> {
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

					const cachedData: CacheItem | undefined = await cacheAdapter.get(this.cacheKey);
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
