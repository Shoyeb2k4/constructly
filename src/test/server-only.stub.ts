// Test stub for the `server-only` package. Next.js exposes `server-only` only
// under the react-server export condition, which Vitest/Vite doesn't resolve, so
// any module that transitively imports a "server-only" file would fail to load in
// tests. This empty module is aliased in place of it (see vitest.config.ts); the
// guarantee it provides is a build-time concern and irrelevant under test.
export {};
