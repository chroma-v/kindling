import { describe, expect, test } from "vitest";
import type { FilterNode } from "../../ast-types.js";
import { isSuccess } from "../../result-types.js";
import { compileFilter, compileFilterNode } from "../compile-where.js";
import type { Dialect } from "../dialect.js";
import { sqliteDialect } from "../sqlite-dialect.js";
import type { SqlColumnMap } from "../types.js";

const columns: SqlColumnMap = {
  status: "status",
  priority: "priority",
  title: "title",
  assignedTo: "assignedTo",
  isDeleted: "isDeleted",
  createdAt: "createdAt",
};

// ============================================================================
// PATH A: Filter POJO → SQL
// ============================================================================

describe("compileFilter (POJO path)", () => {
  test("bare value → equality", () => {
    const result = compileFilter({ status: "active" }, columns, sqliteDialect);
    expect(result.sql).toBe('"status" = ?');
    expect(result.parameters).toEqual(["active"]);
  });

  test("multiple fields → AND", () => {
    const result = compileFilter({ status: "active", priority: 3 }, columns, sqliteDialect);
    expect(result.sql).toBe('"status" = ? AND "priority" = ?');
    expect(result.parameters).toEqual(["active", 3]);
  });

  test("null value → IS NULL", () => {
    const result = compileFilter({ assignedTo: null }, columns, sqliteDialect);
    expect(result.sql).toBe('"assignedTo" IS NULL');
    expect(result.parameters).toEqual([]);
  });

  test("boolean value → dialect literal", () => {
    const result = compileFilter({ isDeleted: false }, columns, sqliteDialect);
    expect(result.sql).toBe('"isDeleted" = 0');
    expect(result.parameters).toEqual([]);
  });

  test("ne operator", () => {
    const result = compileFilter({ status: { ne: "done" } }, columns, sqliteDialect);
    expect(result.sql).toBe('"status" != ?');
    expect(result.parameters).toEqual(["done"]);
  });

  test("ne null → IS NOT NULL", () => {
    const result = compileFilter({ assignedTo: { ne: null } }, columns, sqliteDialect);
    expect(result.sql).toBe('"assignedTo" IS NOT NULL');
  });

  test("gt operator", () => {
    const result = compileFilter({ priority: { gt: 2 } }, columns, sqliteDialect);
    expect(result.sql).toBe('"priority" > ?');
    expect(result.parameters).toEqual([2]);
  });

  test("gte operator", () => {
    const result = compileFilter({ priority: { gte: 3 } }, columns, sqliteDialect);
    expect(result.sql).toBe('"priority" >= ?');
    expect(result.parameters).toEqual([3]);
  });

  test("lt operator", () => {
    const result = compileFilter({ priority: { lt: 4 } }, columns, sqliteDialect);
    expect(result.sql).toBe('"priority" < ?');
  });

  test("lte operator", () => {
    const result = compileFilter({ priority: { lte: 2 } }, columns, sqliteDialect);
    expect(result.sql).toBe('"priority" <= ?');
  });

  test("in operator", () => {
    const result = compileFilter({ status: { in: ["active", "done"] } }, columns, sqliteDialect);
    expect(result.sql).toBe('"status" IN (?, ?)');
    expect(result.parameters).toEqual(["active", "done"]);
  });

  test("in with empty array → always false", () => {
    const result = compileFilter({ status: { in: [] } }, columns, sqliteDialect);
    expect(result.sql).toBe("1 = 0");
  });

  test("notIn operator", () => {
    const result = compileFilter({ status: { notIn: ["done"] } }, columns, sqliteDialect);
    expect(result.sql).toBe('"status" NOT IN (?)');
    expect(result.parameters).toEqual(["done"]);
  });

  test("notIn with empty array → always true", () => {
    const result = compileFilter({ status: { notIn: [] } }, columns, sqliteDialect);
    expect(result.sql).toBe("1 = 1");
  });

  test("like operator", () => {
    const result = compileFilter({ title: { like: "%test%" } }, columns, sqliteDialect);
    expect(result.sql).toBe("\"title\" LIKE ? ESCAPE '\\'");
    expect(result.parameters).toEqual(["%test%"]);
  });

  test("isNull: true", () => {
    const result = compileFilter({ assignedTo: { isNull: true } }, columns, sqliteDialect);
    expect(result.sql).toBe('"assignedTo" IS NULL');
  });

  test("isNull: false → IS NOT NULL", () => {
    const result = compileFilter({ assignedTo: { isNull: false } }, columns, sqliteDialect);
    expect(result.sql).toBe('"assignedTo" IS NOT NULL');
  });

  test("isNotNull: true", () => {
    const result = compileFilter({ assignedTo: { isNotNull: true } }, columns, sqliteDialect);
    expect(result.sql).toBe('"assignedTo" IS NOT NULL');
  });

  test("gte + lte combo (between pattern)", () => {
    const result = compileFilter({ priority: { gte: 1, lte: 3 } }, columns, sqliteDialect);
    expect(result.sql).toBe('"priority" >= ? AND "priority" <= ?');
    expect(result.parameters).toEqual([1, 3]);
  });

  test("OR branches", () => {
    const result = compileFilter({ OR: [{ status: "active" }, { status: "done" }] }, columns, sqliteDialect);
    expect(result.sql).toBe('(("status" = ?) OR ("status" = ?))');
    expect(result.parameters).toEqual(["active", "done"]);
  });

  test("mixed AND + OR", () => {
    const result = compileFilter(
      { priority: { gte: 2 }, OR: [{ status: "active" }, { status: "review" }] },
      columns,
      sqliteDialect,
    );
    expect(result.sql).toBe('"priority" >= ? AND (("status" = ?) OR ("status" = ?))');
    expect(result.parameters).toEqual([2, "active", "review"]);
  });

  test("empty filter → 1 = 1", () => {
    const result = compileFilter({}, columns, sqliteDialect);
    expect(result.sql).toBe("1 = 1");
    expect(result.parameters).toEqual([]);
  });

  test("unmapped field uses key as column name", () => {
    const result = compileFilter({ unknownField: "val" }, columns, sqliteDialect);
    expect(result.sql).toBe('"unknownField" = ?');
  });
});

