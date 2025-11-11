/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref, ShallowRef, shallowRef, type Ref } from '@vue/reactivity';
import { MemoryAdapter, StorageAdapter } from '../src/adapters';
import {
	MutationClient,
	QueryClient,
	type MutationOptions as MO,
	type MutationResult as MR,
	type QueryOptions as QO
} from '../src/lib';

type QueryResult<T, U extends any[] = []> = Omit<QueryClient<T, U>, 'data' | 'loading'> & {
	data: Ref<T | undefined>;
	loading: ShallowRef<boolean>;
	activeFetch: ShallowRef<Promise<T | undefined> | undefined>;
};

type QueryOptions<T, Args extends any[] = []> = Omit<QO<T, Args>, 'cacheAdapter' | 'on'> & {
	deepSignal?: boolean;
};

const storageAdapter = new StorageAdapter();
function createQuery() {
	/** Query options
	 * keys: Array of keys to use for caching
	 * fn: Function to call to fetch data
	 * staleTime: Time in minutes to consider data stale
	 * cacheTime: Time in minutes to keep data in cache
	 * on: Callbacks for loading, success, error
	 * refetch: Options for refetching data on window focus and/or reconnect
	 * initial: Options for initial fetch
	 */
	function useQuery<T, Args extends any[] = []>(options: QueryOptions<T, Args>): QueryResult<T, Args> {
		const queryOptions = options as QO<T, Args>;
		queryOptions.cacheAdapter = storageAdapter;

		const loading = shallowRef(options.initial?.manualFetch === true ? false : true);
		const activeFetch = shallowRef<Promise<T | undefined> | undefined>(undefined);
		let data: Ref<T | undefined>;
		if (options.deepSignal === true) {
			data = ref(options.initial?.value) as Ref<T | undefined>;
		} else {
			data = shallowRef<T | undefined>(options.initial?.value);
		}

		queryOptions.on = {
			success(res) {
				data.value = res;
			},
			loading(val) {
				loading.value = val;
			},
			request(promise) {
				activeFetch.value = promise;
			}
		};

		const q = new QueryClient(queryOptions);

		return {
			data,
			loading,
			activeFetch,
			get error() {
				return q.error;
			},
			fetch: q.fetch.bind(q),
			refresh: q.refresh.bind(q),
			updateKeys: q.updateKeys.bind(q)
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
	loading: ShallowRef<boolean>;
	error: ShallowRef<Error | null>;
	state: Ref<T>;
};

function createReactiveMutator() {
	function useMutation<T>(value: T, options: MutationOptions<T, T>): MutationResult<T, T> {
		const mutationOptions = options as MO<T, T>;
		mutationOptions.cacheAdapter = new MemoryAdapter();

		let s: Ref<T>;
		if (options.deepSignal === true) {
			s = ref(value) as Ref<T>;
		} else {
			s = shallowRef(value);
		}
		const loading = shallowRef(false);
		const error = shallowRef<Error | null>(null);

		mutationOptions.on = {
			mutate(v) {
				if (typeof v === 'function') {
					s.value = (v as any)(s.value);
				} else {
					s.value = v;
				}
				return s.value;
			},
			loading(v) {
				loading.value = v;
			},
			error(e) {
				error.value = e;
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
	Omit<MutationResult<T, T>, 'state'> & {
		error: ShallowRef<Error | null>;
	};

export function useStore<T, Args extends any[] = []>(options: StoreOptions<T, Args>): StoreResult<T, Args> {
	let data: Ref<T | undefined>;
	if (options.deepSignal === true) {
		data = ref<T>();
	} else {
		data = shallowRef<T | undefined>(undefined);
	}

	const loading = shallowRef(options.initial?.manualFetch === true ? false : true);
	const activeFetch = shallowRef<Promise<T | undefined> | undefined>(undefined);
	const error = shallowRef<Error | null>(null);

	const queryOptions: QO<T, Args> = Object.assign({}, options as any);
	queryOptions.cacheAdapter = storageAdapter;
	queryOptions.fn = options.query;

	queryOptions.on = {
		success(res: T) {
			data.value = res;
		},
		loading(val: boolean) {
			loading.value = val;
		},
		request(promise) {
			activeFetch.value = promise;
		}
	};

	const q = new QueryClient(queryOptions);

	const mutationOptions: MO<T, T> = Object.assign({}, options as any);
	mutationOptions.cacheAdapter = storageAdapter;

	mutationOptions.on = {
		mutate(v) {
			if (typeof v === 'function') {
				data.value = (v as any)(data.value);
			} else {
				data.value = v;
			}
			return data.value as T;
		},
		loading(v) {
			loading.value = v;
		},
		error(e, v) {
			if (v) {
				data.value = v;
			}
			error.value = e;
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
		activeFetch,
		fetch: q.fetch.bind(q),
		mutate: m.mutate.bind(m),
		refresh: q.refresh.bind(q)
	};
}
