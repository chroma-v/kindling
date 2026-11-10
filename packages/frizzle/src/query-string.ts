// ============================================================================
// QUERY STRING PARSING & SERIALIZATION
// ============================================================================
// URL query string parsing and serialization (e.g., "filter=age>18&sort=name:asc")
// This is the web/HTTP layer - separate from core compiler logic
//
// Responsibilities:
// - Parse URL query strings into QueryParams
// - Serialize QueryAst back to URL query strings
// - Handle string, URL, and URLSearchParams inputs

import type { FilterNode, QueryAst, SortDirection, SortNode } from "./ast-types.js";
import { foldFilterNode } from "./code-generator.js";
import { query, requiresValue } from "./language.js";
import type { Result } from "./result-types.js";
import { createError, createParseError, createSuccess, isError } from "./result-types.js";
import type { Schema } from "./schema-types.js";
import { SchemaValidator } from "./validation/schema-validator.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed query parameters from URL
 */
export interface QueryParams {
  filter?: string;
  sort?: SortNode[];
  limit?: number;
  offset?: number;
}

/**
 * Options for {@link parseQueryString}. Both must be positive integers.
 * Filter limits (`maxDepth`, `maxParameters`, `maxConditions`) apply where
 * the filter is parsed: `parseFilter`, `compileFilter`, `compileFilterToSQL`,
 * or `Compiler` (whose own `maxLimit` should match this one).
 */
export interface QueryStringOptions {
  /** Largest accepted `limit`. Default `query.limits.max` (1000). */
  readonly maxLimit?: number;
  /** `limit` to use when the query string has none. Capped at `maxLimit`. Default: no limit. */
  readonly defaultLimit?: number;
  /**
   * Validate `sort` against this schema, as `parseSort(sort, schema)` does:
   * unknown fields and fields with `sortable: false` are errors. The filter is
   * not validated here; pass the schema to `parseFilter` / `Compiler` for that.
   */
  readonly schema?: Schema;
}

// ============================================================================
// URL QUERY STRING PARSING
// ============================================================================

/**
 * Parse URL query string parameters into structured QueryParams
 *
 * Handles multiple input types:
 * - string: URL query string (e.g., "filter=age>18&sort=name:asc")
 * - URL: Full URL object (extracts search params)
 * - URLSearchParams: Search params object
 *
 * Parses:
 * - filter parameter (filter expression string)
 * - sort parameter (comma-separated field:direction pairs)
 * - limit parameter (integer)
 * - offset parameter (integer)
 *
 * @param input - Query string, URL, or URLSearchParams
 * @param options - `maxLimit` / `defaultLimit`
 * @returns Result with QueryParams or error
 *
 * @example
 * // From string
 * const result1 = parseQueryString("filter=age gte 18&sort=name:asc&limit=50");
 *
 * // From URL object
 * const result2 = parseQueryString(new URL(request.url));
 *
 * // From URLSearchParams
 * const result3 = parseQueryString(new URLSearchParams(location.search));
 *
 * if (isSuccess(result)) {
 *   const { filter, sort, limit } = result.data;
 *   // Use with compiler.parse(result.data)
 * }
 */
export function parseQueryString(input: string, options?: QueryStringOptions): Result<QueryParams>;
export function parseQueryString(input: URL, options?: QueryStringOptions): Result<QueryParams>;
export function parseQueryString(input: URLSearchParams, options?: QueryStringOptions): Result<QueryParams>;
export function parseQueryString(
  input: string | URL | URLSearchParams,
  options?: QueryStringOptions,
): Result<QueryParams> {
  // Convert all inputs to URLSearchParams
  let params: URLSearchParams;

  if (typeof input === "string") {
    params = new URLSearchParams(input);
  } else if (input instanceof URL) {
    params = new URLSearchParams(input.search);
  } else {
    params = input;
  }

  return parseSearchParams(params, options);
}

/** A whole non-negative integer in plain decimal digits, or undefined. `parseInt` would accept "10abc" and "2.9". */
const parseWholeNumber = (text: string): number | undefined => (/^\d+$/.test(text) ? Number(text) : undefined);

