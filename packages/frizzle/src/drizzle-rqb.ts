// ============================================================================
// DRIZZLE RQB OBJECT SYNTAX CODE GENERATOR
// ============================================================================
// Converts FilterNode to Drizzle RQB object syntax for use in
// db.query.table.findMany({ where: { ... } })

import type { ComparisonNode, ComparisonOperator, FilterNode } from "./ast-types.js";
import { foldFilterNode, foldFilterResult } from "./code-generator.js";
import { validateOperatorValue } from "./drizzle-validation.js";
import type { FilterLimits } from "./filter-limits.js";
import { isLikeOperator, likePattern } from "./like-pattern.js";
import { ownValue } from "./own-property.js";
import { parseFilter } from "./parse.js";
import { parseSort } from "./query-string.js";
import { andWhere, type Filter, orWhere, type Sort } from "./query.js";
import type { Result } from "./result-types.js";
import { createError, createParseError, createSuccess, isError } from "./result-types.js";
import type { Schema } from "./schema-types.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * @deprecated Use `Filter` from `@chromav/frizzle` instead.
 * Kept as an alias for backward compatibility.
 */
export type DrizzleWhere = Filter;

/**
 * A resolver function for virtual columns that returns RQB object syntax.
 * Used for many-to-many relationships where you need to filter via junction tables.
 *
 * Returns an object that can be spread into the where clause. For relations
 * that require subqueries, return the IDs to filter on.
 *
 * @example
 * // Tag resolver that returns task IDs matching the tag filter
 * const tagResolver: WhereResolver = async (operator, value, context) => {
 *   const names = Array.isArray(value) ? value : [String(value)];
 *   const matchingTaskIds = await context.db
 *     .select({ taskId: taskTags.taskId })
 *     .from(taskTags)
 *     .innerJoin(tags, eq(taskTags.tagId, tags.id))
 *     .where(inArray(tags.name, names));
 *   return { id: { in: matchingTaskIds.map(r => r.taskId) } };
 * };
 */
export type WhereResolver<TContext = unknown> = (
  operator: ComparisonOperator,
  value: unknown,
  context: TContext,
) => DrizzleWhere | Promise<DrizzleWhere>;

/**
 * A field that is sorted by one column and filtered by that column or by a
 * resolver, so the same map works for `compileFilter` and `compileSort`.
 *
 * @example
 * { name: { field: "name", where: nameResolver } }
 */
export interface WhereFieldMapping<TContext = unknown> {
  /** DB field to sort by, and to filter by when there is no `where`. A dotted path filters through relations but can't be sorted. */
  readonly field: string;
  /** Custom filter for this field. Sorting still uses `field`. */
  readonly where?: WhereResolver<TContext>;
}

/**
 * Column mapping for compileFilter.
 * - string: Direct field name (1:1 mapping)
 * - WhereResolver: Function that resolves virtual columns (e.g., many-to-many); can't be sorted
 * - WhereFieldMapping: `{ field, where? }`, sorted by `field`
 */
export type WhereColumnMapping<TContext = unknown> = string | WhereResolver<TContext> | WhereFieldMapping<TContext>;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a nested object from a dot-separated path.
 * Example: buildNestedObject("taskTags.tag.name", value) => { taskTags: { tag: { name: value } } }
 */
function buildNestedObject(path: string, leafValue: unknown): DrizzleWhere {
  const parts = path.split(".");
  let result: DrizzleWhere = { [parts[parts.length - 1]]: leafValue };

  // Build from innermost to outermost
  for (let i = parts.length - 2; i >= 0; i--) {
    result = { [parts[i]]: result };
  }

  return result;
}

/**
 * Map comparison operators to RQB object syntax.
 * Supports nested paths like "taskTags.tag.name" for relation filtering.
 */
/** The subset of Drizzle's RAW-filter operators this module uses. */
type RawOperators = { sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown };

/**
 * A LIKE condition. Plain `{ like }` when the pattern has nothing to escape;
 * otherwise a RAW filter with `ESCAPE '\'`, since the object syntax has no way
 * to say ESCAPE. The RAW sits beside the column (inside any relation objects),
 * where Drizzle hands it that table.
 */
function likeToWhereObject(field: string, operator: ComparisonOperator, value: unknown): DrizzleWhere {
  const { pattern, escaped } = likePattern(operator, value);
  if (!escaped) {
    return buildNestedObject(field, { like: pattern });
  }

  const parts = field.split(".");
  const column = parts.pop() as string;
  const raw = (table: Record<string, unknown>, { sql }: RawOperators) =>
    sql`${table[column]} like ${pattern} escape '\\'`;
  return parts.length === 0 ? { RAW: raw } : buildNestedObject(parts.join("."), { RAW: raw });
}

