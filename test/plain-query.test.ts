import assert from "node:assert/strict";
import { describe, test } from "node:test";
import "fake-indexeddb/auto";

import { MemoryAdapter, StorageAdapter } from "../src/adapters.ts";
import { MutationClient, QueryClient, getCacheKey } from "../src/lib.ts";

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 5;
  const endTime = Date.now() + timeoutMs;

  while (Date.now() < endTime) {
    if (await check()) {
      return;
    }

    await sleep(intervalMs);
  }

  assert.fail(`Timed out after ${timeoutMs}ms`);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function installFakeBrowser() {
  const previousWindow = (globalThis as Record<string, unknown>).window;
  const previousDocument = (globalThis as Record<string, unknown>).document;
  const listeners = new Map<string, Set<() => void>>();

  const fakeWindow = {
    addEventListener(type: string, listener: () => void) {
      const bucket = listeners.get(type) ?? new Set<() => void>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };

  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).document = { visibilityState: "visible" };

  return {
    window: fakeWindow,
    restore() {
      if (previousWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = previousWindow;
      }

      if (previousDocument === undefined) {
        delete (globalThis as Record<string, unknown>).document;
      } else {
        (globalThis as Record<string, unknown>).document = previousDocument;
      }
    },
  };
}

describe("helpers", () => {
  test("getCacheKey joins key segments", () => {
    assert.equal(getCacheKey(["users", "list", "1"]), "users:list:1");
  });
});

describe("adapters", () => {
  test("MemoryAdapter supports set/get/del/clear", async () => {
    const adapter = new MemoryAdapter();

    adapter.set("user:1", { value: "Alice" });
    assert.deepEqual(await adapter.get("user:1"), { value: "Alice" });

    adapter.del("user:1");
    assert.equal(await adapter.get("user:1"), undefined);

    adapter.set("user:2", { value: "Bob" });
    adapter.clear();
    assert.equal(await adapter.get("user:2"), undefined);
  });

  test("StorageAdapter persists values through indexedDB-compatible storage", async () => {
    const adapter = new StorageAdapter();

    await adapter.clear();
    adapter.set("settings", { theme: "light" });
    await waitFor(async () => (await adapter.get("settings"))?.theme === "light");
    assert.deepEqual(await adapter.get("settings"), { theme: "light" });

    await adapter.del("settings");
    await waitFor(async () => (await adapter.get("settings")) === undefined);

    adapter.set("settings", { theme: "dark" });
    await waitFor(async () => (await adapter.get("settings"))?.theme === "dark");
    await adapter.clear();
    await waitFor(async () => (await adapter.get("settings")) === undefined);
  });
});

