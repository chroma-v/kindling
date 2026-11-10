// ============================================================================
// DRIZZLE RQB OBJECT SYNTAX CODE GENERATOR TESTS
// ============================================================================
// Tests the compileFilter function (RQB object syntax), the exhaustive
// operator x value matrix, nested paths, resolvers, and compileSort.

import { describe, expect, test, vi } from "vitest";
import type { FilterNode } from "./ast-types.js";
import { compileFilter, compileFilterNode, compileSort, type WhereResolver } from "./drizzle-rqb.js";
import { isError, isSuccess } from "./result-types.js";

// ============================================================================
// compileFilter TESTS (RQB object syntax)
// ============================================================================

describe("compileFilter", () => {
  // Simple field mappings for RQB tests
  const columns = {
    title: "title",
    status: "status",
    priority: "priority",
    assignedToUserId: "assignedToUserId",
    percentComplete: "percentComplete",
  };

  describe("basic operators", () => {
    test("eq generates simple object", async () => {
      const result = await compileFilter("status eq 'active'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: "active" });
      }
    });

    test("ne generates { ne: value }", async () => {
      const result = await compileFilter("status ne 'deleted'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: { ne: "deleted" } });
      }
    });

    test("gt generates { gt: value }", async () => {
      const result = await compileFilter("percentComplete gt 50", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ percentComplete: { gt: 50 } });
      }
    });

    test("gte generates { gte: value }", async () => {
      const result = await compileFilter("percentComplete gte 50", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ percentComplete: { gte: 50 } });
      }
    });

    test("lt generates { lt: value }", async () => {
      const result = await compileFilter("percentComplete lt 100", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ percentComplete: { lt: 100 } });
      }
    });

    test("lte generates { lte: value }", async () => {
      const result = await compileFilter("percentComplete lte 75", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ percentComplete: { lte: 75 } });
      }
    });

    test("in generates { in: [...] }", async () => {
      const result = await compileFilter('status in ["active", "pending"]', columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: { in: ["active", "pending"] } });
      }
    });

    test("not_in generates { notIn: [...] }", async () => {
      const result = await compileFilter('status not_in ["deleted", "archived"]', columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: { notIn: ["deleted", "archived"] } });
      }
    });
  });

  describe("string operators", () => {
    test("contains generates { like: %value% }", async () => {
      const result = await compileFilter("title contains 'Kitchen'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ title: { like: "%Kitchen%" } });
      }
    });

    test("starts_with generates { like: value% }", async () => {
      const result = await compileFilter("title starts_with 'Fix'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ title: { like: "Fix%" } });
      }
    });

    test("ends_with generates { like: %value }", async () => {
      const result = await compileFilter("title ends_with 'repair'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ title: { like: "%repair" } });
      }
    });
  });

  describe("null operators", () => {
    test("eq null generates { field: { isNull: true } }", async () => {
      const result = await compileFilter("assignedToUserId eq null", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        // SQL: "field = NULL" is always false — must use IS NULL
        expect(result.data).toEqual({ assignedToUserId: { isNull: true } });
      }
    });

    test("ne null generates { field: { isNotNull: true } }", async () => {
      const result = await compileFilter("assignedToUserId ne null", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        // SQL: "field != NULL" is always false — must use IS NOT NULL
        expect(result.data).toEqual({ assignedToUserId: { isNotNull: true } });
      }
    });

    test("is_null generates { field: { isNull: true } }", async () => {
      const result = await compileFilter("assignedToUserId is_null", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ assignedToUserId: { isNull: true } });
      }
    });

    test("is_not_null generates { field: { isNotNull: true } }", async () => {
      const result = await compileFilter("assignedToUserId is_not_null", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ assignedToUserId: { isNotNull: true } });
      }
    });
  });

  describe("nested paths (relation filtering)", () => {
    // Column mapping with nested path for many-to-many relation
    const columnsWithNested = {
      ...columns,
      tags: "taskTags.tag.name", // Many-to-many via junction table
    };

    test("nested path generates nested object for eq", async () => {
      const result = await compileFilter("tags eq 'bug'", columnsWithNested);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          taskTags: { tag: { name: "bug" } },
        });
      }
    });

    test("nested path generates nested object for in", async () => {
      const result = await compileFilter('tags in ["bug", "feature"]', columnsWithNested);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          taskTags: { tag: { name: { in: ["bug", "feature"] } } },
        });
      }
    });

    test("nested path with ne operator", async () => {
      const result = await compileFilter("tags ne 'wontfix'", columnsWithNested);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          taskTags: { tag: { name: { ne: "wontfix" } } },
        });
      }
    });

    test("nested path combined with simple fields", async () => {
      const result = await compileFilter("status eq 'active' AND tags eq 'bug'", columnsWithNested);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          status: "active",
          taskTags: { tag: { name: "bug" } },
        });
      }
    });

    test("deep nested path (3+ levels)", async () => {
      const columnsDeep = { category: "workspace.settings.category" };
      const result = await compileFilter("category eq 'development'", columnsDeep);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          workspace: { settings: { category: "development" } },
        });
      }
    });
  });

  describe("logical operators", () => {
    test("AND merges objects", async () => {
      const result = await compileFilter("status eq 'active' AND priority eq 'high'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: "active", priority: "high" });
      }
    });

    test("OR wraps in OR array", async () => {
      const result = await compileFilter("status eq 'active' OR status eq 'pending'", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          OR: [{ status: "active" }, { status: "pending" }],
        });
      }
    });

    test("complex AND with OR", async () => {
      const result = await compileFilter("priority eq 'high' AND (status eq 'active' OR status eq 'pending')", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          priority: "high",
          OR: [{ status: "active" }, { status: "pending" }],
        });
      }
    });

    test("multiple ANDs merge correctly", async () => {
      const result = await compileFilter(
        "status eq 'active' AND priority eq 'high' AND percentComplete gt 50",
        columns,
      );

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          status: "active",
          priority: "high",
          percentComplete: { gt: 50 },
        });
      }
    });
  });

  describe("resolver functions", () => {
    test("sync resolver returns v2 object", async () => {
      const resolver: WhereResolver = (_operator, _value) => {
        return { id: { in: ["task-1", "task-2"] } };
      };

      const result = await compileFilter("tags eq 'bug'", {
        ...columns,
        tags: resolver,
      });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ id: { in: ["task-1", "task-2"] } });
      }
    });

    test("async resolver returns v2 object", async () => {
      const resolver: WhereResolver = async (_operator, _value) => {
        // Simulate async database lookup
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { id: { in: ["task-3", "task-4"] } };
      };

      const result = await compileFilter("tags eq 'feature'", {
        ...columns,
        tags: resolver,
      });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ id: { in: ["task-3", "task-4"] } });
      }
    });

    test("resolver receives correct operator and value", async () => {
      const resolver = vi.fn<WhereResolver>(() => ({ id: { in: [] } }));

      await compileFilter('tags in ["bug", "feature"]', {
        ...columns,
        tags: resolver,
      });

      expect(resolver).toHaveBeenCalledWith("in", ["bug", "feature"], undefined);
    });

    test("resolver receives context", async () => {
      const context = { db: "mock-db" };
      const resolver = vi.fn<WhereResolver<typeof context>>(() => ({ id: { in: [] } }));

      await compileFilter("tags eq 'bug'", { ...columns, tags: resolver }, { context });

      expect(resolver).toHaveBeenCalledWith("eq", "bug", context);
    });

    test("resolver combined with direct fields via AND", async () => {
      const resolver: WhereResolver = () => ({ id: { in: ["task-1"] } });

      const result = await compileFilter("status eq 'active' AND tags eq 'bug'", {
        ...columns,
        tags: resolver,
      });

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({
          status: "active",
          id: { in: ["task-1"] },
        });
      }
    });
  });

  describe("error handling", () => {
    test("unknown field returns error", async () => {
      const result = await compileFilter("unknownField eq 'value'", columns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Unknown column");
        expect(result.error.message).toContain("unknownField");
      }
    });

    test("resolver error is propagated", async () => {
      const resolver: WhereResolver = () => {
        throw new Error("Database connection failed");
      };

      const result = await compileFilter("tags eq 'bug'", {
        ...columns,
        tags: resolver,
      });

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Database connection failed");
      }
    });

    test("async resolver error is propagated", async () => {
      const resolver: WhereResolver = async () => {
        throw new Error("Async error");
      };

      const result = await compileFilter("tags eq 'bug'", {
        ...columns,
        tags: resolver,
      });

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Async error");
      }
    });
  });
});