// ============================================================================
// PATH B: FilterNode AST → SQL
// ============================================================================

describe("compileFilterNode (AST path)", () => {
  test("comparison: eq", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "status", operator: "eq", value: "active" },
      columns,
      sqliteDialect,
    );
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"status" = ?');
      expect(result.data.parameters).toEqual(["active"]);
    }
  });

  test("comparison: eq null → IS NULL", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "assignedTo", operator: "eq", value: null },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"assignedTo" IS NULL');
      expect(result.data.parameters).toEqual([]);
    }
  });

  test("comparison: ne null → IS NOT NULL", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "assignedTo", operator: "ne", value: null },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"assignedTo" IS NOT NULL');
    }
  });

  test("comparison: contains wraps with %", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "title", operator: "contains", value: "test" },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe("\"title\" LIKE ? ESCAPE '\\'");
      expect(result.data.parameters).toEqual(["%test%"]);
    }
  });

  test("comparison: starts_with", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "title", operator: "starts_with", value: "Fix" },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.parameters).toEqual(["Fix%"]);
    }
  });

  test("comparison: ends_with", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "title", operator: "ends_with", value: "page" },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.parameters).toEqual(["%page"]);
    }
  });

  test("comparison: ilike falls back to LOWER() for SQLite", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "title", operator: "ilike", value: "test" },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toContain("LOWER");
    }
  });

  test("comparison: in with array", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "status", operator: "in", value: ["a", "b", "c"] },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"status" IN (?, ?, ?)');
      expect(result.data.parameters).toEqual(["a", "b", "c"]);
    }
  });

  test("comparison: in with empty array → 1 = 0", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "status", operator: "in", value: [] },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe("1 = 0");
    }
  });

  test("comparison: not_in", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "status", operator: "not_in", value: ["done"] },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"status" NOT IN (?)');
    }
  });

  test("comparison: between", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "priority", operator: "between", value: [1, 3] },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"priority" BETWEEN ? AND ?');
      expect(result.data.parameters).toEqual([1, 3]);
    }
  });

  test("comparison: is_null", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "assignedTo", operator: "is_null", value: null },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"assignedTo" IS NULL');
    }
  });

  test("comparison: is_not_null", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "assignedTo", operator: "is_not_null", value: null },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('"assignedTo" IS NOT NULL');
    }
  });

  test("logical: AND", () => {
    const result = compileFilterNode(
      {
        type: "logical",
        operator: "and",
        left: { type: "comparison", field: "status", operator: "eq", value: "active" },
        right: { type: "comparison", field: "priority", operator: "gte", value: 3 },
      },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('("status" = ? AND "priority" >= ?)');
      expect(result.data.parameters).toEqual(["active", 3]);
    }
  });

  test("logical: OR", () => {
    const result = compileFilterNode(
      {
        type: "logical",
        operator: "or",
        left: { type: "comparison", field: "status", operator: "eq", value: "active" },
        right: { type: "comparison", field: "status", operator: "eq", value: "done" },
      },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('("status" = ? OR "status" = ?)');
    }
  });

  test("group: parenthesized expression", () => {
    const result = compileFilterNode(
      {
        type: "group",
        expression: { type: "comparison", field: "status", operator: "eq", value: "active" },
      },
      columns,
      sqliteDialect,
    );
    if (isSuccess(result)) {
      expect(result.data.sql).toBe('("status" = ?)');
    }
  });

  test("unknown field → error", () => {
    const result = compileFilterNode(
      { type: "comparison", field: "nonexistent", operator: "eq", value: "x" },
      columns,
      sqliteDialect,
    );
    expect(isSuccess(result)).toBe(false);
  });
});

