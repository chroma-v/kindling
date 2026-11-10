// ============================================================================
// OPERATOR x VALUE VALIDATION TESTS
// ============================================================================
// Tests the validateOperatorValue function that catches invalid operator/value
// combinations at compile time (returning Result errors with TYPE_MISMATCH code)
// instead of silently producing broken SQL/RQB objects.

import { describe, expect, test } from "vitest";
import { validateOperatorValue } from "./drizzle-validation.js";
import { operators } from "./language.js";
import { isError, isSuccess } from "./result-types.js";

describe("validateOperatorValue", () => {
  // ========================================================================
  // COMPLETENESS GUARD
  // ========================================================================
  // Ensures every operator in the registry is covered by the validation
  // function. If a new operator is added to language.ts, this test fails
  // until it's added to the matrix expectations below.

  const allOperators = Object.keys(operators) as (keyof typeof operators)[];

  test("every operator in the registry is handled (not INVALID_OPERATOR)", () => {
    for (const op of allOperators) {
      // Use a benign value that most operators accept
      const value =
        op === "is_null" || op === "is_not_null"
          ? null
          : op === "between"
            ? [1, 2]
            : op === "in" || op === "not_in"
              ? ["a"]
              : "test";
      const result = validateOperatorValue(op, value, "f");
      // Should succeed (valid combo) — never INVALID_OPERATOR
      expect(isSuccess(result)).toBe(true);
    }
  });

  test("matrix expectations cover every registry operator", () => {
    // This set must match Object.keys(operators) exactly
    const matrixOperators = new Set([
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "like",
      "ilike",
      "contains",
      "starts_with",
      "ends_with",
      "in",
      "not_in",
      "between",
      "is_null",
      "is_not_null",
    ]);
    const registryOperators = new Set(allOperators);
    expect(matrixOperators).toEqual(registryOperators);
  });

  // ========================================================================
  // VALID COMBINATIONS
  // ========================================================================

  describe("valid combinations", () => {
    const validCases: Array<[string, string, unknown]> = [
      ["eq", "string", "hello"],
      ["eq", "number", 42],
      ["eq", "null", null],
      ["eq", "boolean", true],
      ["ne", "string", "hello"],
      ["ne", "null", null],
      ["gt", "number", 42],
      ["gt", "string", "a"],
      ["gte", "number", 0],
      ["lt", "number", 100],
      ["lte", "boolean", false],
      ["like", "string", "pattern"],
      ["ilike", "string", "term"],
      ["contains", "string", "text"],
      ["starts_with", "string", "prefix"],
      ["ends_with", "number", 42], // numbers are coerced to strings in SQL
      ["in", "array", ["a", "b"]],
      ["in", "string", "single"], // wrapped in [value]
      ["not_in", "array", [1, 2, 3]],
      ["between", "2-array", [1, 10]],
      ["is_null", "null", null],
      ["is_null", "undefined", undefined],
      ["is_not_null", "null", null],
      ["is_not_null", "undefined", undefined],
    ];

    test.each(validCases)("%s x %s -> success", (op, _label, value) => {
      const result = validateOperatorValue(op as any, value, "testField");
      expect(isSuccess(result)).toBe(true);
    });
  });

  // ========================================================================
  // INVALID COMBINATIONS
  // ========================================================================

  describe("invalid combinations", () => {
    const invalidCases: Array<[string, string, unknown, string]> = [
      // eq/ne with arrays -> suggest in/not_in
      ["eq", "array", ["a", "b"], "use 'in'"],
      ["ne", "array", [1, 2], "use 'not_in'"],

      // Comparison ops with null -> suggest is_null
      ["gt", "null", null, "is_null"],
      ["gte", "null", null, "is_null"],
      ["lt", "null", null, "is_null"],
      ["lte", "null", null, "is_null"],

      // Comparison ops with undefined (same as null)
      ["gt", "undefined", undefined, "is_null"],
      ["gte", "undefined", undefined, "is_null"],

      // Comparison ops with arrays
      ["gt", "array", [1, 2], "does not accept array"],
      ["gte", "array", [1], "does not accept array"],
      ["lt", "array", ["a"], "does not accept array"],
      ["lte", "array", [true], "does not accept array"],

      // String ops with null -> suggest is_null
      ["like", "null", null, "is_null"],
      ["ilike", "null", null, "is_null"],
      ["contains", "null", null, "is_null"],
      ["starts_with", "null", null, "is_null"],
      ["ends_with", "null", null, "is_null"],

      // String ops with arrays
      ["like", "array", ["a"], "does not accept array"],
      ["ilike", "array", ["b"], "does not accept array"],
      ["contains", "array", [1, 2], "does not accept array"],
      ["starts_with", "array", ["x"], "does not accept array"],
      ["ends_with", "array", ["y"], "does not accept array"],

      // in/not_in with null -> suggest is_null
      ["in", "null", null, "is_null"],
      ["not_in", "null", null, "is_null"],
      ["in", "undefined", undefined, "is_null"],
      ["not_in", "undefined", undefined, "is_null"],

      // between with invalid values
      ["between", "null", null, "exactly 2"],
      ["between", "string", "hello", "exactly 2"],
      ["between", "number", 42, "exactly 2"],
      ["between", "boolean", true, "exactly 2"],
      ["between", "1-array", [1], "exactly 2"],
      ["between", "3-array", [1, 2, 3], "exactly 2"],
      ["between", "empty-array", [], "exactly 2"],
    ];

    test.each(invalidCases)("%s x %s -> error containing '%s'", (op, _label, value, expectedMsg) => {
      const result = validateOperatorValue(op as any, value, "testField");
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
        expect(result.error.message).toContain(expectedMsg);
        expect(result.error.field).toBe("testField");
      }
    });
  });

  // ========================================================================
  // ERROR SUGGESTIONS
  // ========================================================================

  describe("error suggestions", () => {
    test("eq array suggests 'in'", () => {
      const result = validateOperatorValue("eq", ["a"], "f");
      if (isError(result)) {
        expect(result.error.suggestions).toContain("in");
      }
    });

    test("ne array suggests 'not_in'", () => {
      const result = validateOperatorValue("ne", [1], "f");
      if (isError(result)) {
        expect(result.error.suggestions).toContain("not_in");
      }
    });

    test("gt null suggests is_null and is_not_null", () => {
      const result = validateOperatorValue("gt", null, "f");
      if (isError(result)) {
        expect(result.error.suggestions).toContain("is_null");
        expect(result.error.suggestions).toContain("is_not_null");
      }
    });

    test("contains null suggests is_null", () => {
      const result = validateOperatorValue("contains", null, "f");
      if (isError(result)) {
        expect(result.error.suggestions).toContain("is_null");
      }
    });

    test("in null suggests is_null and is_not_null", () => {
      const result = validateOperatorValue("in", null, "f");
      if (isError(result)) {
        expect(result.error.suggestions).toContain("is_null");
        expect(result.error.suggestions).toContain("is_not_null");
      }
    });
  });

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  describe("edge cases", () => {
    test("undefined treated same as null for value-bearing operators", () => {
      const nullResult = validateOperatorValue("gt", null, "f");
      const undefinedResult = validateOperatorValue("gt", undefined, "f");
      expect(isError(nullResult)).toBe(true);
      expect(isError(undefinedResult)).toBe(true);
    });

    test("empty array is valid for in/not_in (DB returns no rows)", () => {
      expect(isSuccess(validateOperatorValue("in", [], "f"))).toBe(true);
      expect(isSuccess(validateOperatorValue("not_in", [], "f"))).toBe(true);
    });

    test("empty array is invalid for between (needs exactly 2)", () => {
      expect(isError(validateOperatorValue("between", [], "f"))).toBe(true);
    });

    test("is_null ignores any value (even arrays)", () => {
      expect(isSuccess(validateOperatorValue("is_null", "anything", "f"))).toBe(true);
      expect(isSuccess(validateOperatorValue("is_null", [1, 2], "f"))).toBe(true);
      expect(isSuccess(validateOperatorValue("is_not_null", 42, "f"))).toBe(true);
    });
  });
});
