// ============================================================================
// FILTER GRAMMAR
// ============================================================================
// The filter language written as parser combinators, with no separate lexer:
// whether a word is a field or a value is decided by where it sits in the
// grammar (`field operator value`), not by peeking ahead to guess. This is the
// parser behind parseFilterExpression; the older Lexer + PrattParser remain
// (deprecated) and filter-grammar.test.ts checks the two agree.
//
//   filter     = expr EOF
//   expr       = andExpr { "or" andExpr }
//   andExpr    = primary { "and" primary }
//   primary    = comparison | "(" expr ")"
//   comparison = field operator [ value ]      (no value for is_null / is_not_null)
//   value      = string | number | array | "true" | "false" | "null" | bareword
//
// parseFilterValue reads a lone `value`, for UIs that hold one serialized.

import type { ComparisonNode, ComparisonOperator, FilterNode, LogicalOperator } from "../ast-types.js";
import { isOperator, query, requiresValue, symbolToOperator } from "../language.js";
import type { Result } from "../result-types.js";
import { createError, createParseError, createSuccess, isParseErrorCode } from "../result-types.js";
import {
  alt,
  chain,
  chainl1,
  eof,
  fatal,
  label,
  lazy,
  left,
  map,
  type Parser,
  pure,
  regex,
  right,
  sepBy,
  seq,
  where,
} from "./combinators.js";

// ============================================================================
// TOKENS
// ============================================================================

const ws = regex(/\s*/y, "whitespace");

/** `p`, then any whitespace after it. Hutton's `token`. */
const lexeme = <A>(p: Parser<A>): Parser<A> => left(p, ws);

/** An exact piece of punctuation. Hutton's `symbol`. */
const symbol = (text: string): Parser<string> =>
  lexeme(regex(new RegExp(text.replaceAll(/[[\]()]/g, "\\$&"), "y"), `'${text}'`));

/** A case-insensitive keyword that is not the start of a longer word. */
const keyword = (word: string): Parser<string> =>
  lexeme(map(regex(new RegExp(`${word}(?![\\w.])`, "iy"), word), () => word));

/** Letters, digits, "_" and "." — dotted relation paths are one word. */
const word = lexeme(regex(/[A-Za-z][\w.]*/y, "word"));

/** Fails with `message` at end of input. Elsewhere it fails silently, adding nothing to "expected". */
const missingAtEnd =
  (message: string): Parser<never> =>
  (input, pos) =>
    pos === input.length ? { ok: false, pos, expected: [], message } : { ok: false, pos, expected: [] };

const isReserved = (w: string): boolean => {
  const lower = w.toLowerCase();
  return (
    lower === "and" || lower === "or" || lower === "true" || lower === "false" || lower === "null" || isOperator(lower)
  );
};

// ============================================================================
// VALUES
// ============================================================================

const unescapeBackslashes = (body: string): string => body.replaceAll(/\\([\s\S])/g, "$1");

/** A quoted string with backslash escapes. A missing closing quote is an error, not end of input. */
const quoted = (quote: "'" | '"'): Parser<string> => {
  const pattern = quote === "'" ? /'(?:[^'\\]|\\[\s\S])*'/y : /"(?:[^"\\]|\\[\s\S])*"/y;
  return alt(
    map(regex(pattern, "string"), (s) => unescapeBackslashes(s.slice(1, -1))),
    right(regex(new RegExp(quote, "y"), "string"), fatal("Unterminated string literal")),
  );
};

// Once the opening quote is consumed, `fatal` fires one character in; report it at the quote instead.
const atStart =
  <A>(p: Parser<A>): Parser<A> =>
  (input, pos) => {
    const reply = p(input, pos);
    return !reply.ok && reply.message !== undefined ? { ...reply, pos } : reply;
  };

const stringLiteral = lexeme(atStart(alt(quoted("'"), quoted('"'))));

/** A number literal's value, or an "Invalid number" error if it is too large to be finite (`9` x 400, `1e400`). */
const finite = (literal: Parser<string>): Parser<number> =>
  chain(literal, (text) => {
    const value = Number(text);
    return Number.isFinite(value) ? pure(value) : fatal("Invalid number");
  });

/**
 * `-?digits(.digits)?(e±digits)?`, which must not run into more word
 * characters (`1.2.3`, `18abc`). Exponents are accepted because that is how
 * `String(n)` writes very small and very large numbers (`1e-7`, `1e+21`),
 * so serialized filters read back.
 */
const number = lexeme(
  atStart(
    alt(
      finite(regex(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/y, "number")),
      right(regex(/-?\d/y, "number"), fatal("Invalid number")),
    ),
  ),
);

const literal = alt<boolean | null>(
  map(keyword("true"), () => true),
  map(keyword("false"), () => false),
  map(keyword("null"), () => null),
);

// Arrays are flat. Elements follow JSON (double-quoted strings with JSON
// escapes, JSON numbers, lowercase literals), plus single-quoted strings for
// hand-written input like ['a', 'b'].
/** A JSON string; `JSON.parse` decides which escapes are valid. */
const jsonString = lexeme(
  chain(regex(/"(?:[^"\\]|\\[\s\S])*"/y, "string"), (s) => {
    try {
      return pure(JSON.parse(s) as string);
    } catch {
      return fatal("Invalid string in array literal");
    }
  }),
);
const jsonNumber = lexeme(finite(regex(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/y, "number")));
const jsonLiteral = alt<boolean | null>(
  map(lexeme(regex(/true(?![\w.])/y, "true")), () => true),
  map(lexeme(regex(/false(?![\w.])/y, "false")), () => false),
  map(lexeme(regex(/null(?![\w.])/y, "null")), () => null),
);