// ============================================================================
// SCHEMA VALIDATION IN compileFilter
// ============================================================================

describe("compileFilter: schema validation", () => {
  const columns = {
    status: "status",
    age: "age",
  };

  const schema = {
    status: { type: "enum" as const, enumValues: ["active", "pending"] },
    age: { type: "number" as const, min: 0, max: 120 },
  };

  test("passes valid filter with schema", async () => {
    const result = await compileFilter("status eq 'active'", columns, {
      schema,
    });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toEqual({ status: "active" });
    }
  });

  test("rejects unknown field when schema provided", async () => {
    const result = await compileFilter("unknown eq 'x'", columns, { schema });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
    }
  });

  test("rejects invalid enum value when schema provided", async () => {
    const result = await compileFilter("status eq 'invalid'", columns, {
      schema,
    });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("INVALID_VALUE");
    }
  });

  test("rejects incompatible operator when schema provided", async () => {
    const result = await compileFilter("age like 'text'", columns, { schema });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("INVALID_OPERATOR");
    }
  });

  test("skips validation when schema not provided", async () => {
    // Without schema, unknown fields still rejected by columnMappings
    const result = await compileFilter("status eq 'anything'", columns);
    expect(isSuccess(result)).toBe(true);
  });

  test("works with context and schema together", async () => {
    const resolver = vi.fn(() => ({ id: { in: ["1", "2"] } }));
    const result = await compileFilter(
      "tags eq 'bug'",
      { tags: resolver },
      {
        context: { db: "fake" },
        schema: { tags: { type: "enum" as const, enumValues: ["bug", "feature"] } },
      },
    );
    expect(isSuccess(result)).toBe(true);
    expect(resolver).toHaveBeenCalled();
  });
});

