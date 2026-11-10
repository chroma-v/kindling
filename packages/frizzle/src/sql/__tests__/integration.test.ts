import type Database from "better-sqlite3";
import { beforeEach, describe, expect, test } from "vitest";
import { isSuccess, parseFilter } from "../../index.js";
import type { Filter } from "../../query.js";
import { mergeFilters } from "../../query.js";
import { createWriteDescriptor, mergeWriteDescriptor } from "../../write-descriptor.js";
import { compileSelect } from "../compile-query.js";
import { compileFilter, compileFilterNode } from "../compile-where.js";
import { compileDelete, compileInsert, compileUpdate } from "../compile-write.js";
import type { Dialect } from "../dialect.js";
import { sqliteDialect } from "../sqlite-dialect.js";
import { createTestDb, SEED_TASKS, TASK_COLUMNS, type TestTask } from "./test-schema.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ============================================================================
// QUERY INTEGRATION
// ============================================================================

describe("SELECT integration", () => {
  test("empty descriptor returns all rows", () => {
    const { sql, parameters } = compileSelect("tasks", {}, TASK_COLUMNS, sqliteDialect);
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(8);
  });

  test("filter by equality", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { status: "in_progress" } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(3); // t-2, t-4, t-8
    for (const row of rows) {
      expect((row as { status: string }).status).toBe("in_progress");
    }
  });

  test("filter by operator (gte)", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { priority: { gte: 3 } } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(3); // t-2 (3), t-4 (4), t-7 (3)
    for (const row of rows) {
      expect((row as { priority: number }).priority).toBeGreaterThanOrEqual(3);
    }
  });

  test("filter IS NULL", () => {
    const { sql, parameters } = compileSelect("tasks", { filter: { assignedTo: null } }, TASK_COLUMNS, sqliteDialect);
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(2); // t-3, t-5
  });

  test("filter IN array", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { status: { in: ["done", "backlog"] } } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(5); // t-1, t-3, t-5, t-6, t-7
  });

  test("filter with OR branches", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { OR: [{ status: "done" }, { priority: { gte: 4 } }] } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    // done: t-1, t-7; priority >= 4: t-4; union = 3
    expect(rows).toHaveLength(3);
  });

  test("workspace scope filtering", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { workspaceId: "ws-1" } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(6); // all ws-1 tasks
    for (const row of rows) {
      expect((row as { workspaceId: string }).workspaceId).toBe("ws-1");
    }
  });

  test("combined scope + soft-delete + user filter", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      {
        filter: {
          workspaceId: "ws-1",
          isDeleted: false,
          status: "in_progress",
        },
      },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters);
    // ws-1 + not deleted + in_progress: t-2, t-4
    expect(rows).toHaveLength(2);
  });

  test("sort ordering", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      {
        filter: { workspaceId: "ws-1", isDeleted: false },
        sort: { priority: "desc" },
      },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters) as { priority: number }[];
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.priority).toBeLessThanOrEqual(rows[i - 1]!.priority);
    }
  });

  test("limit and offset", () => {
    const { sql, parameters } = compileSelect("tasks", { take: 3, skip: 2 }, TASK_COLUMNS, sqliteDialect);
    const rows = db.prepare(sql).all(...parameters);
    expect(rows).toHaveLength(3);
  });

  test("select projection", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { select: { id: true, title: true } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters) as Record<string, unknown>[];
    expect(rows).toHaveLength(8);
    // Only id and title columns should be present
    expect(Object.keys(rows[0]!)).toEqual(["id", "title"]);
  });
});

// ============================================================================
// FILTER STRING → SQL → EXECUTE
// ============================================================================

describe("filter expression → SQL integration", () => {
  test("parse filter string → compile → execute", () => {
    const parsed = parseFilter("status eq 'done'");
    expect(isSuccess(parsed)).toBe(true);
    if (!isSuccess(parsed)) {
      return;
    }

    const compiled = compileFilterNode(parsed.data, TASK_COLUMNS, sqliteDialect);
    expect(isSuccess(compiled)).toBe(true);
    if (!isSuccess(compiled)) {
      return;
    }

    const rows = db.prepare(`SELECT * FROM tasks WHERE ${compiled.data.sql}`).all(...compiled.data.parameters);
    expect(rows).toHaveLength(2); // t-1, t-7
  });

  test("complex filter string: AND + operator", () => {
    const parsed = parseFilter("status eq 'in_progress' AND priority gte 3");
    expect(isSuccess(parsed)).toBe(true);
    if (!isSuccess(parsed)) {
      return;
    }

    const compiled = compileFilterNode(parsed.data, TASK_COLUMNS, sqliteDialect);
    expect(isSuccess(compiled)).toBe(true);
    if (!isSuccess(compiled)) {
      return;
    }

    const rows = db.prepare(`SELECT * FROM tasks WHERE ${compiled.data.sql}`).all(...compiled.data.parameters);
    expect(rows).toHaveLength(2); // t-2 (priority 3), t-4 (priority 4)
  });

  test("contains operator", () => {
    const parsed = parseFilter("title contains 'bug'");
    expect(isSuccess(parsed)).toBe(true);
    if (!isSuccess(parsed)) {
      return;
    }

    const compiled = compileFilterNode(parsed.data, TASK_COLUMNS, sqliteDialect);
    expect(isSuccess(compiled)).toBe(true);
    if (!isSuccess(compiled)) {
      return;
    }

    const rows = db.prepare(`SELECT * FROM tasks WHERE ${compiled.data.sql}`).all(...compiled.data.parameters);
    // SQLite LIKE is case-insensitive for ASCII → matches "Fix bug #42"
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe("t-4");
  });
});

