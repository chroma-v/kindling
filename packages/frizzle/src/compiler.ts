// ============================================================================
// QUERY COMPILER
// ============================================================================
// Generic query compiler - no knowledge of URLs or web contexts
//
// Responsibilities:
// 1. Parse filter expressions into AST
// 2. Validate AST against schema (optional)
// 3. Generate target code from AST
//
// NOT responsible for:
// - URL query string parsing (that's web layer concern)
// - HTTP request handling
// - Routing

import type { FilterNode, MutableQueryAst, QueryAst, SortNode } from "./ast-types.js";
import type { CodeGenerator } from "./code-generator.js";
import type { Lexer } from "./core/lexer.js";
import { parseFilterExpression, parseTokens } from "./core/parser.js";
import type { FilterLimits } from "./filter-limits.js";
import { query as queryLanguage } from "./language.js";
import type { Result } from "./result-types.js";
import { createError, createParseError, isError } from "./result-types.js";
import type { Schema } from "./schema-types.js";
import { SchemaValidator } from "./validation/schema-validator.js";

// ============================================================================
// COMPILER OPTIONS
// ============================================================================

/**
 * Configuration for the query compiler
 */
export interface CompilerOptions<TQuery, TContext> extends FilterLimits {
  /**
   * Schema for validation (optional)
   * If provided, all queries will be validated
   */
  schema?: Schema;

  /**
   * Code generator to convert AST → target code
   * Required (e.g., DrizzleCodeGenerator, SQLCodeGenerator)
   */
  codeGenerator: CodeGenerator<TQuery, TContext>;

  /**
   * Custom tokenizer (optional). When set, filters are parsed with the
   * deprecated Lexer + PrattParser path instead of the combinator grammar.
   *
   * @deprecated Will be removed with Lexer and PrattParser.
   */
  tokenizer?: Lexer;

  /**
   * Largest `limit` accepted by {@link Compiler.parse}. Default
   * `query.limits.max` (1000); match what you pass to `parseQueryString`.
   */
  maxLimit?: number;
}

// ============================================================================
// QUERY COMPILER
// ============================================================================

/**
 * Generic query compiler
 *
 * Parses filter expressions and compiles them to target code.
 * No knowledge of URLs - works with plain strings and AST.
 *
 * @template TQuery - Type of generated code (e.g., Drizzle query, SQL string)
 * @template TContext - Context needed for code generation
 *
 * @example
 * // Create compiler
 * const compiler = new Compiler({
 *   schema: taskSchema,
 *   codeGenerator: new DrizzleCodeGenerator()
 * });
 *
 * // Parse a filter expression
 * const ast = compiler.parseFilter("age gte 18 and active eq true");
 *
 * // Compile to target code
 * const query = compiler.compile(ast.data, {
 *   baseQuery: db.select().from(users),
 *   tableColumns: users
 * });
 */
export class Compiler<TQuery, TContext> {
  private tokenizer?: Lexer;
  private validator?: SchemaValidator;
  private codeGenerator: CodeGenerator<TQuery, TContext>;
  private schema?: Schema;
  private limits: FilterLimits;
  private maxLimit: number | undefined;

  constructor(options: CompilerOptions<TQuery, TContext>) {
    this.tokenizer = options.tokenizer;
    this.maxLimit = options.maxLimit;
    this.limits = {
      maxDepth: options.maxDepth,
      maxParameters: options.maxParameters,
      maxConditions: options.maxConditions,
    };
    this.codeGenerator = options.codeGenerator;
    this.schema = options.schema;
    this.validator = options.schema ? new SchemaValidator(options.schema) : undefined;
  }

  /**
   * Parse a filter expression string into FilterNode AST
   *
   * @param filterExpression - Filter string (e.g., "age >= 18 and active = true")
   * @returns Result with FilterNode or error
   *
   * @example
   * const result = compiler.parseFilter("age gte 18");
   * if (isSuccess(result)) {
   *   console.log(result.data); // FilterNode
   * }
   */
  parseFilter(filterExpression: string): Result<FilterNode> {
    // A custom tokenizer keeps the deprecated Lexer + PrattParser path.
    const parsed = this.tokenizer
      ? this.parseWithTokenizer(this.tokenizer, filterExpression)
      : parseFilterExpression(filterExpression, this.limits);
    if (isError(parsed)) {
      return parsed;
    }

    return this.validator ? this.validator.validateFilterNode(parsed.data) : parsed;
  }

