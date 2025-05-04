import { useRef, useSyncExternalStore } from 'react';
import { MemoryAdapter, StorageAdapter } from '../src/adapters';
import {
	MutationClient,
	QueryClient,
	type MutationOptions as MO,
	type MutationResult as MR,
	type QueryOptions as QO
} from '../src/lib';

// Generic mini observable for useSyncExternalStore
function createValueStore<T>(initial: T) {
	let current = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => current,
		set: (v: T) => {
			current = v;
			listeners.forEach((fn) => fn());
		},
		subscribe: (cb: () => void) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		}
	};
}

type QueryResult<T, Args extends any[] = []> = Omit<QueryClient<T, Args>, 'data' | 'loading'> & {
	data: T | undefined;
	loading: boolean;
	error: Error | null;
};

type QueryOptions<T, Args extends any[] = []> = Omit<QO<T, Args>, 'cacheAdapter' | 'on'>;
const storageAdapter = new StorageAdapter();

function useQuery<T, Args extends any[] = []>(options: QueryOptions<T, Args>): QueryResult<T, Args> {
	const dataStore = useRef(createValueStore<T | undefined>(undefined));
	const loadingStore = useRef(createValueStore(options.initial?.manualFetch === true ? false : true));
	const errorStore = useRef(createValueStore<Error | null>(null));

	const queryOptions = { ...options } as QO<T, Args>;
	queryOptions.cacheAdapter = storageAdapter;
	queryOptions.on = {
		success(res: T) {
			dataStore.current.set(res);
			errorStore.current.set(null);
		},
		loading(val: boolean) {
			loadingStore.current.set(val);
		},
		error(e: Error) {
			errorStore.current.set(e);
		}
	};

	const clientRef = useRef<QueryClient<T, Args>>(undefined);
	if (!clientRef.current) {
		clientRef.current = new QueryClient(queryOptions);
	}
	const q = clientRef.current;

	const data = useSyncExternalStore(dataStore.current.subscribe, dataStore.current.get);
	const loading = useSyncExternalStore(loadingStore.current.subscribe, loadingStore.current.get);
	const error = useSyncExternalStore(errorStore.current.subscribe, errorStore.current.get);

	return {
		get error() {
			return error;
		},
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		fetch: q.fetch.bind(q),
		refresh: q.refresh.bind(q),
		updateKeys: q.updateKeys.bind(q)
	} as QueryResult<T, Args>;
}

type MutationOptions<T, Args> = Omit<MO<T, Args>, 'cacheAdapter' | 'on'> & {
	onSuccess?: (variables: Args) => void;
};
type MutationResult<T, Args> = Omit<MR<T, Args>, 'loading' | 'error' | 'on' | 'initial'> & {
	state: T;
	loading: boolean;
	error: Error | null;
};

function useMutation<T>(value: T, options: MutationOptions<T, T>): MutationResult<T, T> {
	const loadingStore = useRef(createValueStore(false));
	const errorStore = useRef(createValueStore<Error | null>(null));
	const stateStore = useRef(createValueStore(value));

	const mutationOptions = { ...options } as MO<T, T>;
	mutationOptions.cacheAdapter = new MemoryAdapter();
	mutationOptions.on = {
		mutate(v) {
			if (typeof v === 'function') {
				const updater = v as any;
				stateStore.current.set(updater(stateStore.current.get()));
			} else {
				stateStore.current.set(v);
			}
			return stateStore.current.get();
		},
		loading(v) {
			loadingStore.current.set(v);
		},
		error(e) {
			errorStore.current.set(e);
		}
	};
	if (options.onSuccess) {
		mutationOptions.on.success = options.onSuccess;
	}

	const clientRef = useRef<MutationClient<T, T>>(undefined);
	if (!clientRef.current) {
		clientRef.current = new MutationClient(value, mutationOptions);
	}
	const m = clientRef.current;

	const loading = useSyncExternalStore(loadingStore.current.subscribe, loadingStore.current.get);
	const error = useSyncExternalStore(errorStore.current.subscribe, errorStore.current.get);
	const state = useSyncExternalStore(stateStore.current.subscribe, stateStore.current.get);

	return {
		mutate: m.mutate.bind(m),
		get state() {
			return state;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		}
	};
}

type StoreOptions<T, Args extends any[]> = Omit<QueryOptions<T, Args>, 'fn'> &
	MutationOptions<T, T> & {
		query: QueryOptions<T, Args>['fn'];
	};
type StoreResult<T, Args extends any[]> = Omit<ReturnType<typeof useQuery<T, Args>>, 'error' | 'updateKeys'> &
	Omit<ReturnType<typeof useMutation<T>>, 'state'> & {
		error: Error | null;
		loading: boolean;
		data: T | undefined;
	};

function useStore<T, Args extends any[] = []>(options: StoreOptions<T, Args>): StoreResult<T, Args> {
	const dataStore = useRef(createValueStore<T | undefined>(undefined));
	const loadingStore = useRef(createValueStore(options.initial?.manualFetch === true ? false : true));
	const errorStore = useRef(createValueStore<Error | null>(null));

	const queryOptions: QO<T, Args> = { ...(options as any) };
	queryOptions.cacheAdapter = storageAdapter;
	queryOptions.fn = options.query;
	queryOptions.on = {
		success(res: T) {
			dataStore.current.set(res);
			errorStore.current.set(null);
		},
		loading(val: boolean) {
			loadingStore.current.set(val);
		},
		error(e: Error) {
			errorStore.current.set(e);
		}
	};

	const qRef = useRef<QueryClient<T, Args>>(undefined);
	if (!qRef.current) {
		qRef.current = new QueryClient(queryOptions);
	}
	const q = qRef.current;

	const mutationOptions: MO<T, T> = { ...(options as any) };
	mutationOptions.cacheAdapter = storageAdapter;
	mutationOptions.on = {
		mutate(v) {
			if (typeof v === 'function') {
				dataStore.current.set((v as any)(dataStore.current.get()));
			} else {
				dataStore.current.set(v);
			}
			return dataStore.current.get();
		},
		loading(v) {
			loadingStore.current.set(v);
		},
		error(e, v) {
			if (v) {
				dataStore.current.set(v);
			}
			errorStore.current.set(e);
		}
	};
	if (options.onSuccess) {
		mutationOptions.on.success = options.onSuccess;
	}
	const mRef = useRef<MutationClient<T, T>>(undefined);
	if (!mRef.current) {
		mRef.current = new MutationClient(undefined, mutationOptions);
	}
	const m = mRef.current;

	const loading = useSyncExternalStore(loadingStore.current.subscribe, loadingStore.current.get);
	const error = useSyncExternalStore(errorStore.current.subscribe, errorStore.current.get);
	const data = useSyncExternalStore(dataStore.current.subscribe, dataStore.current.get);

	return {
		data,
		error,
		loading,
		fetch: q.fetch.bind(q),
		mutate: m.mutate.bind(m),
		refresh: q.refresh.bind(q)
	};
}

// Named exports
export { useMutation, useQuery, useStore };
