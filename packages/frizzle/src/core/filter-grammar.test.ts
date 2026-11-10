// ============================================================================
// FILTER GRAMMAR TESTS
// ============================================================================
// Pins the combinator grammar's behavior, then checks it against the
// deprecated Lexer + PrattParser: on thousands of generated inputs both must
// agree on accept/reject and, when they accept, on the AST.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { FilterNode } from "../ast-types.js";
import { serializeFilterNode } from "../query-string.js";
import { isError, isSuccess } from "../result-types.js";
import { parseFilterGrammar, parseFilterValue } from "./filter-grammar.js";
import { tokenizeFilterExpression } from "./lexer.js";
import { parseTokens } from "./parser.js";

/** The deprecated Lexer + PrattParser path, as a reference implementation. */
const parseLegacy = (input: string) => {
  const tokens = tokenizeFilterExpression(input);
  return isError(tokens) ? tokens : parseTokens(tokens.data, input);
};

const ok = (input: string): FilterNode => {
  const result = parseFilterGrammar(input);
  if (!isSuccess(result)) {
    throw new Error(`expected "${input}" to parse: ${result.error.message}`);
  }
  return result.data;
};

const err = (input: string) => {
  const result = parseFilterGrammar(input);
  if (!isError(result)) {
    throw new Error(`expected "${input}" to be rejected`);
  }
  return result.error;
};

describe("parseFilterGrammar()", () => {
  describe("values", () => {
    test.each([
      ["age gte 18", 18],
      ["age gt -5", -5],
      ["score eq 1.5", 1.5],
      ["name eq 'John Doe'", "John Doe"],
      ['name eq "it\\"s"', 'it"s'],
      ["name eq '0'", "0"],
      ["active eq TRUE", true],
      ["deleted eq null", null],
      ["status eq active", "active"],
      ["tags in ['a', 'b']", ["a", "b"]],
      ['tags in ["a", 1, true, null]', ["a", 1, true, null]],
      ["tags in []", []],
      ["age between [18, 65]", [18, 65]],
      ["name eq '50%25 off'", "50%25 off"],
    ])("%s", (input, expected) => {
      expect(ok(input)).toMatchObject({ type: "comparison", value: expected });
    });

    test("single-quoted array elements use the same escapes as scalar strings", () => {
      // The old JSON-with-quote-swap fallback turned this into `it"s`.
      expect(ok("names in ['it\\'s']")).toMatchObject({ value: ["it's"] });
    });

    test("null-check operators take no value", () => {
      expect(ok("dueDate is_null")).toEqual({ type: "comparison", field: "dueDate", operator: "is_null", value: null });
    });

    test("symbol operators normalize to named ones", () => {
      expect(ok("age>=18")).toMatchObject({ field: "age", operator: "gte", value: 18 });
      expect(ok("age != 3")).toMatchObject({ operator: "ne" });
    });

    test("dotted relation paths are one field", () => {
      expect(ok("author.name eq 'x'")).toMatchObject({ field: "author.name" });
    });
  });

  describe("precedence", () => {
    test("AND binds tighter than OR, both left-associative", () => {
      expect(serializeFilterNode(ok("a eq 1 or b eq 2 and c eq 3 or d eq 4"))).toBe(
        "a eq 1 or b eq 2 and c eq 3 or d eq 4",
      );
      const tree = ok("a eq 1 or b eq 2 and c eq 3");
      expect(tree).toMatchObject({ operator: "or", right: { operator: "and" } });
      expect(ok("a eq 1 and b eq 2 and c eq 3")).toMatchObject({ operator: "and", left: { operator: "and" } });
    });

    test("parentheses produce a group node", () => {
      expect(ok("(a eq 1 or b eq 2) and c eq 3")).toMatchObject({
        operator: "and",
        left: { type: "group", expression: { operator: "or" } },
      });
    });
  });

  describe("errors", () => {
    test.each([
      ["name eq 'abc", "Unterminated string literal", 8],
      ["name eq 'abc\\'", "Unterminated string literal", 8],
      ["tags in [1,2", "Unterminated array literal", 8],
      ["v eq 1.2.3", "Invalid number", 5],
      ["v eq 18abc", "Invalid number", 5],
      ["(age >= 18", "Unbalanced parentheses: missing closing parenthesis", 10],
      [">= 18", "Expected field or '(', got '>='", 0],
      ["age 18", "Expected operator, got '18'", 4],
      ["age >=", "Expected value, got end of input", 6],
      ["age >= 18 18", "Expected and, or or end of input, got '18'", 10],
      ["tags in [1,,2]", "Expected array element, got ','", 11],
      ["age gt 18 and", "Expected field or '(', got end of input", 13],
      ["status eq in", "Expected value, got 'in'", 10],
      ["tags in [[1],[2]]", "Expected array element or ']', got '['", 9],
    ])("%s", (input, message, position) => {
      expect(err(input)).toMatchObject({ message, position });
    });

    test("BETWEEN checks are INVALID_VALUE at the value", () => {
      expect(err("age between 5")).toMatchObject({ code: "INVALID_VALUE", position: 12 });
      expect(err("age between [1,2,3]")).toMatchObject({
        code: "INVALID_VALUE",
        message: "BETWEEN operator requires exactly 2 values, got 3",
      });
    });
  });
});