/**
 * Internal implementation that parses from URLSearchParams
 */
/** A positive-integer option, or an INVALID_VALUE error naming it. */
const checkPositiveInteger = (name: string, value: number | undefined, context: string): Result<undefined> =>
  value === undefined || (Number.isSafeInteger(value) && value >= 1)
    ? createSuccess(undefined)
    : createError(
        createParseError(`Invalid ${name}: ${value}. Must be a positive integer`, 0, context, "INVALID_VALUE"),
      );

function parseSearchParams(params: URLSearchParams, options?: QueryStringOptions): Result<QueryParams> {
  const result: QueryParams = {};
  const queryString = params.toString();
  for (const [name, value] of [
    ["maxLimit", options?.maxLimit],
    ["defaultLimit", options?.defaultLimit],
  ] as const) {
    const checked = checkPositiveInteger(name, value, queryString);
    if (isError(checked)) {
      return checked;
    }
  }
  const maxLimit = options?.maxLimit ?? query.limits.max;
  const minLimit = query.limits.min;

  const filterParam = params.get("filter");
  if (filterParam) {
    result.filter = filterParam;
  }

  const sortParam = params.get("sort");
  if (sortParam) {
    const sort = parseSort(sortParam, options?.schema);
    if (isError(sort)) {
      return sort;
    }
    result.sort = sort.data;
  }

  const limitParam = params.get("limit");
  if (limitParam) {
    const limit = parseWholeNumber(limitParam);
    if (limit === undefined || limit < minLimit || limit > maxLimit) {
      return createError(
        createParseError(
          `Invalid limit: ${limitParam}. Must be between ${minLimit} and ${maxLimit}`,
          0,
          queryString,
          "INVALID_VALUE",
        ),
      );
    }
    result.limit = limit;
  } else if (options?.defaultLimit !== undefined) {
    result.limit = Math.min(options.defaultLimit, maxLimit);
  }

  const offsetParam = params.get("offset");
  if (offsetParam) {
    const offset = parseWholeNumber(offsetParam);
    if (offset === undefined) {
      return createError(
        createParseError(
          `Invalid offset: ${offsetParam}. Must be a non-negative integer`,
          0,
          queryString,
          "INVALID_VALUE",
        ),
      );
    }
    result.offset = offset;
  }

  return createSuccess(result);
}

/**
 * Parse a sort expression, rejecting anything that isn't `field[:asc|desc]`.
 *
 * Format: "field1:asc,field2:desc,field3" (direction defaults to asc, any case).
 * Empty items (e.g. a trailing comma) are skipped. Error positions point into
 * `sortExpression`.
 *
 * With a schema, each field must also be in it (`UNKNOWN_FIELD`, with
 * suggestions) and not marked `sortable: false` (`UNSORTABLE_FIELD`).
 *
 * @example
 * parseSort("name:asc,age:desc")
 * // => success: [{ field: "name", direction: "asc" }, { field: "age", direction: "desc" }]
 *
 * parseSort("name:sideways")
 * // => error: Invalid sort direction 'sideways' for 'name'. Use asc or desc
 *
 * parseSort("notes:asc", { notes: { type: "string", sortable: false } })
 * // => error (UNSORTABLE_FIELD): Field 'notes' can't be sorted
 */
export function parseSort(sortExpression: string, schema?: Schema): Result<SortNode[]> {
  const nodes: SortNode[] = [];
  const validator = schema ? new SchemaValidator(schema) : undefined;
  const invalid = (message: string, position: number) =>
    createError<SortNode[]>(createParseError(message, position, sortExpression, "INVALID_VALUE"));

  let start = 0;
  for (const raw of sortExpression.split(",")) {
    const item = raw.trim();
    const itemStart = start + raw.indexOf(item);
    start += raw.length + 1;
    if (item.length === 0) {
      continue;
    }

    const parts = item.split(":");
    if (parts.length > 2) {
      return invalid(`Invalid sort item '${item}'`, itemStart);
    }

    const field = parts[0].trim();
    if (field.length === 0) {
      return invalid("Missing sort field", itemStart);
    }

    const direction = (parts[1] ?? query.defaults.sortDirection).trim().toLowerCase();
    if (direction !== "asc" && direction !== "desc") {
      const directionStart = itemStart + item.indexOf(":") + 1;
      return invalid(`Invalid sort direction '${parts[1].trim()}' for '${field}'. Use asc or desc`, directionStart);
    }

    const node: SortNode = { field, direction };
    if (validator) {
      const valid = validator.validateSortNode(node);
      if (isError(valid)) {
        const { error } = valid;
        return createError(
          createParseError(error.message, itemStart, sortExpression, error.code, error.field, error.suggestions),
        );
      }
    }
    nodes.push(node);
  }

  return createSuccess(nodes);
}

