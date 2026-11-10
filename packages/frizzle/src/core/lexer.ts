// ============================================================================
// LEXER MODULE
// ============================================================================
// Handles tokenization of query filter expressions

import type { ComparisonOperator } from "../ast-types.js";
import type { Result } from "../result-types.js";
import { createError, createParseError, createSuccess } from "../result-types.js";
import type { Token } from "../token-types.js";
import { createToken } from "../token-types.js";

// ============================================================================
// OPERATOR MAPPINGS & LOOKUP TABLES
// ============================================================================

/**
 * Single-character symbol operators
 */
const singleCharSymbols = new Set(["=", ">", "<"]);

/**
 * Two-character symbol operators (must be checked before single-char)
 */
const twoCharSymbols = new Set(["!=", ">=", "<="]);

/**
 * Mapping from symbol operators to named operators.
 * Allows inputs like "age > 18" to be normalized to "age gt 18".
 * Symbol operators are less URL-safe, so we convert them to named form.
 */
const symbolToNamed: Record<string, ComparisonOperator> = {
  "=": "eq",
  "!=": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
} as const;

/**
 * Valid named operators that map to themselves.
 * These are already in canonical form and need no conversion.
 */
const validNamedOperators = new Set<string>([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "in",
  "not_in",
  "starts_with",
  "ends_with",
  "contains",
  "between",
  "is_null",
  "is_not_null",
]);

/**
 * Pre-computed array of named operators for lookahead in isFieldIdentifier.
 * Avoids Array.from(Set) allocation on every identifier token.
 */
const namedOperatorArray: readonly string[] = [...validNamedOperators];

/**
 * Parentheses characters
 */
const leftParenChar = "(";
const rightParenChar = ")";

/**
 * Quote characters for string literals
 */
const quoteChars = new Set(['"', "'"]);

/**
 * A number literal, matched at a given position (sticky)
 */
const numberPattern = /-?\d+(?:\.\d+)?/y;

/**
 * Special keywords that should be treated as values
 */
const valueKeywords = new Set(["null", "true", "false"]);

/**
 * Logical operator keywords
 */
const logicalKeywords = new Set(["and", "or"]);

// ============================================================================
// LEXER CLASS
// ============================================================================

/**
 * Tokenizes query filter expressions into a stream of tokens.
 *
 * The input is an already-decoded expression: decoding is the transport
 * layer's job (`parseQueryString` / `URLSearchParams` already does it).
 *
 * Handles:
 * - Named (URL-safe) and symbol operators
 * - Quoted strings with escape sequences
 * - Arrays for IN/BETWEEN operators
 * - Negative numbers
 * - Keywords (AND, OR, NULL, TRUE, FALSE)
 * - Field/value disambiguation
 *
 * @example
 * const lexer = new Lexer();
 * const result = lexer.tokenize("age >= 18 and status = 'active'");
 * if (isSuccess(result)) {
 *   console.log(result.data); // Array of tokens
 * }
 *
 * @deprecated `parseFilterExpression` no longer tokenizes: the combinator
 * grammar reads the input directly (and in linear time; this lexer's
 * look-ahead is quadratic on long input). Will be removed in a future release.
 */
export class Lexer {
  private input = "";
  private position = 0;
  private tokens: Token[] = [];

