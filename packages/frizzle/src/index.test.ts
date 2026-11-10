// ============================================================================
// PUBLIC API VERIFICATION TESTS
// ============================================================================
// Verifies that the public API exports work correctly

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DrizzleQueryTable } from "./drizzle.js";
import { createDrizzleAdapter, DrizzleCodeGenerator } from "./drizzle.js";
import {
  createCompiler,
  createExecutableQuery,
  createQuery,
  isSuccess,
  mergeFilters,
  parseQueryString,
  type QueryAdapter,
  type Schema,
} from "./index.js";

// ============================================================================
// TEST SETUP
// ============================================================================

const testSchema: Schema = {
  id: { type: "string" },
  name: { type: "string" },
  age: { type: "number", min: 0, max: 150 },
  active: { type: "boolean" },
} as const;

const mockColumns = {
  id: { name: "id" },
  name: { name: "name" },
  age: { name: "age" },
  active: { name: "active" },
} as any;

let mockBaseQuery: {
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockBaseQuery = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  };
});

// ============================================================================
// PUBLIC API TESTS
// ============================================================================

describe("Public API", () => {
  test("should export createCompiler", () => {
    const compiler = createCompiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    expect(compiler).toBeDefined();
  });

  test("should export DrizzleCodeGenerator", () => {
    const generator = new DrizzleCodeGenerator();
    expect(generator).toBeDefined();
  });

  test("should export parseQueryString from web layer", () => {
    const result = parseQueryString("filter=age gte 18&limit=50");
    expect(isSuccess(result)).toBe(true);
  });

  test("should work end-to-end through public API", () => {
    // 1. Create compiler
    const compiler = createCompiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    // 2. Parse URL query string (web layer)
    const paramsResult = parseQueryString("filter=age gte 18&sort=name:asc&limit=50");
    expect(isSuccess(paramsResult)).toBe(true);

    if (!isSuccess(paramsResult)) {
      return;
    }

    // 3. Parse into AST
    const astResult = compiler.parse(paramsResult.data);
    expect(isSuccess(astResult)).toBe(true);

    if (!isSuccess(astResult)) {
      return;
    }

    // 4. Compile to Drizzle query
    const queryResult = compiler.compile(astResult.data, {
      baseQuery: mockBaseQuery,
      tableColumns: mockColumns,
    });
    expect(isSuccess(queryResult)).toBe(true);

    // 5. Verify query builder methods were called
    expect(mockBaseQuery.where).toHaveBeenCalled();
    expect(mockBaseQuery.orderBy).toHaveBeenCalled();
    expect(mockBaseQuery.limit).toHaveBeenCalledWith(50);
  });

  test("should support simplified single-step compilation", () => {
    const compiler = createCompiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    const result = compiler.compileFilter("age gte 18 AND active eq true", {
      baseQuery: mockBaseQuery,
      tableColumns: mockColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(mockBaseQuery.where).toHaveBeenCalled();
  });
});

// ============================================================================
// QUERY ALGEBRA EXPORT TESTS
// ============================================================================

describe("Query Algebra Public API", () => {
  test("should export createQuery", () => {
    const q = createQuery();
    expect(q).toBeDefined();
    expect(q.config()).toEqual({ filter: {} });
  });

  test("should export mergeFilters", () => {
    const result = mergeFilters({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test("should export createExecutableQuery", async () => {
    const adapter: QueryAdapter<{ id: string }> = {
      findMany: async () => [{ id: "1" }],
      findFirst: async () => ({ id: "1" }),
    };

    const q = createExecutableQuery(adapter);
    const results = await q.filter({ id: "1" }).findMany();
    expect(results).toEqual([{ id: "1" }]);
  });

  test("should export createDrizzleAdapter from frizzle/drizzle", async () => {
    const mockTable: DrizzleQueryTable<{ id: string }> = {
      findMany: async () => [],
      findFirst: async () => undefined,
    };

    const adapter = createDrizzleAdapter(mockTable);
    expect(adapter).toBeDefined();
    expect(typeof adapter.findMany).toBe("function");
    expect(typeof adapter.findFirst).toBe("function");
  });

  test("Query composition is immutable", () => {
    const q1 = createQuery<unknown>();
    const q2 = q1.filter({ status: "active" });

    expect(q1.config().filter).toEqual({});
    expect(q2.config().filter).toEqual({ status: "active" });
  });
});