// ============================================================================
// EXHAUSTIVE OPERATOR x VALUE MATRIX TEST
// ============================================================================
// Tests every ComparisonOperator against every value type to ensure the RQB
// code generator validates inputs and returns proper Result errors for invalid
// combinations. This matrix caught the `eq null` -> `{ field: null }` bug
// (should be `{ isNull: true }`), so it serves as a regression safety net.

describe("compileFilter: operator x value exhaustive matrix", () => {
  const columns = {
    field: "field",
    nested: "a.b.c",
  };

  // Every value type the parser can produce
  const valueTypes = {
    string: { raw: "'hello'", parsed: "hello" },
    number: { raw: "42", parsed: 42 },
    null: { raw: "null", parsed: null },
    true: { raw: "true", parsed: true },
    false: { raw: "false", parsed: false },
    array: { raw: '["a","b"]', parsed: ["a", "b"] },
  } as const;

  // Expected RQB output for each operator x value combination.
  // `null` = expect an error result (invalid combo).
  // A function receives the parsed value and returns the expected leaf.
  type Expected = Record<string, unknown> | null;

  function leaf(v: unknown): Expected {
    return { field: v };
  }
  function obj(shape: Record<string, unknown>): Expected {
    return { field: shape };
  }

  // Value type predicates for validation-aware expectations
  const isNullVal = (v: unknown) => v === null;
  const isArrVal = (v: unknown) => Array.isArray(v);

  const expectations: Record<string, (parsed: unknown) => Expected> = {
    // --- Comparison operators ---
    // eq: null -> isNull, arrays -> error (use 'in'), otherwise direct value
    eq: (v) => (isArrVal(v) ? null : isNullVal(v) ? obj({ isNull: true }) : leaf(v)),
    // ne: null -> isNotNull, arrays -> error (use 'not_in'), otherwise { ne: v }
    ne: (v) => (isArrVal(v) ? null : isNullVal(v) ? obj({ isNotNull: true }) : obj({ ne: v })),
    // gt/gte/lt/lte: null -> error, arrays -> error
    gt: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ gt: v })),
    gte: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ gte: v })),
    lt: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ lt: v })),
    lte: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ lte: v })),

    // --- String operators: null -> error, arrays -> error ---
    like: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ like: `%${v}%` })),
    ilike: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ like: `%${v}%` })),
    contains: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ like: `%${v}%` })),
    starts_with: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ like: `${v}%` })),
    ends_with: (v) => (isNullVal(v) || isArrVal(v) ? null : obj({ like: `%${v}` })),

    // --- Array operators: null -> error ---
    in: (v) => (isNullVal(v) ? null : obj({ in: isArrVal(v) ? v : [v] })),
    not_in: (v) => (isNullVal(v) ? null : obj({ notIn: isArrVal(v) ? v : [v] })),

    // --- Range: only valid with 2-element array ---
    between: (v) =>
      isArrVal(v) && (v as unknown[]).length === 2 ? obj({ gte: (v as unknown[])[0], lte: (v as unknown[])[1] }) : null,

    // --- Null operators (value-less — parser won't produce a value token) ---
    is_null: () => obj({ isNull: true }),
    is_not_null: () => obj({ isNotNull: true }),
  };

  // Operators that don't take a value (parser handles them differently)
  const nullaryOperators = new Set(["is_null", "is_not_null"]);

  // --- Generate test cases for value-bearing operators ---
  for (const [opName, expectedFn] of Object.entries(expectations)) {
    if (nullaryOperators.has(opName)) {
      continue;
    }

    for (const [valName, valDef] of Object.entries(valueTypes)) {
      const filterExpr = `field ${opName} ${valDef.raw}`;
      const expected = expectedFn(valDef.parsed);

      if (expected === null) {
        // Expect error result (e.g., between with non-array)
        test(`${opName} x ${valName} -> error`, async () => {
          const result = await compileFilter(filterExpr, columns);
          expect(isError(result)).toBe(true);
        });
      } else {
        test(`${opName} x ${valName} -> correct RQB object`, async () => {
          const result = await compileFilter(filterExpr, columns);
          expect(isSuccess(result)).toBe(true);
          if (isSuccess(result)) {
            expect(result.data).toEqual(expected);
          }
        });
      }
    }
  }

  // --- Nullary operators (is_null, is_not_null) ---
  for (const opName of nullaryOperators) {
    const filterExpr = `field ${opName}`;
    const expected = expectations[opName]!(null);

    test(`${opName} (no value) -> correct RQB object`, async () => {
      const result = await compileFilter(filterExpr, columns);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual(expected);
      }
    });
  }

  // --- Nested path variants (ensure nesting works for all operator categories) ---
  const nestedCases: Array<{ label: string; expr: string; expected: Record<string, unknown> }> = [
    { label: "eq string", expr: "nested eq 'x'", expected: { a: { b: { c: "x" } } } },
    { label: "ne string", expr: "nested ne 'x'", expected: { a: { b: { c: { ne: "x" } } } } },
    { label: "eq null", expr: "nested eq null", expected: { a: { b: { c: { isNull: true } } } } },
    { label: "in array", expr: 'nested in ["a","b"]', expected: { a: { b: { c: { in: ["a", "b"] } } } } },
    { label: "is_null", expr: "nested is_null", expected: { a: { b: { c: { isNull: true } } } } },
    { label: "contains", expr: "nested contains 'x'", expected: { a: { b: { c: { like: "%x%" } } } } },
    { label: "gt number", expr: "nested gt 5", expected: { a: { b: { c: { gt: 5 } } } } },
  ];

  for (const { label, expr, expected } of nestedCases) {
    test(`nested path: ${label} -> correct nesting`, async () => {
      const result = await compileFilter(expr, columns);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual(expected);
      }
    });
  }
});

