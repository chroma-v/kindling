import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite "golden snapshot" utilities — node-only helpers for creating and
 * restoring self-contained database snapshots (e.g. for E2E test fixtures).
 *
 * Pairs with {@link computeD1Filename}/{@link parseWranglerConfig} so callers
 * can locate a miniflare D1 file and snapshot/restore it. Requires
 * `better-sqlite3` (an optional peer dependency); these run in node tooling
 * only, never in a Worker or browser bundle.
 */

export interface SnapshotVerify {
  /** A query selecting a single integer column aliased `count`. */
  countQuery: string;
  /** Minimum acceptable count (default 1). */
  min?: number;
}

/** Remove the `-wal` and `-shm` sidecar files for a SQLite database, if present. */
export function removeWalFiles(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/**
 * Checkpoint a database file's WAL into its main file and close it, so the
 * `.sqlite` file is self-contained and safe to copy without its sidecars.
 */
export function checkpointDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

/**
 * Count rows from a read-only query against a SQLite file. The query must
 * select a single integer column aliased `count`. Does not mutate WAL/SHM.
 */
export function countRows(dbPath: string, countQuery: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(countQuery).get() as { count: number } | undefined;
    return row?.count ?? 0;
  } finally {
    db.close();
  }
}

/**
 * Verify a snapshot by running a count query, then clean up any WAL/SHM files
 * created by opening it read-only. Returns the count.
 */
export function verifySnapshot(snapshotPath: string, countQuery: string): number {
  try {
    return countRows(snapshotPath, countQuery);
  } finally {
    removeWalFiles(snapshotPath);
  }
}

/** Delete an existing snapshot and its sidecars; ensure the parent dir exists. */
export function removeOldSnapshot(snapshotPath: string): void {
  const dir = dirname(snapshotPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(snapshotPath)) {
    rmSync(snapshotPath, { force: true });
    removeWalFiles(snapshotPath);
  }
}

export interface CreateSnapshotOptions {
  /** Verify the created snapshot has the expected data; throws if not. */
  verify?: SnapshotVerify;
}

/**
 * Create a self-contained snapshot of a live SQLite database.
 *
 * Checkpoints the source's WAL into its main file first (so the copy contains
 * all committed data without needing the `-wal` sidecar), removes any stale
 * snapshot, copies the main file, and optionally verifies the result.
 */
export function createSnapshot(sourceDbPath: string, snapshotPath: string, options: CreateSnapshotOptions = {}): void {
  if (!existsSync(sourceDbPath)) {
    throw new Error(`Cannot create snapshot: source database not found at ${sourceDbPath}`);
  }

  checkpointDatabase(sourceDbPath);
  removeOldSnapshot(snapshotPath);
  copyFileSync(sourceDbPath, snapshotPath);

  if (options.verify) {
    const { countQuery, min = 1 } = options.verify;
    const count = verifySnapshot(snapshotPath, countQuery);
    if (count < min) {
      throw new Error(
        `Snapshot verification failed: \`${countQuery}\` returned ${count} (expected >= ${min}).\n  Snapshot: ${snapshotPath}`,
      );
    }
  }
}

export interface RestoreSnapshotOptions {
  /** Reject the snapshot if smaller than this many bytes (corruption guard). */
  minBytes?: number;
  /** Verify the restored database after the swap; throws if not. */
  verify?: SnapshotVerify;
}

/**
 * Restore a snapshot onto a target database path atomically.
 *
 * Validates the snapshot exists (and meets `minBytes`), removes the target's
 * stale WAL/SHM, copies the snapshot to a uniquely-named temp file, then
 * atomically renames it into place — leaving no window where the target is
 * missing or half-written, and no chance of SQLite replaying a stale journal
 * against fresh data. Optionally verifies the restored data.
 */
export function restoreSnapshot(snapshotPath: string, targetPath: string, options: RestoreSnapshotOptions = {}): void {
  const { minBytes = 1, verify } = options;

  if (!existsSync(snapshotPath)) {
    throw new Error(`Cannot restore: snapshot not found at ${snapshotPath}`);
  }
  const size = statSync(snapshotPath).size;
  if (size < minBytes) {
    throw new Error(
      `Cannot restore: snapshot at ${snapshotPath} is ${size} bytes (expected >= ${minBytes}). Likely corrupt — recreate it.`,
    );
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  removeWalFiles(targetPath);

  // Copy to a uniquely-named temp file, then atomically swap. Unique suffix
  // avoids races between concurrent processes restoring the same target.
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  copyFileSync(snapshotPath, tmpPath);
  renameSync(tmpPath, targetPath);

  if (verify) {
    const { countQuery, min = 1 } = verify;
    const count = verifySnapshot(targetPath, countQuery);
    if (count < min) {
      throw new Error(
        `Restore verification failed: \`${countQuery}\` returned ${count} (expected >= ${min}).\n  Target: ${targetPath}`,
      );
    }
  }
}
