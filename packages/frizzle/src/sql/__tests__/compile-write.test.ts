import { describe, expect, test } from "vitest";
import { createWriteDescriptor, mergeWriteDescriptor } from "../../write-descriptor.js";
import { compileDelete, compileInsert, compileUpdate, compileWrite } from "../compile-write.js";
import { sqliteDialect } from "../sqlite-dialect.js";

describe("compileInsert", () => {
  test("basic insert", () => {
    const desc = createWriteDescriptor("insert", { title: "Task", status: "backlog" });
    const result = compileInsert("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('INSERT INTO "tasks" ("title", "status") VALUES (?, ?)');
    expect(result.parameters).toEqual(["Task", "backlog"]);
  });

  test("empty values → DEFAULT VALUES", () => {
    const desc = createWriteDescriptor("insert");
    const result = compileInsert("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('INSERT INTO "tasks" DEFAULT VALUES');
    expect(result.parameters).toEqual([]);
  });

  test("preserves parameter order", () => {
    const desc = createWriteDescriptor("insert", { a: 1, b: 2, c: 3 });
    const result = compileInsert("t", desc, sqliteDialect);
    expect(result.parameters).toEqual([1, 2, 3]);
  });
});

describe("compileUpdate", () => {
  test("single target ID", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { status: "done" }), { targetIds: ["t-1"] });
    const result = compileUpdate("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('UPDATE "tasks" SET "status" = ? WHERE "id" = ?');
    expect(result.parameters).toEqual(["done", "t-1"]);
  });

  test("multiple target IDs → IN clause", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { isDeleted: true }), {
      targetIds: ["t-1", "t-2", "t-3"],
    });
    const result = compileUpdate("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('UPDATE "tasks" SET "isDeleted" = ? WHERE "id" IN (?, ?, ?)');
    expect(result.parameters).toEqual([true, "t-1", "t-2", "t-3"]);
  });

  test("empty target IDs → WHERE 1 = 0 (safety)", () => {
    const desc = createWriteDescriptor("update", { status: "done" });
    const result = compileUpdate("tasks", desc, sqliteDialect);
    expect(result.sql).toContain("WHERE 1 = 0");
  });

  test("custom ID column", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { name: "New" }), { targetIds: ["x-1"] });
    const result = compileUpdate("items", desc, sqliteDialect, { idColumn: "itemId" });
    expect(result.sql).toBe('UPDATE "items" SET "name" = ? WHERE "itemId" = ?');
  });

  test("multiple SET values", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { status: "done", priority: 5 }), {
      targetIds: ["t-1"],
    });
    const result = compileUpdate("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('UPDATE "tasks" SET "status" = ?, "priority" = ? WHERE "id" = ?');
    expect(result.parameters).toEqual(["done", 5, "t-1"]);
  });
});

describe("compileDelete", () => {
  test("single target", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("delete"), { targetIds: ["t-1"] });
    const result = compileDelete("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('DELETE FROM "tasks" WHERE "id" = ?');
    expect(result.parameters).toEqual(["t-1"]);
  });

  test("multiple targets", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("delete"), { targetIds: ["t-1", "t-2"] });
    const result = compileDelete("tasks", desc, sqliteDialect);
    expect(result.sql).toBe('DELETE FROM "tasks" WHERE "id" IN (?, ?)');
    expect(result.parameters).toEqual(["t-1", "t-2"]);
  });

  test("empty targets → WHERE 1 = 0", () => {
    const desc = createWriteDescriptor("delete");
    const result = compileDelete("tasks", desc, sqliteDialect);
    expect(result.sql).toContain("WHERE 1 = 0");
  });
});

describe("compileWrite (dispatcher)", () => {
  test("dispatches to insert", () => {
    const desc = createWriteDescriptor("insert", { title: "X" });
    const result = compileWrite("tasks", desc, sqliteDialect);
    expect(result.sql).toContain("INSERT INTO");
  });

  test("dispatches to update", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("update", { title: "Y" }), { targetIds: ["t-1"] });
    const result = compileWrite("tasks", desc, sqliteDialect);
    expect(result.sql).toContain("UPDATE");
  });

  test("dispatches to delete", () => {
    const desc = mergeWriteDescriptor(createWriteDescriptor("delete"), { targetIds: ["t-1"] });
    const result = compileWrite("tasks", desc, sqliteDialect);
    expect(result.sql).toContain("DELETE FROM");
  });
});
