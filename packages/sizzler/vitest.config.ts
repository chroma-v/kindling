import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "sizzler",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    // POOL_FAST: pure column-factory tests — no DB connection, no mocks, no
    // shared state — so worker threads can be reused across files. (Stateful
    // suites must keep isolation: see app-unit/app-ui/graph.)
    pool: "threads",
    isolate: false,
    // Ratchet thresholds — floors below measured coverage to lock in the current
    // level without breaking on noise. Only enforced under `--coverage`
    // (npm run test:coverage). Raise as coverage grows; never lower silently.
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 80,
        lines: 78,
      },
    },
  },
});
