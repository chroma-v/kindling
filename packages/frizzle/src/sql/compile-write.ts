// ============================================================================
// WRITE COMPILER — WriteDescriptor → INSERT / UPDATE / DELETE
// ============================================================================

import type { WriteDescriptor } from "../write-descriptor.js";
import type { Dialect } from "./dialect.js";
import type { CompiledQuery, WriteCompileOptions } from "./types.js";

const DEFAULT_ID_COLUMN = "id";

/**
 * Compile a WriteDescriptor into an INSERT statement.
 *
 * @param table - SQL table name
 * @param descriptor - The write descriptor (mutation must be "insert")
 * @param dialect - SQL dialect
 * @returns Compiled INSERT statement
 *
 * @example
 * ```ts
 * const desc = createWriteDescriptor("insert", { title: "Task", status: "backlog" });
 * const { sql, parameters } = compileInsert("tasks", desc, sqliteDialect);
 * // sql: 'INSERT INTO "tasks" ("title", "status") VALUES (?, ?)'
 * // parameters: ["Task", "backlog"]
 * ```
 */
export function compileInsert(table: string, descriptor: WriteDescriptor, dialect: Dialect): CompiledQuery {
  const entries = Object.entries(descriptor.values);
  if (entries.length === 0) {
    return { sql: `INSERT INTO ${dialect.quoteIdentifier(table)} DEFAULT VALUES`, parameters: [] };
  }

  const columns = entries.map(([col]) => dialect.quoteIdentifier(col));
  const parameters = entries.map(([, val]) => val);
  const placeholders = parameters.map((_, i) => dialect.parameter(i));

  return {
    sql: `INSERT INTO ${dialect.quoteIdentifier(table)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    parameters,
  };
}

/**
 * Compile a WriteDescriptor into an UPDATE statement.
 *
 * Uses `descriptor.targetIds` for the WHERE clause (`id IN (...)`).
 * The ID column name defaults to `"id"` but is configurable.
 *
 * @param table - SQL table name
 * @param descriptor - The write descriptor (mutation must be "update")
 * @param dialect - SQL dialect
 * @param options - Configure ID column name
 * @returns Compiled UPDATE statement
 *
 * @example
 * ```ts
 * const desc = mergeWriteDescriptor(
 *   createWriteDescriptor("update", { status: "done" }),
 *   { targetIds: ["task-1", "task-2"] },
 * );
 * const { sql, parameters } = compileUpdate("tasks", desc, sqliteDialect);
 * // sql: 'UPDATE "tasks" SET "status" = ? WHERE "id" IN (?, ?)'
 * // parameters: ["done", "task-1", "task-2"]
 * ```
 */
export function compileUpdate(
  table: string,
  descriptor: WriteDescriptor,
  dialect: Dialect,
  options?: WriteCompileOptions,
): CompiledQuery {
  const idCol = options?.idColumn ?? DEFAULT_ID_COLUMN;
  const entries = Object.entries(descriptor.values);
  const parameters: unknown[] = [];

  // SET clause
  const setParts = entries.map(([col, val]) => {
    const placeholder = dialect.parameter(parameters.length);
    parameters.push(val);
    return `${dialect.quoteIdentifier(col)} = ${placeholder}`;
  });

  // WHERE clause
  const whereClause = compileIdWhereClause(descriptor.targetIds, idCol, dialect, parameters);

  return {
    sql: `UPDATE ${dialect.quoteIdentifier(table)} SET ${setParts.join(", ")} ${whereClause}`,
    parameters,
  };
}

/**
 * Compile a WriteDescriptor into a DELETE statement.
 *
 * Uses `descriptor.targetIds` for the WHERE clause.
 *
 * @param table - SQL table name
 * @param descriptor - The write descriptor (mutation must be "delete")
 * @param dialect - SQL dialect
 * @param options - Configure ID column name
 * @returns Compiled DELETE statement
 *
 * @example
 * ```ts
 * const desc = mergeWriteDescriptor(
 *   createWriteDescriptor("delete"),
 *   { targetIds: ["task-1"] },
 * );
 * const { sql, parameters } = compileDelete("tasks", desc, sqliteDialect);
 * // sql: 'DELETE FROM "tasks" WHERE "id" = ?'
 * // parameters: ["task-1"]
 * ```
 */
export function compileDelete(
  table: string,
  descriptor: WriteDescriptor,
  dialect: Dialect,
  options?: WriteCompileOptions,
): CompiledQuery {
  const idCol = options?.idColumn ?? DEFAULT_ID_COLUMN;
  const parameters: unknown[] = [];
  const whereClause = compileIdWhereClause(descriptor.targetIds, idCol, dialect, parameters);

  return {
    sql: `DELETE FROM ${dialect.quoteIdentifier(table)} ${whereClause}`,
    parameters,
  };
}

/**
 * Dispatch to the appropriate compiler based on `descriptor.mutation`.
 *
 * Convenience wrapper when the mutation type isn't known at compile time
 * (e.g., after interceptors have potentially transformed it).
 */
export function compileWrite(
  table: string,
  descriptor: WriteDescriptor,
  dialect: Dialect,
  _options?: WriteCompileOptions,
): CompiledQuery {
  switch (descriptor.mutation) {
    case "insert":
      return compileInsert(table, descriptor, dialect);
    case "update":
      return compileUpdate(table, descriptor, dialect);
    case "delete":
      return compileDelete(table, descriptor, dialect);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function compileIdWhereClause(targetIds: string[], idCol: string, dialect: Dialect, parameters: unknown[]): string {
  const quoted = dialect.quoteIdentifier(idCol);

  if (targetIds.length === 0) {
    return "WHERE 1 = 0";
  }

  if (targetIds.length === 1) {
    const placeholder = dialect.parameter(parameters.length);
    parameters.push(targetIds[0]);
    return `WHERE ${quoted} = ${placeholder}`;
  }

  const placeholders = targetIds.map((id) => {
    const p = dialect.parameter(parameters.length);
    parameters.push(id);
    return p;
  });
  return `WHERE ${quoted} IN (${placeholders.join(", ")})`;
}
