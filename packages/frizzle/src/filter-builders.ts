// ============================================================================
// FILTER NODE BUILDERS
// ============================================================================
// Build FilterNode trees in code instead of writing the object literals by
// hand, e.g. to turn shorthand query parameters (`?region=europe`) into
// conditions and AND them with a parsed user filter.

import {
  type ComparisonNode,
  type ComparisonOperator,
  chainOperands,
  type FilterNode,
  type LogicalOperator,
} from "./ast-types.js";

/**
 * A value a builder accepts. Numbers must be finite: `NaN` and `Infinity`
 * serialize as bare words and parse back as strings. `-0` comes back as `0`.
 */
export type FilterScalar = string | number | boolean | null;

const compare = (field: string, operator: ComparisonOperator, value: unknown): ComparisonNode => ({
  type: "comparison",
  field,
  operator,
  value,
});

/**
 * Joins nodes with one logical operator, left to right, as the parser would
 * for `a AND b AND c`. `undefined` arguments are skipped, so optional
 * conditions can be passed straight in; with nothing left the result is
 * `undefined`, and a single node is returned as-is.
 *
 * An operand that is itself a chain of the same operator is spliced in, so
 * `and(a, and(b, c))` is the flat chain `a AND b AND c` in whatever order it
 * was built, and adds no nesting toward `maxDepth`. An OR operand of an AND is
 * wrapped in a group, so `and(x, or(y, z))` means `x AND (y OR z)` and
 * serializes that way; that group counts as one level toward `maxDepth`. An
 * AND operand of an OR needs no group, since AND binds tighter.
 */
function combine(operator: LogicalOperator, nodes: readonly (FilterNode | undefined)[]): FilterNode | undefined {
  const present = nodes.filter((node): node is FilterNode => node !== undefined);
  if (present.length <= 1) {
    return present[0];
  }
  const terms = present
    .flatMap((node) => chainOperands(operator, node))
    // Left in an AND chain, a logical term is an OR, which needs parentheses.
    // An AND term in an OR chain doesn't: AND binds tighter, so it reads (and
    // parses back) the same without them.
    .map((node): FilterNode =>
      operator === "and" && node.type === "logical" ? { type: "group", expression: node } : node,
    );

  let result = terms[0];
  for (const term of terms.slice(1)) {
    result = { type: "logical", operator, left: result, right: term };
  }
  return result;
}

/**
 * Builders for filter trees. Each comparison builder returns a
 * `ComparisonNode`; `and` / `or` skip `undefined` and return `undefined` when
 * nothing is left.
 *
 * The trees are the same shape `parseFilter` produces, so
 * `parseFilter(serializeFilterNode(node))` gives back an equal tree, as long as
 * the field names are ones the grammar accepts: a keyword (`and`, `in`,
 * `null`, ...) or a name starting with `_` or a digit compiles fine but doesn't
 * serialize to a parseable string. See {@link FilterScalar} for values.
 * Builders don't validate: pass the result to `validateFilter(node, schema)`
 * (once, on the combined tree) before compiling it.
 *
 * @example
 * import { f } from "@chromav/frizzle";
 *
 * const where = f.and(
 *   params.region ? f.eq("region", params.region) : undefined,
 *   params.q ? f.or(f.contains("name", params.q), f.startsWith("code", params.q)) : undefined,
 * );
 * // region eq "europe" and (name contains "fr" or code starts_with "fr"),
 * // or just one side, or undefined when neither parameter is set
 */
export const f = {
  eq: (field: string, value: FilterScalar): ComparisonNode => compare(field, "eq", value),
  ne: (field: string, value: FilterScalar): ComparisonNode => compare(field, "ne", value),
  gt: (field: string, value: string | number): ComparisonNode => compare(field, "gt", value),
  gte: (field: string, value: string | number): ComparisonNode => compare(field, "gte", value),
  lt: (field: string, value: string | number): ComparisonNode => compare(field, "lt", value),
  lte: (field: string, value: string | number): ComparisonNode => compare(field, "lte", value),

  /** Substring match; the same as `contains`. */
  like: (field: string, value: string): ComparisonNode => compare(field, "like", value),
  /** Case-insensitive substring match. */
  ilike: (field: string, value: string): ComparisonNode => compare(field, "ilike", value),
  contains: (field: string, value: string): ComparisonNode => compare(field, "contains", value),
  startsWith: (field: string, value: string): ComparisonNode => compare(field, "starts_with", value),
  endsWith: (field: string, value: string): ComparisonNode => compare(field, "ends_with", value),

  in: (field: string, values: readonly FilterScalar[]): ComparisonNode => compare(field, "in", [...values]),
  notIn: (field: string, values: readonly FilterScalar[]): ComparisonNode => compare(field, "not_in", [...values]),
  between: (field: string, min: string | number, max: string | number): ComparisonNode =>
    compare(field, "between", [min, max]),

  isNull: (field: string): ComparisonNode => compare(field, "is_null", null),
  isNotNull: (field: string): ComparisonNode => compare(field, "is_not_null", null),

  /**
   * ANDs the given nodes, skipping `undefined`. `undefined` if none are left.
   * Combines filter trees (what `parseFilter` returns); to combine compiled
   * where objects (`compileFilter` output, scopes), use `andWhere`.
   */
  and: (...nodes: (FilterNode | undefined)[]): FilterNode | undefined => combine("and", nodes),
  /** ORs the given nodes, skipping `undefined`. `undefined` if none are left. For where objects, use `orWhere`. */
  or: (...nodes: (FilterNode | undefined)[]): FilterNode | undefined => combine("or", nodes),
  /** Wraps a node in parentheses. */
  group: (node: FilterNode): FilterNode => ({ type: "group", expression: node }),
} as const;