  /**
   * Tokenizes a filter expression string into tokens.
   *
   * @param input - The filter expression to tokenize
   * @returns Success with token array if valid, error otherwise
   */
  tokenize(input: string): Result<readonly Token[]> {
    this.input = input;
    this.position = 0;
    this.tokens = [];

    while (this.position < this.input.length) {
      this.skipWhitespace();

      if (this.position >= this.input.length) {
        break;
      }

      const char = this.input[this.position];
      const startPos = this.position;

      // Handle parentheses
      if (char === leftParenChar) {
        this.tokens.push(createToken("leftParen", char, startPos));
        this.position++;
        continue;
      }

      if (char === rightParenChar) {
        this.tokens.push(createToken("rightParen", char, startPos));
        this.position++;
        continue;
      }

      // Handle quoted strings — tagged "string" so the parser never coerces
      // them by content (e.g. the string "0" must stay a string, not become 0).
      if (quoteChars.has(char)) {
        const value = this.readString(char);
        if (value === null) {
          return createError(createParseError("Unterminated string literal", startPos, this.input, "SYNTAX_ERROR"));
        }
        this.tokens.push(createToken("value", value, startPos, "string"));
        continue;
      }

      // Handle arrays — tagged "array" so the parser parses the literal.
      if (char === "[") {
        const value = this.readArray();
        if (value === null) {
          return createError(createParseError("Unterminated array literal", startPos, this.input, "SYNTAX_ERROR"));
        }
        this.tokens.push(createToken("value", value, startPos, "array"));
        continue;
      }

      // Handle operators (check longer operators first)
      // Convert symbol operators to named operators for consistency
      const twoChar = this.input.slice(this.position, this.position + 2);
      if (twoCharSymbols.has(twoChar)) {
        const namedOp = symbolToNamed[twoChar];
        this.tokens.push(createToken("operator", namedOp, startPos));
        this.position += 2;
        continue;
      }

      if (singleCharSymbols.has(char)) {
        const namedOp = symbolToNamed[char];
        this.tokens.push(createToken("operator", namedOp, startPos));
        this.position++;
        continue;
      }

      // Handle identifiers and keywords
      if (/[a-zA-Z]/.test(char)) {
        const identifier = this.readIdentifier();
        const lower = identifier.toLowerCase();

        if (logicalKeywords.has(lower)) {
          const tokenType = lower === "and" ? "and" : "or";
          this.tokens.push(createToken(tokenType, lower, startPos));
        } else if (valueKeywords.has(lower)) {
          // Handle special value keywords
          this.tokens.push(createToken("value", lower, startPos));
        } else if (validNamedOperators.has(lower)) {
          // Handle named operators (already in canonical form)
          this.tokens.push(createToken("operator", lower, startPos));
        } else {
          // Determine if it's a field or value by looking ahead
          const isField = this.isFieldIdentifier();
          this.tokens.push(createToken(isField ? "field" : "value", identifier, startPos));
        }
        continue;
      }

      // Handle numbers (a leading "-" only where a value can start)
      if (/\d/.test(char) || this.isNegativeNumber()) {
        const value = this.readNumber();
        if (value === null) {
          return createError(createParseError("Invalid number", startPos, this.input, "SYNTAX_ERROR"));
        }
        this.tokens.push(createToken("value", value, startPos));
        continue;
      }

      return createError(createParseError(`Unexpected character '${char}'`, this.position, this.input, "SYNTAX_ERROR"));
    }

    this.tokens.push(createToken("eof", "", this.position));
    return createSuccess(this.tokens);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.input[this.position])) {
      this.position++;
    }
  }

  /** Reads a quoted string; returns null if the closing quote is missing. */
  private readString(quote: string): string | null {
    let value = "";
    this.position++; // Skip opening quote

    while (this.position < this.input.length && this.input[this.position] !== quote) {
      if (this.input[this.position] === "\\" && this.position + 1 < this.input.length) {
        this.position++; // Skip backslash
      }
      value += this.input[this.position];
      this.position++;
    }

    if (this.position >= this.input.length) {
      return null;
    }
    this.position++; // Skip closing quote

    return value;
  }

  private readIdentifier(): string {
    let value = "";
    while (this.position < this.input.length && /[a-zA-Z0-9_.]/.test(this.input[this.position])) {
      value += this.input[this.position];
      this.position++;
    }
    return value;
  }

  /** Reads an array literal verbatim; returns null if the closing "]" is missing. */
  private readArray(): string | null {
    let value = "[";
    this.position++; // Skip opening bracket

    // Quote-aware scan: a "]" only terminates the array when it is NOT inside a
    // quoted string element. Backslash escapes are copied verbatim (not
    // unescaped) so the downstream JSON parse sees valid escape sequences.
    let inQuote: string | null = null;
    while (this.position < this.input.length) {
      const ch = this.input[this.position];

      if (inQuote) {
        value += ch;
        if (ch === "\\" && this.position + 1 < this.input.length) {
          this.position++;
          value += this.input[this.position]; // copy the escaped char verbatim
        } else if (ch === inQuote) {
          inQuote = null;
        }
        this.position++;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inQuote = ch;
        value += ch;
        this.position++;
        continue;
      }

      if (ch === "]") {
        break;
      }

      value += ch;
      this.position++;
    }

    if (this.position >= this.input.length) {
      return null;
    }
    value += "]";
    this.position++; // Skip closing bracket

    return value;
  }

  /**
   * Reads `-?digits(.digits)?`. Returns null when the number is malformed or
   * runs straight into more word characters (`1.2.3`, `1.`, `18abc`).
   */
  private readNumber(): string | null {
    numberPattern.lastIndex = this.position;
    const match = numberPattern.exec(this.input);
    if (!match) {
      return null;
    }
    this.position += match[0].length;
    if (this.position < this.input.length && /[\w.]/.test(this.input[this.position])) {
      return null;
    }
    return match[0];
  }

  private isNegativeNumber(): boolean {
    const char = this.input[this.position];
    if (char === "-" && this.position + 1 < this.input.length && /\d/.test(this.input[this.position + 1])) {
      const lastToken = this.tokens.length > 0 ? this.tokens[this.tokens.length - 1] : null;
      // Only treat as negative number if previous token is an operator or we're at start
      return (
        !lastToken ||
        lastToken.type === "operator" ||
        lastToken.type === "leftParen" ||
        lastToken.type === "and" ||
        lastToken.type === "or"
      );
    }
    return false;
  }

  private isFieldIdentifier(): boolean {
    const savedPos = this.position;
    this.skipWhitespace();

    if (this.position >= this.input.length) {
      this.position = savedPos;
      return false;
    }

    const nextChar = this.input[this.position];

    // Check if next token could be an operator
    const isField =
      // Comparison operators (=, !=, >, >=, <, <=)
      ["=", "!", ">", "<"].includes(nextChar) ||
      // Check for named operators (eq, ne, gt, gte, like, in, etc.)
      namedOperatorArray.some((op) => this.input.slice(this.position).toLowerCase().startsWith(op)) ||
      // Also treat as field if followed by a value token (number, string, array)
      /\d/.test(nextChar) ||
      nextChar === "'" ||
      nextChar === '"' ||
      nextChar === "[" ||
      nextChar === "-"; // Negative numbers

    this.position = savedPos;
    return isField;
  }
}

// ============================================================================
// STANDALONE FUNCTION (for backward compatibility)
// ============================================================================

/**
 * Tokenizes a filter expression string into tokens.
 *
 * @example
 * const result = tokenizeFilterExpression("age >= 18");
 * if (isSuccess(result)) {
 *   console.log(result.data); // Token array
 * }
 *
 * @deprecated See {@link Lexer}.
 */
export function tokenizeFilterExpression(input: string): Result<readonly Token[]> {
  const lexer = new Lexer();
  return lexer.tokenize(input);
}
