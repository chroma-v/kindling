// ============================================================================
// PARSER MODULE
// ============================================================================
// parseFilterExpression (the combinator grammar in filter-grammar.ts), plus the
// original Pratt parser over Lexer tokens, kept for compatibility (deprecated).

import type { ComparisonNode, ComparisonOperator, FilterNode, LogicalOperator } from "../ast-types.js";
import { checkFilterLimits, type FilterLimits, resolveLimits } from "../filter-limits.js";
import { query } from "../language.js";
import type { Result } from "../result-types.js";
import { createError, createParseError, createSuccess, isError } from "../result-types.js";
import type { Token, TokenType } from "../token-types.js";
import { createToken } from "../token-types.js";
import { parseFilterGrammar } from "./filter-grammar.js";

/** Sentinel from {@link PrattParser.parseArray} for a literal that isn't a valid array. */
const invalidArray = Symbol("invalidArray");

// ============================================================================
// PRATT PARSER CLASS
// ============================================================================

/**
 * Pratt parser for filter expressions.
 *
 * Implements operator precedence parsing (Pratt parsing) to build an AST
 * from a stream of tokens. Handles:
 * - Comparison operations (field op value)
 * - Logical operations (AND/OR with precedence)
 * - Grouped expressions (parentheses)
 * - Operator precedence (AND binds tighter than OR)
 *
 * @example
 * const tokens = [
 *   { type: "field", value: "age" },
 *   { type: "operator", value: ">=" },
 *   { type: "value", value: "18" },
 *   { type: "eof", value: "" },
 * ];
 * const parser = new PrattParser(tokens);
 * const result = parser.parseExpression(0);
 *
 * @deprecated `parseFilterExpression` no longer uses this: it parses with the
 * combinator grammar, which needs no separate lexer. Kept for code that feeds
 * it tokens directly; use {@link parseTokens} for the full check (end of
 * input, limits). Will be removed in a future release.
 */
export class PrattParser {
  private tokens: readonly Token[];
  private position = 0;
  private depth = 0;
  private readonly maxDepth: number;

  /**
   * @param tokens - Tokens from the lexer, ending in `eof`
   * @param limits - `maxDepth` caps parenthesis nesting (default `query.limits.maxDepth`)
   */
  constructor(tokens: readonly Token[], limits?: FilterLimits) {
    this.tokens = tokens;
    this.maxDepth = limits?.maxDepth ?? query.limits.maxDepth;
  }

  /**
   * Gets the current token without consuming it.
   */
  get currentToken(): Token {
    return this.tokens[this.position] || createToken("eof", "", this.tokens.length);
  }

  /**
   * Advances to the next token.
   */
  private advance(): void {
    if (this.position < this.tokens.length - 1) {
      this.position++;
    }
  }

  /**
   * Expects a specific token type and consumes it if found.
   *
   * @param type - The expected token type
   * @returns Success with token if found, error otherwise
   */
  private expect(type: TokenType): Result<Token> {
    const token = this.currentToken;
    if (token.type !== type) {
      // Provide better error message for unbalanced parentheses
      const message =
        type === "rightParen" && token.type === "eof"
          ? "Unbalanced parentheses: missing closing parenthesis"
          : `Expected ${type}, got ${token.type}`;

      return createError(
        createParseError(message, token.position, this.tokens.map((t) => t.value).join(" "), "SYNTAX_ERROR"),
      );
    }
    this.advance();
    return createSuccess(token);
  }

