import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "frizzle",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    // POOL_FAST: pure, stateless compiler tests — no vi.mock, no DB, no shared
    // mutable state — so worker threads can be reused across files for faster
    // startup. (Stateful suites must keep isolation: see app-unit/app-ui/graph.)
    pool: "threads",
    isolate: false,
    // Ratchet thresholds — floors sit a few points below measured coverage to
    // lock in the current level without breaking on noise. Only enforced under
    // `--coverage` (npm run test:coverage). Raise as coverage grows; never lower
    // silently.
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 88,
        branches: 80,
        functions: 88,
        lines: 88,
      },
    },
  },
});
