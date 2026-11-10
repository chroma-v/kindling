import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkpointDatabase,
  countRows,
  createSnapshot,
  removeOldSnapshot,
  removeWalFiles,
  restoreSnapshot,
  verifySnapshot,
} from "./snapshot.js";

const COUNT_USERS = "SELECT COUNT(*) as count FROM users";

let dir: string;

/** Create a WAL-mode SQLite db at `path` seeded with `rows` users (replaces any existing file). */
function makeDb(path: string, rows: number): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.prepare("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)").run();
  const insert = db.prepare("INSERT INTO users (name) VALUES (?)");
  for (let i = 0; i < rows; i++) {
    insert.run(`user-${i}`);
  }
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sizzler-snapshot-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshot create/restore round-trip", () => {
  it("creates a verified snapshot and restores it to a fresh target", () => {
    const source = join(dir, "source.sqlite");
    const golden = join(dir, "out", "golden.sqlite");
    const target = join(dir, "restored", "target.sqlite");
    makeDb(source, 3);

    createSnapshot(source, golden, { verify: { countQuery: COUNT_USERS, min: 3 } });
    expect(existsSync(golden)).toBe(true);
    expect(countRows(golden, COUNT_USERS)).toBe(3);

    restoreSnapshot(golden, target, { verify: { countQuery: COUNT_USERS, min: 3 } });
    expect(countRows(target, COUNT_USERS)).toBe(3);
  });

  it("checkpoints WAL into the main file so the snapshot is self-contained", () => {
    const source = join(dir, "wal.sqlite");
    makeDb(source, 2);
    // Re-open and write to leave data in the WAL, then close.
    const db = new Database(source);
    db.prepare("INSERT INTO users (name) VALUES (?)").run("late");
    db.close();

    const golden = join(dir, "golden.sqlite");
    createSnapshot(source, golden);
    // The copied main file alone (no sidecars) must contain all 3 rows.
    expect(countRows(golden, COUNT_USERS)).toBe(3);
  });

  it("overwrites an existing snapshot", () => {
    const source = join(dir, "s.sqlite");
    const golden = join(dir, "g.sqlite");
    makeDb(source, 1);
    createSnapshot(source, golden);
    makeDb(source, 5); // recreate source with different data
    createSnapshot(source, golden);
    expect(countRows(golden, COUNT_USERS)).toBe(5);
  });
});

describe("createSnapshot errors", () => {
  it("throws when the source database is missing", () => {
    expect(() => createSnapshot(join(dir, "nope.sqlite"), join(dir, "g.sqlite"))).toThrow(/source database not found/);
  });

  it("throws when verification falls below the minimum", () => {
    const source = join(dir, "s.sqlite");
    makeDb(source, 1);
    expect(() =>
      createSnapshot(source, join(dir, "g.sqlite"), { verify: { countQuery: COUNT_USERS, min: 2 } }),
    ).toThrow(/verification failed/);
  });
});

describe("restoreSnapshot errors", () => {
  it("throws when the snapshot is missing", () => {
    expect(() => restoreSnapshot(join(dir, "nope.sqlite"), join(dir, "t.sqlite"))).toThrow(/snapshot not found/);
  });

  it("throws when the snapshot is smaller than minBytes (corruption guard)", () => {
    const tiny = join(dir, "tiny.sqlite");
    writeFileSync(tiny, "x");
    expect(() => restoreSnapshot(tiny, join(dir, "t.sqlite"), { minBytes: 1024 })).toThrow(/Likely corrupt/);
  });

  it("throws when restore verification falls below the minimum", () => {
    const source = join(dir, "s.sqlite");
    const golden = join(dir, "g.sqlite");
    makeDb(source, 1);
    createSnapshot(source, golden);
    expect(() =>
      restoreSnapshot(golden, join(dir, "t.sqlite"), { verify: { countQuery: COUNT_USERS, min: 9 } }),
    ).toThrow(/Restore verification failed/);
  });
});

describe("primitives", () => {
  it("removeWalFiles is a no-op when sidecars are absent", () => {
    expect(() => removeWalFiles(join(dir, "absent.sqlite"))).not.toThrow();
  });

  it("checkpointDatabase merges WAL on a clean file", () => {
    const path = join(dir, "c.sqlite");
    makeDb(path, 1);
    checkpointDatabase(path);
    expect(countRows(path, COUNT_USERS)).toBe(1);
  });

  it("verifySnapshot returns the count and cleans up WAL sidecars", () => {
    const path = join(dir, "v.sqlite");
    makeDb(path, 4);
    expect(verifySnapshot(path, COUNT_USERS)).toBe(4);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  it("removeOldSnapshot creates the parent dir and deletes an existing file", () => {
    const nested = join(dir, "deep", "nested", "snap.sqlite");
    removeOldSnapshot(nested); // dir does not exist yet
    expect(existsSync(join(dir, "deep", "nested"))).toBe(true);

    makeDb(nested, 1);
    expect(existsSync(nested)).toBe(true);
    removeOldSnapshot(nested);
    expect(existsSync(nested)).toBe(false);
  });

  it("countRows returns 0 for an empty table", () => {
    const path = join(dir, "empty.sqlite");
    makeDb(path, 0);
    expect(countRows(path, COUNT_USERS)).toBe(0);
    expect(statSync(path).size).toBeGreaterThan(0);
  });
});
