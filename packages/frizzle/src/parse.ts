// ============================================================================
// SHARED PARSE PIPELINE
// ============================================================================
// Single entry point for: parse (with limits) → schema validation.
// Used by both Drizzle code generators (RQB and SQL) instead of inlining
// the pipeline in each.

import type { FilterNode } from "./ast-types.js";
import { parseFilterExpression } from "./core/parser.js";
import { checkFilterLimits, type FilterLimits, resolveLimits } from "./filter-limits.js";
import type { Result } from "./result-types.js";
import { isError } from "./result-types.js";
import type { Schema } from "./schema-types.js";
import { SchemaValidator } from "./validation/schema-validator.js";

/**
 * Parse a filter expression string into an AST, with optional schema validation.
 *
 * Combines parsing (see parseFilterExpression), the size limits and (if a
 * schema is provided) field/operator/value validation into a single call.
 *
 * @param expression - Filter string (e.g., "status eq 'active' and priority in ['high','urgent']")
 * @param schema - Optional schema for field/operator/value validation
 * @param limits - Optional overrides for `query.limits.maxDepth` / `maxParameters` / `maxConditions`
 * @returns Result with FilterNode AST or structured ParseError
 *
 * @example
 * const result = parseFilter("status eq 'active'");
 *
 * @example
 * const result = parseFilter("status eq 'active'", taskSchema);
 * if (isError(result)) {
 *   console.warn(result.error.code, result.error.message);
 * }
 */
export function parseFilter(expression: string, schema?: Schema, limits?: FilterLimits): Result<FilterNode> {
  const result = parseFilterExpression(expression, limits);
  if (isError(result)) {
    return result;
  }

  if (schema) {
    const validator = new SchemaValidator(schema);
    return validator.validateFilterNode(result.data);
  }

  return result;
}

/**
 * Validate a filter tree against a schema and the filter limits.
 *
 * `parseFilter(expression, schema)` does this for a parsed string; use this for
 * a tree you built or combined yourself, e.g. a user's filter ANDed with
 * shorthand conditions from other query parameters. The limits (`maxParameters`,
 * `maxConditions`, `maxDepth`) apply to the whole tree, so validate the
 * combined tree once rather than each part.
 *
 * @param node - The filter tree
 * @param schema - Fields, types, operators and value constraints
 * @param limits - Optional overrides for `query.limits`
 * @returns Result with the validated tree (values coerced to the field types) or the first error
 *
 * @example
 * const user = params.filter ? parseFilter(params.filter) : undefined; // no schema yet
 * if (user && isError(user)) return user;                  // don't drop a bad filter silently
 * const combined = f.and(user?.data, f.in("region", regions));
 * const valid = validateFilter(combined!, schema, { maxParameters: 90 });
 * if (isError(valid)) return valid;
 * // compile valid.data
 */
export function validateFilter(node: FilterNode, schema: Schema, limits?: FilterLimits): Result<FilterNode> {
  const resolved = resolveLimits(limits, "");
  if (isError(resolved)) {
    return resolved;
  }
  const checked = checkFilterLimits(node, "", resolved.data);
  if (isError(checked)) {
    return checked;
  }
  return new SchemaValidator(schema).validateFilterNode(node);
}
