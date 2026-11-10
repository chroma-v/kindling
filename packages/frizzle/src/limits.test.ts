// ============================================================================
// PARSE LIMITS & STRICT QUERY-STRING PARSING
// ============================================================================
// Guards that turn oversized or malformed requests into ParseErrors instead of
// runtime failures: maxDepth (nesting), maxParameters (bound values),
// maxLimit / defaultLimit (pagination), and strict sort/limit/offset parsing.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import type { FilterNode } from "./ast-types.js";
import { Compiler } from "./compiler.js";
import { Lexer } from "./core/lexer.js";
import { parseFilterExpression } from "./core/parser.js";
import { compileFilter, compileSort } from "./drizzle-rqb.js";
import { compileFilterToSQL } from "./drizzle-sql.js";
import { query } from "./language.js";
import { parseFilter, validateFilter } from "./parse.js";
import { parseQueryString, parseSort } from "./query-string.js";
import type { Result } from "./result-types.js";
import { createSuccess } from "./result-types.js";
import type { Schema } from "./schema-types.js";

const nested = (depth: number) => `${"(".repeat(depth)}a eq 1${")".repeat(depth)}`;
const list = (n: number) => `region in [${Array(n).fill("'europe'").join(",")}]`;

const dataOf = <T>(result: Result<T>): T => {
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
};

const expectLimitError = (result: Result<unknown>, message: string) => {
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe("LIMIT_EXCEEDED");
    expect(result.error.message).toContain(message);
  }
};

describe("defaults", () => {
  test("are exposed on query.limits", () => {
    expect(query.limits).toMatchObject({ maxDepth: 32, maxParameters: 100, maxConditions: 1000, max: 1000, min: 1 });
  });
});

describe("maxDepth", () => {
  test("allows 32 levels of parentheses by default", () => {
    expect(parseFilterExpression(nested(32)).success).toBe(true);
  });

  test("rejects 33 levels by default", () => {
    expectLimitError(parseFilterExpression(nested(33)), "nested more than 32 levels deep");
  });

  test("returns an error instead of overflowing the stack", () => {
    expect(() => parseFilterExpression(nested(10_000))).not.toThrow();
    expectLimitError(parseFilterExpression(nested(10_000)), "nested more than 32 levels deep");
  });

  test("points at the parenthesis that went too deep", () => {
    const result = parseFilterExpression(`x eq 1 and ${nested(5)}`, { maxDepth: 4 });
    expect(!result.success && result.error.position).toBe(15);
  });

  test("can be raised or lowered", () => {
    expect(parseFilterExpression(nested(50), { maxDepth: 50 }).success).toBe(true);
    expectLimitError(parseFilterExpression(nested(2), { maxDepth: 1 }), "nested more than 1 level deep");
  });
});

describe("maxParameters", () => {
  test("allows 100 values by default", () => {
    expect(parseFilter(list(100)).success).toBe(true);
  });

  test("rejects a 150-item list by default", () => {
    expectLimitError(parseFilter(list(150)), "150 values");
  });

  test("counts values across the whole filter", () => {
    const filter = `${list(60)} and ${list(40)} and age between [1, 2] and name is_null`;
    expectLimitError(parseFilter(filter), "102 values");
    expect(parseFilter(filter, undefined, { maxParameters: 102 }).success).toBe(true);
  });

  test("counts repeated comparisons, not just lists", () => {
    const ors = Array.from({ length: 101 }, (_, i) => `id eq ${i}`).join(" or ");
    expectLimitError(parseFilter(ors), "101 values");
  });

  test("applies through every entry point", () => {
    const region = sqliteTable("t", { region: text("region") }).region;
    expectLimitError(compileFilterToSQL(list(150), { region }), "150 values");
    expect(compileFilterToSQL(list(150), { region }, { maxParameters: 150 }).success).toBe(true);

    const compiler = new Compiler({ codeGenerator: { generate: () => createSuccess(null) }, maxParameters: 10 });
    expectLimitError(compiler.parseFilter(list(11)), "11 values");
    expectLimitError(
      new Compiler({ codeGenerator: { generate: () => createSuccess(null) }, maxDepth: 1 }).parseFilter(nested(2)),
      "nested",
    );
  });

  test("applies to the RQB generator", async () => {
    expectLimitError(await compileFilter(list(150), { region: "region" }), "150 values");
    expect((await compileFilter(list(150), { region: "region" }, { maxParameters: 150 })).success).toBe(true);
  });
});

