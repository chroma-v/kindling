// ============================================================================
// WHERE CLAUSE COMPILER
// ============================================================================
// Two compilation paths:
// Path A: Filter POJO → SQL (from QueryDescriptor.filter)
// Path B: FilterNode AST → SQL (from parsed filter expression)

import type { ComparisonNode, FilterNode } from "../ast-types.js";
import { foldFilterResult } from "../code-generator.js";
import { isLikeOperator, wrapLike } from "../like-pattern.js";
import { ownValue } from "../own-property.js";
import type { Filter } from "../query.js";
import type { Result } from "../result-types.js";
import { createError, createParseError, createSuccess, isError } from "../result-types.js";
import type { Dialect } from "./dialect.js";
import type { CompiledQuery, SqlColumnMap } from "./types.js";

// ============================================================================
// PATH A: Filter POJO → SQL
// ============================================================================

/**
 * Compile a Filter POJO to a WHERE clause.
 *
 * This is the primary path used with `QueryDescriptor.filter` — the same
 * filter objects that flow through the interceptor pipeline.
 *
 * @param filter - Filter POJO (e.g., `{ status: "active", priority: { gte: 3 } }`)
 * @param columns - Map of filter field names to SQL column names
 * @param dialect - SQL dialect for quoting/parameter style
 * @returns Compiled WHERE clause (without the `WHERE` keyword)
 *
 * @example
 * ```ts
 * const { sql, parameters } = compileFilter(
 *   { status: "active", priority: { gte: 3 } },
 *   { status: "status", priority: "priority" },
 *   sqliteDialect,
 * );
 * // sql: '"status" = ? AND "priority" >= ?'
 * // parameters: ["active", 3]
 * ```
 */
export function compileFilter(filter: Filter, columns: SqlColumnMap, dialect: Dialect): CompiledQuery {
  const parameters: unknown[] = [];
  const sql = compileFilterInto(filter, columns, dialect, parameters);
  return { sql, parameters };
}

/**
 * Compiles `filter` to SQL, appending its values to the shared `parameters`.
 * Every placeholder is numbered from `parameters.length` as its value is
 * pushed, so numbered dialects (`$1`, `$2`, ...) stay in order across nested
 * `OR` / `AND` branches.
 */
function compileFilterInto(filter: Filter, columns: SqlColumnMap, dialect: Dialect, parameters: unknown[]): string {
  const clauses: string[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === "OR" || key === "AND") {
      const branches = (value as Filter[]).map(
        (branch) => `(${compileFilterInto(branch, columns, dialect, parameters)})`,
      );
      if (branches.length > 0) {
        clauses.push(`(${branches.join(` ${key} `)})`);
      }
      continue;
    }

    const col = ownValue(columns, key) ?? key;
    const quoted = dialect.quoteIdentifier(col);

    if (value === null) {
      clauses.push(`${quoted} IS NULL`);
    } else if (typeof value === "boolean") {
      clauses.push(`${quoted} = ${dialect.booleanLiteral(value)}`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Operator object: { ne: v }, { gte: v, lte: v }, { in: [...] }, { isNull: true }, etc.
      const ops = value as Record<string, unknown>;
      for (const [op, opVal] of Object.entries(ops)) {
        clauses.push(compileOperator(quoted, op, opVal, dialect, parameters));
      }
    } else {
      // Bare value = equality
      clauses.push(`${quoted} = ${bind(dialect, parameters, value)}`);
    }
  }

  return clauses.length === 0 ? "1 = 1" : clauses.join(" AND ");
}

/** SQL for comparison operators. Filter objects and ASTs share these names. */
const COMPARISON: Readonly<Record<string, string>> = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

/** Appends `value` to `parameters` and returns its placeholder, numbered in push order. */
function bind(dialect: Dialect, parameters: unknown[], value: unknown): string {
  parameters.push(value);
  return dialect.parameter(parameters.length - 1);
}

/** `col IN (...)` or `col NOT IN (...)`; an empty list is always false / always true. */
function inList(quoted: string, values: unknown, negate: boolean, bindValue: (v: unknown) => string): string {
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) {
    return negate ? "1 = 1" : "1 = 0";
  }
  return `${quoted} ${negate ? "NOT IN" : "IN"} (${list.map(bindValue).join(", ")})`;
}

