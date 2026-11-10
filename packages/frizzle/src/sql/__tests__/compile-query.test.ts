import { describe, expect, test } from "vitest";
import { compileSelect } from "../compile-query.js";
import { sqliteDialect } from "../sqlite-dialect.js";
import type { SqlColumnMap } from "../types.js";

const columns: SqlColumnMap = {
  id: "id",
  status: "status",
  priority: "priority",
  title: "title",
  createdAt: "createdAt",
};

describe("compileSelect", () => {
  test("empty descriptor → SELECT * FROM table", () => {
    const result = compileSelect("tasks", {}, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks"');
    expect(result.parameters).toEqual([]);
  });

  test("with filter", () => {
    const result = compileSelect("tasks", { filter: { status: "active" } }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks" WHERE "status" = ?');
    expect(result.parameters).toEqual(["active"]);
  });

  test("with sort", () => {
    const result = compileSelect("tasks", { sort: { createdAt: "desc" } }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks" ORDER BY "createdAt" DESC');
  });

  test("with multiple sort fields", () => {
    const result = compileSelect("tasks", { sort: { priority: "desc", createdAt: "asc" } }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks" ORDER BY "priority" DESC, "createdAt" ASC');
  });

  test("with limit", () => {
    const result = compileSelect("tasks", { take: 20 }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks" LIMIT ?');
    expect(result.parameters).toEqual([20]);
  });

  test("with offset", () => {
    const result = compileSelect("tasks", { take: 20, skip: 40 }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks" LIMIT ? OFFSET ?');
    expect(result.parameters).toEqual([20, 40]);
  });

  test("with select projection", () => {
    const result = compileSelect("tasks", { select: { id: true, title: true, status: false } }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT "id", "title" FROM "tasks"');
  });

  test("full descriptor: filter + sort + limit + offset", () => {
    const result = compileSelect(
      "tasks",
      {
        filter: { status: "active", priority: { gte: 2 } },
        sort: { createdAt: "desc" },
        take: 10,
        skip: 0,
      },
      columns,
      sqliteDialect,
    );
    expect(result.sql).toBe(
      'SELECT * FROM "tasks" WHERE "status" = ? AND "priority" >= ? ORDER BY "createdAt" DESC LIMIT ? OFFSET ?',
    );
    expect(result.parameters).toEqual(["active", 2, 10, 0]);
  });

  test("include is ignored", () => {
    const result = compileSelect("tasks", { include: { author: true } }, columns, sqliteDialect);
    expect(result.sql).toBe('SELECT * FROM "tasks"');
  });
});
