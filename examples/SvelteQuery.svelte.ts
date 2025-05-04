/* eslint-disable @typescript-eslint/no-explicit-any */
import { untrack } from 'svelte';
import { MemoryAdapter, StorageAdapter } from '../src/adapters.ts';
import {
	MutationClient,
	QueryClient,
	type MutationOptions as MO,
	type MutationResult as MR,
	type QueryOptions as QO
} from '../src/lib.ts';

export type Signal<T> = {
	current: T;
	get: () => T;
};

export function createSignal<T>(value: T): Signal<T> {
	let s = $state.raw(value);

	return {
		get: () => untrack(() => s),
		get current() {
			return s;
		},
		set current(v: T) {
			s = v;
		}
	};
}

export function createDeepSignal<T>(value: T): Signal<T> {
	let s = $state(value);

	return {
		get() {
			if (typeof s === 'object' && s !== null) {
				return $state.snapshot(s) as T;
			}
			return untrack(() => s);
		},
		get current() {
			return s;
		},
		set current(v: T) {
			s = v;
		}
	};
}

type QueryResult<T, U extends any[] = []> = Omit<QueryClient<T, U>, 'data' | 'loading'> & {
	data: Signal<T | undefined>;
	loading: Signal<boolean>;
};

type QueryOptions<T, Args extends any[] = []> = Omit<QO<T, Args>, 'cacheAdapter' | 'on'> & {
	deepSignal?: boolean;
};

const storageAdapter = new StorageAdapter();
function createQuery() {
	/** Query options
	 * keys: Array of keys to use for caching
	 * fn: Function to call to fetch data
	 * staleTime: Time in seconds to consider data stale
	 * cacheTime: Time in seconds to keep data in cache
	 * on: Callbacks for loading, success, error
	 * refetch: Options for refetching data on window focus and/or reconnect
	 * initial: Options for initial fetch
	 */
	function useQuery<T, Args extends any[] = []>(options: QueryOptions<T, Args>): QueryResult<T, Args> {
		const queryOptions = options as QO<T, Args>;
		queryOptions.cacheAdapter = storageAdapter;

		const loading = createSignal(options.initial?.manualFetch === true ? false : true);
		let data: Signal<T | undefined>;
		if (options.deepSignal === true) {
			data = createDeepSignal<T | undefined>(undefined);
		} else {
			data = createSignal<T | undefined>(undefined);
		}

		queryOptions.on = {
			success(res) {
				data.current = res;
			},
			loading(val) {
				loading.current = val;
			}
		};

		const q = new QueryClient(queryOptions);

		return {
			data,
			loading,
			get error() {
				return q.error;
			},
			fetch: (...args: Args) => q.fetch(...args),
			refresh: (...args: Args) => q.refresh(...args),
			updateKeys: (newKeys: Array<string>) => q.updateKeys(newKeys)
		};
	}

	return useQuery;
}

export const useQuery = createQuery();

type MutationOptions<T, Args> = Omit<MO<T, Args>, 'cacheAdapter' | 'on'> & {
	deepSignal?: boolean;
	onSuccess?: (variables: Args) => void;
};

type MutationResult<T, Args> = Omit<MR<T, Args>, 'loading' | 'error' | 'on' | 'initial'> & {
	loading: Signal<boolean>;
	error: Signal<Error | null>;
	state: Signal<T>;
};

function createReactiveMutator() {
	function useMutation<T>(value: T, options: MutationOptions<T, T>): MutationResult<T, T> {
		const mutationOptions = options as MO<T, T>;
		mutationOptions.cacheAdapter = new MemoryAdapter();

		let s: Signal<T>;
		if (options.deepSignal === true) {
			s = createDeepSignal(value);
		} else {
			s = createSignal(value);
		}
		const loading = createSignal(false);
		const error = createSignal<Error | null>(null);

		mutationOptions.on = {
			mutate(v) {
				if (typeof v === 'function') {
					s.current = (v as any)(s.current);
				} else {
					s.current = v;
				}
				return s.current;
			},
			loading(v) {
				loading.current = v;
			},
			error(e) {
				error.current = e;
			}
		};

		if (options.onSuccess) {
			mutationOptions.on.success = options.onSuccess;
		}

		const m = new MutationClient(value, mutationOptions);

		return {
			mutate: m.mutate.bind(m),
			state: s,
			loading,
			error
		};
	}

	return useMutation;
}

export const useMutation = createReactiveMutator();

type StoreOptions<T, Args extends any[]> = Omit<QueryOptions<T, Args>, 'fn'> &
	MutationOptions<T, T> & {
		query: QueryOptions<T, Args>['fn'];
	};

type StoreResult<T, Args extends any[]> = Omit<QueryResult<T, Args>, 'error' | 'updateKeys'> &
	Omit<MutationResult<T, T>, 'state'>;

export function useStore<T, Args extends any[] = []>(options: StoreOptions<T, Args>): StoreResult<T, Args> {
	let data: Signal<T | undefined>;
	if (options.deepSignal === true) {
		data = createDeepSignal(undefined);
	} else {
		data = createSignal(undefined);
	}

	const loading = createSignal(options.initial?.manualFetch === true ? false : true);
	const error = createSignal<Error | null>(null);

	const queryOptions: QO<T, Args> = Object.assign({}, options as any);
	queryOptions.cacheAdapter = storageAdapter;
	queryOptions.fn = options.query;

	queryOptions.on = {
		success(res: T) {
			data.current = res;
		},
		loading(val: boolean) {
			loading.current = val;
		}
	};

	const q = new QueryClient(queryOptions);

	const mutationOptions: MO<T, T> = Object.assign({}, options as any);
	mutationOptions.cacheAdapter = storageAdapter;

	mutationOptions.on = {
		mutate(v) {
			if (typeof v === 'function') {
				data.current = (v as any)(data.current);
			} else {
				data.current = v;
			}
			return data.current as T;
		},
		loading(v) {
			loading.current = v;
		},
		error(e, v) {
			if (v) {
				data.current = v;
			}
			error.current = e;
		}
	};

	if (options.onSuccess) {
		mutationOptions.on.success = options.onSuccess;
	}

	const m = new MutationClient(undefined, mutationOptions);

	return {
		data,
		error,
		loading,
		fetch: q.fetch.bind(q),
		mutate: m.mutate.bind(m),
		refresh: q.refresh.bind(q)
	};
}