/** One `{ op: value }` entry of a Filter operator object, as a clause. */
function compileOperator(quoted: string, op: string, value: unknown, dialect: Dialect, parameters: unknown[]): string {
  const bindValue = (v: unknown) => bind(dialect, parameters, v);
  if (op === "ne" && value === null) {
    return `${quoted} IS NOT NULL`;
  }
  if (Object.hasOwn(COMPARISON, op)) {
    return `${quoted} ${COMPARISON[op]} ${bindValue(value)}`;
  }
  switch (op) {
    case "in":
    case "notIn":
      return inList(quoted, value, op === "notIn", bindValue);
    case "like":
      return `${quoted} LIKE ${bindValue(value)} ESCAPE '\\'`;
    case "isNull":
    case "isNotNull":
      return (op === "isNull") === Boolean(value) ? `${quoted} IS NULL` : `${quoted} IS NOT NULL`;
    default:
      // Unknown operator key: treat as equality (forward-compat)
      return `${quoted} = ${bindValue(value)}`;
  }
}

// ============================================================================
// PATH B: FilterNode AST → SQL
// ============================================================================

/**
 * Compile a FilterNode AST to a WHERE clause.
 *
 * Use this when you have a parsed filter expression string and want raw SQL
 * instead of a Drizzle object.
 *
 * @param node - Parsed FilterNode AST (from `parseFilter()`)
 * @param columns - Map of filter field names to SQL column names
 * @param dialect - SQL dialect
 * @returns Result with compiled WHERE clause or error
 *
 * @example
 * ```ts
 * import { parseFilter } from "@chromav/frizzle";
 * import { compileFilterNode, sqliteDialect } from "@chromav/frizzle/sql";
 *
 * const ast = parseFilter("status eq 'active' and priority gte 3");
 * if (isSuccess(ast)) {
 *   const result = compileFilterNode(ast.data, columns, sqliteDialect);
 * }
 * ```
 */
export function compileFilterNode(node: FilterNode, columns: SqlColumnMap, dialect: Dialect): Result<CompiledQuery> {
  // One shared array, as in Path A: each placeholder is numbered as its value
  // is bound, and the fold visits comparisons left to right, so numbered
  // dialects stay in order however the comparisons nest.
  const parameters: unknown[] = [];
  const sql = foldFilterResult<string>(node, {
    comparison: (comparison) => compileComparison(comparison, columns, dialect, parameters),
    chain: (clauses, operator) => createSuccess(`(${clauses.join(operator === "or" ? " OR " : " AND ")})`),
    group: (clause) => createSuccess(`(${clause})`),
  });
  return isError(sql) ? sql : createSuccess({ sql: sql.data, parameters });
}

/** SQL for one comparison, appending its values to the shared `parameters`. */
function compileComparison(
  node: ComparisonNode,
  columns: SqlColumnMap,
  dialect: Dialect,
  parameters: unknown[],
): Result<string> {
  const col = ownValue(columns, node.field);
  if (!col) {
    return createError(createParseError(`Unknown column: ${node.field}`, 0, "", "UNKNOWN_FIELD", node.field));
  }

  const quoted = dialect.quoteIdentifier(col);
  const bindValue = (value: unknown) => bind(dialect, parameters, value);
  const { operator, value } = node;

  if (value === null && (operator === "eq" || operator === "ne")) {
    return createSuccess(`${quoted} ${operator === "eq" ? "IS NULL" : "IS NOT NULL"}`);
  }
  if (Object.hasOwn(COMPARISON, operator)) {
    return createSuccess(`${quoted} ${COMPARISON[operator]} ${bindValue(value)}`);
  }
  if (isLikeOperator(operator)) {
    const pattern = bindValue(wrapLike(operator, dialect.escapeLikePattern(String(value))));
    if (operator === "ilike" && !dialect.supportsILike) {
      return createSuccess(`LOWER(${quoted}) LIKE LOWER(${pattern}) ESCAPE '\\'`);
    }
    return createSuccess(`${quoted} ${operator === "ilike" ? "ILIKE" : "LIKE"} ${pattern} ESCAPE '\\'`);
  }

  switch (operator) {
    case "in":
    case "not_in":
      return createSuccess(inList(quoted, value, operator === "not_in", bindValue));
    case "between":
      if (!Array.isArray(value) || value.length !== 2) {
        return createError(createParseError("BETWEEN requires array with exactly 2 values", 0, "", "INVALID_VALUE"));
      }
      return createSuccess(`${quoted} BETWEEN ${bindValue(value[0])} AND ${bindValue(value[1])}`);
    case "is_null":
    case "is_not_null":
      return createSuccess(`${quoted} ${operator === "is_null" ? "IS NULL" : "IS NOT NULL"}`);
    default:
      return createError(createParseError(`Unsupported operator: ${operator}`, 0, "", "INVALID_OPERATOR"));
  }
}
