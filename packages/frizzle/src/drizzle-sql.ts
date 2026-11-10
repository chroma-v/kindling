// ============================================================================
// DRIZZLE SQL CODE GENERATOR
// ============================================================================
// Converts QueryAst to Drizzle ORM SQL queries using the query builder pattern.
// Produces Drizzle `SQL` objects for use with `db.select().from(table).where(sql)`.

import {
  type AnyColumn,
  and,
  asc,
  between,
  Column,
  desc,
  eq,
  gt,
  gte,
  inArray,
  is,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { ComparisonNode, ComparisonOperator, FilterNode, QueryAst, SortNode } from "./ast-types.js";
import type { CodeGenerator } from "./code-generator.js";
import { foldFilterResult } from "./code-generator.js";
import { validateOperatorValue } from "./drizzle-validation.js";
import type { FilterLimits } from "./filter-limits.js";
import { likePattern } from "./like-pattern.js";
import { ownValue } from "./own-property.js";
import { parseFilter } from "./parse.js";
import type { Result } from "./result-types.js";
import { createError, createParseError, createSuccess, isError } from "./result-types.js";
import type { Schema } from "./schema-types.js";

// ============================================================================
// COLUMN RESOLVERS (Virtual Columns)
// ============================================================================

/**
 * A function that generates SQL for a virtual column (e.g., many-to-many relationship).
 * Called by the Drizzle code generator when it encounters this field in a filter.
 *
 * `context` is whatever the caller passed as `context` to `compileFilterToSQL`,
 * `compileFilterNodeToSQL` or `generateDrizzleQuery` (e.g. the request's `db`),
 * so the resolvers can be defined once instead of per request. Resolvers that
 * take only `(operator, value)` still work.
 *
 * With a context type, the context is required: `SQLColumnResolver<{ db: Db }>`
 * receives it as a non-optional third argument, and the compile functions
 * refuse to type-check without one. Without a type parameter (`unknown`), the
 * third argument is optional, so such a resolver can still be called with
 * two arguments.
 *
 * @example
 * // Tag resolver for tasks -> task_tags -> tags many-to-many
 * const tagResolver: SQLColumnResolver<{ db: Db }> = (operator, value, { db }) => {
 *   const names = Array.isArray(value) ? value : [String(value)];
 *   const subquery = db.select({ taskId: taskTags.taskId }).from(taskTags)
 *     .innerJoin(tags, eq(taskTags.tagId, tags.id))
 *     .where(inArray(tags.name, names));
 *   return operator === "ne" || operator === "not_in"
 *     ? notInArray(tasks.id, subquery)
 *     : inArray(tasks.id, subquery);
 * };
 */
export type SQLColumnResolver<TContext = unknown> = unknown extends TContext
  ? (operator: ComparisonOperator, value: unknown, context?: TContext) => SQL
  : (operator: ComparisonOperator, value: unknown, context: TContext) => SQL;

/** The resolver shape the generator calls; {@link SQLColumnResolver} narrows it for callers. */
type ResolverFn<TContext> = (operator: ComparisonOperator, value: unknown, context?: TContext) => SQL;

/**
 * The trailing context argument: optional when the field map's resolvers don't
 * declare a context type, required when they do, so a resolver that
 * destructures its context can't be compiled without one.
 */
type ContextArg<TContext> = unknown extends TContext ? [context?: TContext] : [context: TContext];

/** Options for {@link compileFilterToSQL}. */
type CompileSQLOptions<TContext> = { schema?: Schema; context?: TContext } & FilterLimits;

/**
 * A field that is sorted by one column and filtered by that column or by
 * custom SQL, so one field map serves both filtering and sorting.
 *
 * @example
 * const fields = {
 *   // Sorted by countries.name; filtered through a resolver (e.g. matching aliases too)
 *   name: { column: countries.name, where: nameResolver },
 *   // Filtered and sorted by the column, with eq / contains / ... ignoring case
 *   code: { column: countries.code, caseInsensitive: true },
 * };
 */
export interface SQLFieldMapping<TContext = unknown> {
  /** Column to sort by, and to filter by when there is no `where`. */
  readonly column: AnyColumn;
  /** Custom filter SQL for this field. Sorting still uses `column`. */
  readonly where?: SQLColumnResolver<TContext>;
  /**
   * Compare text case-insensitively: `eq` / `ne` compile to
   * `lower(col) = lower(?)` and the LIKE operators to
   * `lower(col) like lower(?) escape '\'`. Other operators, and sorting, use the
   * column as-is, and so do non-string values (`n eq 5` on a number column is a
   * plain `=`). Ignored when `where` is set. On SQLite, `lower()` folds ASCII
   * letters only.
   */
  readonly caseInsensitive?: boolean;
}

/**
 * A column mapping entry: a Drizzle column, a resolver function for virtual
 * columns (e.g., many-to-many relationships via junction tables; these can be
 * filtered but not sorted), or a {@link SQLFieldMapping}.
 */
export type SQLColumnMapping<TContext = unknown> = AnyColumn | SQLColumnResolver<TContext> | SQLFieldMapping<TContext>;

/** A mapping entry split into what sorting and filtering each use. */
interface ResolvedMapping<TContext> {
  readonly column?: AnyColumn;
  readonly where?: SQLColumnResolver<TContext>;
  readonly caseInsensitive: boolean;
}

/** A `{ column, where? }` entry, as opposed to a column (or anything else drizzle accepts as one). */
const isFieldMapping = <TContext>(mapping: SQLColumnMapping<TContext>): mapping is SQLFieldMapping<TContext> =>
  typeof mapping === "object" && mapping !== null && "column" in mapping && !is(mapping, Column);

function resolveMapping<TContext>(mapping: SQLColumnMapping<TContext>): ResolvedMapping<TContext> {
  if (typeof mapping === "function") {
    return { where: mapping, caseInsensitive: false };
  }
  if (isFieldMapping(mapping)) {
    return { column: mapping.column, where: mapping.where, caseInsensitive: mapping.caseInsensitive === true };
  }
  return { column: mapping, caseInsensitive: false };
}

// ============================================================================
// DRIZZLE CONTEXT
// ============================================================================

/**
 * Context needed for Drizzle SQL code generation
 */
export interface SQLCodeGenContext<TContext = unknown> {
  /**
   * The base Drizzle query builder to enhance
   * (e.g., db.select().from(users))
   */
  baseQuery: unknown;

  /**
   * Map of field names to Drizzle column objects, resolver functions, or
   * `{ column, where? }` entries. Resolvers handle virtual columns (e.g.,
   * many-to-many via junction tables).
   */
  tableColumns: Record<string, SQLColumnMapping<TContext>>;

  /** Passed to resolvers as their third argument. */
  resolverContext?: TContext;
}

// ============================================================================
// OPERATOR BUILDERS
// ============================================================================

/**
 * Map of comparison operators to Drizzle builder functions
 *
 * NOTE: This mapping must include all operators defined in language.ts
 * The keys should match the OperatorName type from language.ts
 */
/**
 * LIKE that matches the value literally: "%", "_" and "\" in it are escaped,
 * and the ESCAPE clause is added only when there was something to escape.
 */
const likeLiteral =
  (operator: ComparisonOperator) =>
  (column: AnyColumn, value: unknown): SQL => {
    const { pattern, escaped } = likePattern(operator, value);
    return escaped ? sql`${column} like ${pattern} escape '\\'` : like(column, pattern);
  };

/** `lower(col) like lower(?)`, for {@link SQLFieldMapping.caseInsensitive}. */
const lowerLike = (operator: ComparisonOperator, column: AnyColumn, value: unknown): SQL => {
  const { pattern, escaped } = likePattern(operator, value);
  return escaped
    ? sql`lower(${column}) like lower(${pattern}) escape '\\'`
    : sql`lower(${column}) like lower(${pattern})`;
};

/** Operators that {@link SQLFieldMapping.caseInsensitive} changes. */
const CASE_INSENSITIVE_OPERATORS: Partial<Record<ComparisonOperator, (column: AnyColumn, value: unknown) => SQL>> = {
  eq: (col, val) => sql`lower(${col}) = lower(${val})`,
  ne: (col, val) => sql`lower(${col}) <> lower(${val})`,
  like: (col, val) => lowerLike("like", col, val),
  ilike: (col, val) => lowerLike("ilike", col, val),
  contains: (col, val) => lowerLike("contains", col, val),
  starts_with: (col, val) => lowerLike("starts_with", col, val),
  ends_with: (col, val) => lowerLike("ends_with", col, val),
};

// NOTE: Using `like` instead of `ilike` for SQLite/D1 compatibility
// SQLite's LIKE is case-insensitive for ASCII letters by default
const DRIZZLE_OPERATORS: Record<ComparisonOperator, (column: AnyColumn, value: unknown) => SQL> = {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like: likeLiteral("like"),
  ilike: likeLiteral("ilike"), // SQLite: use like (case-insensitive by default)
  in: (col, val) => inArray(col, Array.isArray(val) ? val : [val]),
  not_in: (col, val) => notInArray(col, Array.isArray(val) ? val : [val]),
  starts_with: likeLiteral("starts_with"),
  ends_with: likeLiteral("ends_with"),
  contains: likeLiteral("contains"),
  between: (col, val) => {
    if (!Array.isArray(val) || val.length !== 2) {
      throw new Error("BETWEEN operator requires array with exactly 2 values");
    }
    return between(col, val[0], val[1]);
  },
  is_null: (col) => isNull(col),
  is_not_null: (col) => isNotNull(col),
};

// ============================================================================
// FILTER TO CONDITION
// ============================================================================

/** The Drizzle condition for one comparison. */
function compileComparison<TContext>(
  node: ComparisonNode,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
  context: TContext,
): Result<SQL> {
  const mapping = ownValue(tableColumns, node.field);
  if (!mapping) {
    return createError(createParseError(`Unknown column: ${node.field}`, 0, "", "UNKNOWN_FIELD", node.field));
  }

  // Validate operator x value combination before generating SQL
  const validation = validateOperatorValue(node.operator, node.value, node.field);
  if (isError(validation)) {
    return validation as Result<SQL>;
  }

  const { column, where, caseInsensitive } = resolveMapping(mapping);

  // Virtual column: delegate to resolver function
  if (where) {
    try {
      // Without a context, call exactly as before it existed: (operator, value)
      const resolve = where as ResolverFn<TContext>;
      const condition =
        context === undefined ? resolve(node.operator, node.value) : resolve(node.operator, node.value, context);
      return createSuccess(condition);
    } catch (error) {
      return createError(
        createParseError(
          `Column resolver failed for ${node.field}: ${error instanceof Error ? error.message : "Unknown error"}`,
          0,
          "",
          "INVALID_VALUE",
        ),
      );
    }
  }

  if (!column) {
    return createError(createParseError(`No column for field: ${node.field}`, 0, "", "UNKNOWN_FIELD", node.field));
  }

  // Handle eq/ne with null value - convert to isNull/isNotNull
  // SQL: "field = NULL" always returns false, must use "field IS NULL"
  if (node.value === null) {
    if (node.operator === "eq") {
      return createSuccess(isNull(column));
    }
    if (node.operator === "ne") {
      return createSuccess(isNotNull(column));
    }
  }

  // lower() only for text: a number bound to lower(?) comes back as "5.0" on
  // SQLite (never equal to lower(5) = "5"), and lower(integer) is a type
  // error on PostgreSQL.
  const foldCase = caseInsensitive && typeof node.value === "string";
  const builder = (foldCase && CASE_INSENSITIVE_OPERATORS[node.operator]) || DRIZZLE_OPERATORS[node.operator];
  if (!builder) {
    return createError(createParseError(`Unsupported operator: ${node.operator}`, 0, "", "INVALID_OPERATOR"));
  }

  try {
    const condition = builder(column, node.value);
    return createSuccess(condition);
  } catch (error) {
    return createError(
      createParseError(
        `Failed to build condition: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        "",
        "INVALID_VALUE",
      ),
    );
  }
}

/** The WHERE condition for a whole tree: stack-safe, and flat for a chain of one operator. */
function compileWhere<TContext>(
  node: FilterNode,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
  context: TContext,
): Result<SQL> {
  return foldFilterResult<SQL>(node, {
    comparison: (comparison) => compileComparison(comparison, tableColumns, context),
    chain: (conditions, operator) => {
      const combined = (operator === "and" ? and : or)(...conditions);
      return combined
        ? createSuccess(combined)
        : createError(createParseError("Failed to combine logical expressions", 0, "", "SYNTAX_ERROR"));
    },
    group: (condition) => createSuccess(condition),
  });
}

// ============================================================================
// SORT
// ============================================================================

/**
 * ORDER BY term for one sort node. A field mapped only to a resolver can't be
 * sorted; a `{ column, where }` entry sorts by `column`.
 */
function compileSortNode<TContext>(
  sort: SortNode,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
): Result<SQL> {
  const mapping = ownValue(tableColumns, sort.field);
  if (!mapping) {
    return createError(createParseError(`Unknown sort field: ${sort.field}`, 0, "", "UNKNOWN_FIELD", sort.field));
  }
  const { column } = resolveMapping(mapping);
  if (!column) {
    return createError(
      createParseError(`Cannot sort by virtual column: ${sort.field}`, 0, "", "UNSORTABLE_FIELD", sort.field),
    );
  }
  if (sort.direction !== "asc" && sort.direction !== "desc") {
    return createError(
      createParseError(
        `Invalid sort direction '${sort.direction}' for '${sort.field}'. Use asc or desc`,
        0,
        "",
        "INVALID_VALUE",
        sort.field,
      ),
    );
  }
  return createSuccess(sort.direction === "desc" ? desc(column) : asc(column));
}

// ============================================================================
// DRIZZLE CODE GENERATOR
// ============================================================================

/**
 * Code generator for Drizzle ORM
 *
 * Converts a QueryAst into a Drizzle query builder with:
 * - WHERE clauses from filters
 * - ORDER BY from sort nodes
 * - LIMIT/OFFSET from pagination
 *
 * @example
 * const generator = new DrizzleCodeGenerator();
 * const result = generator.generate(ast, {
 *   baseQuery: db.select().from(users),
 *   tableColumns: { id: users.id, name: users.name }
 * });
 */
export class DrizzleCodeGenerator<TQuery = unknown, TContext = unknown> implements CodeGenerator<
  TQuery,
  SQLCodeGenContext<TContext>
> {
  generate(ast: QueryAst, context: SQLCodeGenContext<TContext>): Result<TQuery> {
    try {
      // Drizzle query builders are chainable but don't share a common interface.
      // We type the methods we call rather than using `any`.
      type ChainableQuery = Record<string, (...args: unknown[]) => unknown>;
      let query = context.baseQuery as ChainableQuery;

      // Apply filter (WHERE clause)
      if (ast.filter) {
        const conditionResult = compileWhere(ast.filter, context.tableColumns, context.resolverContext as TContext);
        if (isError(conditionResult)) {
          return conditionResult;
        }
        query = query.where(conditionResult.data) as ChainableQuery;
      }

      // Apply sorting (ORDER BY)
      if (ast.sort && ast.sort.length > 0) {
        const orderBy: SQL[] = [];
        for (const sort of ast.sort) {
          const order = compileSortNode(sort, context.tableColumns);
          if (isError(order)) {
            return order;
          }
          orderBy.push(order.data);
        }
        query = query.orderBy(...orderBy) as ChainableQuery;
      }

      // Apply pagination (LIMIT/OFFSET)
      if (ast.limit) {
        query = query.limit(ast.limit) as ChainableQuery;
      }

      if (ast.offset) {
        query = query.offset(ast.offset) as ChainableQuery;
      }

      return createSuccess(query as TQuery);
    } catch (error) {
      return createError(
        createParseError(
          `Failed to generate Drizzle query: ${error instanceof Error ? error.message : "Unknown error"}`,
          0,
          "",
          "SYNTAX_ERROR",
        ),
      );
    }
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a Drizzle code generator instance
 */
export function createDrizzleCodeGenerator<TQuery = unknown, TContext = unknown>(): DrizzleCodeGenerator<
  TQuery,
  TContext
> {
  return new DrizzleCodeGenerator<TQuery, TContext>();
}

/**
 * Generate a Drizzle query from AST in one call
 *
 * @param ast - The query AST
 * @param baseQuery - The base Drizzle query
 * @param tableColumns - Column mappings; the same map filters and sorts
 * @param context - Passed to resolvers as their third argument
 * @returns Result with generated query
 */
export function generateDrizzleQuery<TQuery, TContext = unknown>(
  ast: QueryAst,
  baseQuery: TQuery,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
  ...[context]: ContextArg<TContext>
): Result<TQuery> {
  const generator = new DrizzleCodeGenerator<TQuery, TContext>();
  return generator.generate(ast, { baseQuery, tableColumns, resolverContext: context });
}

// ============================================================================
// FILTER-ONLY COMPILATION
// ============================================================================

/**
 * Compile a FilterNode AST directly to a Drizzle SQL condition
 *
 * Use this when you already have a parsed AST and need the SQL condition.
 * This is the core conversion function - no parsing involved.
 *
 * @param filterNode - AST filter node (ComparisonNode, LogicalNode, or GroupNode)
 * @param tableColumns - Column mappings
 * @param context - Passed to resolvers as their third argument
 * @returns Result with SQL condition or error
 *
 * @example
 * const node: FilterNode = {
 *   type: "comparison",
 *   field: "status",
 *   operator: "eq",
 *   value: "active"
 * };
 * const result = compileFilterNodeToSQL(node, { status: tasks.status });
 */
export function compileFilterNodeToSQL<TContext = unknown>(
  filterNode: FilterNode,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
  ...[context]: ContextArg<TContext>
): Result<SQL> {
  return compileWhere(filterNode, tableColumns, context as TContext);
}

/**
 * Compile a filter expression string to a Drizzle SQL condition
 *
 * Use this when you need just the WHERE condition, not a full query builder.
 * Ideal for Drizzle's relational query API (db.query.table.findMany({ where: ... }))
 *
 * This function parses the string first, then converts to SQL.
 * If you already have an AST, use compileFilterNodeToSQL instead.
 *
 * @param filterExpression - Filter string (e.g., "status eq 'active'")
 * @param tableColumns - Column mappings
 * @param options - `schema` (validation), `context` (passed to resolvers) and the
 *   filter limits (`maxDepth`, `maxParameters`, `maxConditions`)
 * @returns Result with SQL condition or error
 *
 * @example
 * const result = compileFilterToSQL(
 *   "status eq 'in_progress' and priority eq 'high'",
 *   { status: tasks.status, priority: tasks.priority }
 * );
 * if (isSuccess(result)) {
 *   const tasks = await db.query.tasks.findMany({
 *     where: and(eq(tasks.isDeleted, false), result.data)
 *   });
 * }
 */
export function compileFilterToSQL<TContext = unknown>(
  filterExpression: string,
  tableColumns: Record<string, SQLColumnMapping<TContext>>,
  ...[options]: unknown extends TContext
    ? [options?: CompileSQLOptions<TContext>]
    : [options: CompileSQLOptions<TContext> & { context: TContext }]
): Result<SQL> {
  const parsed = parseFilter(filterExpression, options?.schema, options);
  if (isError(parsed)) {
    return parsed;
  }

  return compileWhere(parsed.data, tableColumns, options?.context as TContext);
}
