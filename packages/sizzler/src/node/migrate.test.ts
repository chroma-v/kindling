import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeD1Filename } from "./connection/index.js";
import { runLocalMigrations } from "./migrate.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sizzler-migrate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.TEST_STATE_DIR;
});

function writeWranglerConfig(bindings: Array<{ binding: string; database_id: string }>): void {
  writeFileSync(join(root, "wrangler.jsonc"), JSON.stringify({ d1_databases: bindings }, null, 2));
}

function writeMigration(sql: string): void {
  // drizzle-kit (v1-beta) directory format: <name>/migration.sql, ordered by dir name.
  const dir = join(root, "drizzle", "migrations", "0000_init");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration.sql"), sql);
}

function dbPathFor(stateDir: string, databaseId: string): string {
  return join(root, stateDir, "v3", "d1", "miniflare-D1DatabaseObject", computeD1Filename(databaseId));
}

function tableExists(path: string, name: string): boolean {
  const db = new Database(path, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as {
      c: number;
    };
    return row.c === 1;
  } finally {
    db.close();
  }
}

describe("runLocalMigrations", () => {
  it("creates the hashed D1 file and applies migrations", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    writeWranglerConfig([{ binding: "DB", database_id: id }]);
    writeMigration("CREATE TABLE widgets (id integer primary key, name text);");

    runLocalMigrations({ bindingName: "DB", projectRoot: root, log: () => {} });

    expect(tableExists(dbPathFor(".wrangler/state", id), "widgets")).toBe(true);
  });

  it("throws when the binding is missing", () => {
    writeWranglerConfig([{ binding: "OTHER_DB", database_id: "x" }]);
    writeMigration("CREATE TABLE t (id integer);");

    expect(() => runLocalMigrations({ bindingName: "DB", projectRoot: root, log: () => {} })).toThrow(
      /No D1 database binding 'DB'/,
    );
  });

  it("honors TEST_STATE_DIR for the database location", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    writeWranglerConfig([{ binding: "DB", database_id: id }]);
    writeMigration("CREATE TABLE t (id integer);");
    process.env.TEST_STATE_DIR = ".wrangler-test";

    runLocalMigrations({ bindingName: "DB", projectRoot: root, log: () => {} });

    // TEST_STATE_DIR path omits the "state" segment (matches --persist-to).
    expect(tableExists(dbPathFor(".wrangler-test", id), "t")).toBe(true);
  });
});
