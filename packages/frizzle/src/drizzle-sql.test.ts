// ============================================================================
// DRIZZLE SQL CODE GENERATOR TESTS
// ============================================================================
// Tests the DrizzleCodeGenerator class which applies filter, sort, limit, and
// offset to a Drizzle query builder. Also tests compileFilterToSQL and
// compileFilterNodeToSQL convenience functions, and SQLColumnResolver virtual
// column support.
//
// Uses real Drizzle columns for accurate SQL generation testing.

import { and, asc, desc, eq, gt, gte, isNotNull, isNull, like, lt, lte, or } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, test, vi } from "vitest";
import type { ComparisonNode, FilterNode, LogicalNode, QueryAst } from "./ast-types.js";
import {
  compileFilterNodeToSQL,
  compileFilterToSQL,
  DrizzleCodeGenerator,
  generateDrizzleQuery,
} from "./drizzle-sql.js";
import { isError, isSuccess } from "./result-types.js";

// ============================================================================
// TEST TABLE (standalone Drizzle columns for package-level testing)
// ============================================================================

const tasks = sqliteTable("tasks", {
  title: text("title").notNull(),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  assignedToUserId: text("assigned_to_user_id"),
  percentComplete: integer("percent_complete").notNull().default(0),
});

const taskColumns = {
  title: tasks.title,
  status: tasks.status,
  priority: tasks.priority,
  assignedToUserId: tasks.assignedToUserId,
  percentComplete: tasks.percentComplete,
};

// ============================================================================
// SQL COMPARISON UTILITIES
// ============================================================================

/**
 * Normalize a Drizzle SQL chunk for comparison
 * Extracts the essential data from each chunk type, avoiding circular refs
 */
function normalizeChunk(chunk: unknown): unknown {
  if (chunk === null || chunk === undefined) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return chunk;
  }
  if (typeof chunk === "number") {
    return chunk;
  }
  if (typeof chunk === "boolean") {
    return chunk;
  }

  if (typeof chunk === "object") {
    const obj = chunk as Record<string, unknown>;

    // Column: has 'name' and 'columnType' properties
    if ("name" in obj && "columnType" in obj) {
      return { type: "Column", name: obj.name, columnType: obj.columnType };
    }

    // StringChunk: { value: ['string content'] }
    if ("value" in obj && Array.isArray(obj.value) && !("columnType" in obj) && !("name" in obj)) {
      return { type: "StringChunk", value: obj.value };
    }

    // Param: Drizzle wraps params in objects with value property (non-array)
    if ("value" in obj && !Array.isArray(obj.value) && !("columnType" in obj)) {
      return { type: "Param", value: obj.value };
    }

    // Nested SQL object with queryChunks
    if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
      return {
        type: "SQL",
        chunks: (obj.queryChunks as unknown[]).map(normalizeChunk),
      };
    }
  }

  return { type: "Unknown" };
}

/**
 * Normalize a Drizzle SQL object into a comparable structure
 */
function normalizeSql(sql: unknown): unknown[] {
  const chunks = (sql as { queryChunks?: unknown[] }).queryChunks;
  if (!chunks) {
    return [];
  }
  return chunks.map(normalizeChunk);
}

// ============================================================================
// MOCK QUERY BUILDER
// ============================================================================

/**
 * Create a mock query builder that captures method calls and their arguments
 */
function createMockQueryBuilder() {
  const calls: Record<string, unknown[]> = {
    where: [],
    orderBy: [],
    limit: [],
    offset: [],
  };

  const builder = {
    where: vi.fn((condition: unknown) => {
      calls.where.push(condition);
      return builder;
    }),
    orderBy: vi.fn((...args: unknown[]) => {
      calls.orderBy.push(...args);
      return builder;
    }),
    limit: vi.fn((value: number) => {
      calls.limit.push(value);
      return builder;
    }),
    offset: vi.fn((value: number) => {
      calls.offset.push(value);
      return builder;
    }),
  };

  return { builder, calls };
}

// ============================================================================
// AST NODE HELPERS
// ============================================================================

/** Create a comparison node */
function comparison(field: string, operator: ComparisonNode["operator"], value: unknown): ComparisonNode {
  return { type: "comparison", field, operator, value };
}

/** Create an AND logical node */
function andNode(left: FilterNode, right: FilterNode): LogicalNode {
  return { type: "logical", operator: "and", left, right };
}