describe("maxConditions", () => {
  // Null checks bind no parameters, so maxParameters doesn't bound them. A long
  // enough chain used to build a tree deep enough to overflow every recursive
  // walker (the parameter count, both generators, the serializer).
  const nullChecks = (n: number) => Array(n).fill("a is_null").join(" and ");
  const region = sqliteTable("t", { a: text("a") }).a;

  test("allows 1000 conditions by default", () => {
    expect(parseFilter(nullChecks(1000)).success).toBe(true);
  });

  test("rejects 1001 conditions by default", () => {
    expectLimitError(parseFilter(nullChecks(1001)), "1001 conditions; the limit is 1000");
  });

  test("a 20,000-condition chain is an error, not a stack overflow, through every entry point", async () => {
    const chain = nullChecks(20_000);
    expectLimitError(parseFilter(chain), "20000 conditions");
    expectLimitError(compileFilterToSQL(chain, { a: region }), "20000 conditions");
    expectLimitError(await compileFilter(chain, { a: "a" }), "20000 conditions");
    expectLimitError(
      new Compiler({ codeGenerator: { generate: () => createSuccess(null) } }).parseFilter(chain),
      "20000 conditions",
    );
  });

  test("can be raised or lowered", () => {
    expect(parseFilter(nullChecks(1500), undefined, { maxConditions: 1500 }).success).toBe(true);
    expectLimitError(parseFilter(nullChecks(3), undefined, { maxConditions: 2 }), "3 conditions; the limit is 2");
  });
});

describe("per-field maxValues", () => {
  const schema: Schema = { region: { type: "enum", enumValues: ["europe", "asia"], maxValues: 3 } };

  test("allows a list up to the field's cap", () => {
    expect(parseFilter(list(3), schema).success).toBe(true);
  });

  test("rejects a longer list with LIMIT_EXCEEDED", () => {
    expectLimitError(parseFilter(list(4), schema), "Field 'region' accepts at most 3 values; got 4");
    expectLimitError(parseFilter(list(4).replace(" in ", " not_in "), schema), "at most 3 values");
  });

  test("a field without maxValues is capped only by maxParameters", () => {
    const uncapped: Schema = { region: { type: "enum", enumValues: ["europe"] } };
    expect(parseFilter(list(100), uncapped).success).toBe(true);
    expectLimitError(parseFilter(list(101), uncapped), "Filter has 101 values; the limit is 100");
  });

  test("applies only to in / not_in lists", () => {
    const capped: Schema = {
      name: { type: "string", maxValues: 2 },
      n: { type: "number", maxValues: 1 },
    };
    expect(parseFilter("name eq 'abcdef'", capped).success).toBe(true);
    const between: FilterNode = { type: "comparison", field: "n", operator: "between", value: [1, 5] };
    expect(validateFilter(between, capped).success).toBe(true);
  });

  test("SchemaField.max limits the value, not the list length", () => {
    const numbers: Schema = { n: { type: "number", max: 2 } };
    expect(parseFilter("n in [1,1,1,1,1]", numbers).success).toBe(true);
  });
});