function comparisonToWhereObject(field: string, operator: ComparisonOperator, value: unknown): DrizzleWhere {
  if (isLikeOperator(operator)) {
    return likeToWhereObject(field, operator, value);
  }

  // Determine the leaf value based on operator
  let leafValue: unknown;

  switch (operator) {
    case "eq":
      // SQL: "field = NULL" is always false — must use IS NULL
      leafValue = value === null ? { isNull: true } : value;
      break;
    case "ne":
      // SQL: "field != NULL" is always false — must use IS NOT NULL
      leafValue = value === null ? { isNotNull: true } : { ne: value };
      break;
    case "gt":
      leafValue = { gt: value };
      break;
    case "gte":
      leafValue = { gte: value };
      break;
    case "lt":
      leafValue = { lt: value };
      break;
    case "lte":
      leafValue = { lte: value };
      break;
    case "in":
      leafValue = { in: Array.isArray(value) ? value : [value] };
      break;
    case "not_in":
      leafValue = { notIn: Array.isArray(value) ? value : [value] };
      break;
    case "is_null":
      leafValue = { isNull: true };
      break;
    case "is_not_null":
      leafValue = { isNotNull: true };
      break;
    case "between":
      if (Array.isArray(value) && value.length === 2) {
        leafValue = { gte: value[0], lte: value[1] };
      } else {
        throw new Error("BETWEEN operator requires array with exactly 2 values");
      }
      break;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }

  // Build nested object if path contains dots
  return buildNestedObject(field, leafValue);
}

// ============================================================================
// COMPARISONS
// ============================================================================

/**
 * The where object for one comparison. A resolver may return a promise, so
 * this may too.
 */
