// ============================================================================
// OPERATOR x VALUE VALIDATION
// ============================================================================
// Validates operator/value combinations at compile time, before any SQL or RQB
// output is generated. Derives rules from the operator registry's `category`
// field in language.ts, so new operators must be explicitly handled here.

import type { ComparisonOperator } from "./ast-types.js";
import { operators } from "./language.js";
import type { Result } from "./result-types.js";
import { createError, createParseError, createSuccess } from "./result-types.js";

/**
 * Validates that an operator + value combination is semantically valid.
 * Derives rules from the operator registry's `category` field in language.ts,
 * so new operators added to the registry must be handled here (the default
 * case returns an error to force explicit coverage).
 *
 * Returns an error for combos that would produce incorrect SQL (e.g., `gt null`)
 * or crash at query time (e.g., `eq ["a","b"]`).
 *
 * Validated early in the code generators so callers get a clear `Result<Error>`
 * instead of a silent bad query or a runtime crash.
 */
export function validateOperatorValue(operator: ComparisonOperator, value: unknown, field: string): Result<void> {
  // Look up the operator's category from the registry (source of truth)
  const meta = operators[operator];
  if (!meta) {
    return createError(createParseError(`Unknown operator: ${operator}`, 0, "", "INVALID_OPERATOR", field));
  }

  const { category } = meta;
  const isNullValue = value === null || value === undefined;
  const isArrayValue = Array.isArray(value);

  switch (category) {
    // --- null category: is_null, is_not_null — value is ignored ---
    case "null":
      return createSuccess(undefined);

    // --- comparison category: eq, ne, gt, gte, lt, lte ---
    case "comparison": {
      // eq/ne accept null (-> isNull/isNotNull conversion), reject arrays
      if (operator === "eq" || operator === "ne") {
        if (isArrayValue) {
          const suggestion = operator === "eq" ? "in" : "not_in";
          return createError(
            createParseError(
              `Operator '${operator}' does not accept array values — use '${suggestion}' instead`,
              0,
              "",
              "TYPE_MISMATCH",
              field,
              [suggestion],
            ),
          );
        }
        return createSuccess(undefined);
      }

      // gt, gte, lt, lte — reject null and arrays
      if (isNullValue) {
        return createError(
          createParseError(
            `Operator '${operator}' cannot compare with null — use 'is_null' or 'is_not_null'`,
            0,
            "",
            "TYPE_MISMATCH",
            field,
            ["is_null", "is_not_null"],
          ),
        );
      }
      if (isArrayValue) {
        return createError(
          createParseError(`Operator '${operator}' does not accept array values`, 0, "", "TYPE_MISMATCH", field),
        );
      }
      return createSuccess(undefined);
    }

    // --- string category: like, ilike, contains, starts_with, ends_with ---
    case "string": {
      if (isNullValue) {
        return createError(
          createParseError(
            `String operator '${operator}' cannot match null — use 'is_null'`,
            0,
            "",
            "TYPE_MISMATCH",
            field,
            ["is_null"],
          ),
        );
      }
      if (isArrayValue) {
        return createError(
          createParseError(`String operator '${operator}' does not accept array values`, 0, "", "TYPE_MISMATCH", field),
        );
      }
      return createSuccess(undefined);
    }

    // --- array category: in, not_in ---
    case "array": {
      if (isNullValue) {
        return createError(
          createParseError(
            `Operator '${operator}' cannot match null — use 'is_null' or 'is_not_null'`,
            0,
            "",
            "TYPE_MISMATCH",
            field,
            ["is_null", "is_not_null"],
          ),
        );
      }
      return createSuccess(undefined);
    }

    // --- range category: between ---
    case "range": {
      if (!isArrayValue || value.length !== 2) {
        return createError(
          createParseError(`Operator 'between' requires an array with exactly 2 values`, 0, "", "TYPE_MISMATCH", field),
        );
      }
      return createSuccess(undefined);
    }

    // --- If a new category is added to language.ts, this forces a compile error ---
    default: {
      const _exhaustive: never = category;
      return createError(
        createParseError(
          `Unhandled operator category '${_exhaustive}' for operator '${operator}'`,
          0,
          "",
          "INVALID_OPERATOR",
          field,
        ),
      );
    }
  }
}
