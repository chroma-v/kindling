// ============================================================================
// ROUND-TRIP PROPERTY TESTS (fast-check)
// ============================================================================
//
// Property-based tests for the parse <-> serialize boundary. Example tests
// pin specific cases; these generate thousands of random-but-valid ASTs and
// assert structural invariants that must hold for *every* input.
//
// The headline property is serialize -> parse -> serialize *idempotence*: the
// string form is a fixed point of (serialize . parse). This is robust to AST
// normalization the parser is free to perform (unwrapping redundant groups,
// re-associating AND/OR chains) because it compares the surface string, not
// the tree shape.
//
// Generators cover the FULL value domain — including number/boolean-shaped
// strings, negative numbers, and strings/array-elements containing structural
// characters (quotes, backslashes, commas, brackets). These exercised three
// real round-trip bugs that were since fixed in the lexer/parser; the
// "round-trip regressions" block at the bottom pins the specific cases.
// ============================================================================

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { ComparisonNode, ComparisonOperator, FilterNode, SortNode } from "./ast-types.js";
import { parseFilterValue } from "./core/filter-grammar.js";
import { parseFilter } from "./parse.js";
import { parseSortExpression, serializeFilterNode, serializeFilterValue } from "./query-string.js";
import { isSuccess } from "./result-types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Field names from a fixed pool that can never collide with operators,
// logical keywords (and/or), or literals (null/true/false).
const FIELDS = ["name", "age", "status", "priority", "title", "count", "score", "email", "active", "city", "amount"];
const fieldArb = fc.constantFrom(...FIELDS);

// Full string domain, including the characters that previously broke parsing:
// quotes, backslash, comma, brackets, parens. Quoted strings round-trip
// verbatim regardless of content (including values that look like numbers,
// booleans, null, or arrays — those stay strings). Control characters and
// line/paragraph separators matter inside arrays, whose double-quoted
// elements are read as JSON.
const STRING_CHARS = [..."abcdeABCDE012 _-.,:'\"\\[]()%", "\n", "\t", "\r", "\u0001", "\u2028", "é"];
const stringValueArb = fc.array(fc.constantFrom(...STRING_CHARS), { maxLength: 16 }).map((cs) => cs.join(""));

// Integers (incl. negatives), a few decimals, and values that String()
// writes in exponent form (1e-7, 1e+21).
const numberValueArb = fc.oneof(
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.constantFrom(1.5, -2.25, 100.01, 0.5, -0.25, 1e-7, -1e-9, 1e21, 1.5e300, Number.MAX_SAFE_INTEGER),
);
const scalarValueArb = fc.oneof(numberValueArb, fc.boolean(), stringValueArb);

const SCALAR_OPS: ComparisonOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte"];
const STRING_OPS: ComparisonOperator[] = ["like", "ilike", "starts_with", "ends_with", "contains"];
const ARRAY_OPS: ComparisonOperator[] = ["in", "not_in"];
const NULL_OPS: ComparisonOperator[] = ["is_null", "is_not_null"];

// Comparison nodes that carry a value (scalar / string / array operators).
// Used for the strict value-fidelity property.
const valuedComparisonArb: fc.Arbitrary<ComparisonNode> = fc.oneof(
  fc.record({
    type: fc.constant("comparison" as const),
    field: fieldArb,
    operator: fc.constantFrom(...SCALAR_OPS),
    value: scalarValueArb,
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fieldArb,
    operator: fc.constantFrom(...STRING_OPS),
    value: stringValueArb,
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fieldArb,
    operator: fc.constantFrom(...ARRAY_OPS),
    value: fc.array(fc.oneof(numberValueArb, stringValueArb), { minLength: 1, maxLength: 4 }),
  }),
);

// Any comparison, including value-less null operators.
const anyComparisonArb: fc.Arbitrary<ComparisonNode> = fc.oneof(
  valuedComparisonArb,
  fc.record({
    type: fc.constant("comparison" as const),
    field: fieldArb,
    operator: fc.constantFrom(...NULL_OPS),
    value: fc.constant(null),
  }),
);

// Recursive filter: comparison leaves combined by AND/OR. Bounded depth so
// generation terminates. (Group nodes are intentionally excluded — they
// normalize away on re-parse and are covered by example tests instead.)
const filterNodeArb: fc.Arbitrary<FilterNode> = fc.letrec<{ node: FilterNode }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, depthIdentifier: "filter" },
    anyComparisonArb,
    fc.record({
      type: fc.constant("logical" as const),
      operator: fc.constantFrom("and" as const, "or" as const),
      left: tie("node"),
      right: tie("node"),
    }),
  ),
})).node;

