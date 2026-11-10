// ============================================================================
// SQL DIALECT INTERFACE
// ============================================================================
// Abstracts database-specific SQL syntax. Start with SQLite, extend for
// PostgreSQL, Trino/Spark (Iceberg), etc.

/**
 * Database dialect — encapsulates SQL syntax differences.
 *
 * Minimal and focused on what frizzle's compilers actually need:
 * WHERE, ORDER BY, LIMIT/OFFSET, INSERT, UPDATE, DELETE.
 *
 * Feature flags (like `supportsILike`) let the compiler branch once
 * per dialect rather than per query.
 *
 * @example
 * ```ts
 * import { sqliteDialect } from "@chromav/frizzle/sql";
 * const { sql, parameters } = compileSelect("tasks", descriptor, columns, sqliteDialect);
 * ```
 */
export interface Dialect {
  /** Dialect name for debugging/logging. */
  readonly name: string;

  /**
   * Quote a SQL identifier (table name, column name).
   *
   * SQLite/PostgreSQL: `"name"` • MySQL/Spark: `` `name` ``
   */
  quoteIdentifier(name: string): string;

  /**
   * Produce a parameter placeholder for the given 0-based index.
   *
   * SQLite/MySQL: `?` (ignores index) • PostgreSQL: `$1`, `$2`, ...
   */
  parameter(index: number): string;

  /**
   * Render a boolean literal.
   *
   * SQLite: `1`/`0` • PostgreSQL/Trino: `true`/`false`
   */
  booleanLiteral(value: boolean): string;

  /**
   * Whether this dialect supports `ILIKE` (case-insensitive LIKE) natively.
   *
   * If false, the compiler falls back to `LOWER(col) LIKE LOWER(pattern)`.
   */
  readonly supportsILike: boolean;

  /**
   * Escape special characters in a LIKE pattern (`%`, `_`, `\`).
   *
   * The returned string is used as the LIKE operand. The compiler
   * appends `ESCAPE '\'` to the clause.
   */
  escapeLikePattern(pattern: string): string;
}