// ============================================================================
// WRITE INTEGRATION
// ============================================================================

describe("INSERT integration", () => {
  test("insert a new row", () => {
    const desc = createWriteDescriptor("insert", {
      id: "t-new",
      title: "New task",
      status: "backlog",
      priority: 0,
      isDeleted: 0,
      workspaceId: "ws-1",
      order: 10,
      createdAt: "2026-03-11",
    });
    const { sql, parameters } = compileInsert("tasks", desc, sqliteDialect);
    db.prepare(sql).run(...parameters);

    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get("t-new") as { title: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.title).toBe("New task");
  });
});

describe("UPDATE integration", () => {
  test("update single row", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { status: "done", priority: 5 }), {
      targetIds: ["t-2"],
    });
    const { sql, parameters } = compileUpdate("tasks", desc, sqliteDialect);
    db.prepare(sql).run(...parameters);

    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get("t-2") as { status: string; priority: number };
    expect(row.status).toBe("done");
    expect(row.priority).toBe(5);
  });

  test("update multiple rows (soft-delete pattern)", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { isDeleted: 1, deletedAt: "2026-03-11" }), {
      targetIds: ["t-1", "t-2", "t-3"],
    });
    const { sql, parameters } = compileUpdate("tasks", desc, sqliteDialect);
    const info = db.prepare(sql).run(...parameters);
    expect(info.changes).toBe(3);

    const rows = db.prepare('SELECT * FROM tasks WHERE "isDeleted" = 1').all();
    expect(rows).toHaveLength(4); // 3 newly deleted + t-6 already deleted
  });
});

describe("DELETE integration", () => {
  test("delete single row", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("delete"), { targetIds: ["t-6"] });
    const { sql, parameters } = compileDelete("tasks", desc, sqliteDialect);
    const info = db.prepare(sql).run(...parameters);
    expect(info.changes).toBe(1);

    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get("t-6");
    expect(row).toBeUndefined();
  });
});

// ============================================================================
// INTERCEPTOR → SQL → EXECUTE (full pipeline simulation)
// ============================================================================

describe("interceptor pipeline → SQL → execute", () => {
  test("scope interceptor produces valid SQL", () => {
    // Simulate what the scope interceptor does: merge workspaceId + isDeleted
    const userFilter = { status: "in_progress" };
    const scopedFilter = { ...userFilter, workspaceId: "ws-1", isDeleted: false };

    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: scopedFilter, sort: { priority: "desc" }, take: 10 },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(sql).all(...parameters) as { id: string; priority: number }[];

    // ws-1 + not deleted + in_progress = t-2, t-4
    expect(rows).toHaveLength(2);
    // Sorted by priority desc: t-4 (4), t-2 (3)
    expect(rows[0]!.id).toBe("t-4");
    expect(rows[1]!.id).toBe("t-2");
  });

  test("soft-delete write interceptor → update → verify", () => {
    // Simulate soft-delete interceptor: remove → update with isDeleted
    const desc = mergeWriteDescriptor(
      createWriteDescriptor("update", {
        isDeleted: 1,
        deletedAt: "2026-03-11",
      }),
      { targetIds: ["t-3"] },
    );
    const { sql, parameters } = compileUpdate("tasks", desc, sqliteDialect);
    db.prepare(sql).run(...parameters);

    // Verify: scoped query should no longer return t-3
    const { sql: selectSql, parameters: selectParams } = compileSelect(
      "tasks",
      { filter: { workspaceId: "ws-1", isDeleted: false } },
      TASK_COLUMNS,
      sqliteDialect,
    );
    const rows = db.prepare(selectSql).all(...selectParams) as { id: string }[];
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("t-3");
  });
});

// ============================================================================
// mergeFilters → SQL: both sides must hold
// ============================================================================