  private parseWithTokenizer(tokenizer: Lexer, filterExpression: string): Result<FilterNode> {
    const tokenResult = tokenizer.tokenize(filterExpression);
    if (isError(tokenResult)) {
      return tokenResult;
    }
    return parseTokens(tokenResult.data, filterExpression, this.limits);
  }

  /**
   * Parse a query (filter + optional sort/limit/offset)
   *
   * For simple filter-only queries, use parseFilter() instead.
   * This method expects a complete query object.
   *
   * @param query - Query with filter/sort/limit/offset
   * @returns Result with QueryAst or error
   */
  parse(query: { filter?: string; sort?: SortNode[]; limit?: number; offset?: number }): Result<QueryAst> {
    const ast: MutableQueryAst = {};

    // Parse filter if provided
    if (query.filter) {
      const filterResult = this.parseFilter(query.filter);
      if (isError(filterResult)) {
        return filterResult;
      }
      ast.filter = filterResult.data;
    }

    // Add sort
    if (query.sort) {
      // Validate sort fields if schema provided
      if (this.validator) {
        for (const sortNode of query.sort) {
          const sortResult = this.validator.validateSortNode(sortNode);
          if (isError(sortResult)) {
            return sortResult;
          }
        }
      }
      ast.sort = query.sort;
    }

    // Add pagination (same rules as parseQueryString: whole numbers only)
    if (query.limit !== undefined) {
      const limits = queryLanguage.limits;
      const maxLimit = this.maxLimit ?? limits.max;
      if (!Number.isSafeInteger(maxLimit) || maxLimit < limits.min) {
        return createError(
          createParseError(`Invalid maxLimit: ${maxLimit}. Must be a positive integer`, 0, "", "INVALID_VALUE"),
        );
      }
      if (!Number.isSafeInteger(query.limit) || query.limit < limits.min || query.limit > maxLimit) {
        return createError(
          createParseError(
            `Invalid limit: ${query.limit}. Must be between ${limits.min} and ${maxLimit}`,
            0,
            "",
            "INVALID_VALUE",
          ),
        );
      }

      ast.limit = query.limit;
    }

    if (query.offset !== undefined) {
      if (!Number.isSafeInteger(query.offset) || query.offset < queryLanguage.limits.offsetMin) {
        return createError(
          createParseError(`Invalid offset: ${query.offset}. Must be a non-negative integer`, 0, "", "INVALID_VALUE"),
        );
      }

      ast.offset = query.offset;
    }

    return { success: true, data: ast as QueryAst };
  }

  /**
   * Compile an AST into target code
   *
   * @param ast - The QueryAst to compile
   * @param context - Code generation context
   * @returns Result with generated code or error
   *
   * @example
   * const ast = { filter: { type: "comparison", field: "age", operator: "gte", value: 18 } };
   * const result = compiler.compile(ast, { baseQuery, tableColumns });
   */
  compile(ast: QueryAst, context: TContext): Result<TQuery> {
    return this.codeGenerator.generate(ast, context);
  }

  /**
   * Convenience: parse filter expression and compile in one step
   *
   * @param filterExpression - Filter string
   * @param context - Code generation context
   * @returns Result with generated code or error
   *
   * @example
   * const result = compiler.compileFilter(
   *   "age gte 18 and active eq true",
   *   { baseQuery, tableColumns }
   * );
   */
  compileFilter(filterExpression: string, context: TContext): Result<TQuery> {
    const parseResult = this.parseFilter(filterExpression);
    if (isError(parseResult)) {
      return parseResult;
    }

    const ast: QueryAst = { filter: parseResult.data };
    return this.compile(ast, context);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a compiler instance
 *
 * @example
 * const compiler = createCompiler({
 *   schema: mySchema,
 *   codeGenerator: new DrizzleCodeGenerator()
 * });
 */
export function createCompiler<TQuery, TContext>(
  options: CompilerOptions<TQuery, TContext>,
): Compiler<TQuery, TContext> {
  return new Compiler(options);
}

// All types and functions are already exported inline above