describe("validateFilter: hand-built trees", () => {
  const schema: Schema = { region: { type: "enum", enumValues: ["europe"] }, name: { type: "string" } };
  const inList = (n: number): FilterNode => ({
    type: "comparison",
    field: "region",
    operator: "in",
    value: Array(n).fill("europe"),
  });

  test("enforces maxParameters, which SchemaValidator alone does not", () => {
    expectLimitError(validateFilter(inList(150), schema), "Filter has 150 values; the limit is 100");
    expectLimitError(validateFilter(inList(20), schema, { maxParameters: 10 }), "the limit is 10");
    expect(validateFilter(inList(100), schema).success).toBe(true);
  });

  test("counts values across the combined tree", () => {
    const combined: FilterNode = { type: "logical", operator: "and", left: inList(60), right: inList(60) };
    expectLimitError(validateFilter(combined, schema), "Filter has 120 values");
  });

  test("enforces maxConditions and maxDepth without overflowing the stack", () => {
    let chain: FilterNode = { type: "comparison", field: "name", operator: "is_null", value: null };
    for (let i = 0; i < 20_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: chain.type === "logical" ? chain.right : chain };
    }
    expectLimitError(validateFilter(chain, schema), "conditions; the limit is 1000");

    let deep: FilterNode = { type: "comparison", field: "name", operator: "eq", value: "x" };
    for (let i = 0; i < 100_000; i++) {
      deep = { type: "group", expression: deep };
    }
    expectLimitError(validateFilter(deep, schema), "Filter is nested more than 32 levels deep");
  });

  test("a malformed node is a SYNTAX_ERROR, not a thrown TypeError", () => {
    const leaf: FilterNode = { type: "comparison", field: "name", operator: "eq", value: "x" };
    const cases = [
      [{ type: "logical", operator: "and", left: leaf }, "missing left or right"],
      [{ type: "group" }, "missing expression"],
      [{ type: "comparison", operator: "eq", value: 1 }, "missing field"],
      [null, "got null"],
      [{ type: "nope" }, "unknown type 'nope'"],
    ] as const;
    for (const [node, message] of cases) {
      const result = validateFilter(node as unknown as FilterNode, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("SYNTAX_ERROR");
        expect(result.error.message).toContain(message);
      }
    }
  });

  test("shared subtrees are cut off instead of hanging", () => {
    // Each round doubles the tree as walked (2^40 leaves) while adding one node
    let shared: FilterNode = { type: "comparison", field: "name", operator: "is_null", value: null };
    for (let i = 0; i < 40; i++) {
      shared = { type: "logical", operator: "and", left: shared, right: shared };
    }
    const started = Date.now();
    expectLimitError(validateFilter(shared, schema), "Filter is too large to measure");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("runs the schema checks too", () => {
    const result = validateFilter({ type: "comparison", field: "nope", operator: "eq", value: 1 }, schema);
    expect(!result.success && result.error.code).toBe("UNKNOWN_FIELD");
  });
});

describe("Compiler with a custom tokenizer (deprecated path)", () => {
  class CountingLexer extends Lexer {
    calls = 0;
    override tokenize(input: string) {
      this.calls++;
      return super.tokenize(input);
    }
  }
  const codeGenerator = { generate: () => createSuccess(null) };

  test("uses the tokenizer and still enforces the limits", () => {
    const tokenizer = new CountingLexer();
    const compiler = new Compiler({ codeGenerator, tokenizer, maxParameters: 2, maxDepth: 1 });
    expect(compiler.parseFilter("age gte 18").success).toBe(true);
    expectLimitError(compiler.parseFilter(list(3)), "3 values");
    expectLimitError(compiler.parseFilter(nested(2)), "nested more than 1 level deep");
    expect(tokenizer.calls).toBe(3);
  });

  test("returns the tokenizer's error", () => {
    const result = new Compiler({ codeGenerator, tokenizer: new Lexer() }).parseFilter("a eq 'unterminated");
    expect(result.success).toBe(false);
  });

  test("without one, the grammar parses (the two differ on escaped quotes in arrays)", () => {
    const filter = "names in ['it\\'s']";
    const viaGrammar = new Compiler({ codeGenerator }).parseFilter(filter);
    const viaTokenizer = new Compiler({ codeGenerator, tokenizer: new Lexer() }).parseFilter(filter);
    expect(viaGrammar.success && viaGrammar.data).toMatchObject({ value: ["it's"] });
    expect(viaTokenizer.success && viaTokenizer.data).toMatchObject({ value: ['it"s'] });
  });
});

describe("parseQueryString: limit and offset", () => {
  test.each(["10abc", "2.9", "-1", "0", "1e2", " 5", "+5", "0x10"])("rejects limit=%s", (limit) => {
    const result = parseQueryString(`limit=${encodeURIComponent(limit)}`);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_VALUE");
    }
  });

  test.each(["5x", "1.5", "-1", "1e2"])("rejects offset=%s", (offset) => {
    expect(parseQueryString(`offset=${offset}`).success).toBe(false);
  });

  test("accepts plain integers", () => {
    expect(parseQueryString("limit=25&offset=0")).toEqual({ success: true, data: { limit: 25, offset: 0 } });
  });

  test("accepts the smallest limit, and options of 1", () => {
    expect(dataOf(parseQueryString("limit=1"))).toEqual({ limit: 1 });
    expect(dataOf(parseQueryString("limit=1", { maxLimit: 1 }))).toEqual({ limit: 1 });
    expect(dataOf(parseQueryString("", { defaultLimit: 1 }))).toEqual({ limit: 1 });
  });

  test("maxLimit lowers the cap", () => {
    expect(parseQueryString("limit=50", { maxLimit: 50 }).success).toBe(true);
    const result = parseQueryString("limit=51", { maxLimit: 50 });
    expect(!result.success && result.error.message).toBe("Invalid limit: 51. Must be between 1 and 50");
  });

  test("defaultLimit applies only when limit is absent", () => {
    expect(dataOf(parseQueryString("filter=a eq 1", { defaultLimit: 20 }))).toMatchObject({ limit: 20 });
    expect(dataOf(parseQueryString("limit=5", { defaultLimit: 20 }))).toMatchObject({ limit: 5 });
    expect(dataOf(parseQueryString("filter=a eq 1"))).not.toHaveProperty("limit");
  });

  test("a defaultLimit above maxLimit is capped", () => {
    expect(dataOf(parseQueryString("", { maxLimit: 20, defaultLimit: 50 }))).toMatchObject({ limit: 20 });
  });
});

