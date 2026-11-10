// ============================================================================
// CODE GENERATOR INTERFACE
// ============================================================================
// Defines the contract for converting AST to target code (Drizzle, SQL, etc.)
//
// Purpose: Decouple AST representation from code generation targets
// - Input: Validated QueryAst
// - Output: Target-specific code (Drizzle query, SQL string, GraphQL, etc.)
//
// Benefits:
// - Easy to add new code generation targets
// - Target logic isolated from parsing/validation
// - Testable in isolation

import {
  type ComparisonNode,
  chainOperands,
  type FilterNode,
  type GroupNode,
  type LogicalOperator,
  malformedNodeReason,
  type QueryAst,
} from "./ast-types.js";
import { createError, createParseError, isError, type Result } from "./result-types.js";

// ============================================================================
// CORE INTERFACE
// ============================================================================

/**
 * Code generator interface - converts AST to target code
 *
 * @template TQuery - The type of query object produced (e.g., Drizzle SelectQueryBuilder)
 * @template TContext - Additional context needed for generation (e.g., table columns)
 *
 * @example
 * // Drizzle implementation
 * class DrizzleCodeGenerator implements CodeGenerator<DrizzleQuery, DrizzleContext> {
 *   generate(ast: QueryAst, context: DrizzleContext): Result<DrizzleQuery> {
 *     // Convert AST to Drizzle query
 *   }
 * }
 *
 * // SQL implementation
 * class SQLCodeGenerator implements CodeGenerator<string, SQLContext> {
 *   generate(ast: QueryAst, context: SQLContext): Result<string> {
 *     // Convert AST to SQL string
 *   }
 * }
 */
export interface CodeGenerator<TQuery, TContext = unknown> {
  /**
   * Generate target code from validated AST
   *
   * @param ast - The validated query AST
   * @param context - Target-specific context (table metadata, base query, etc.)
   * @returns Result containing generated code or error
   */
  generate(ast: QueryAst, context: TContext): Result<TQuery>;
}

// ============================================================================
// VISITOR INTERFACE (for tree walking)
// ============================================================================

/**
 * Visitor pattern for walking filter nodes
 * Code generators can implement this to traverse the AST
 *
 * @template TResult - The result type of visiting each node
 *
 * @example
 * // The fields a filter mentions
 * const fieldsVisitor: FilterNodeVisitor<string[]> = {
 *   visitComparison: (node) => [node.field],
 *   visitLogical: (node) => [...walkFilterNode(node.left, fieldsVisitor), ...walkFilterNode(node.right, fieldsVisitor)],
 *   visitGroup: (node) => walkFilterNode(node.expression, fieldsVisitor),
 * };
 */
export interface FilterNodeVisitor<TResult> {
  /**
   * Visit a comparison node (e.g., "age >= 25")
   */
  visitComparison(node: FilterNode & { type: "comparison" }): TResult;

  /**
   * Visit a logical node (e.g., "age >= 25 and active = true")
   */
  visitLogical(node: FilterNode & { type: "logical" }): TResult;

  /**
   * Visit a group node (e.g., "(age >= 25 and active = true)")
   */
  visitGroup(node: FilterNode & { type: "group" }): TResult;
}

/**
 * Walk a filter node tree using the visitor pattern. The visitor recurses
 * through `walkFilterNode` itself, so this is fine for a tree within the
 * parse limits (`maxConditions`, `maxDepth`) but not stack-safe for a very
 * large hand-built one.
 *
 * @param node - The filter node to walk
 * @param visitor - The visitor implementation
 * @returns The result of visiting the tree
 *
 * @example
 * const fields = walkFilterNode(ast.filter, fieldsVisitor);
 */
export function walkFilterNode<TResult>(node: FilterNode, visitor: FilterNodeVisitor<TResult>): TResult {
  switch (node.type) {
    case "comparison":
      return visitor.visitComparison(node);
    case "logical":
      return visitor.visitLogical(node);
    case "group":
      return visitor.visitGroup(node);
    default: {
      // Exhaustiveness check - TypeScript will error if we miss a case
      const _exhaustive: never = node;
      throw new Error(`Unknown node type: ${(_exhaustive as FilterNode).type}`);
    }
  }
}

// ============================================================================
// FOLD (stack-safe traversal)
// ============================================================================

/**
 * Handlers for {@link foldFilterNode}: how to turn each kind of node into a
 * `T`, given its children's results. Each handler gets the children's results
 * first, then the node(s) they came from.
 *
 * Handlers are called in source order: every comparison left to right, each
 * chain or group right after its last operand. A handler that binds
 * parameters (e.g. `$1`, `$2`) can rely on that.
 */