describe("compileFilterNode: chains", () => {
  const cmp = (field: string): FilterNode => ({ type: "comparison", field, operator: "eq", value: field });

  test("a chain of one operator is one flat clause", () => {
    const node: FilterNode = {
      type: "logical",
      operator: "and",
      left: { type: "logical", operator: "and", left: cmp("title"), right: cmp("status") },
      right: cmp("priority"),
    };
    const result = compileFilterNode(node, columns, sqliteDialect);
    expect(result.success && result.data).toEqual({
      sql: '("title" = ? AND "status" = ? AND "priority" = ?)',
      parameters: ["title", "status", "priority"],
    });
  });

  test("numbered placeholders follow the SQL text in a flattened chain with a group inside", () => {
    const numbered: Dialect = { ...sqliteDialect, name: "numbered", parameter: (index) => `$${index + 1}` };
    // title and ((status or priority) and assignedTo), nested to the right:
    // the AND chain flattens to [title, (status or priority), assignedTo]
    const node: FilterNode = {
      type: "logical",
      operator: "and",
      left: cmp("title"),
      right: {
        type: "logical",
        operator: "and",
        left: {
          type: "group",
          expression: { type: "logical", operator: "or", left: cmp("status"), right: cmp("priority") },
        },
        right: cmp("assignedTo"),
      },
    };
    const result = compileFilterNode(node, columns, numbered);
    expect(result.success && result.data).toEqual({
      sql: '("title" = $1 AND (("status" = $2 OR "priority" = $3)) AND "assignedTo" = $4)',
      parameters: ["title", "status", "priority", "assignedTo"],
    });
  });

  test("a 50,000-condition hand-built chain compiles, not a RangeError", () => {
    let chain = cmp("title");
    for (let i = 0; i < 50_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: cmp("title") };
    }
    const result = compileFilterNode(chain, columns, sqliteDialect);
    expect(result.success && result.data.parameters).toHaveLength(50_001);
  });
});