describe("sort direction", () => {
  test("parseSort accepts asc/desc in any case, defaulting to asc", () => {
    expect(parseSort("name:DESC, age, title:asc")).toEqual({
      success: true,
      data: [
        { field: "name", direction: "desc" },
        { field: "age", direction: "asc" },
        { field: "title", direction: "asc" },
      ],
    });
  });

  test.each([
    ["name:sideways", "Invalid sort direction 'sideways' for 'name'. Use asc or desc", 5],
    ["age:asc,name:up", "Invalid sort direction 'up' for 'name'. Use asc or desc", 13],
    [":asc", "Missing sort field", 0],
    ["name:asc:desc", "Invalid sort item 'name:asc:desc'", 0],
  ])("parseSort rejects %s", (sort, message, position) => {
    const result = parseSort(sort);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.message).toBe(message);
      expect(result.error.position).toBe(position);
    }
  });

  test("parseQueryString rejects an invalid direction", () => {
    const result = parseQueryString("sort=name:sideways");
    expect(!result.success && result.error.message).toContain("Invalid sort direction 'sideways'");
  });

  test("RQB compileSort rejects an invalid direction", () => {
    const result = compileSort("name:sideways", { name: "name" });
    expect(!result.success && result.error.code).toBe("INVALID_VALUE");
  });
});

describe("sort validated against a schema", () => {
  const schema: Schema = {
    name: { type: "string" },
    createdAt: { type: "date" },
    notes: { type: "string", sortable: false },
  };

  test("accepts known, sortable fields; fields are sortable by default", () => {
    expect(dataOf(parseSort("name:desc, createdAt", schema))).toEqual([
      { field: "name", direction: "desc" },
      { field: "createdAt", direction: "asc" },
    ]);
  });

  test("rejects an unknown field with suggestions, pointing at the item", () => {
    const result = parseSort("name,nam:asc", schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({ code: "UNKNOWN_FIELD", field: "nam", position: 5 });
      expect(result.error.suggestions).toContain("name");
    }
  });

  test("rejects sortable: false with UNSORTABLE_FIELD", () => {
    const result = parseSort("notes:asc", schema);
    expect(!result.success && result.error).toMatchObject({
      code: "UNSORTABLE_FIELD",
      message: "Field 'notes' can't be sorted",
    });
  });

  test("still rejects a bad direction, and extra segments", () => {
    expect(!parseSort("name:sideways", schema).success).toBe(true);
    expect(!parseSort("name:asc:x", schema).success).toBe(true);
  });

  test("parseQueryString takes the schema for sort", () => {
    const result = parseQueryString("sort=notes:desc", { schema });
    expect(!result.success && result.error.code).toBe("UNSORTABLE_FIELD");
    expect(parseQueryString("sort=notes:desc").success).toBe(true);
  });

  test("Compiler.parse applies sortable too", () => {
    const compiler = new Compiler({ codeGenerator: { generate: () => createSuccess(null) }, schema });
    const result = compiler.parse({ sort: [{ field: "notes", direction: "asc" }] });
    expect(!result.success && result.error.code).toBe("UNSORTABLE_FIELD");
  });
});

