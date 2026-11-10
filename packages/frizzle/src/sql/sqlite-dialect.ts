// ============================================================================
// SQLITE DIALECT
// ============================================================================

import { escapeLikePattern } from "../like-pattern.js";
import type { Dialect } from "./dialect.js";

/**
 * SQLite dialect.
 *
 * - Identifiers: double-quoted (`"col"`)
 * - Parameters: positional `?`
 * - Booleans: `1`/`0`
 * - ILIKE: not supported (SQLite's LIKE is case-insensitive for ASCII by default)
 * - LIKE escape: backslash (`ESCAPE '\'`)
 */
export const sqliteDialect: Dialect = {
  name: "sqlite",

  quoteIdentifier(name: string): string {
    // Escape embedded double quotes by doubling them
    return `"${name.replaceAll('"', '""')}"`;
  },

  parameter(_index: number): string {
    return "?";
  },

  booleanLiteral(value: boolean): string {
    return value ? "1" : "0";
  },

  supportsILike: false,

  escapeLikePattern,
};