// ============================================================================
// DRIZZLE CODE GENERATOR TESTS
// ============================================================================

describe("DrizzleCodeGenerator", () => {
  test("generates query with simple filter - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("percentComplete", "gte", 25),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(builder.where).toHaveBeenCalledTimes(1);

    // Verify actual SQL matches expected
    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(gte(taskColumns.percentComplete, 25));
    expect(actualSql).toEqual(expectedSql);
  });

  test("generates query with logical operators - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: andNode(comparison("status", "eq", "in_progress"), comparison("priority", "eq", "high")),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    // Verify actual SQL matches expected
    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(and(eq(taskColumns.status, "in_progress"), eq(taskColumns.priority, "high")));
    expect(actualSql).toEqual(expectedSql);
  });

  test("generates query with sorting - verifies actual orderBy", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      sort: [
        { field: "title", direction: "asc" },
        { field: "priority", direction: "desc" },
      ],
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(builder.orderBy).toHaveBeenCalledTimes(1);

    // Verify orderBy received correct sort expressions
    const actualOrderBy = calls.orderBy.map(normalizeSql);
    const expectedOrderBy = [normalizeSql(asc(taskColumns.title)), normalizeSql(desc(taskColumns.priority))];
    expect(actualOrderBy).toEqual(expectedOrderBy);
  });

  test("generates query with pagination", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      limit: 10,
      offset: 20,
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(calls.limit).toEqual([10]);
    expect(calls.offset).toEqual([20]);
  });

  test("handles unknown column error", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("nonexistent", "eq", "test"),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
      expect(result.error.message).toContain("nonexistent");
    }
  });

  test("generates complete query with filter, sort, and pagination", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: andNode(comparison("percentComplete", "gte", 50), comparison("status", "eq", "in_progress")),
      sort: [{ field: "title", direction: "asc" }],
      limit: 50,
      offset: 10,
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    // Verify filter SQL
    const actualFilterSql = normalizeSql(calls.where[0]);
    const expectedFilterSql = normalizeSql(
      and(gte(taskColumns.percentComplete, 50), eq(taskColumns.status, "in_progress")),
    );
    expect(actualFilterSql).toEqual(expectedFilterSql);

    // Verify sort
    const actualOrderBy = calls.orderBy.map(normalizeSql);
    expect(actualOrderBy).toEqual([normalizeSql(asc(taskColumns.title))]);

    // Verify pagination
    expect(calls.limit).toEqual([50]);
    expect(calls.offset).toEqual([10]);
  });
});

describe("generateDrizzleQuery convenience function", () => {
  test("generates query without creating generator instance", () => {
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("status", "eq", "done"),
    };

    const result = generateDrizzleQuery(ast, builder, taskColumns);

    expect(isSuccess(result)).toBe(true);

    // Verify actual SQL
    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(eq(taskColumns.status, "done"));
    expect(actualSql).toEqual(expectedSql);
  });
});

describe("null value handling", () => {
  test("eq null converts to isNull - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("assignedToUserId", "eq", null),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    // Verify isNull is used, not eq with null
    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(isNull(taskColumns.assignedToUserId));
    expect(actualSql).toEqual(expectedSql);
  });

  test("ne null converts to isNotNull - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("assignedToUserId", "ne", null),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    // Verify isNotNull is used
    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(isNotNull(taskColumns.assignedToUserId));
    expect(actualSql).toEqual(expectedSql);
  });

  test("is_null operator - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("assignedToUserId", "is_null", null),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(isNull(taskColumns.assignedToUserId));
    expect(actualSql).toEqual(expectedSql);
  });

  test("is_not_null operator - verifies actual SQL", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder, calls } = createMockQueryBuilder();

    const ast: QueryAst = {
      filter: comparison("assignedToUserId", "is_not_null", null),
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: taskColumns,
    });

    expect(isSuccess(result)).toBe(true);

    const actualSql = normalizeSql(calls.where[0]);
    const expectedSql = normalizeSql(isNotNull(taskColumns.assignedToUserId));
    expect(actualSql).toEqual(expectedSql);
  });
});

// ============================================================================
// compileFilterNodeToSQL TESTS (direct AST -> SQL conversion)
// ============================================================================

