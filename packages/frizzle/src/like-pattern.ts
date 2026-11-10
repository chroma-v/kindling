// ============================================================================
// LIKE PATTERNS
// ============================================================================
// The string operators (like, ilike, contains, starts_with, ends_with) match
// the user's text literally: "%", "_" and "\" in the value are data, not
// wildcards or escapes. `like` and `ilike` are substring matches, the same as
// `contains`; frizzle has no operator that passes a raw LIKE pattern through.

import type { ComparisonOperator } from "./ast-types.js";

/** Escapes LIKE wildcards with backslash, for use with `ESCAPE '\'`. */
export const escapeLikePattern = (value: string): string => value.replaceAll(/[%_\\]/g, "\\$&");

/**
 * The LIKE pattern for a string operator, and whether it must be run with
 * `ESCAPE '\'`. Values with no `%`, `_` or `\` are left as-is, so ordinary
 * searches keep the plain `LIKE` form. A backslash counts: SQLite reads it
 * literally without an ESCAPE clause, but PostgreSQL treats it as the default
 * escape character, so `a\b` must be escaped and run with `ESCAPE` too.
 */
export function likePattern(operator: ComparisonOperator, value: unknown): { pattern: string; escaped: boolean } {
  const text = String(value);
  const escaped = /[%_\\]/.test(text);
  return { pattern: wrapLike(operator, escaped ? escapeLikePattern(text) : text), escaped };
}

/** Anchors an (already escaped) LIKE body: `starts_with` → `v%`, `ends_with` → `%v`, the rest → `%v%`. */
export const wrapLike = (operator: ComparisonOperator, body: string): string =>
  operator === "starts_with" ? `${body}%` : operator === "ends_with" ? `%${body}` : `%${body}%`;

/** Operators that compile to LIKE. */
export const isLikeOperator = (operator: ComparisonOperator): boolean =>
  operator === "like" ||
  operator === "ilike" ||
  operator === "contains" ||
  operator === "starts_with" ||
  operator === "ends_with";