describe("mergeFilters → compileSelect → execute", () => {
  const ids = (filter: Filter) => {
    const { sql, parameters } = compileSelect("tasks", { filter, sort: { id: "asc" } }, TASK_COLUMNS, sqliteDialect);
    return (db.prepare(sql).all(...parameters) as { id: string }[]).map((r) => r.id);
  };
  const expected = (keep: (t: TestTask) => boolean) =>
    SEED_TASKS.filter(keep)
      .map((t) => t.id)
      .sort();

  test("a user OR merged with a scope OR keeps both (used to concatenate into one OR)", () => {
    const user: Filter = { OR: [{ status: "done" }, { status: "backlog" }] };
    const scope: Filter = { OR: [{ assignedTo: "user-1" }, { assignedTo: null }] };
    const want = expected(
      (t) => (t.status === "done" || t.status === "backlog") && (t.assignedTo === "user-1" || t.assignedTo === null),
    );
    // Guard: the old concatenated OR would have matched more rows.
    const concatenated = expected(
      (t) => t.status === "done" || t.status === "backlog" || t.assignedTo === "user-1" || t.assignedTo === null,
    );
    expect(want.length).toBeGreaterThan(0);
    expect(concatenated.length).toBeGreaterThan(want.length);

    expect(ids(mergeFilters(user, scope))).toEqual(want);
  });

  test("the same field from both sides keeps both conditions (used to keep only the later one)", () => {
    const merged = mergeFilters({ priority: { gte: 2 } }, { priority: { lte: 3 } });
    expect(ids(merged)).toEqual(expected((t) => t.priority >= 2 && t.priority <= 3));
  });

  test("a scope field can't be overridden by the user filter: both apply", () => {
    const merged = mergeFilters({ workspaceId: "ws-2" }, { workspaceId: "ws-1" });
    expect(ids(merged)).toEqual([]);
  });
});

// ============================================================================
// $n placeholders are numbered in order, across nesting
// ============================================================================

describe("numbered placeholders ($1, $2, ...)", () => {
  const numbered: Dialect = { ...sqliteDialect, name: "numbered", parameter: (index) => `$${index + 1}` };

  // Execute on SQLite by turning each $k into ? and binding parameters[k - 1]
  // in placeholder order: rows only come back right if every placeholder
  // points at the right parameter.
  const run = (sql: string, parameters: readonly unknown[]) => {
    const bound = [...sql.matchAll(/\$(\d+)/g)].map((m) => parameters[Number(m[1]) - 1]);
    const rows = db.prepare(`SELECT id FROM tasks WHERE ${sql.replaceAll(/\$\d+/g, "?")} ORDER BY id`).all(...bound);
    return (rows as { id: string }[]).map((r) => r.id);
  };
  const placeholders = (sql: string) => [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

  test("Filter objects: OR and AND branches continue the numbering", () => {
    const filter: Filter = {
      OR: [{ status: "done" }, { status: "in_progress" }],
      AND: [{ priority: { gte: 2 } }, { priority: { in: [2, 3, 4] } }],
    };
    const { sql, parameters } = compileFilter(filter, TASK_COLUMNS, numbered);
    expect(placeholders(sql)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parameters).toEqual(["done", "in_progress", 2, 2, 3, 4]);
    expect(run(sql, parameters)).toEqual(
      SEED_TASKS.filter(
        (t) => (t.status === "done" || t.status === "in_progress") && t.priority >= 2 && [2, 3, 4].includes(t.priority),
      )
        .map((t) => t.id)
        .sort(),
    );
  });

  test("parsed filters: every comparison continues the numbering", () => {
    const parsed = parseFilter(
      "(status eq 'done' or status eq 'in_progress') and priority in [2, 3, 4] and priority between [0, 5]",
    );
    if (!isSuccess(parsed)) {
      throw new Error("parse failed");
    }
    const result = compileFilterNode(parsed.data, TASK_COLUMNS, numbered);
    if (!isSuccess(result)) {
      throw new Error(result.error.message);
    }
    const { sql, parameters } = result.data;
    expect(placeholders(sql)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parameters).toEqual(["done", "in_progress", 2, 3, 4, 0, 5]);
    expect(run(sql, parameters)).toEqual(
      SEED_TASKS.filter((t) => (t.status === "done" || t.status === "in_progress") && [2, 3, 4].includes(t.priority))
        .map((t) => t.id)
        .sort(),
    );
  });

  test("compileSelect numbers LIMIT / OFFSET after the WHERE parameters", () => {
    const { sql, parameters } = compileSelect(
      "tasks",
      { filter: { OR: [{ status: "done" }, { status: "backlog" }] }, take: 5, skip: 0 },
      TASK_COLUMNS,
      numbered,
    );
    expect(placeholders(sql)).toEqual([1, 2, 3, 4]);
    expect(parameters).toEqual(["done", "backlog", 5, 0]);
  });
});