describe("compileFilterNodeToSQL - direct AST conversion", () => {
  test("converts comparison node to Drizzle SQL", () => {
    const result = compileFilterNodeToSQL(comparison("status", "eq", "in_progress"), taskColumns);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualSql = normalizeSql(result.data);
      const expectedSql = normalizeSql(eq(taskColumns.status, "in_progress"));
      expect(actualSql).toEqual(expectedSql);
    }
  });

  test("converts logical AND node to Drizzle SQL", () => {
    const result = compileFilterNodeToSQL(
      andNode(comparison("status", "eq", "done"), comparison("priority", "eq", "high")),
      taskColumns,
    );

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualSql = normalizeSql(result.data);
      const expectedSql = normalizeSql(and(eq(taskColumns.status, "done"), eq(taskColumns.priority, "high")));
      expect(actualSql).toEqual(expectedSql);
    }
  });

  test("returns error for unknown field", () => {
    const result = compileFilterNodeToSQL(comparison("unknownField", "eq", "value"), taskColumns);

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
      expect(result.error.message).toContain("unknownField");
    }
  });
});

// ============================================================================
// compileFilterToSQL TESTS (string -> SQL full integration)
// ============================================================================
// This is the function used in the loader at app/routes/projects/$id.tsx
// It parses the filter expression string and converts to Drizzle SQL

