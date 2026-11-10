// ============================================================================
// SQL CODE GENERATOR — Core Types
// ============================================================================

/**
 * The output of any SQL compilation step.
 *
 * `sql` contains the parameterized query string with dialect-appropriate
 * placeholders (e.g., `?` for SQLite, `$1` for PostgreSQL).
 * `parameters` contains the values in binding order.
 *
 * @example
 * ```ts
 * const { sql, parameters } = compileSelect("tasks", descriptor, columns, dialect);
 * // SQLite:    sql = 'SELECT * FROM "tasks" WHERE "status" = ?', parameters = ["active"]
 * // Postgres:  sql = 'SELECT * FROM "tasks" WHERE "status" = $1', parameters = ["active"]
 * ```
 */
export interface CompiledQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * Column mapping: filter/sort field name → SQL column name.
 *
 * Maps the field names used in frizzle's `Filter` and `Sort` types
 * to actual SQL column names. Simple string-to-string mapping.
 *
 * @example
 * ```ts
 * const columns: SqlColumnMap = {
 *   status: "status",        // 1:1 mapping
 *   assignee: "assigned_to", // rename
 *   created: "created_at",   // rename
 * };
 * ```
 */
export type SqlColumnMap = Record<string, string>;

/**
 * Options for write compilation.
 */
export interface WriteCompileOptions {
  /** The primary key column name. Default: `"id"`. */
  idColumn?: string;
}
