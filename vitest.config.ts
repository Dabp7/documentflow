import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { testTimeout: 60000, hookTimeout: 60000, env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://demo:demo@localhost:55432/documentflow_test', STORAGE_ROOT: '.data/test-storage' } } })