describe("compileFilterToSQL - string to SQL integration", () => {
  describe("comparison operators", () => {
    test("eq with string value", () => {
      const result = compileFilterToSQL("status eq 'in_progress'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(eq(taskColumns.status, "in_progress"));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("gt with number value", () => {
      const result = compileFilterToSQL("percentComplete gt 50", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(gt(taskColumns.percentComplete, 50));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("gte with number value", () => {
      const result = compileFilterToSQL("percentComplete gte 50", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(gte(taskColumns.percentComplete, 50));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("lt with number value", () => {
      const result = compileFilterToSQL("percentComplete lt 100", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(lt(taskColumns.percentComplete, 100));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("lte with number value", () => {
      const result = compileFilterToSQL("percentComplete lte 75", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(lte(taskColumns.percentComplete, 75));
        expect(actualSql).toEqual(expectedSql);
      }
    });
  });

  describe("string operators", () => {
    test("contains generates LIKE %value%", () => {
      const result = compileFilterToSQL("title contains 'Kitchen'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(like(taskColumns.title, "%Kitchen%"));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("starts_with generates LIKE value%", () => {
      const result = compileFilterToSQL("title starts_with 'Fix'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(like(taskColumns.title, "Fix%"));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("ends_with generates LIKE %value", () => {
      const result = compileFilterToSQL("title ends_with 'repair'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(like(taskColumns.title, "%repair"));
        expect(actualSql).toEqual(expectedSql);
      }
    });
  });

  describe("null operators", () => {
    test("eq null generates IS NULL", () => {
      const result = compileFilterToSQL("assignedToUserId eq null", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(isNull(taskColumns.assignedToUserId));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("is_null generates IS NULL", () => {
      const result = compileFilterToSQL("assignedToUserId is_null", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(isNull(taskColumns.assignedToUserId));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("is_not_null generates IS NOT NULL", () => {
      const result = compileFilterToSQL("assignedToUserId is_not_null", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(isNotNull(taskColumns.assignedToUserId));
        expect(actualSql).toEqual(expectedSql);
      }
    });
  });

  describe("validation (SQL generator)", () => {
    test("rejects gt null with TYPE_MISMATCH", () => {
      const result = compileFilterToSQL("percentComplete gt null", taskColumns);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
        expect(result.error.message).toContain("is_null");
      }
    });

    test("rejects contains null with TYPE_MISMATCH", () => {
      const result = compileFilterToSQL("title contains null", taskColumns);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
      }
    });

    test("validation error in AND stops early", () => {
      const result = compileFilterToSQL("status eq 'active' AND percentComplete gt null", taskColumns);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
      }
    });
  });

  describe("logical operators", () => {
    test("AND combines two conditions", () => {
      const result = compileFilterToSQL("status eq 'in_progress' AND priority eq 'high'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(and(eq(taskColumns.status, "in_progress"), eq(taskColumns.priority, "high")));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("OR combines two conditions", () => {
      const result = compileFilterToSQL("status eq 'done' OR percentComplete eq 100", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(or(eq(taskColumns.status, "done"), eq(taskColumns.percentComplete, 100)));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("nested AND and OR with parentheses", () => {
      const result = compileFilterToSQL(
        "(status eq 'in_progress' OR status eq 'not_started') AND percentComplete lt 50",
        taskColumns,
      );

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(
          and(
            or(eq(taskColumns.status, "in_progress"), eq(taskColumns.status, "not_started")),
            lt(taskColumns.percentComplete, 50),
          ),
        );
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("multiple ANDs compile to one flat and()", () => {
      const result = compileFilterToSQL(
        "status eq 'in_progress' AND priority eq 'high' AND percentComplete gte 50",
        taskColumns,
      );

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(
          and(
            eq(taskColumns.status, "in_progress"),
            eq(taskColumns.priority, "high"),
            gte(taskColumns.percentComplete, 50),
          ),
        );
        expect(actualSql).toEqual(expectedSql);
      }
    });
  });

  describe("real-world filter expressions (loader use cases)", () => {
    test("filter by title containing text", () => {
      const result = compileFilterToSQL("title contains 'countertop'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(like(taskColumns.title, "%countertop%"));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("filter unassigned high-priority tasks", () => {
      const result = compileFilterToSQL("assignedToUserId is_null AND priority eq 'urgent'", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(and(isNull(taskColumns.assignedToUserId), eq(taskColumns.priority, "urgent")));
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("filter by completion percentage range", () => {
      const result = compileFilterToSQL("percentComplete gte 25 AND percentComplete lte 75", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(
          and(gte(taskColumns.percentComplete, 25), lte(taskColumns.percentComplete, 75)),
        );
        expect(actualSql).toEqual(expectedSql);
      }
    });

    test("filter incomplete or unassigned tasks", () => {
      const result = compileFilterToSQL("percentComplete lt 100 OR assignedToUserId eq null", taskColumns);

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const actualSql = normalizeSql(result.data);
        const expectedSql = normalizeSql(
          or(lt(taskColumns.percentComplete, 100), isNull(taskColumns.assignedToUserId)),
        );
        expect(actualSql).toEqual(expectedSql);
      }
    });
  });

  describe("error handling", () => {
    test("unknown field returns error", () => {
      const result = compileFilterToSQL("unknownField eq 'value'", taskColumns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("UNKNOWN_FIELD");
        expect(result.error.message).toContain("unknownField");
      }
    });

    test("invalid syntax returns error", () => {
      const result = compileFilterToSQL("status eq", taskColumns);

      expect(isError(result)).toBe(true);
    });

    test("unknown field in nested expression returns error", () => {
      const result = compileFilterToSQL("status eq 'done' AND badField eq 'value'", taskColumns);

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("UNKNOWN_FIELD");
      }
    });
  });
});

// ============================================================================
// COLUMN RESOLVER (Virtual Column) TESTS
// ============================================================================

describe("SQLColumnResolver (virtual columns)", () => {
  test("resolver receives correct operator and value", () => {
    const resolver = vi.fn(() => eq(tasks.status, "dummy"));

    const result = compileFilterToSQL('tags eq "bug"', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isSuccess(result)).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith("eq", "bug");
  });

  test("resolver SQL is used in the output", () => {
    const expectedSql = eq(tasks.status, "resolved-value");
    const resolver = vi.fn(() => expectedSql);

    const result = compileFilterToSQL('tags eq "bug"', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualNorm = normalizeSql(result.data);
      const expectedNorm = normalizeSql(expectedSql);
      expect(actualNorm).toEqual(expectedNorm);
    }
  });

  test("resolver works alongside standard columns with AND", () => {
    const resolver = vi.fn(() => eq(tasks.title, "tag-match"));

    const result = compileFilterToSQL('tags eq "bug" AND status eq "open"', { ...taskColumns, tags: resolver });

    expect(isSuccess(result)).toBe(true);
    expect(resolver).toHaveBeenCalledWith("eq", "bug");
    if (isSuccess(result)) {
      const actualNorm = normalizeSql(result.data);
      const expectedNorm = normalizeSql(and(eq(tasks.title, "tag-match"), eq(taskColumns.status, "open")));
      expect(actualNorm).toEqual(expectedNorm);
    }
  });

  test("resolver works alongside standard columns with OR", () => {
    const resolver = vi.fn(() => eq(tasks.title, "tag-match"));

    const result = compileFilterToSQL('tags eq "bug" OR status eq "open"', { ...taskColumns, tags: resolver });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualNorm = normalizeSql(result.data);
      const expectedNorm = normalizeSql(or(eq(tasks.title, "tag-match"), eq(taskColumns.status, "open")));
      expect(actualNorm).toEqual(expectedNorm);
    }
  });

  test("resolver works in grouped expressions", () => {
    const resolver = vi.fn(() => eq(tasks.title, "tag-match"));

    const result = compileFilterToSQL('(tags eq "bug" OR status eq "open") AND priority eq "high"', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualNorm = normalizeSql(result.data);
      const expectedNorm = normalizeSql(
        and(or(eq(tasks.title, "tag-match"), eq(taskColumns.status, "open")), eq(taskColumns.priority, "high")),
      );
      expect(actualNorm).toEqual(expectedNorm);
    }
  });

  test("resolver error is caught and returned as INVALID_VALUE", () => {
    const resolver = vi.fn(() => {
      throw new Error("DB connection failed");
    });

    const result = compileFilterToSQL('tags eq "bug"', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.message).toContain("Column resolver failed for tags");
      expect(result.error.message).toContain("DB connection failed");
    }
  });

  test("unknown field still errors even with resolvers present", () => {
    const resolver = vi.fn(() => eq(tasks.status, "dummy"));

    const result = compileFilterToSQL('nonexistent eq "value"', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
    }
  });

  test("cannot sort by virtual column", () => {
    const generator = new DrizzleCodeGenerator();
    const { builder } = createMockQueryBuilder();
    const resolver = vi.fn(() => eq(tasks.status, "dummy"));

    const ast: QueryAst = {
      sort: [{ field: "tags", direction: "asc" }],
    };

    const result = generator.generate(ast, {
      baseQuery: builder,
      tableColumns: { ...taskColumns, tags: resolver },
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.message).toBe("Cannot sort by virtual column: tags");
      expect(result.error.code).toBe("UNSORTABLE_FIELD");
      expect(result.error.field).toBe("tags");
    }
  });

  test("sorting by an unmapped field is UNKNOWN_FIELD", () => {
    const { builder } = createMockQueryBuilder();
    const result = new DrizzleCodeGenerator().generate(
      { sort: [{ field: "nope", direction: "asc" }] },
      { baseQuery: builder, tableColumns: taskColumns },
    );
    expect(!result.success && result.error.code).toBe("UNKNOWN_FIELD");
  });

  test("a hand-built sort node with an invalid direction is rejected", () => {
    const { builder } = createMockQueryBuilder();
    const result = new DrizzleCodeGenerator().generate(
      { sort: [{ field: "title", direction: "sideways" as "asc" }] },
      { baseQuery: builder, tableColumns: taskColumns },
    );
    expect(!result.success && result.error.code).toBe("INVALID_VALUE");
  });

  test("resolver receives array value from in operator", () => {
    const resolver = vi.fn(() => eq(tasks.status, "dummy"));

    const result = compileFilterToSQL('tags in ["bug", "feature"]', {
      ...taskColumns,
      tags: resolver,
    });

    expect(isSuccess(result)).toBe(true);
    expect(resolver).toHaveBeenCalledWith("in", ["bug", "feature"]);
  });
});

// ============================================================================
// SCHEMA VALIDATION IN compileFilterToSQL
// ============================================================================

describe("compileFilterToSQL: schema validation", () => {
  const schema = {
    status: { type: "enum" as const, enumValues: ["active", "pending"] },
    percentComplete: { type: "number" as const, min: 0, max: 100 },
  };

  test("passes valid filter with schema", () => {
    const result = compileFilterToSQL("status eq 'active'", taskColumns, {
      schema,
    });
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const actualSql = normalizeSql(result.data);
      const expectedSql = normalizeSql(eq(taskColumns.status, "active"));
      expect(actualSql).toEqual(expectedSql);
    }
  });

  test("rejects unknown field when schema provided", () => {
    const result = compileFilterToSQL("unknown eq 'x'", taskColumns, {
      schema,
    });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
    }
  });

  test("rejects invalid enum value when schema provided", () => {
    const result = compileFilterToSQL("status eq 'invalid'", taskColumns, {
      schema,
    });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("INVALID_VALUE");
    }
  });

  test("rejects incompatible operator when schema provided", () => {
    const result = compileFilterToSQL("percentComplete like 'text'", taskColumns, {
      schema,
    });
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("INVALID_OPERATOR");
    }
  });

  test("skips validation when options not provided", () => {
    const result = compileFilterToSQL("status eq 'anything'", taskColumns);
    expect(isSuccess(result)).toBe(true);
  });
});
