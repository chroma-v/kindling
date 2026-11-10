// ============================================================================
// QUERY SYSTEM PUBLIC API
// ============================================================================
// Clean, generic query compiler with separate web layer
//
// Architecture:
// - Compiler: Generic query parsing and compilation
// - Web Layer: URL query string parsing (query-string.ts)
// - Code Generators: Target-specific code generation (e.g., Drizzle)
// - Core: the combinator grammar (core/filter-grammar.ts); Lexer and
//   PrattParser remain, deprecated
// - Validation: Schema validation (internal)

// ============================================================================
// MAIN API
// ============================================================================

export type { CompilerOptions } from "./compiler.js";
export { Compiler, createCompiler } from "./compiler.js";
export type { FilterScalar } from "./filter-builders.js";
export { f } from "./filter-builders.js";
export type { FilterLimits } from "./filter-limits.js";
export { countParameters } from "./filter-limits.js";
export { parseFilterValue } from "./core/filter-grammar.js";
export { parseFilter, validateFilter } from "./parse.js";

// ============================================================================
// CODE GENERATORS
// ============================================================================

// Drizzle code generator is available via "@chromav/frizzle/drizzle" entry point

export type { CodeGenerator, FilterNodeVisitor } from "./code-generator.js";

export { walkFilterNode } from "./code-generator.js";

// ============================================================================
// QUERY STRING LAYER (URL Query String Parsing)
// ============================================================================

export type { QueryParams, QueryStringOptions } from "./query-string.js";
export {
  parseQueryString,
  parseSort,
  parseSortExpression,
  serializeFilterNode,
  serializeFilterValue,
} from "./query-string.js";

// ============================================================================
// AST TYPES
// ============================================================================

export type {
  ComparisonNode,
  ComparisonOperator,
  FilterNode,
  GroupNode,
  LogicalNode,
  LogicalOperator,
  MutableQueryAst,
  QueryAst,
  SortDirection,
  SortNode,
} from "./ast-types.js";

export { isComparisonNode, isGroupNode, isLogicalNode } from "./ast-types.js";

// ============================================================================
// RESULT TYPES
// ============================================================================

export type { ParseError, ParseErrorCode, Result } from "./result-types.js";

export { createError, createParseError, createSuccess, isError, isSuccess, propagateError } from "./result-types.js";

// ============================================================================
// SCHEMA TYPES
// ============================================================================

export type { FieldType, Schema, SchemaField } from "./schema-types.js";

export { operatorSymbols } from "./schema-types.js";

// ============================================================================
// VALIDATION (Advanced Usage)
// ============================================================================

export { SchemaValidator } from "./validation/schema-validator.js";

// ============================================================================
// CORE PARSING (Advanced Usage)
// ============================================================================

// Note: Most users should use Compiler instead of these low-level APIs.
// Lexer, tokenizeFilterExpression, PrattParser and parseTokens are deprecated:
// parseFilterExpression parses with the combinator grammar.
export { Lexer, tokenizeFilterExpression } from "./core/lexer.js";
export { PrattParser, parseFilterExpression, parseTokens } from "./core/parser.js";

export type { Token, TokenType } from "./token-types.js";

// ============================================================================
// RESERVED WORDS (Advanced Usage)
// ============================================================================

export { isKeyword, keywords } from "./reserved-words.js";

// ============================================================================
// LANGUAGE CONSTANTS (Advanced Usage)
// ============================================================================

export type { LiteralValue, NodeType, OperatorName, QueryParam, QueryParamValue } from "./language.js";
export {
  getOperatorsByCategory,
  isLogicalOperator,
  isNodeType,
  isOperator,
  isUrlSafeOperator,
  logicalOperators,
  nodeTypes,
  operators,
  operatorToSymbol,
  query,
  requiresValue,
  sortDirections,
  symbolToOperator,
} from "./language.js";

// ============================================================================
// QUERY ALGEBRA (legacy — QueryConfig-based, still used by existing consumers)
// ============================================================================

export type { ExecutableQuery, Filter, Query as LegacyQuery, QueryAdapter, QueryConfig, Sort } from "./query.js";

export { allOf, andWhere, anyOf, createExecutableQuery, createQuery, mergeFilters, orWhere } from "./query.js";