function compileComparison<TContext>(
  node: ComparisonNode,
  columnMappings: Record<string, WhereColumnMapping<TContext>>,
  context: TContext,
): Result<DrizzleWhere> | Promise<Result<DrizzleWhere>> {
  const entry = ownValue(columnMappings, node.field);
  const mapping = typeof entry === "object" ? (entry.where ?? entry.field) : entry;

  if (!mapping) {
    return createError(createParseError(`Unknown column: ${node.field}`, 0, "", "UNKNOWN_FIELD", node.field));
  }

  // Validate operator x value combination before generating output
  const validation = validateOperatorValue(node.operator, node.value, node.field);
  if (isError(validation)) {
    return validation as Result<DrizzleWhere>;
  }

  // Resolver function (e.g., for many-to-many)
  if (typeof mapping === "function") {
    try {
      const resultOrPromise = mapping(node.operator, node.value, context);

      // Handle async resolvers
      if (resultOrPromise instanceof Promise) {
        return resultOrPromise
          .then((result) => createSuccess(result))
          .catch((error) =>
            createError(
              createParseError(
                `Resolver failed for ${node.field}: ${error instanceof Error ? error.message : "Unknown error"}`,
                0,
                "",
                "INVALID_VALUE",
              ),
            ),
          );
      }

      return createSuccess(resultOrPromise);
    } catch (error) {
      return createError(
        createParseError(
          `Resolver failed for ${node.field}: ${error instanceof Error ? error.message : "Unknown error"}`,
          0,
          "",
          "INVALID_VALUE",
        ),
      );
    }
  }

  // Direct field mapping
  const fieldName = mapping;
  try {
    const whereObject = comparisonToWhereObject(fieldName, node.operator, node.value);
    return createSuccess(whereObject);
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

// ============================================================================
// COMPILE FILTER
// ============================================================================

/**
 * Compile a filter expression string to Drizzle RQB object syntax.
 *
 * Use this for db.query.table.findMany({ where: ... }) or nested
 * relation queries like db.query.projects.findFirst({ with: { tasks: { where: ... } } }).
 * Requires drizzle-orm 1.0 (beta/rc): the relational query filter syntax it
 * emits (`OR` / `AND` / `RAW`) doesn't exist in 0.x.
 *
 * Output shape: fields on different keys merge into one object; when both
 * sides of an AND share a key the result is `{ AND: [...] }` (one flat list
 * for chains). A LIKE value containing `%` or `_` becomes a `RAW` filter (a
 * function) so it can run with `ESCAPE '\'`, so the result isn't plain JSON.
 * Combine it with your own conditions as `{ AND: [yours, result.data] }`,
 * never with object spread.
 *
 * @param filterExpression - Filter string (e.g., "status eq 'active'")
 * @param columnMappings - Map of filter field names to DB field names or resolver functions
 * @param options - `context` (passed to resolver functions, e.g. a db instance for
 *   subqueries), `schema` (validation), and the filter limits (`maxDepth`,
 *   `maxParameters`, `maxConditions`)
 * @returns Result with where object or error
 *
 * @example
 * // Simple usage with direct field mappings
 * const result = await compileFilter(
 *   "status eq 'in_progress' and priority eq 'high'",
 *   { status: "status", priority: "priority" }
 * );
 * // Result: { status: "in_progress", priority: "high" }
 *
 * @example
 * // With many-to-many tag resolver
 * const tagResolver: WhereResolver<DbContext> = async (op, value, ctx) => {
 *   const taskIds = await ctx.db.select({ id: taskTags.taskId })
 *     .from(taskTags).innerJoin(tags, eq(...)).where(inArray(tags.name, [value]));
 *   return { id: { in: taskIds.map(r => r.id) } };
 * };
 *
 * const result = await compileFilter(
 *   "tags eq 'bug'",
 *   { tags: tagResolver },
 *   { context: { db } }
 * );
 * // Result: { id: { in: ["task-1", "task-2"] } }
 */
export async function compileFilter<TContext = unknown>(
  filterExpression: string,
  columnMappings: Record<string, WhereColumnMapping<TContext>>,
  options?: { context?: TContext; schema?: Schema } & FilterLimits,
): Promise<Result<DrizzleWhere>> {
  const parsed = parseFilter(filterExpression, options?.schema, options);
  if (isError(parsed)) {
    return parsed;
  }

  return compileFilterNode(parsed.data, columnMappings, options?.context);
}

/**
 * Compile a FilterNode AST directly to Drizzle RQB object syntax.
 *
 * Use this when you already have a parsed AST and need the where object.
 *
 * @param filterNode - AST filter node
 * @param columnMappings - Column mappings
 * @param context - Context for resolver functions
 * @returns Result with where object or error
 */
export async function compileFilterNode<TContext = unknown>(
  filterNode: FilterNode,
  columnMappings: Record<string, WhereColumnMapping<TContext>>,
  context?: TContext,
): Promise<Result<DrizzleWhere>> {
  // Resolvers may be async and the fold is not, so this goes in three steps,
  // none of them recursive: collect the comparisons in order, resolve them one
  // at a time (stopping at the first error, so later resolvers aren't called),
  // then fold again, taking each comparison's result in the same order.
  const comparisons: ComparisonNode[] = [];
  foldFilterNode<null>(filterNode, {
    comparison: (node) => {
      comparisons.push(node);
      return null;
    },
    chain: () => null,
    group: () => null,
    // The second fold reports it; comparisons before it are still resolved
    malformed: () => null,
  });

  const results: Result<DrizzleWhere>[] = [];
  for (const node of comparisons) {
    const result = await compileComparison(node, columnMappings, context as TContext);
    results.push(result);
    if (isError(result)) {
      break;
    }
  }

  // The fold visits comparisons in the same order and stops at the first
  // error, so it never reads past the results collected above.
  let next = 0;
  return foldFilterResult<DrizzleWhere>(filterNode, {
    comparison: () => results[next++] as Result<DrizzleWhere>,
    chain: (wheres, operator) =>
      createSuccess(operator === "or" ? orWhere(...(wheres as [Filter, ...Filter[]])) : andWhere(...wheres)),
    group: (where) => createSuccess(where),
  });
}

// ============================================================================
// SORT COMPILATION (RQB Object Syntax)
// ============================================================================

/**
 * @deprecated Use `Sort` from `@chromav/frizzle` instead.
 * Kept as an alias for backward compatibility.
 */
export type DrizzleOrderBy = Sort;

/**
 * Compile a sort expression string to Drizzle RQB orderBy object syntax.
 *
 * Parses "field:direction" pairs, validates fields against column mappings,
 * and rejects nested paths (can't sort by relation fields).
 *
 * @param sortExpression - Sort string (e.g., "status:asc,createdAt:desc")
 * @param columnMappings - Same column mappings used by compileFilter
 * @returns Result with orderBy object or error
 *
 * @example
 * const result = compileSort("status:asc,createdAt:desc", {
 *   status: "status",
 *   createdAt: "createdAt",
 *   tags: "taskTags.tag.name",
 * });
 * // Result: { status: "asc", createdAt: "desc" }
 *
 * @example
 * // Nested paths are rejected
 * compileSort("tags:asc", { tags: "taskTags.tag.name" });
 * // Error: Cannot sort by nested relation field: tags
 */
export function compileSort<TContext = unknown>(
  sortExpression: string,
  columnMappings: Record<string, WhereColumnMapping<TContext>>,
): Result<DrizzleOrderBy> {
  const parsedSort = parseSort(sortExpression);
  if (isError(parsedSort)) {
    return parsedSort;
  }
  const sortNodes = parsedSort.data;

  if (sortNodes.length === 0) {
    return createError(createParseError("Empty sort expression", 0, sortExpression, "SYNTAX_ERROR"));
  }

  const orderBy: DrizzleOrderBy = {};

  for (const node of sortNodes) {
    const entry = ownValue(columnMappings, node.field);
    const mapping = typeof entry === "object" ? entry.field : entry;

    if (!mapping) {
      return createError(
        createParseError(`Unknown sort field: ${node.field}`, 0, sortExpression, "UNKNOWN_FIELD", node.field),
      );
    }

    // Resolver functions = virtual/calculated columns, can't sort
    if (typeof mapping === "function") {
      return createError(
        createParseError(
          `Cannot sort by virtual column: ${node.field}`,
          0,
          sortExpression,
          "UNSORTABLE_FIELD",
          node.field,
        ),
      );
    }

    // Nested paths = relation fields, can't sort
    if (mapping.includes(".")) {
      return createError(
        createParseError(
          `Cannot sort by nested relation field: ${node.field}`,
          0,
          sortExpression,
          "UNSORTABLE_FIELD",
          node.field,
        ),
      );
    }

    orderBy[mapping] = node.direction;
  }

  return createSuccess(orderBy);
}
