import { createHash, createHmac } from "crypto";
import { readdirSync } from "fs";
import { join } from "path";
import { parseWranglerConfig } from "./wrangler-config.js";

/**
 * Compute the SQLite filename that miniflare uses for a D1 database.
 *
 * ## Why this exists
 *
 * Miniflare (Cloudflare's local dev runtime) stores each D1 database as a
 * SQLite file with a hashed name — NOT the human-readable `database_id` from
 * `wrangler.jsonc`. Without this function, scripts that need to create or
 * locate the database file (migrations, golden DB restore, golden DB create)
 * would have to start a dev server first and scan the directory for whatever
 * file appeared — which is fragile and slow.
 *
 * ## How the hash works
 *
 * Miniflare's `durableObjectNamespaceIdFromName()` algorithm:
 *
 * 1. Derive a `key` by SHA-256 hashing the Durable Object unique key
 *    (always `"miniflare-D1DatabaseObject"` for D1).
 * 2. HMAC-SHA256 the `database_id` with that key, take the first 16 bytes
 *    → this is the `nameHmac` (identifies the namespace + name).
 * 3. HMAC-SHA256 the `nameHmac` with the same key, take the first 16 bytes
 *    → this is the `hmac` (integrity check).
 * 4. Concatenate `nameHmac + hmac` (32 bytes) and hex-encode → 64-char filename.
 * 5. Append `.sqlite`.
 *
 * For our `database_id: "3c9d1256-e9bd-4617-ad46-22315915a680"`, this always
 * produces: `feed28b9d46e13dcb8b4ff9ebe14a54b3b84fc08efd83b1de4251b30f50c9f10.sqlite`
 *
 * ## Where it's used
 *
 * - `drizzle/migrate-local.ts` — creates the DB file with the correct name
 * - `scripts/golden-db-restore.ts` — copies snapshot to the correct filename
 * - `scripts/golden-db-create.ts` — finds the DB file to snapshot
 * - `getLocalD1Path()` below — locates the DB file for seed scripts
 *
 * @param databaseId - The `database_id` from wrangler.jsonc
 * @returns The hashed filename (e.g., `feed28b9...sqlite`)
 *
 * @see https://github.com/cloudflare/workers-sdk — miniflare source
 */
export function computeD1Filename(databaseId: string): string {
  // Step 1: Derive key from the D1 Durable Object namespace identifier
  const uniqueKey = "miniflare-D1DatabaseObject";
  const key = createHash("sha256").update(uniqueKey).digest();

  // Step 2: HMAC the database_id to get the namespace identifier (first 16 bytes)
  const nameHmac = createHmac("sha256", key).update(databaseId).digest().subarray(0, 16);

  // Step 3: HMAC the nameHmac for an integrity suffix (first 16 bytes)
  const hmac = createHmac("sha256", key).update(nameHmac).digest().subarray(0, 16);

  // Step 4-5: Concatenate and hex-encode → 64-char filename + .sqlite
  return Buffer.concat([nameHmac, hmac]).toString("hex") + ".sqlite";
}

/**
 * Get the local D1 database file path for development or testing.
 *
 * By default, looks in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`.
 * When TEST_STATE_DIR is set (e.g., TEST_STATE_DIR=.wrangler-test), looks there instead.
 *
 * @param bindingName - The D1 binding name from wrangler.json (default: "DB")
 * @param projectRoot - Project root directory (default: process.cwd())
 * @returns The absolute path to the SQLite database file
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { drizzle } from "drizzle-orm/better-sqlite3";
 * import { getLocalD1Path } from "sizzler/node";
 *
 * const dbPath = getLocalD1Path();
 * const sqlite = new Database(dbPath);
 * const db = drizzle({ client: sqlite });
 * ```
 */
export function getLocalD1Path(bindingName = "DB", projectRoot: string = process.cwd()): string {
  // Allow override via environment variable for test isolation
  const stateDir = process.env.TEST_STATE_DIR;

  // Parse wrangler.json to get database_id
  const wranglerConfig = parseWranglerConfig(projectRoot);

  const dbConfig = wranglerConfig.d1_databases?.find((d) => d.binding === bindingName);
  if (!dbConfig) {
    throw new Error(`Database binding '${bindingName}' not found in wrangler.json/wrangler.jsonc`);
  }

  // Find the SQLite file (local D1 uses different IDs than production)
  // Note: Default wrangler uses .wrangler/state/v3/d1/...
  //       But --persist-to uses <dir>/v3/d1/... (no "state" subdirectory)
  const d1Dir = stateDir
    ? join(projectRoot, `${stateDir}/v3/d1/miniflare-D1DatabaseObject`)
    : join(projectRoot, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

  // Compute the deterministic filename miniflare uses
  const expectedFilename = computeD1Filename(dbConfig.database_id);
  const expectedPath = join(d1Dir, expectedFilename);

  try {
    const files = readdirSync(d1Dir).filter((file) => file.endsWith(".sqlite"));

    if (files.length === 0) {
      throw new Error(`No D1 database found in ${d1Dir}. Run migrations first (npm run db:migrate).`);
    }

    // Prefer the computed miniflare filename
    if (files.includes(expectedFilename)) {
      return expectedPath;
    }

    // Fall back to first SQLite file (e.g., during migration)
    return join(d1Dir, files[0]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("No D1 database")) {
      throw error;
    }
    throw new Error(`No D1 database directory found at ${d1Dir}. Run migrations first (npm run db:migrate).`);
  }
}
