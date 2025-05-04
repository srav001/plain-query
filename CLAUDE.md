# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- Build: `pnpm build` (runs TypeScript compiler)
- Publish:`pnpm pub` (builds and publishes package)
- Test: No test command available yet

## Code Style Guidelines

- **TypeScript**: Strict type checking enabled with noImplicitAny, strictNullChecks
- **Formatting**: Code uses Prettier with organize-imports plugin
- **Naming**:
    - Use camelCase for variables, functions (getCacheKey)
    - Use PascalCase for classes, interfaces (QueryClient, QueryOptions)
    - Private variables use single letter prefixes (l, d, e) or # prefix (#idb)
- **Error Handling**: Try-catch blocks with proper error wrapping
- **Types**: Always define explicit return types and parameters
- **Imports**: Organize imports alphabetically, group by external/internal
- **Patterns**: Functional adapters pattern, separation of concerns
- **Comments**: Minimal comments, only for unclear code sections

This project is a lightweight query client for various front-end frameworks.
