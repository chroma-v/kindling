/**
 * Node.js utilities for Sizzler.
 *
 * These utilities require Node.js APIs (fs, path) and should NOT be imported
 * in Cloudflare Workers or browser code.
 *
 * @example
 * ```ts
 * import {
 *   getLocalD1Path,
 *   createJSONSeeder,
 *   resetDatabase,
 * } from "sizzler/node";
 *
 * // Get local D1 database path
 * const dbPath = getLocalD1Path();
 *
 * // Create a JSON seeder
 * const seeder = createJSONSeeder({
 *   baseDir: "./seed-data",
 * });
 * ```
 */

// Connection helpers
export {
  computeD1Filename,
  getLocalD1Path,
  parseWranglerConfig,
  type WranglerConfig,
} from "./node/connection/index.js";

// D1 `batch()` for a better-sqlite3 Drizzle instance, so D1 code runs on a local SQLite file
export { attachD1BatchShim, type D1BatchTarget, type SqliteStatementRunner } from "./node/d1-batch-shim.js";

// Local migration runner (requires optional `better-sqlite3` + `drizzle-orm` peers)
export { type RunLocalMigrationsOptions, runLocalMigrations } from "./node/migrate.js";

// Seeding utilities
export { commonTransformers, createJSONSeeder, type JSONSeederOptions, resetDatabase } from "./node/seeding/index.js";

// Golden snapshot utilities (create / restore / verify SQLite snapshots).
// Requires the optional `better-sqlite3` peer dependency.
export {
  type CreateSnapshotOptions,
  checkpointDatabase,
  countRows,
  createSnapshot,
  type RestoreSnapshotOptions,
  removeOldSnapshot,
  removeWalFiles,
  restoreSnapshot,
  type SnapshotVerify,
  verifySnapshot,
} from "./node/snapshot/index.js";