const sortNodesArb: fc.Arbitrary<SortNode[]> = fc.array(
  fc.record({ field: fieldArb, direction: fc.constantFrom("asc" as const, "desc" as const) }),
  { maxLength: 5 },
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("frizzle round-trip properties", () => {
  test("parse never throws and succeeds on any well-formed filter (totality)", () => {
    fc.assert(
      fc.property(filterNodeArb, (node) => {
        const result = parseFilter(serializeFilterNode(node));
        expect(isSuccess(result)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  test("serialize -> parse -> serialize is idempotent for any filter", () => {
    fc.assert(
      fc.property(filterNodeArb, (node) => {
        const s1 = serializeFilterNode(node);
        const parsed = parseFilter(s1);
        expect(isSuccess(parsed)).toBe(true);
        if (isSuccess(parsed)) {
          const s2 = serializeFilterNode(parsed.data);
          expect(s2).toBe(s1);
        }
      }),
      { numRuns: 300 },
    );
  });

  test("comparison nodes preserve field, operator, and value type through a round-trip", () => {
    fc.assert(
      fc.property(valuedComparisonArb, (node) => {
        const parsed = parseFilter(serializeFilterNode(node));
        expect(isSuccess(parsed)).toBe(true);
        if (isSuccess(parsed)) {
          // Single comparison serializes with no parens/precedence, so the
          // parsed tree is exactly one comparison node and must match.
          expect(parsed.data).toEqual(node);
        }
      }),
      { numRuns: 300 },
    );
  });

  test("a value round-trips through serializeFilterValue -> parseFilterValue", () => {
    const valueArb = fc.oneof(fc.constant(null), scalarValueArb, fc.array(stringValueArb, { maxLength: 6 }));
    fc.assert(
      fc.property(valueArb, (value) => {
        const parsed = parseFilterValue(serializeFilterValue(value));
        expect(isSuccess(parsed) && parsed.data).toEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  test("sort expressions round-trip through parseSortExpression", () => {
    fc.assert(
      fc.property(sortNodesArb, (sortNodes) => {
        const serialized = sortNodes.map((s) => `${s.field}:${s.direction}`).join(",");
        expect(parseSortExpression(serialized)).toEqual(sortNodes);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip regressions (previously broken; pinned so they can't recur)
// ---------------------------------------------------------------------------
//
// Each case below was a real defect the property tests above surfaced. They
// are now fixed in the lexer/parser (quoted strings are no longer coerced by
// content, the array tokenizer is quote-aware, and negative numbers parse as
// numbers). Keep these as concrete documentation + guards.

describe("frizzle round-trip — regressions", () => {
  test("a quoted number-shaped string keeps its string type", () => {
    const node: ComparisonNode = { type: "comparison", field: "name", operator: "eq", value: "0" };
    const parsed = parseFilter(serializeFilterNode(node));
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toBe("0");
    }
  });

  test("a quoted boolean-shaped string keeps its string type", () => {
    const node: ComparisonNode = { type: "comparison", field: "name", operator: "eq", value: "true" };
    const parsed = parseFilter(serializeFilterNode(node));
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toBe("true");
    }
  });

  test("a bare number still coerces to a number (guards against over-correction)", () => {
    const parsed = parseFilter("age eq 0");
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toBe(0);
    }
  });

  test("an array string element containing ']' parses as an array", () => {
    const parsed = parseFilter('name in ["]"]');
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toEqual(["]"]);
    }
  });

  test("an array string element containing a quote parses as an array", () => {
    const parsed = parseFilter('name in ["\'",0]');
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toEqual(["'", 0]);
    }
  });

  test.each([["a\nb"], ["t\tb"], ["\u0001"], ["\u2028"], ['q"\\']])(
    "an array string element %j round-trips (elements are read as JSON)",
    (element) => {
      const node: ComparisonNode = { type: "comparison", field: "name", operator: "in", value: [element, "x"] };
      const parsed = parseFilter(serializeFilterNode(node));
      expect(parsed).toEqual({ success: true, data: node });
    },
  );

  test.each([1e-7, -1e-9, 1e21, 1.5e300])(
    "the number %s round-trips (String() writes it with an exponent)",
    (value) => {
      const node: ComparisonNode = { type: "comparison", field: "age", operator: "eq", value };
      expect(parseFilter(serializeFilterNode(node))).toEqual({ success: true, data: node });
    },
  );

  test.each(["age eq 1e5", "age eq 1.5E-3", "age in [1e5, -2E+2]"])("%s parses exponents in numbers", (filter) => {
    expect(isSuccess(parseFilter(filter))).toBe(true);
  });

  test.each([`age eq ${"9".repeat(400)}`, `age eq -${"9".repeat(400)}`, `age in [${"9".repeat(400)}]`, "age eq 1e400"])(
    "a number too large to be finite is rejected: %s",
    (filter) => {
      const parsed = parseFilter(filter);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.message).toContain("Invalid number");
      }
    },
  );

  test("a negative number value keeps its numeric type", () => {
    const node: ComparisonNode = { type: "comparison", field: "age", operator: "eq", value: -1 };
    const parsed = parseFilter(serializeFilterNode(node));
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed)) {
      expect((parsed.data as ComparisonNode).value).toBe(-1);
    }
  });
});