// ============================================================================
// DIFFERENTIAL CHECK AGAINST Lexer + PrattParser
// ============================================================================

// Fragments that exercise every token class, joined with or without spaces so
// the generator also produces glued forms like "age>=18" and "ageeq".
const FRAGMENTS = [
  "ilike",
  "ends_with",
  "[-1, 2.5]",
  '["a\\\\b"]',
  "'tab\there'",
  "age",
  "status",
  "name",
  "author.name",
  "Title",
  "eq",
  "EQ",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "like",
  "contains",
  "starts_with",
  "in",
  "not_in",
  "between",
  "is_null",
  "is_not_null",
  "and",
  "AND",
  "or",
  "Or",
  "(",
  ")",
  "18",
  "-5",
  "0",
  "1.5",
  "007",
  "'a b'",
  "'it\\'s'",
  '"x\\"y"',
  "'0'",
  '"true"',
  "[1,2]",
  "[ 1 , 2 ]",
  '["a",1]',
  "[]",
  '["a","b"]',
  "[[1],[2]]",
  "[1,2,3]",
  "true",
  "FALSE",
  "null",
  "NULL",
  "active",
  "draft",
];

const inputArb = fc
  .tuple(
    fc.array(fc.constantFrom(...FRAGMENTS), { minLength: 1, maxLength: 9 }),
    fc.constantFrom(" ", "  ", "", "\t", "\n", " \r\n "),
  )
  .map(([parts, gap]) => parts.join(gap));

// Inputs shaped like real filters, so a meaningful share of cases are accepted.
const comparisonArb = fc
  .tuple(
    fc.constantFrom("age", "status", "author.name"),
    fc.constantFrom("eq", "=", "gte", ">=", "in", "not_in", "between", "is_null", "like", "ilike", "ends_with"),
    fc.constantFrom(
      "18",
      "-5",
      "1.5",
      "'a b'",
      '"x\\"y"',
      "'50% off_'",
      "[1,2]",
      "[-1, -2.5]",
      '["a","b"]',
      "true",
      "null",
      "active",
      "",
    ),
  )
  .map((parts) => parts.join(" ").trim());
const wellFormedArb = fc
  .tuple(
    fc.array(comparisonArb, { minLength: 1, maxLength: 4 }),
    fc.array(fc.constantFrom(" and ", " OR ", "\tand\n", " or\t"), { minLength: 3, maxLength: 3 }),
    fc.integer({ min: 0, max: 5 }),
  )
  .map(([cs, ops, depth]) => {
    const body = cs.reduce((acc, c, i) => `${acc}${ops[i - 1]}${c}`);
    return `${"(".repeat(depth)}${body}${")".repeat(depth)}`;
  });

const tally = { accepted: 0, rejected: 0 };

const sameOutcome = (input: string) => {
  const legacy = parseLegacy(input);
  tally[legacy.success ? "accepted" : "rejected"]++;
  const grammar = parseFilterGrammar(input);
  expect(grammar.success, `accept/reject differs for: ${input}`).toBe(legacy.success);
  if (legacy.success && grammar.success) {
    expect(grammar.data, input).toEqual(legacy.data);
  }
};

describe("parseFilterValue()", () => {
  test.each([
    ['["Smith, John","Doe"]', ["Smith, John", "Doe"]],
    ['"say \\"hi\\""', 'say "hi"'],
    ["  42 ", 42],
    ["null", null],
    ["active", "active"],
  ])("%s", (input, expected) => {
    const result = parseFilterValue(input);
    expect(isSuccess(result) && result.data).toEqual(expected);
  });

  test.each(["", "a b", "[a,b]", '"open', "age eq 1"])("rejects %j", (input) => {
    expect(isError(parseFilterValue(input))).toBe(true);
  });
});

describe("agrees with the deprecated Lexer + PrattParser", () => {
  test("on random fragment soup", () => {
    fc.assert(fc.property(inputArb, sameOutcome), { numRuns: 5000 });
  });

  test("on well-formed filters", () => {
    fc.assert(fc.property(wellFormedArb, sameOutcome), { numRuns: 3000 });
  });

  test("the generated inputs include plenty of accepted filters", () => {
    // Guards the check above: agreeing only on rejections would prove little.
    expect(tally.accepted).toBeGreaterThan(1000);
  });
});