describe("limit options must be non-negative integers", () => {
  const codeGenerator = { generate: () => createSuccess(null) };
  const expectInvalidOption = (result: Result<unknown>, option: string) => {
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.message).toContain(option);
    }
  };

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5])(
    "maxDepth: %s is rejected, not treated as unlimited",
    (maxDepth) => {
      const deep = nested(20_000);
      expect(() => parseFilterExpression(deep, { maxDepth })).not.toThrow();
      expectInvalidOption(parseFilterExpression(deep, { maxDepth }), "maxDepth");
    },
  );

  test.each(["maxParameters", "maxConditions"] as const)("%s: NaN is rejected, not treated as unlimited", (option) => {
    expectInvalidOption(parseFilter(list(150), undefined, { [option]: Number.NaN }), option);
  });

  test("null means the default, like undefined", () => {
    expect(parseFilterExpression(nested(32), { maxDepth: null as unknown as number }).success).toBe(true);
    expectLimitError(parseFilterExpression(nested(33), { maxDepth: null as unknown as number }), "32 levels");
  });

  test("0 is a valid limit", () => {
    expect(parseFilterExpression("a eq 1", { maxDepth: 0 }).success).toBe(true);
    expectLimitError(parseFilterExpression("(a eq 1)", { maxDepth: 0 }), "nested more than 0 levels deep");
  });

  test("Compiler rejects invalid limits the same way", () => {
    expectInvalidOption(new Compiler({ codeGenerator, maxDepth: Number.NaN }).parseFilter("a eq 1"), "maxDepth");
  });
});

describe("Compiler.parse: limit and offset", () => {
  const codeGenerator = { generate: () => createSuccess(null) };

  test("honours maxLimit like parseQueryString does", () => {
    const params = parseQueryString("limit=2000", { maxLimit: 5000 });
    expect(params.success).toBe(true);
    const compiler = new Compiler({ codeGenerator, maxLimit: 5000 });
    expect(compiler.parse(dataOf(params)).success).toBe(true);
    expect(new Compiler({ codeGenerator }).parse({ limit: 2000 }).success).toBe(false);
  });

  test.each([Number.NaN, 2.5, 0, -1])("rejects limit %s", (limit) => {
    expect(new Compiler({ codeGenerator }).parse({ limit }).success).toBe(false);
  });

  test.each([Number.NaN, 1.5, -1])("rejects offset %s", (offset) => {
    const result = new Compiler({ codeGenerator }).parse({ offset });
    expect(!result.success && result.error).toMatchObject({
      code: "INVALID_VALUE",
      message: `Invalid offset: ${offset}. Must be a non-negative integer`,
    });
  });

  test("accepts a maxLimit of 1", () => {
    expect(dataOf(new Compiler({ codeGenerator, maxLimit: 1 }).parse({ limit: 1 }))).toEqual({ limit: 1 });
  });

  test.each([0, 2.5, Number.NaN])("rejects a maxLimit of %s when a limit is given", (maxLimit) => {
    const result = new Compiler({ codeGenerator, maxLimit }).parse({ limit: 1 });
    expect(!result.success && result.error).toMatchObject({
      code: "INVALID_VALUE",
      message: `Invalid maxLimit: ${maxLimit}. Must be a positive integer`,
    });
  });

  test("returns the filter's parse error", () => {
    const result = new Compiler({ codeGenerator }).parse({ filter: "a eq", limit: 10 });
    expect(!result.success && result.error.code).toBe("SYNTAX_ERROR");
  });
});

describe("parseQueryString: maxLimit and defaultLimit must be positive integers", () => {
  test.each([
    [{ defaultLimit: 0 }, "defaultLimit"],
    [{ defaultLimit: -5 }, "defaultLimit"],
    [{ defaultLimit: 2.5 }, "defaultLimit"],
    [{ maxLimit: 0 }, "maxLimit"],
    [{ maxLimit: Number.NaN }, "maxLimit"],
  ])("%o is rejected", (options, option) => {
    const result = parseQueryString("", options);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.message).toContain(option);
    }
  });
});
