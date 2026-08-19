import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the "@/*" path mapping in tsconfig.json. Set by hand rather than via
    // vite-tsconfig-paths, which is ESM-only and cannot be required by a CJS config.
    alias: [{ find: /^@\//, replacement: `${projectRoot}` }],
  },
  test: {
    globals: true,
    // Default to node: most of the suite covers pure logic and node:crypto.
    // Component suites opt into jsdom with a `@vitest-environment jsdom` docblock.
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['{lib,components,tests}/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'components/**/*.tsx'],
    },
  },
})
