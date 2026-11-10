// ============================================================================
// RESERVED WORDS - Keywords that cannot be used as field names
// ============================================================================

/**
 * Reserved words in the query language.
 * These are keywords that have special meaning and cannot be used as field names
 * unless properly quoted or escaped.
 */
export const keywords: readonly string[] = [
  // Logical operators
  "and",
  "or",

  // URL-safe comparison operators
  "eq", // =
  "ne", // !=
  "gt", // >
  "gte", // >=
  "lt", // <
  "lte", // <=

  // String operators
  "like",
  "ilike",
  "starts_with",
  "ends_with",
  "contains",

  // Array operators
  "in",
  "not_in",

  // Range operators
  "between",

  // Null operators
  "is_null",
  "is_not_null",

  // Special values
  "null",
  "true",
  "false",
] as const;

/**
 * Type representing all reserved words
 */
export type Keyword = (typeof keywords)[number];

/**
 * Check if a string is a reserved word
 */
export const isKeyword = (word: string): word is Keyword => {
  return keywords.includes(word.toLowerCase() as Keyword);
};
