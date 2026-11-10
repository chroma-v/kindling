// ============================================================================
// TOKEN TYPES - Shared lexical analysis types
// ============================================================================

const tokenTypes = ["field", "operator", "value", "and", "or", "leftParen", "rightParen", "eof"] as const;
/**
 * Token types for lexical analysis
 */
export type TokenType = (typeof tokenTypes)[number];

/**
 * How a `value` token's literal was written in the source. The lexer flattens
 * every value to a string, so this preserves the one bit the parser can't
 * otherwise recover: whether the value was quoted (a string literal — never
 * coerce) or an array literal (parse, don't treat as a scalar). Bare values
 * (numbers, true/false/null, barewords) leave this undefined and are coerced
 * by content.
 */
export type ValueKind = "string" | "array";

/**
 * Token - represents a lexical unit with position information
 */
export interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
  readonly valueKind?: ValueKind;
}

/**
 * Create a token with type, value, and position
 */
export function createToken(type: TokenType, value: string, position: number, valueKind?: ValueKind): Token {
  return valueKind ? { type, value, position, valueKind } : { type, value, position };
}

/**
 * Type guard for token types
 */
export function isTokenType(type: string): type is TokenType {
  return tokenTypes.includes(type as TokenType);
}