  /**
   * Parses a comparison node (field op value).
   *
   * @returns Success with ComparisonNode if valid, error otherwise
   */
  private parseComparison(): Result<ComparisonNode> {
    const fieldResult = this.expect("field");
    if (isError(fieldResult)) {
      return fieldResult;
    }

    const operatorResult = this.expect("operator");
    if (isError(operatorResult)) {
      return operatorResult;
    }

    const field = fieldResult.data.value;
    const operator = operatorResult.data.value;

    // Null-check operators don't require a value
    if (operator === "is_null" || operator === "is_not_null") {
      return createSuccess({
        type: "comparison" as const,
        field,
        operator: operator as ComparisonOperator,
        value: null,
      });
    }

    const valueResult = this.expect("value");
    if (isError(valueResult)) {
      return valueResult;
    }

    const value = this.coerceValue(valueResult.data);

    if (value === invalidArray) {
      return createError(
        createParseError(
          `Invalid array literal: ${valueResult.data.value}`,
          valueResult.data.position,
          this.tokens.map((t) => t.value).join(" "),
          "INVALID_VALUE",
        ),
      );
    }

    // Validate BETWEEN operator requires array with 2 elements
    if (operator === "between") {
      if (!Array.isArray(value)) {
        return createError(
          createParseError(
            `BETWEEN operator requires an array value, got ${typeof value}`,
            valueResult.data.position,
            this.tokens.map((t) => t.value).join(" "),
            "INVALID_VALUE",
          ),
        );
      }
      if (value.length !== 2) {
        return createError(
          createParseError(
            `BETWEEN operator requires exactly 2 values, got ${value.length}`,
            valueResult.data.position,
            this.tokens.map((t) => t.value).join(" "),
            "INVALID_VALUE",
          ),
        );
      }
    }

    return createSuccess({
      type: "comparison" as const,
      field,
      operator: operator as ComparisonOperator,
      value,
    });
  }

  /**
   * Coerces a value token to its typed value.
   *
   * The token's `valueKind` (set by the lexer) is authoritative:
   * - "string": a quoted literal — returned verbatim, never coerced. This is
   *   what keeps `name eq "0"` a string and `name eq "true"` a string.
   * - "array": an array literal — parsed (JSON-first, see {@link parseArray}).
   * - undefined: a bare token (number, true/false/null, or bareword) — coerced
   *   by content.
   *
   * @param token - The value token to coerce
   * @returns Coerced value (number, boolean, null, array, or string)
   *
   * @private
   */
  private coerceValue(token: Token): unknown {
    const { value, valueKind } = token;

    // Quoted string literal — preserve verbatim, no content-based coercion.
    if (valueKind === "string") {
      return value;
    }

    // Array literal.
    if (valueKind === "array") {
      return this.parseArray(value);
    }

    // Bare token: coerce by content. Leading "-" is part of the number.
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    const lower = value.toLowerCase();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
    if (lower === "null") {
      return null;
    }

    // Defensive: an untagged array-shaped value (shouldn't occur post-lexer).
    if (value.startsWith("[") && value.endsWith("]")) {
      return this.parseArray(value);
    }

    return value;
  }