// ============================================================================
// COMPILE SORT TESTS
// ============================================================================

describe("compileSort", () => {
  const columns = {
    title: "title",
    status: "status",
    priority: "priority",
    createdAt: "createdAt",
    tags: "taskTags.tag.name",
  };

  describe("basic sort", () => {
    test("single field ascending", () => {
      const result = compileSort("status:asc", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: "asc" });
      }
    });

    test("single field descending", () => {
      const result = compileSort("createdAt:desc", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ createdAt: "desc" });
      }
    });

    test("defaults to asc when direction omitted", () => {
      const result = compileSort("title", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ title: "asc" });
      }
    });

    test("multiple fields", () => {
      const result = compileSort("status:asc,createdAt:desc", columns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual({ status: "asc", createdAt: "desc" });
      }
    });
  });

  describe("validation", () => {
    test("rejects unknown field", () => {
      const result = compileSort("unknown:asc", columns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Unknown sort field");
        expect(result.error.message).toContain("unknown");
      }
    });

    test("rejects nested relation field", () => {
      const result = compileSort("tags:asc", columns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("nested relation");
        expect(result.error.message).toContain("tags");
        expect(result.error.code).toBe("UNSORTABLE_FIELD");
      }
    });

    test("rejects virtual column (resolver)", () => {
      const resolver: WhereResolver = () => ({ id: { in: [] } });
      const result = compileSort("tags:asc", { ...columns, tags: resolver });

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("virtual column");
        expect(result.error.code).toBe("UNSORTABLE_FIELD");
      }
    });

    test("rejects empty expression", () => {
      const result = compileSort("", columns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Empty sort");
      }
    });
  });
});

