import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { attachD1BatchShim } from "./d1-batch-shim.js";

const notes = sqliteTable("notes", { id: integer("id").primaryKey(), body: text("body").notNull() });

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle> & { batch: (statements: readonly PromiseLike<unknown>[]) => Promise<unknown[]> };

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  const base = drizzle({ client: sqlite });
  attachD1BatchShim(base, sqlite);
  db = base as typeof db;
});

const count = () => sqlite.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number };

describe("attachD1BatchShim", () => {
  it("runs every statement and returns the results in order", async () => {
    const results = await db.batch([
      db.insert(notes).values({ id: 1, body: "a" }),
      db.insert(notes).values({ id: 2, body: "b" }),
      db.select().from(notes),
    ]);

    expect(results).toHaveLength(3);
    expect(results[2]).toEqual([
      { id: 1, body: "a" },
      { id: 2, body: "b" },
    ]);
    expect(count().n).toBe(2);
  });

  it("is atomic: one failing statement rolls back the ones before it", async () => {
    await expect(
      db.batch([
        db.insert(notes).values({ id: 1, body: "a" }),
        db.insert(notes).values({ id: 1, body: "duplicate key" }),
      ]),
    ).rejects.toThrow(/Failed query/); // Drizzle wraps SQLite's UNIQUE constraint error

    expect(count().n).toBe(0);
    // The connection is usable afterwards — no transaction left open.
    await db.insert(notes).values({ id: 3, body: "c" });
    expect(count().n).toBe(1);
  });

  it("surfaces the original error when SQLite has already rolled back", async () => {
    sqlite.exec(
      "CREATE TRIGGER veto BEFORE INSERT ON notes WHEN NEW.body = 'veto' BEGIN SELECT RAISE(ROLLBACK, 'vetoed by trigger'); END",
    );

    // Drizzle wraps the SQLite error; the trigger's message is its cause.
    await expect(
      db.batch([db.insert(notes).values({ id: 1, body: "a" }), db.insert(notes).values({ id: 2, body: "veto" })]),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ message: "vetoed by trigger" }) });

    expect(count().n).toBe(0);
    expect(sqlite.inTransaction).toBe(false);
  });

  it("runs overlapping batches one after another", async () => {
    const [first, second] = await Promise.all([
      db.batch([db.insert(notes).values({ id: 1, body: "a" }), db.select().from(notes)]),
      db.batch([db.insert(notes).values({ id: 2, body: "b" }), db.select().from(notes)]),
    ]);

    // Each batch sees only the rows committed before it started, plus its own.
    expect(first[1]).toEqual([{ id: 1, body: "a" }]);
    expect(second[1]).toEqual([
      { id: 1, body: "a" },
      { id: 2, body: "b" },
    ]);
    expect(sqlite.inTransaction).toBe(false);
  });

  it("runs the next queued batch after one fails", async () => {
    const [failed, next] = await Promise.allSettled([
      db.batch([db.insert(notes).values({ id: 1, body: "a" }), db.insert(notes).values({ id: 1, body: "dup" })]),
      db.batch([db.insert(notes).values({ id: 2, body: "b" })]),
    ]);

    expect(failed.status).toBe("rejected");
    expect(next.status).toBe("fulfilled");
    expect(sqlite.prepare("SELECT id FROM notes").all()).toEqual([{ id: 2 }]);
  });

  it("handles an empty batch", async () => {
    expect(await db.batch([])).toEqual([]);
    expect(sqlite.inTransaction).toBe(false);
  });
});
