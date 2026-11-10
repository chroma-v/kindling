// ============================================================================
// COMPILER TESTS (Clean Generic API)
// ============================================================================

import { beforeEach, describe, expect, test, vi } from "vitest";
import { Compiler, createCompiler } from "./compiler.js";
import { DrizzleCodeGenerator } from "./drizzle.js";
import { parseQueryString } from "./query-string.js";
import { isError, isSuccess } from "./result-types.js";
import type { Schema } from "./schema-types.js";

// ============================================================================
// TEST SETUP
// ============================================================================

const testSchema: Schema = {
  id: { type: "string" },
  name: { type: "string" },
  age: { type: "number", min: 0, max: 150 },
  email: { type: "string" },
  active: { type: "boolean" },
  role: {
    type: "enum",
    enumValues: ["admin", "user", "guest"],
  },
} as const;

const mockColumns = {
  id: { name: "id" },
  name: { name: "name" },
  age: { name: "age" },
  email: { name: "email" },
  active: { name: "active" },
  role: { name: "role" },
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
// COMPILER CREATION TESTS
// ============================================================================

describe("Compiler Creation", () => {
  test("should create compiler with minimal options", () => {
    const compiler = new Compiler({
      codeGenerator: new DrizzleCodeGenerator(),
    });

    expect(compiler).toBeInstanceOf(Compiler);
  });

  test("should create compiler with schema", () => {
    const compiler = new Compiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    expect(compiler).toBeInstanceOf(Compiler);
  });

  test("should create compiler using factory function", () => {
    const compiler = createCompiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    expect(compiler).toBeInstanceOf(Compiler);
  });
});

// ============================================================================
// PARSE FILTER TESTS
// ============================================================================

describe("compiler.parseFilter()", () => {
  const compiler = createCompiler({
    codeGenerator: new DrizzleCodeGenerator(),
  });

  test("should parse simple filter expression", () => {
    const result = compiler.parseFilter("age gte 18");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.type).toBe("comparison");
      expect(result.data).toMatchObject({
        type: "comparison",
        field: "age",
        operator: "gte",
        value: 18,
      });
    }
  });

  test("should parse complex filter with AND", () => {
    const result = compiler.parseFilter("age gte 18 AND active eq true");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.type).toBe("logical");
    }
  });

  test("should validate against schema if provided", () => {
    const validatingCompiler = createCompiler({
      schema: testSchema,
      codeGenerator: new DrizzleCodeGenerator(),
    });

    const result = validatingCompiler.parseFilter("unknown_field eq 'test'");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("UNKNOWN_FIELD");
    }
  });
});

// ============================================================================
// PARSE FULL QUERY TESTS
// ============================================================================

describe("compiler.parse()", () => {
  const compiler = createCompiler({
    codeGenerator: new DrizzleCodeGenerator(),
  });

  test("should parse query with all components", () => {
    const result = compiler.parse({
      filter: "age gte 18",
      sort: [{ field: "name", direction: "asc" }],
      limit: 50,
      offset: 10,
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBeDefined();
      expect(result.data.sort).toHaveLength(1);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(10);
    }
  });

  test("should parse filter-only query", () => {
    const result = compiler.parse({
      filter: "age gte 18 AND active eq true",
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBeDefined();
      expect(result.data.sort).toBeUndefined();
    }
  });

  test("should validate limit range", () => {
    const result = compiler.parse({
      limit: 9999,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.message).toContain("limit");
    }
  });
});

// ============================================================================
// COMPILE TESTS
// ============================================================================

describe("compiler.compile()", () => {
  const compiler = createCompiler({
    codeGenerator: new DrizzleCodeGenerator(),
  });

  test("should compile AST to Drizzle query", () => {
    const ast = {
      filter: {
        type: "comparison" as const,
        field: "age",
        operator: "gte" as const,
        value: 18,
      },
    };

    const result = compiler.compile(ast, {
      baseQuery: mockBaseQuery,
      tableColumns: mockColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(mockBaseQuery.where).toHaveBeenCalled();
  });
});

// ============================================================================
// CONVENIENCE METHOD TESTS
// ============================================================================

describe("compiler.compileFilter()", () => {
  const compiler = createCompiler({
    codeGenerator: new DrizzleCodeGenerator(),
  });

  test("should parse and compile in one step", () => {
    const result = compiler.compileFilter("age gte 18 AND active eq true", {
      baseQuery: mockBaseQuery,
      tableColumns: mockColumns,
    });

    expect(isSuccess(result)).toBe(true);
    expect(mockBaseQuery.where).toHaveBeenCalled();
  });
});

// ============================================================================
// WEB LAYER INTEGRATION TESTS
// ============================================================================

describe("Web Layer Integration", () => {
  const compiler = createCompiler({
    codeGenerator: new DrizzleCodeGenerator(),
  });

  test("should work with URL query string parsing (string)", () => {
    // Web layer parses URL from string
    const paramsResult = parseQueryString("filter=age gte 18&sort=name:asc&limit=50");
    expect(isSuccess(paramsResult)).toBe(true);

    if (isSuccess(paramsResult)) {
      // Compiler parses and compiles
      const astResult = compiler.parse(paramsResult.data);
      expect(isSuccess(astResult)).toBe(true);

      if (isSuccess(astResult)) {
        const queryResult = compiler.compile(astResult.data, {
          baseQuery: mockBaseQuery,
          tableColumns: mockColumns,
        });
        expect(isSuccess(queryResult)).toBe(true);
        expect(mockBaseQuery.where).toHaveBeenCalled();
        expect(mockBaseQuery.orderBy).toHaveBeenCalled();
        expect(mockBaseQuery.limit).toHaveBeenCalledWith(50);
      }
    }
  });

  test("should work with URL object", () => {
    // Web layer parses URL from URL object
    const url = new URL("https://example.com/tasks?filter=age gte 18&sort=name:asc&limit=50");
    const paramsResult = parseQueryString(url);
    expect(isSuccess(paramsResult)).toBe(true);

    if (isSuccess(paramsResult)) {
      const astResult = compiler.parse(paramsResult.data);
      expect(isSuccess(astResult)).toBe(true);

      if (isSuccess(astResult)) {
        const queryResult = compiler.compile(astResult.data, {
          baseQuery: mockBaseQuery,
          tableColumns: mockColumns,
        });
        expect(isSuccess(queryResult)).toBe(true);
        expect(mockBaseQuery.where).toHaveBeenCalled();
        expect(mockBaseQuery.orderBy).toHaveBeenCalled();
        expect(mockBaseQuery.limit).toHaveBeenCalledWith(50);
      }
    }
  });

  test("should work with URLSearchParams", () => {
    // Web layer parses URL from URLSearchParams
    const searchParams = new URLSearchParams("filter=age gte 18&sort=name:asc&limit=50");
    const paramsResult = parseQueryString(searchParams);
    expect(isSuccess(paramsResult)).toBe(true);

    if (isSuccess(paramsResult)) {
      const astResult = compiler.parse(paramsResult.data);
      expect(isSuccess(astResult)).toBe(true);

      if (isSuccess(astResult)) {
        const queryResult = compiler.compile(astResult.data, {
          baseQuery: mockBaseQuery,
          tableColumns: mockColumns,
        });
        expect(isSuccess(queryResult)).toBe(true);
        expect(mockBaseQuery.where).toHaveBeenCalled();
        expect(mockBaseQuery.orderBy).toHaveBeenCalled();
        expect(mockBaseQuery.limit).toHaveBeenCalledWith(50);
      }
    }
  });
});
