import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { computeD1Filename, parseWranglerConfig } from "./connection/index.js";

export interface RunLocalMigrationsOptions {
  /** D1 binding name in the wrangler config (e.g. "DB", "APP_DB"). */
  bindingName: string;
  /** Project root holding the wrangler config + `.wrangler` state. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** drizzle-kit migrations folder. Defaults to `<projectRoot>/drizzle/migrations`. */
  migrationsFolder?: string;
  /** Progress logger. Defaults to `console.log`. */
  log?: (message: string) => void;
}

/**
 * Apply drizzle-kit migrations to the local miniflare D1 file for a binding.
 *
 * The file is named by hashing the binding's `database_id` — the exact name
 * miniflare (and the @cloudflare/vite-plugin dev server) uses — so the dev
 * server reads what this writes. Always targets that hashed name (never a stray
 * file) and creates it if missing. Honors `TEST_STATE_DIR` for test isolation.
 *
 * Requires the optional `better-sqlite3` + `drizzle-orm` peer deps.
 */
export function runLocalMigrations(options: RunLocalMigrationsOptions): void {
  const { bindingName, projectRoot = process.cwd(), log = console.log } = options;
  const migrationsFolder = options.migrationsFolder ?? join(projectRoot, "drizzle", "migrations");

  // Default: .wrangler/state/v3/...  •  TEST_STATE_DIR (--persist-to): <dir>/v3/... (no "state").
  const stateDir = process.env.TEST_STATE_DIR;
  const d1Dir = stateDir
    ? join(projectRoot, stateDir, "v3", "d1", "miniflare-D1DatabaseObject")
    : join(projectRoot, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  mkdirSync(d1Dir, { recursive: true });

  const dbConfig = parseWranglerConfig(projectRoot).d1_databases?.find((d) => d.binding === bindingName);
  if (!dbConfig) {
    throw new Error(`No D1 database binding '${bindingName}' found in wrangler config`);
  }

  const dbPath = join(d1Dir, computeD1Filename(dbConfig.database_id));
  log(`📂 Database: ${dbPath}`);

  const sqlite = new Database(dbPath);
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder });
    log("✅ Migrations applied successfully");
  } finally {
    sqlite.close();
  }
}