export interface FilterNodeFold<T, TStop extends T = never> {
  /** A leaf comparison, e.g. `age gte 18`. */
  comparison(node: ComparisonNode): T;
  /**
   * A run of logical nodes with one operator, as one step: `a and b and c` is
   * `chain([a, b, c], "and", ...)` however the binary nodes nest. `nodes` are
   * the operand nodes, in the same order as `operands`.
   */
  chain(operands: Exclude<T, TStop>[], operator: LogicalOperator, nodes: readonly FilterNode[]): T;
  /** A parenthesized expression. */
  group(expression: Exclude<T, TStop>, node: GroupNode): T;
  /**
   * A value that ends the fold at once, e.g. an error Result: it becomes the
   * fold's result and nothing further is visited, so the other handlers never
   * see one. Being leftmost-first, it is the leftmost such value.
   */
  stop?(value: T): value is TStop;
  /**
   * The result for a node that isn't a valid filter node (a hand-built tree
   * with a missing child, an unknown type, ...). Without it, the fold throws.
   */
  malformed?(reason: string): T;
}

type FoldStep =
  | { readonly kind: "visit"; readonly node: FilterNode }
  | { readonly kind: "chain"; readonly operator: LogicalOperator; readonly nodes: readonly FilterNode[] }
  | { readonly kind: "group"; readonly node: GroupNode };

/**
 * Fold a filter tree into a value, bottom-up, without recursion: any depth is
 * safe, where a recursive visitor overflows the stack on a long chain.
 *
 * Runs of one logical operator are handed over as one `chain` with all their
 * operands, so a 10,000-condition `and` becomes one `and(...)` rather than
 * 10,000 nested ones (which Drizzle, for one, can't render).
 */
export function foldFilterNode<T, TStop extends T = never>(root: FilterNode, fold: FilterNodeFold<T, TStop>): T {
  type Done = Exclude<T, TStop>;
  const isDone = (value: T): value is Done => fold.stop?.(value) !== true;
  // `steps` is the work still to do (popped from the end); `done` holds the
  // results of finished subtrees, which a chain or group step consumes.
  const steps: FoldStep[] = [{ kind: "visit", node: root }];
  const done: Done[] = [];

  for (let step = steps.pop(); step; step = steps.pop()) {
    let value: T;
    if (step.kind === "chain") {
      value = fold.chain(done.splice(-step.nodes.length), step.operator, step.nodes);
    } else if (step.kind === "group") {
      const [expression] = done.splice(-1);
      value = fold.group(expression, step.node);
    } else {
      const { node } = step;
      const reason = malformedNodeReason(node);
      if (reason !== undefined) {
        if (!fold.malformed) {
          throw new Error(reason);
        }
        return fold.malformed(reason);
      }
      if (node.type === "logical") {
        const nodes = chainOperands(node.operator, node);
        steps.push({ kind: "chain", operator: node.operator, nodes });
        for (let i = nodes.length - 1; i >= 0; i--) {
          steps.push({ kind: "visit", node: nodes[i] });
        }
        continue;
      }
      if (node.type === "group") {
        steps.push({ kind: "group", node }, { kind: "visit", node: node.expression });
        continue;
      }
      value = fold.comparison(node);
    }
    if (!isDone(value)) {
      return value;
    }
    done.push(value);
  }
  // Every step consumed its operands, so the root's result is the only one left.
  return done[0];
}

type Failure<T> = Extract<Result<T>, { success: false }>;

/**
 * {@link foldFilterNode} into a `Result`: `chain` and `group` get their
 * operands' data, the first error (leftmost) is the result, and a malformed
 * node is a SYNTAX_ERROR.
 */
export function foldFilterResult<T>(
  root: FilterNode,
  fold: {
    comparison(node: ComparisonNode): Result<T>;
    chain(operands: T[], operator: LogicalOperator, nodes: readonly FilterNode[]): Result<T>;
    group(expression: T, node: GroupNode): Result<T>;
  },
): Result<T> {
  return foldFilterNode<Result<T>, Failure<T>>(root, {
    comparison: (node) => fold.comparison(node),
    chain: (operands, operator, nodes) =>
      fold.chain(
        operands.map((operand) => operand.data),
        operator,
        nodes,
      ),
    group: (expression, node) => fold.group(expression.data, node),
    stop: isError,
    malformed: (reason) => createError(createParseError(reason, 0, "", "SYNTAX_ERROR")),
  });
}
