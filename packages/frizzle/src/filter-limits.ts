// ============================================================================
// FILTER LIMITS
// ============================================================================
// Caps on how large a parsed filter may be, so an oversized request becomes a
// ParseError instead of a stack overflow or a database error at runtime.

import { type FilterNode, malformedNodeReason } from "./ast-types.js";
import { describeValue } from "./describe-value.js";
import { query, requiresValue } from "./language.js";
import type { ParseErrorCode, Result } from "./result-types.js";
import { createError, createParseError, createSuccess } from "./result-types.js";

/**
 * Limits applied while parsing a filter. Omitted (or `null`) fields use
 * `query.limits`. Each must be a non-negative integer; NaN, Infinity,
 * negatives and fractions are an `INVALID_VALUE` error (see resolveLimits).
 */
export interface FilterLimits {
  /** Deepest allowed parenthesis nesting. Default 32. */
  readonly maxDepth?: number;
  /**
   * Most values the filter may carry: one per comparison, one per `in` /
   * `not_in` element, two for `between`, none for `is_null` / `is_not_null`.
   * Each becomes a bound parameter. Default 100 (Cloudflare D1's per-query
   * cap); lower it if your queries bind other parameters alongside the filter.
   */
  readonly maxParameters?: number;
  /**
   * Most comparisons the filter may contain. Default 1000. Caps the size of
   * the parsed tree, so a recursive walker (your own `walkFilterNode`
   * visitor) can't overflow the stack; `maxParameters` alone doesn't, since
   * null checks bind no values. On SQLite / D1 a single chain already fails
   * near 1,000 terms (SQLite's expression depth limit), so 900 or so is safer
   * if one chain of null checks could get that long.
   */
  readonly maxConditions?: number;
}

/** Number of values a filter would bind as parameters. */
export function countParameters(node: FilterNode): number {
  return measure(node).parameters;
}

/**
 * Counts comparisons, bound values and group nesting without recursion: the
 * tree is only checked against the limits after this returns, so the walk must
 * survive trees of any depth (a hand-built tree hasn't been through the parser's
 * depth check).
 */
function measure(
  root: FilterNode,
  maxNodes = Number.POSITIVE_INFINITY,
  maxDepth = Number.POSITIVE_INFINITY,
): { conditions: number; parameters: number; depth: number; problem?: { message: string; code: ParseErrorCode } } {
  let conditions = 0;
  let parameters = 0;
  let depth = 0;
  let visited = 0;
  const pending: [FilterNode, number][] = [[root, 0]];
  for (let entry = pending.pop(); entry; entry = pending.pop()) {
    const [node, groups] = entry;
    visited++;
    if (visited > maxNodes) {
      // A tree within the limits has far fewer nodes. Getting here means the
      // tree reuses (or cycles through) subtrees, or is far over the limits
      // anyway, e.g. thousands of heavily parenthesized conditions.
      return {
        conditions,
        parameters,
        depth,
        problem: { message: "Filter is too large to measure", code: "LIMIT_EXCEEDED" },
      };
    }
    const malformed = malformedNodeReason(node);
    if (malformed) {
      return { conditions, parameters, depth, problem: { message: malformed, code: "SYNTAX_ERROR" } };
    }
    if (node.type === "comparison") {
      conditions++;
      if (requiresValue(node.operator)) {
        parameters += Array.isArray(node.value) ? node.value.length : 1;
      }
    } else if (node.type === "logical") {
      pending.push([node.right, groups], [node.left, groups]);
    } else if (node.type === "group") {
      depth = Math.max(depth, groups + 1);
      if (depth > maxDepth) {
        // Too deep already; the error names the limit, not the depth, so stop.
        return { conditions, parameters, depth };
      }
      pending.push([node.expression, groups + 1]);
    }
  }
  return { conditions, parameters, depth };
}

/** FilterLimits with every limit filled in and checked. */
export type ResolvedLimits = Required<FilterLimits>;

const LIMIT_NAMES = ["maxDepth", "maxParameters", "maxConditions"] as const;

/**
 * Fills in defaults and checks each limit is a non-negative integer.
 * `undefined` / `null` mean the default; NaN, Infinity, negatives and
 * fractions are errors rather than silently disabling the limit (a limit
 * that compares false against every count would let deep nesting overflow
 * the stack).
 */
export function resolveLimits(limits: FilterLimits | undefined, input: string): Result<ResolvedLimits> {
  const resolved = { ...query.limits } as Record<(typeof LIMIT_NAMES)[number], number>;
  for (const name of LIMIT_NAMES) {
    const value: unknown = limits?.[name];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      return createError(
        createParseError(
          `Invalid ${name}: ${describeValue(value)}. Must be a non-negative integer`,
          0,
          input,
          "INVALID_VALUE",
        ),
      );
    }
    resolved[name] = value;
  }
  return createSuccess({
    maxDepth: resolved.maxDepth,
    maxParameters: resolved.maxParameters,
    maxConditions: resolved.maxConditions,
  });
}

/**
 * Rejects a filter with more comparisons or values than `limits` allow, or
 * with groups nested deeper than `maxDepth`.
 */
export function checkFilterLimits(node: FilterNode, input: string, limits: ResolvedLimits): Result<FilterNode> {
  const { maxConditions, maxParameters, maxDepth } = limits;
  // Generous: a tree has at most 2 nodes per condition, plus groups (at most
  // maxDepth around each).
  const maxNodes = 2 * (maxConditions + 1) * (maxDepth + 2) + 1000;
  const { conditions, parameters, depth, problem } = measure(node, maxNodes, maxDepth);
  if (problem) {
    return createError(createParseError(problem.message, 0, input, problem.code));
  }
  if (depth > maxDepth) {
    const levels = maxDepth === 1 ? "1 level" : `${maxDepth} levels`;
    return createError(createParseError(`Filter is nested more than ${levels} deep`, 0, input, "LIMIT_EXCEEDED"));
  }
  if (conditions > maxConditions) {
    return createError(
      createParseError(
        `Filter has ${conditions} conditions; the limit is ${maxConditions}`,
        0,
        input,
        "LIMIT_EXCEEDED",
      ),
    );
  }
  if (parameters > maxParameters) {
    return createError(
      createParseError(`Filter has ${parameters} values; the limit is ${maxParameters}`, 0, input, "LIMIT_EXCEEDED"),
    );
  }
  return createSuccess(node);
}