describe("compileFilterNode: trees of any shape", () => {
  const cmp = (field: string, value: unknown = 1): FilterNode => ({ type: "comparison", field, operator: "eq", value });

  test("a 50,000-condition hand-built chain compiles, not a RangeError", async () => {
    // Identical branches, so this is about the walk's depth: orWhere drops
    // the repeats. Wide ORs of different branches are timed in distinct.test.ts.
    let chain = cmp("a");
    for (let i = 0; i < 50_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: cmp("a") };
    }
    expect(await compileFilterNode(chain, { a: "a" })).toEqual({ success: true, data: { a: 1 } });
  });

  test("a chain of different conditions is one flat OR", async () => {
    let chain = cmp("a", 0);
    for (let i = 1; i < 1_000; i++) {
      chain = { type: "logical", operator: "or", left: cmp("a", i), right: chain };
    }
    const result = await compileFilterNode(chain, { a: "a" });
    expect(result.success && (result.data.OR as unknown[]).length).toBe(1_000);
  });

  test("100,000 nested groups compile, not a RangeError", async () => {
    let deep = cmp("a");
    for (let i = 0; i < 100_000; i++) {
      deep = { type: "group", expression: deep };
    }
    expect(await compileFilterNode(deep, { a: "a" })).toEqual({ success: true, data: { a: 1 } });
  });

  test("resolvers run left to right, and none after the first error", async () => {
    const calls: unknown[] = [];
    const resolver: WhereResolver = async (_op, value) => {
      calls.push(value);
      if (value === 2) {
        throw new Error("boom");
      }
      return { r: value };
    };
    const node: FilterNode = {
      type: "logical",
      operator: "and",
      left: cmp("r", 1),
      right: { type: "logical", operator: "or", left: cmp("r", 2), right: cmp("r", 3) },
    };
    const result = await compileFilterNode(node, { r: resolver });
    expect(calls).toEqual([1, 2]);
    expect(!result.success && result.error).toMatchObject({
      code: "INVALID_VALUE",
      message: "Resolver failed for r: boom",
    });
  });

  test("a malformed node is a SYNTAX_ERROR, not a rejected promise", async () => {
    const missingRight = { type: "logical", operator: "and", left: cmp("a") } as unknown as FilterNode;
    const result = await compileFilterNode(missingRight, { a: "a" });
    expect(!result.success && result.error).toMatchObject({
      code: "SYNTAX_ERROR",
      message: "Malformed logical node: missing left or right",
    });
  });
});
