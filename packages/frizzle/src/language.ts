// ============================================================================
// QUERY LANGUAGE CONSTANTS
// ============================================================================
// Centralized lookup tables and registries for the query language.
// Provides type-safe constants, efficient lookups, and metadata.

/**
 * AST node type values
 */
export const nodeTypes = ["comparison", "logical", "group"] as const;

/**
 * AST node type - derived from nodeTypes array
 */
export type NodeType = (typeof nodeTypes)[number];

/**
 * Set for O(1) node type lookups
 */
const nodeTypeSet = new Set(nodeTypes);

/**
 * Type guard for node types
 */
export const isNodeType = (value: string): value is NodeType => nodeTypeSet.has(value as NodeType);

/**
 * Logical operator values (AND, OR)
 */
export const logicalOperators = ["and", "or"] as const;

/**
 * Logical operator type - derived from logicalOperators array
 */
export type LogicalOperator = (typeof logicalOperators)[number];

/**
 * Set for O(1) logical operator lookups
 */
const logicalOpSet = new Set(logicalOperators);

/**
 * Type guard for logical operators
 */
export const isLogicalOperator = (value: string): value is LogicalOperator =>
  logicalOpSet.has(value as LogicalOperator);

/**
 * Sort direction values
 */
export const sortDirections = ["asc", "desc"] as const;

/**
 * Sort direction type - derived from sortDirections array
 */
export type SortDirection = (typeof sortDirections)[number];

/**
 * Operator registry with metadata
 *
 * Each operator can have:
 * - symbol: The symbolic representation (=, !=, >, etc.)
 * - category: Logical grouping (comparison, string, array, etc.)
 * - requiresValue: Whether the operator needs a value (false for is_null/is_not_null)
 */
export const operators = {
  // Comparison operators (have symbols for backward compatibility)
  eq: { symbol: "=", category: "comparison" },
  ne: { symbol: "!=", category: "comparison" },
  gt: { symbol: ">", category: "comparison" },
  gte: { symbol: ">=", category: "comparison" },
  lt: { symbol: "<", category: "comparison" },
  lte: { symbol: "<=", category: "comparison" },

  // String operators (URL-safe only, no symbols)
  like: { category: "string" },
  ilike: { category: "string" },
  starts_with: { category: "string" },
  ends_with: { category: "string" },
  contains: { category: "string" },

  // Array operators
  in: { category: "array" },
  not_in: { category: "array" },

  // Range operators
  between: { category: "range" },

  // Null operators (don't require values)
  is_null: { category: "null", requiresValue: false },
  is_not_null: { category: "null", requiresValue: false },
} as const;

/**
 * Operator name type - derived from operators registry
 */
export type OperatorName = keyof typeof operators;

/**
 * All operator names as an array
 */
const operatorKeys = Object.keys(operators) as OperatorName[];

/**
 * Set for O(1) operator lookups
 */
const operatorSet = new Set(operatorKeys);

/**
 * Type guard for operators
 */
export const isOperator = (value: string): value is OperatorName => operatorSet.has(value as OperatorName);

/**
 * Check if an operator requires a value
 * (is_null and is_not_null don't need values)
 */
export const requiresValue = (op: OperatorName): boolean => {
  const operator = operators[op] as { requiresValue?: boolean };
  return operator.requiresValue !== false;
};

/**
 * Get all operators by category
 */
export const getOperatorsByCategory = (
  category: "comparison" | "string" | "array" | "range" | "null",
): OperatorName[] => operatorKeys.filter((op) => operators[op].category === category);

/**
 * Mapping from operator name to symbol (for operators that have symbols)
 * Example: { eq: "=", ne: "!=", ... }
 */
export const operatorToSymbol = Object.fromEntries(
  Object.entries(operators)
    .filter(([, v]) => "symbol" in v)
    .map(([k, v]) => [k, (v as { symbol: string }).symbol]),
) as Record<string, string>;

/**
 * Reverse mapping from symbol to operator name
 * Example: { "=": "eq", "!=": "ne", ... }
 */
export const symbolToOperator = Object.fromEntries(Object.entries(operatorToSymbol).map(([k, v]) => [v, k])) as Record<
  string,
  string
>;

/**
 * All URL-safe operators (all operators in our registry are URL-safe)
 */
export const urlSafeOperators = operatorSet;

/**
 * Check if a string is a URL-safe operator
 */
export const isUrlSafeOperator = (value: string): value is OperatorName => isOperator(value.toLowerCase());

// ============================================================================
// PATTERN 4: Namespace (Query Parameters, Limits, Defaults)
// ============================================================================

/**
 * Query configuration namespace
 */
export const query = {
  /**
   * Standard query parameter names
   */
  params: {
    filter: "filter",
    sort: "sort",
    limit: "limit",
    offset: "offset",
  },

  /**
   * Query limits and bounds
   */
  limits: {
    max: 1000,
    min: 1,
    /** Not applied anywhere; pass `defaultLimit` to parseQueryString for a default page size. */
    default: 50,
    offsetMin: 0,
    /** Deepest allowed parenthesis nesting in a filter. */
    maxDepth: 32,
    /**
     * Most values a filter may carry (each becomes a bound parameter).
     * Matches Cloudflare D1's cap of 100 bound parameters per query.
     */
    maxParameters: 100,
    /**
     * Most comparisons a filter may contain. Bounds the size (and so the depth)
     * of the tree, which maxParameters doesn't for null checks.
     */
    maxConditions: 1000,
  },

  /**
   * Default values
   */
  defaults: {
    sortDirection: "asc" as const,
  },
} as const;

/**
 * Query parameter name type
 */
export type QueryParam = keyof typeof query.params;

/**
 * Query parameter value type
 */
export type QueryParamValue = (typeof query.params)[QueryParam];

// ============================================================================
// SPECIAL VALUES AND KEYWORDS
// ============================================================================

/**
 * Special literal values recognized by the parser
 */
export const literalValues = {
  null: "null",
  true: "true",
  false: "false",
} as const;

/**
 * Type for literal value keywords
 */
export type LiteralValue = (typeof literalValues)[keyof typeof literalValues];

/**
 * Check if a string is a literal value keyword
 */
export const isLiteralValue = (value: string): value is LiteralValue => {
  const lower = value.toLowerCase();
  return lower === "null" || lower === "true" || lower === "false";
};