const arrayElement = label(alt<unknown>(jsonString, lexeme(quoted("'")), jsonNumber, jsonLiteral), "array element");

const arrayLiteral: Parser<unknown[]> = atStart(
  right(
    symbol("["),
    left(sepBy(arrayElement, symbol(",")), alt(symbol("]"), missingAtEnd("Unterminated array literal"))),
  ),
);

const bareword = where(word, (w) => !isReserved(w), "value");

const value = label(alt<unknown>(stringLiteral, arrayLiteral, number, literal, bareword), "value");

// ============================================================================
// COMPARISONS
// ============================================================================

const field = label(
  where(word, (w) => !isReserved(w), "field"),
  "field",
);

const operator = label(
  alt(
    map(lexeme(regex(/!=|>=|<=|=|>|</y, "operator")), (s) => symbolToOperator[s] as ComparisonOperator),
    map(
      where(word, (w) => isOperator(w.toLowerCase()), "operator"),
      (w) => w.toLowerCase() as ComparisonOperator,
    ),
  ),
  "operator",
);

/** BETWEEN takes exactly a two-element array; anything else is an INVALID_VALUE at the value. */
const checkValue = (op: ComparisonOperator, v: unknown): string | undefined => {
  if (op !== "between") {
    return undefined;
  }
  if (!Array.isArray(v)) {
    return `BETWEEN operator requires an array value, got ${typeof v}`;
  }
  if (v.length !== 2) {
    return `BETWEEN operator requires exactly 2 values, got ${v.length}`;
  }
  return undefined;
};

const comparisonValue =
  (op: ComparisonOperator): Parser<unknown> =>
  (input, pos) => {
    const reply = value(input, pos);
    if (!reply.ok) {
      return reply;
    }
    const problem = checkValue(op, reply.value);
    return problem ? fatal(problem, "INVALID_VALUE")(input, pos) : reply;
  };

const comparison: Parser<ComparisonNode> = chain(seq(field, operator), ([f, op]) =>
  map(requiresValue(op) ? comparisonValue(op) : pure(null), (v) => ({
    type: "comparison" as const,
    field: f,
    operator: op,
    value: v,
  })),
);

// ============================================================================
// EXPRESSIONS
// ============================================================================

const logical = (op: LogicalOperator): Parser<(l: FilterNode, r: FilterNode) => FilterNode> =>
  map(keyword(op), () => (l, r) => ({ type: "logical" as const, operator: op, left: l, right: r }));

const closeParen = alt(symbol(")"), missingAtEnd("Unbalanced parentheses: missing closing parenthesis"));

/**
 * The expression grammar for a given nesting limit. Parentheses are the only
 * recursion (AND/OR chains are loops), so counting open groups bounds the
 * stack. The count is checked after "(" is consumed, so any other token at
 * the limit still gets its ordinary error.
 */
const buildFilter = (maxDepth: number): Parser<FilterNode> => {
  let depth = 0;
  const levels = maxDepth === 1 ? "1 level" : `${maxDepth} levels`;

  const expr: Parser<FilterNode> = lazy(() => chainl1(chainl1(primary, logical("and")), logical("or")));

  const inner = map(seq(expr, closeParen), ([expression]): FilterNode => ({ type: "group", expression }));

  const group: Parser<FilterNode> = (input, pos) => {
    const open = symbol("(")(input, pos);
    if (!open.ok) {
      return open;
    }
    if (depth >= maxDepth) {
      return {
        ok: false,
        pos,
        expected: [],
        message: `Filter is nested more than ${levels} deep`,
        code: "LIMIT_EXCEEDED",
      };
    }
    depth++;
    try {
      return inner(input, open.pos);
    } finally {
      depth--;
    }
  };

  const primary: Parser<FilterNode> = alt<FilterNode>(comparison, group);

  return right(ws, left(expr, eof));
};

const filters = new Map<number, Parser<FilterNode>>();

const filterFor = (maxDepth: number): Parser<FilterNode> => {
  let parser = filters.get(maxDepth);
  if (!parser) {
    // Callers use one or two limits; bound the cache anyway.
    if (filters.size >= 16) {
      filters.clear();
    }
    parser = buildFilter(maxDepth);
    filters.set(maxDepth, parser);
  }
  return parser;
};

// ============================================================================
// ENTRY POINT
// ============================================================================

const describeAt = (input: string, pos: number): string => {
  const next = /[A-Za-z0-9_.]+|[!<>=]+|\S/y;
  next.lastIndex = pos;
  const match = next.exec(input);
  return match ? `'${match[0]}'` : "end of input";
};

const orList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

/**
 * Parses a filter expression into an AST. Syntax only: the size limits other
 * than nesting, and schema validation, are applied by the callers.
 *
 * @param maxDepth - Deepest allowed parenthesis nesting (default `query.limits.maxDepth`)
 */
export function parseFilterGrammar(input: string, maxDepth: number = query.limits.maxDepth): Result<FilterNode> {
  return toResult(filterFor(maxDepth), input);
}

const wholeValue = right(ws, left(value, eof));

/**
 * Parses one value as it appears on the right of a comparison — the inverse
 * of `serializeFilterValue`: `"Smith, John"`, `["a","b"]`, `42`, `null`.
 */
export function parseFilterValue(input: string): Result<unknown> {
  return toResult(wholeValue, input);
}

function toResult<A>(parser: Parser<A>, input: string): Result<A> {
  const reply = parser(input, 0);
  if (reply.ok) {
    return createSuccess(reply.value);
  }

  const message = reply.message ?? `Expected ${orList(reply.expected)}, got ${describeAt(input, reply.pos)}`;
  const code = isParseErrorCode(reply.code) ? reply.code : "SYNTAX_ERROR";
  return createError(createParseError(message, reply.pos, input, code));
}
