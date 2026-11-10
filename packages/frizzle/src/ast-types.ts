// ============================================================================
// AST NODE TYPES - Shared between query parsers
// ============================================================================

import type { LogicalOperator, OperatorName, SortDirection } from "./language.js";

/**
 * Comparison operators supported by the query language.
 * Named operators are URL-safe and map directly to Drizzle ORM operators.
 *
 * Re-exported from constants for backward compatibility.
 */
export type ComparisonOperator = OperatorName;

/**
 * Logical operators - re-exported from constants for backward compatibility.
 */
/**
 * Sort direction - re-exported from constants for backward compatibility.
 */
export type { LogicalOperator, SortDirection };

/**
 * Comparison node - represents a single field comparison
 * Example: age = 25, name like "John"
 */
export interface ComparisonNode {
  readonly type: "comparison";
  readonly field: string;
  readonly operator: ComparisonOperator;
  readonly value: unknown;
}

/**
 * Logical node - combines two filter expressions with AND/OR
 * Example: age > 18 AND active = true
 */
export interface LogicalNode {
  readonly type: "logical";
  readonly operator: LogicalOperator;
  readonly left: FilterNode;
  readonly right: FilterNode;
}

/**
 * Group node - represents a parenthesized expression
 * Example: (age > 18 or role = "admin")
 */
export interface GroupNode {
  readonly type: "group";
  readonly expression: FilterNode;
}

/**
 * Union type for all filter node types
 */
export type FilterNode = ComparisonNode | LogicalNode | GroupNode;

/**
 * Sort node - specifies field and direction for ordering
 */
export interface SortNode {
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * Complete query AST with filter, sort, and pagination
 */
export interface QueryAst {
  readonly filter?: FilterNode;
  readonly sort?: readonly SortNode[];
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Mutable version for building - used internally
 */
export type MutableQueryAst = {
  -readonly [K in keyof QueryAst]: QueryAst[K] extends readonly (infer U)[] ? U[] : QueryAst[K];
};

/**
 * Type guards for AST nodes
 */
export const isComparisonNode = (node: FilterNode): node is ComparisonNode => node.type === "comparison";

export const isLogicalNode = (node: FilterNode): node is LogicalNode => node.type === "logical";

export const isGroupNode = (node: FilterNode): node is GroupNode => node.type === "group";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Why a value (e.g. a hand-built tree) can't be a filter node, or `undefined`
 * if its shape is fine. Checks this node only, not its children.
 */
export function malformedNodeReason(node: unknown): string | undefined {
  if (!isObject(node)) {
    return `Malformed filter node: expected an object, got ${node === null ? "null" : typeof node}`;
  }
  switch (node.type) {
    case "comparison":
      return typeof node.field === "string" ? undefined : "Malformed comparison node: missing field";
    case "logical":
      if (node.operator !== "and" && node.operator !== "or") {
        return `Malformed logical node: unknown operator '${String(node.operator)}'`;
      }
      return isObject(node.left) && isObject(node.right) ? undefined : "Malformed logical node: missing left or right";
    case "group":
      return isObject(node.expression) ? undefined : "Malformed group node: missing expression";
    default:
      return `Malformed filter node: unknown type '${String(node.type)}'`;
  }
}

/**
 * The operands of `node` read as a chain of `operator`: a logical node with
 * that operator contributes its operands, left to right (not descending into
 * groups); anything else, including a malformed node, is one operand.
 * `a and b and c` gives `[a, b, c]` whether it nests to the left or the right.
 * Iterative, so a deep chain can't overflow the stack.
 */
export function chainOperands(operator: LogicalOperator, node: FilterNode): FilterNode[] {
  const operands: FilterNode[] = [];
  const pending: FilterNode[] = [node];
  for (let next = pending.pop(); next; next = pending.pop()) {
    // A malformed node (e.g. a hand-built logical node with no `left`) stays
    // one operand, so the caller sees and reports it instead of dropping it.
    if (next.type === "logical" && next.operator === operator && malformedNodeReason(next) === undefined) {
      pending.push(next.right, next.left);
    } else {
      operands.push(next);
    }
  }
  return operands;
}
