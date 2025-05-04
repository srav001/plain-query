# Plain Query

A framework-agnostic, lightweight query client library built in TypeScript. Plain Query offers a simpler alternative to libraries like [@tanstack/query](https://tanstack.com/query) or [SWR](https://swr.vercel.app/), allowing for data fetching, caching, and state management across different frontend frameworks.

## Examples

Plain Query provides examples for popular frontend frameworks that can be copy pasted into your projects or can be used as a reference for your own implementation.

- [React Example](https://github.com/srav001/plain-query/blob/main/examples/ReactQuery.ts)
- [Vue Example](https://github.com/srav001/plain-query/blob/main/examples/VueQuery.ts)
- [Svelte Example](https://github.com/srav001/plain-query/blob/main/examples/SvelteQuery.svelte.ts)

## Table of Contents

- [Installation](#installation)
- [API Reference](#api-reference)
    - [QueryClient](#queryclient)
    - [MutationClient](#mutationclient)
    - [Adapters](#adapters)
        - [MemoryAdapter](#memoryadapter)
        - [StorageAdapter](#storageadapter)
- [Building](#building)
- [License](#license)

## Installation

```bash
# Using npm
npm install plain-query

# Using pnpm
pnpm add plain-query

# Using bun
bun add plain-query
```

## API Reference

### QueryClient

`QueryClient` is the core class for data fetching and caching.

```typescript
import { QueryClient, MemoryAdapter } from 'plain-query';

const client = new QueryClient({
	keys: ['users', 'list'],
	fn: async () => {
		const response = await fetch('https://api.example.com/users');
		return response.json();
	},
	cacheAdapter: new MemoryAdapter(),
	staleTime: 5, // Time in minutes
	cacheTime: 10, // Time in minutes
	on: {
		loading: (isLoading) => console.log('Loading:', isLoading),
		success: (data) => console.log('Data:', data),
		error: (error) => console.error('Error:', error)
	},
	refetch: {
		onWindowFocus: true,
		onReconnect: true
	},
	initial: {
		cacheFirst: true,
		manualFetch: false,
		alwaysFetch: false
	}
});

// Fetch data
client.fetch();

// Refresh data
client.refresh();

// Update query keys and fetch with new keys
client.updateKeys(['users', 'list', '1']).then((data) => {
	console.log('Updated data:', data);
});

// Access current state
console.log(client.data);
console.log(client.loading);
console.log(client.error);
```

### MutationClient

`MutationClient` is used for updating data.

```typescript
import { MutationClient, MemoryAdapter } from 'plain-query';

const userClient = new MutationClient(
	{ name: 'John', email: 'john@example.com' },
	{
		patch: async (user) => {
			const response = await fetch('https://api.example.com/users/1', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(user)
			});
			return response.json();
		},
		cacheAdapter: new MemoryAdapter(),
		cacheTime: 30, // Time in minutes
		keys: ['user', '1'],
		on: {
			loading: (isLoading) => console.log('Loading:', isLoading),
			error: (error, oldValue) => {
				console.error('Error:', error);
				console.log('Rolling back to:', oldValue);
			},
			mutate: (value) => {
				// Value can be a new object or a function
				return typeof value === 'function' ? value(currentValue) : value;
			},
			success: (updatedUser) => console.log('User updated:', updatedUser)
		}
	}
);

// Update with new object
userClient.mutate({ name: 'Jane', email: 'jane@example.com' });

// Update with function
userClient.mutate((user) => ({ ...user, email: 'new-email@example.com' }));

// Access current state
console.log(userClient.loading);
console.log(userClient.error);
```

### Adapters

#### MemoryAdapter

An in-memory cache implementation.

```typescript
import { MemoryAdapter } from 'plain-query';

const cache = new MemoryAdapter();

// Set a value
cache.set('key1', { data: 'value1' });

// Get a value
const value = await cache.get('key1');

// Delete a value
cache.del('key1');
```

#### StorageAdapter

A persistent cache implementation using IndexedDB via [keyval-db](https://www.npmjs.com/package/keyval-db).

```typescript
import { StorageAdapter } from 'plain-query';

const cache = new StorageAdapter();

// Set a value
cache.set('key1', { data: 'value1' });

// Get a value
const value = await cache.get('key1');

// Delete a value
cache.del('key1');
```

## Building

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Publish the package
pnpm pub
```

## License

MIT

---

_This README document was generated with AI assistance._