describe("QueryClient", () => {
  test("fetches once and serves later fetches from cache", async () => {
    const adapter = new MemoryAdapter();
    const loadingEvents: boolean[] = [];
    const successEvents: string[] = [];
    let fetchCalls = 0;

    const client = new QueryClient({
      keys: ["users"],
      cacheAdapter: adapter,
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: (value) => loadingEvents.push(value),
        success: (value) => successEvents.push(value),
      },
      fn: async (id: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, false);
        fetchCalls += 1;
        return `user:${id}:${fetchCalls}`;
      },
    });

    assert.equal(await client.fetch("1"), "user:1:1");
    assert.equal(await client.fetch("1"), "user:1:1");
    assert.equal(fetchCalls, 1);
    assert.equal(client.data, "user:1:1");
    assert.deepEqual(loadingEvents, [true, false, true, false, false]);
    assert.deepEqual(successEvents, ["user:1:1", "user:1:1"]);
  });

  test("manualFetch prevents constructor-time execution", async () => {
    let fetchCalls = 0;

    new QueryClient({
      keys: ["manual"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (signal: AbortSignal) => {
        fetchCalls += 1;
        return signal.aborted;
      },
    });

    await sleep(20);
    assert.equal(fetchCalls, 0);
  });

  test("reads cached initial data without forcing a network request", async () => {
    const adapter = new MemoryAdapter();
    adapter.set(getCacheKey(["cached"]), {
      value: "cached value",
      expiry: Date.now() + 60_000,
    });

    let fetchCalls = 0;
    const client = new QueryClient({
      keys: ["cached"],
      cacheAdapter: adapter,
      staleTime: 0,
      initial: {
        cacheFirst: true,
        alwaysFetch: false,
        manualFetch: false,
      },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (_signal: AbortSignal) => {
        fetchCalls += 1;
        return "fresh value";
      },
    });

    await waitFor(() => client.data === "cached value");
    assert.equal(fetchCalls, 0);
    assert.equal(client.data, "cached value");
  });

  test("works in Node without browser globals even with default refetch settings", async () => {
    let fetchCalls = 0;
    const client = new QueryClient({
      keys: ["node-safe"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (signal: AbortSignal) => {
        fetchCalls += 1;
        return signal.aborted;
      },
    });

    assert.equal(await client.fetch(), false);
    assert.equal(fetchCalls, 1);
  });

  test("updateKeys swaps cache buckets without losing inference or old cache entries", async () => {
    let fetchCalls = 0;
    const client = new QueryClient({
      keys: ["user", "1"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (id: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, false);
        fetchCalls += 1;
        return { id, call: fetchCalls };
      },
    });

    assert.deepEqual(await client.fetch("1"), { id: "1", call: 1 });

    const fetchUser2 = client.updateKeys(["user", "2"]);
    assert.equal(client.data, undefined);
    assert.deepEqual(await fetchUser2("2"), { id: "2", call: 2 });

    const fetchUser1 = client.updateKeys(["user", "1"]);
    assert.deepEqual(await fetchUser1("1"), { id: "1", call: 1 });
    assert.equal(fetchCalls, 2);
  });

  test("request callback exposes the active fetch promise lifecycle", async () => {
    const requests: Array<Promise<string | undefined> | undefined> = [];

    const client = new QueryClient({
      keys: ["request"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
        request: (promise) => requests.push(promise as Promise<string | undefined> | undefined),
      },
      fn: async (id: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, false);
        return `value:${id}`;
      },
    });

    assert.equal(await client.fetch("1"), "value:1");
    assert.equal(requests.length, 2);
    assert.ok(requests[0] instanceof Promise);
    assert.equal(await requests[0], "value:1");
    assert.equal(requests[1], undefined);
  });

  test("refresh re-runs the query after the refresh guard window", async () => {
    let fetchCalls = 0;
    const client = new QueryClient({
      keys: ["refresh"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (_id: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, false);
        fetchCalls += 1;
        return `call:${fetchCalls}`;
      },
    });

    assert.equal(await client.fetch("1"), "call:1");
    await sleep(170);
    assert.equal(await client.refresh("1"), "call:2");
    assert.equal(fetchCalls, 2);
  });

  test("refresh fetches again immediately after an active request settles", async () => {
    let fetchCalls = 0;
    const activeFetch = createDeferred<string>();
    const client = new QueryClient({
      keys: ["refresh-immediate"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
      },
      fn: async (_id: string, signal: AbortSignal) => {
        assert.equal(signal.aborted, false);
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return activeFetch.promise;
        }
        return `call:${fetchCalls}`;
      },
    });

    const firstFetch = client.fetch("1");
    activeFetch.resolve("call:1");
    assert.equal(await firstFetch, "call:1");
    assert.equal(await client.refresh("1"), "call:2");
    assert.equal(fetchCalls, 2);
  });

  test("refresh aborts an in-flight request and replaces it with the queued call", async () => {
    const pending = new Map<string, ReturnType<typeof createDeferred<string>>>();
    const seenSignals = new Map<string, AbortSignal>();
    const errorEvents: Error[] = [];

    const client = new QueryClient({
      keys: ["abort"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
        error: (error) => errorEvents.push(error),
      },
      fn: (id: string, signal: AbortSignal) => {
        seenSignals.set(id, signal);
        const deferred = createDeferred<string>();
        pending.set(id, deferred);
        signal.addEventListener(
          "abort",
          () => deferred.reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        return deferred.promise;
      },
    });

    const firstFetch = client.fetch("first");
    await waitFor(() => seenSignals.has("first"));

    const replacementFetch = client.refresh("second");
    await waitFor(() => seenSignals.get("first")?.aborted === true);
    await waitFor(() => seenSignals.has("second"));

    pending.get("second")?.resolve("second-result");

    assert.equal(await firstFetch, undefined);
    assert.equal(await replacementFetch, "second-result");
    assert.equal(client.data, "second-result");
    assert.equal(errorEvents.length, 0);
  });

  test("request callback keeps the replacement fetch active during refresh replacement", async () => {
    const pending = new Map<string, ReturnType<typeof createDeferred<string>>>();
    const requests: Array<Promise<string | undefined> | undefined> = [];

    const client = new QueryClient({
      keys: ["request-replacement"],
      cacheAdapter: new MemoryAdapter(),
      staleTime: 0,
      initial: { manualFetch: true },
      on: {
        loading: () => {},
        success: () => {},
        request: (promise) => requests.push(promise as Promise<string | undefined> | undefined),
      },
      fn: (id: string, signal: AbortSignal) => {
        const deferred = createDeferred<string>();
        pending.set(id, deferred);
        signal.addEventListener(
          "abort",
          () => deferred.reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        return deferred.promise;
      },
    });

    const firstFetch = client.fetch("first");
    await waitFor(() => requests.length === 1);

    const replacementFetch = client.refresh("second");
    await waitFor(() => requests.length >= 2);

    const replacementPromise = requests[1];
    assert.ok(replacementPromise instanceof Promise);
    assert.notEqual(replacementPromise, requests[0]);
    assert.equal(requests.at(-1), replacementPromise);

    pending.get("second")?.resolve("second-result");

    assert.equal(await firstFetch, undefined);
    assert.equal(await replacementFetch, "second-result");
    assert.equal(requests.at(-1), undefined);
  });

  test("reconnect listener triggers a refetch when browser globals exist", async () => {
    const browser = installFakeBrowser();

    try {
      let fetchCalls = 0;
      const client = new QueryClient({
        keys: ["reconnect"],
        cacheAdapter: new MemoryAdapter(),
        staleTime: 0,
        initial: { manualFetch: true },
        refetch: {
          onReconnect: true,
          onWindowFocus: false,
        },
        on: {
          loading: () => {},
          success: () => {},
        },
        fn: async (id: string, signal: AbortSignal) => {
          assert.equal(signal.aborted, false);
          fetchCalls += 1;
          return `value:${id}:${fetchCalls}`;
        },
      });

      assert.equal(await client.fetch("1"), "value:1:1");
      browser.window.dispatch("online");
      await waitFor(() => client.data === "value:1:2");
      assert.equal(fetchCalls, 2);
    } finally {
      browser.restore();
    }
  });
});

