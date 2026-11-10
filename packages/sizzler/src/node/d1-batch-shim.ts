/**
 * The slice of a better-sqlite3 `Database` the shim uses. Structural, so this
 * module needs no better-sqlite3 types at runtime or compile time.
 */
export interface SqliteStatementRunner {
  prepare(sql: string): { run(): unknown };
  readonly inTransaction: boolean;
}

/**
 * The Drizzle database that receives `batch()`, recognized by its query entry
 * points. Structural, so this module doesn't depend on Drizzle's class layout.
 */
export interface D1BatchTarget {
  select: unknown;
  insert: unknown;
}

/**
 * Give a better-sqlite3 Drizzle instance D1's `db.batch([...])`.
 *
 * Code written against D1 calls `db.batch()` for atomic multi-statement
 * writes. better-sqlite3's Drizzle driver has no `batch`, so the same code
 * can't run on a local SQLite file (an Electron app, a Node entry, tests)
 * without it. This attaches one with D1's semantics: the statements run in
 * order inside one transaction, the results come back in order, and if any
 * statement throws, everything rolls back and the error propagates.
 *
 * Drizzle query builders are thenables, so awaiting each one inside
 * BEGIN/COMMIT executes it in the transaction. Pass the same `sqlite` handle
 * the Drizzle instance was created with.
 *
 * Batches on one `db` are queued and run one at a time, as on D1. Queries
 * outside `batch()` are not, and can run inside an open batch's transaction.
 * See packages/sizzler/docs/node-utilities.md#concurrency.
 *
 * Mutates `db`. Call once, right after creating it.
 */
export function attachD1BatchShim(db: D1BatchTarget, sqlite: SqliteStatementRunner): void {
  const runBatch = async (statements: readonly PromiseLike<unknown>[]): Promise<unknown[]> => {
    sqlite.prepare("BEGIN").run();
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement);
      }
      sqlite.prepare("COMMIT").run();
      return results;
    } catch (err) {
      // Some errors make SQLite roll back on its own; a second ROLLBACK would
      // throw and hide `err`.
      if (sqlite.inTransaction) {
        sqlite.prepare("ROLLBACK").run();
      }
      throw err;
    }
  };

  // The tail of the queue: settles when the last batch handed in has finished.
  let idle: Promise<unknown> = Promise.resolve();
  Object.assign(db, {
    batch: (statements: readonly PromiseLike<unknown>[]): Promise<unknown[]> => {
      const run = idle.then(() => runBatch(statements));
      idle = run.catch(() => undefined); // one batch's failure doesn't block the next
      return run;
    },
  });
}