// ============================================================================
// QUERY DESCRIPTOR (new — expression tree)
// ============================================================================

export type { Include, IncludeDescriptor, QueryDescriptor, Select } from "./query-descriptor.js";

export { mergeDescriptors, mergeIncludes, walkIncludes } from "./query-descriptor.js";

// ============================================================================
// QUERY BUILDER (new — mutable builder with interceptor pipeline)
// ============================================================================

export type { DescriptorAdapter, Query, QueryBuilderOptions } from "./query-builder.js";

export { createQueryBuilder } from "./query-builder.js";

// ============================================================================
// QUERY INTERCEPTORS
// ============================================================================

export type {
  QueryExecutedContext,
  QueryExecutingContext,
  QueryInterceptor,
  QueryServiceContext,
} from "./query-interceptor.js";

export { createExecutedContext, createExecutingContext, executePipeline } from "./query-interceptor.js";

// ============================================================================
// WRITE DESCRIPTOR (mutation expression tree)
// ============================================================================

export type { AfterEffect, WriteDescriptor } from "./write-descriptor.js";

export { createWriteDescriptor, mergeWriteDescriptor } from "./write-descriptor.js";

// ============================================================================
// WRITE INTERCEPTORS (mutation pipeline hooks)
// ============================================================================

export type {
  WriteInterceptor,
  WriteResult,
  WriteServiceContext,
  WritingContext,
  WrittenContext,
} from "./write-interceptor.js";

export { createWritingContext, createWrittenContext, executeWritePipeline } from "./write-interceptor.js";

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/**
 * Basic Usage Example:
 *
 * ```typescript
 * import { createCompiler, parseQueryString } from '@chromav/frizzle';
 * import { DrizzleCodeGenerator } from '@chromav/frizzle/drizzle';
 *
 * // 1. Create compiler with schema
 * const compiler = createCompiler({
 *   schema: taskSchema,
 *   codeGenerator: new DrizzleCodeGenerator()
 * });
 *
 * // 2. Query string layer parses URL query string
 * const paramsResult = parseQueryString("filter=age gte 18&sort=name:asc&limit=50");
 *
 * // 3. Compiler parses QueryParams into AST
 * const astResult = compiler.parse(paramsResult.data);
 *
 * // 4. Compiler compiles AST to Drizzle query
 * const queryResult = compiler.compile(astResult.data, {
 *   baseQuery: db.select().from(users),
 *   tableColumns: users
 * });
 *
 * // 5. Execute the query
 * const results = await queryResult.data;
 * ```
 *
 * Simplified Usage (one step):
 *
 * ```typescript
 * // Parse filter expression directly
 * const result = compiler.parseFilter("age gte 18 and active eq true");
 *
 * // Or parse and compile in one step
 * const query = compiler.compileFilter("age gte 18", {
 *   baseQuery,
 *   tableColumns
 * });
 * ```
 *
 * React Router / Remix Integration:
 *
 * ```typescript
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   // parseQueryString accepts string, URL, or URLSearchParams
 *   const paramsResult = parseQueryString(new URL(request.url));
 *   const astResult = compiler.parse(paramsResult.data);
 *   const query = compiler.compile(astResult.data, { baseQuery, tableColumns });
 *   return await query.data;
 * }
 * ```
 *
 * Multiple Input Types:
 *
 * ```typescript
 * // From query string
 * parseQueryString("filter=age gte 18&sort=name:asc");
 *
 * // From URL object
 * parseQueryString(new URL(request.url));
 *
 * // From URLSearchParams
 * parseQueryString(new URLSearchParams(location.search));
 * ```
 */

// ============================================================================
// REFERENCE INTERCEPTORS
// ============================================================================
// Reusable interceptor implementations for common service layer patterns.

export {
  defaultIncludesInterceptor,
  extraScopeInterceptor,
  extraScopeWriteInterceptor,
  type InjectConfig,
  injectWriteInterceptor,
  type Orderable,
  type SoftDeleteConfig,
  // Read interceptors
  scopeQueryInterceptor,
  // Write interceptors
  scopeWriteInterceptor,
  softDeleteQueryInterceptor,
  softDeleteWriteInterceptor,
  // Entity type constraints
  type Trashable,
} from "./interceptors/index.js";