/**
 * Parse sort expression into SortNode array
 *
 * Format: "field1:asc,field2:desc,field3"
 *
 * @deprecated Treats anything that isn't "desc" as asc, so `name:sideways`
 * silently sorts ascending. Use {@link parseSort}, which returns an error.
 *
 * @param sortExpression - Sort string
 * @returns Array of sort nodes
 *
 * @example
 * parseSortExpression("name:asc,age:desc")
 * // => [{ field: "name", direction: "asc" }, { field: "age", direction: "desc" }]
 */
export function parseSortExpression(sortExpression: string): SortNode[] {
  return sortExpression
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [field, direction = "asc"] = item.split(":");
      return {
        field: field.trim(),
        direction: (direction.toLowerCase() === "desc" ? "desc" : "asc") as SortDirection,
      };
    });
}

// ============================================================================
// QUERY AST SERIALIZATION (internal — used by tests, not exported from index)
// ============================================================================

/**
 * Serialize QueryAst to URL query string.
 * Internal utility for round-trip testing.
 */
export function serializeQueryAst(ast: QueryAst): string {
  const parts: string[] = [];

  if (ast.filter) {
    const filterStr = serializeFilterNode(ast.filter);
    parts.push(`filter=${encodeURIComponent(filterStr)}`);
  }

  if (ast.sort && ast.sort.length > 0) {
    const sortStr = ast.sort.map((s) => `${s.field}:${s.direction}`).join(",");
    parts.push(`sort=${sortStr}`);
  }

  if (ast.limit) {
    parts.push(`limit=${ast.limit}`);
  }
  if (ast.offset) {
    parts.push(`offset=${ast.offset}`);
  }

  return parts.join("&");
}

// ============================================================================
// FILTER SERIALIZATION
// ============================================================================

/**
 * Escape quotes in a string value for serialization
 */
function escapeString(str: string): string {
  return str.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * Serialize a value to string expression
 */
export function serializeFilterValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${escapeString(value)}"`;
  }
  if (Array.isArray(value)) {
    // Double-quoted array elements are read back as JSON strings, which reject
    // raw control characters, so write them as JSON (`\n`, `\u0001`).
    return `[${value.map((v) => (typeof v === "string" ? JSON.stringify(v) : serializeFilterValue(v))).join(",")}]`;
  }
  return String(value);
}

/**
 * Serialize a FilterNode to string expression
 *
 * @param node - The filter node to serialize
 * @returns Filter expression string
 */
export function serializeFilterNode(node: FilterNode): string {
  return foldFilterNode<string>(node, {
    comparison: (comparison) =>
      // Null-check operators (is_null, is_not_null) don't require a value
      requiresValue(comparison.operator)
        ? `${comparison.field} ${comparison.operator} ${serializeFilterValue(comparison.value)}`
        : `${comparison.field} ${comparison.operator}`,
    // An operand of an AND chain that is itself logical is an OR (same-operator
    // operands are part of the chain), and needs parentheses to keep its
    // meaning; an AND inside an OR doesn't, since AND binds tighter.
    chain: (operands, operator, nodes) =>
      operands
        .map((text, i) => (operator === "and" && nodes[i].type === "logical" ? `(${text})` : text))
        .join(` ${operator} `),
    group: (expression) => `(${expression})`,
  });
}

// All types and functions are already exported inline above
