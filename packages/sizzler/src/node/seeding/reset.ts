import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { reset } from "drizzle-seed";

/**
 * Reset database with enhanced error handling and logging.
 * Requires explicit confirmation to prevent accidental data loss.
 *
 * @param db - Drizzle database instance
 * @param schema - Database schema object
 * @param options - Configuration options
 *
 * @example
 * ```ts
 * import { resetDatabase } from "sizzler/node";
 *
 * await resetDatabase(db, schema, {
 *   confirm: true,
 *   verbose: true,
 * });
 * ```
 */
export async function resetDatabase(
  db: SQLiteAsyncDatabase<"sync" | "async", unknown>,
  schema: Record<string, unknown>,
  options: {
    confirm?: boolean;
    verbose?: boolean;
    logger?: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  } = {},
) {
  const { confirm = false, verbose = false, logger = console } = options;

  if (!confirm) {
    throw new Error("Database reset requires explicit confirmation. Set confirm: true");
  }

  try {
    if (verbose) {
      logger.log("Resetting database...");
    }

    await reset(db, schema);

    if (verbose) {
      logger.log("Database reset completed successfully.");
    }
  } catch (error) {
    if (verbose) {
      logger.error("Database reset failed:", error);
    }
    throw error;
  }
}