describe("MutationClient", () => {
  test("mutate stores the optimistic value and reports the patch result on success", async () => {
    const adapter = new MemoryAdapter();
    const loadingEvents: boolean[] = [];
    const successEvents: Array<{ id: string; saved: boolean }> = [];

    const client = new MutationClient(
      { id: "1", name: "Alice" },
      {
        keys: ["user", "1"],
        cacheAdapter: adapter,
        on: {
          loading: (value) => loadingEvents.push(value),
          mutate: (value) => value,
          error: () => {
            assert.fail("mutation should not fail");
          },
          success: (value) => successEvents.push(value as { id: string; saved: boolean }),
        },
        patch: async (value: { id: string; name: string }) => ({
          id: value.id,
          saved: true,
        }),
      },
    );

    assert.deepEqual(await client.mutate({ id: "1", name: "Bob" }), { id: "1", saved: true });
    assert.equal(client.loading, false);
    assert.deepEqual(successEvents, [{ id: "1", saved: true }]);
    assert.deepEqual((await adapter.get("user:1"))?.value, { id: "1", name: "Bob" });
    assert.deepEqual(loadingEvents, [true, false]);
  });

  test("mutate surfaces rollback data from cache when patch fails", async () => {
    const adapter = new MemoryAdapter();
    const rollbackValues: Array<{ id: string; name: string } | undefined> = [];

    const client = new MutationClient(
      { id: "1", name: "Alice" },
      {
        keys: ["user", "1"],
        cacheAdapter: adapter,
        on: {
          loading: () => {},
          mutate: (value) => value,
          error: (error, oldValue) => {
            assert.equal(error.message, "write failed");
            rollbackValues.push(oldValue);
          },
        },
        patch: async () => {
          throw new Error("write failed");
        },
      },
    );

    await assert.rejects(client.mutate({ id: "1", name: "Bob" }), /write failed/);
    assert.equal(client.error?.message, "write failed");
    assert.deepEqual(rollbackValues, [{ id: "1", name: "Alice" }]);
  });
});