  /**
   * Parses an array literal string into a JS array.
   *
   * Tries strict JSON first — this round-trips the serializer's output exactly,
   * including double-quoted elements that contain "'", "]", or escaped quotes,
   * and preserves the string-vs-number distinction of each element ("0" stays a
   * string, 0 stays a number). Falls back to a single-quote → double-quote
   * rewrite to tolerate hand-written arrays like `['a', 'b']`. Anything that
   * still isn't a JSON array yields the `invalidArray` sentinel.
   *
   * @private
   */
  private parseArray(value: string): unknown[] | typeof invalidArray {
    for (const candidate of [value, value.replaceAll("'", '"')]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // try the next candidate
      }
    }
    return invalidArray;
  }

  /**
   * Parses a primary expression (comparison or grouped expression).
   *
   * @returns Success with FilterNode if valid, error otherwise
   */
  private parsePrimary(): Result<FilterNode> {
    if (this.currentToken.type === "leftParen") {
      // Checked before recursing, so deep nesting is an error, not a stack overflow.
      if (this.depth >= this.maxDepth) {
        const levels = this.maxDepth === 1 ? "1 level" : `${this.maxDepth} levels`;
        return createError(
          createParseError(
            `Filter is nested more than ${levels} deep`,
            this.currentToken.position,
            this.tokens.map((t) => t.value).join(" "),
            "LIMIT_EXCEEDED",
          ),
        );
      }

      this.advance(); // consume '('
      this.depth++;
      const exprResult = this.parseExpression(0);
      this.depth--;
      if (isError(exprResult)) {
        return exprResult;
      }

      const rparenResult = this.expect("rightParen");
      if (isError(rparenResult)) {
        return rparenResult;
      }

      return createSuccess({
        type: "group" as const,
        expression: exprResult.data,
      });
    }

    return this.parseComparison();
  }

  /**
   * Gets the precedence level for a token type.
   *
   * @param tokenType - The token type
   * @returns Precedence level (higher = binds tighter)
   */
  private getPrecedence(tokenType: TokenType): number {
    switch (tokenType) {
      case "or":
        return 1;
      case "and":
        return 2;
      default:
        return 0;
    }
  }

  /**
   * Parses an expression with operator precedence.
   *
   * This is the main entry point for parsing. It implements Pratt parsing
   * (operator precedence parsing) to build a correct AST respecting AND/OR
   * precedence.
   *
   * @param minPrecedence - Minimum precedence level for this expression
   * @returns Success with FilterNode if valid, error otherwise
   *
   * @example
   * // Parse "age >= 18 and status = 'active' or role = 'admin'"
   * // Result: OR(AND(age>=18, status='active'), role='admin')
   */
  parseExpression(minPrecedence: number): Result<FilterNode> {
    const leftResult = this.parsePrimary();
    if (isError(leftResult)) {
      return leftResult;
    }

    let left = leftResult.data;

    while (this.currentToken.type !== "eof" && this.currentToken.type !== "rightParen") {
      const tokenType = this.currentToken.type;
      const precedence = this.getPrecedence(tokenType);

      // Break if we encounter a non-operator token (precedence 0) or lower precedence
      if (precedence === 0 || precedence < minPrecedence) {
        break;
      }

      const operator = this.currentToken.value.toLowerCase() as LogicalOperator;
      this.advance();

      const rightResult = this.parseExpression(precedence + 1);
      if (isError(rightResult)) {
        return rightResult;
      }

      left = {
        type: "logical" as const,
        operator,
        left,
        right: rightResult.data,
      };
    }

    return createSuccess(left);
  }
}

// ============================================================================
// STANDALONE FUNCTION
// ============================================================================

/**
 * Parses a filter expression string into an AST.
 *
 * 1. Parses the input with the combinator grammar (see filter-grammar.ts),
 *    enforcing `maxDepth`
 * 2. Enforces the size limits (`maxConditions`, `maxParameters`)
 *
 * Input is an already-decoded expression; decoding is the transport layer's job.
 *
 * @param input - The filter expression string
 * @param limits - Optional overrides for `query.limits.maxDepth` / `maxConditions` / `maxParameters`
 * @returns Success with FilterNode AST if valid, error otherwise
 *
 * @example
 * const result = parseFilterExpression("age >= 18 and status = 'active'");
 * if (isSuccess(result)) {
 *   console.log(result.data); // FilterNode AST
 * }
 */
export function parseFilterExpression(input: string, limits?: FilterLimits): Result<FilterNode> {
  const resolved = resolveLimits(limits, input);
  if (isError(resolved)) {
    return resolved;
  }
  const result = parseFilterGrammar(input, resolved.data.maxDepth);
  if (isError(result)) {
    return result;
  }
  return checkFilterLimits(result.data, input, resolved.data);
}

/**
 * Parses tokens from a {@link Lexer} with the Pratt parser: checks that every
 * token was consumed and enforces `limits`, like parseFilterExpression.
 *
 * @deprecated For callers that supply their own tokens (e.g. a custom
 * `Compiler` `tokenizer`). Use parseFilterExpression. Will be removed with
 * Lexer and PrattParser.
 */
export function parseTokens(tokens: readonly Token[], input: string, limits?: FilterLimits): Result<FilterNode> {
  const resolved = resolveLimits(limits, input);
  if (isError(resolved)) {
    return resolved;
  }
  const parser = new PrattParser(tokens, resolved.data);
  const result = parser.parseExpression(0);
  if (isError(result)) {
    return result;
  }

  // Check if all tokens were consumed (should be at eof)
  if (parser.currentToken.type !== "eof") {
    return createError(
      createParseError(
        `Unexpected token '${parser.currentToken.value}' after expression`,
        parser.currentToken.position,
        input,
        "SYNTAX_ERROR",
      ),
    );
  }

  return checkFilterLimits(result.data, input, resolved.data);
}
