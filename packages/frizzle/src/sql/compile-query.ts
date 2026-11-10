// ============================================================================
// QUERY COMPILER — QueryDescriptor → SELECT
// ============================================================================

import { ownValue } from "../own-property.js";
import type { QueryDescriptor } from "../query-descriptor.js";
import { compileFilter } from "./compile-where.js";
import type { Dialect } from "./dialect.js";
import type { CompiledQuery, SqlColumnMap } from "./types.js";

/**
 * Compile a QueryDescriptor into a SELECT statement.
 *
 * Handles filter, sort, limit, offset, and column selection.
 * `descriptor.include` is intentionally ignored — relation resolution
 * is the consumer's responsibility (via JOINs or separate queries).
 *
 * @param table - SQL table name
 * @param descriptor - The query descriptor (from interceptor pipeline)
 * @param columns - Map of descriptor field names to SQL column names
 * @param dialect - SQL dialect
 * @returns Compiled SELECT statement
 *
 * @example
 * ```ts
 * const { sql, parameters } = compileSelect("tasks", {
 *   filter: { status: "active", workspaceId: "ws-1" },
 *   sort: { createdAt: "desc" },
 *   take: 20,
 *   skip: 0,
 * }, columns, sqliteDialect);
 * ```
 */
export function compileSelect(
  table: string,
  descriptor: QueryDescriptor,
  columns: SqlColumnMap,
  dialect: Dialect,
): CompiledQuery {
  const parameters: unknown[] = [];
  const parts: string[] = [];

  // SELECT clause
  if (descriptor.select && Object.keys(descriptor.select).length > 0) {
    const cols = Object.entries(descriptor.select)
      .filter(([, include]) => include)
      .map(([field]) => dialect.quoteIdentifier(ownValue(columns, field) ?? field));
    parts.push(`SELECT ${cols.join(", ")}`);
  } else {
    parts.push("SELECT *");
  }

  // FROM clause
  parts.push(`FROM ${dialect.quoteIdentifier(table)}`);

  // WHERE clause
  if (descriptor.filter && Object.keys(descriptor.filter).length > 0) {
    const where = compileFilter(descriptor.filter, columns, dialect);
    parts.push(`WHERE ${where.sql}`);
    parameters.push(...where.parameters);
  }

  // ORDER BY clause
  if (descriptor.sort && Object.keys(descriptor.sort).length > 0) {
    const orderParts = Object.entries(descriptor.sort).map(([field, direction]) => {
      const col = ownValue(columns, field) ?? field;
      return `${dialect.quoteIdentifier(col)} ${direction === "desc" ? "DESC" : "ASC"}`;
    });
    parts.push(`ORDER BY ${orderParts.join(", ")}`);
  }

  // LIMIT / OFFSET
  if (descriptor.take !== undefined) {
    parts.push(`LIMIT ${dialect.parameter(parameters.length)}`);
    parameters.push(descriptor.take);
  }
  if (descriptor.skip !== undefined) {
    parts.push(`OFFSET ${dialect.parameter(parameters.length)}`);
    parameters.push(descriptor.skip);
  }

  return { sql: parts.join(" "), parameters };
}
