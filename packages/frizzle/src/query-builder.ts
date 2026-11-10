// ============================================================================
// QUERY BUILDER — Mutable Composition, Immutable at Execution
// ============================================================================
// A Query<T> implementation using the mutable builder pattern.
//
// Each .filter() / .sort() / .include() mutates in place and returns `this`.
// At execution time (.findMany() / .findFirst()), the descriptor is frozen
// and run through the interceptor pipeline.
//
// This avoids the GC pressure of creating a new frozen object per chain call
// (the immutable pattern from the old ExecutableQuery). For Cobaltplan's
// use cases — linear query chains in loaders — this is the right trade-off.
//
// See: docs/platform/semantic-query-layer.md

import type { Include, QueryDescriptor, Select } from "./query-descriptor.js";
import { mergeIncludes } from "./query-descriptor.js";
import type { QueryInterceptor, QueryServiceContext } from "./query-interceptor.js";
import { executePipeline } from "./query-interceptor.js";
import type { Filter, Sort } from "./query.js";
import { mergeFilters } from "./query.js";

// ============================================================================
// QUERY ADAPTER (revised for QueryDescriptor)
// ============================================================================

/**
 * Bridge between the query algebra and a specific backend.
 *
 * The adapter translates a QueryDescriptor into backend-specific calls.
 * Unlike the old QueryAdapter (which took QueryConfig), this one receives
 * the full descriptor including Include and Select.
 */
export interface DescriptorAdapter<T> {
  findMany(descriptor: QueryDescriptor): Promise<T[]>;
  findFirst(descriptor: QueryDescriptor): Promise<T | undefined>;
}

// ============================================================================
// QUERY<T> INTERFACE
// ============================================================================

/**
 * Composable query description bound to an adapter and interceptor pipeline.
 *
 * Each method mutates in place and returns `this` for chaining.
 * Execution (.findMany() / .findFirst()) freezes the descriptor and
 * runs it through the interceptor pipeline → adapter.
 *
 * Callers compose queries. They don't know about interceptors or adapters.
 */
export interface Query<T> {
  /** Add filter conditions (merged with existing via and()). */
  filter(conditions: Filter): Query<T>;

  /** Set sort order (replaces previous). */
  sort(order: Sort): Query<T>;

  /** Merge relation includes (deep-merged with existing). */
  include(relations: Include): Query<T>;

  /** Set column projection (merged with existing). */
  select(columns: Select): Query<T>;

  /** Limit the number of results. */
  take(n: number): Query<T>;

  /** Skip the first N results. */
  skip(n: number): Query<T>;

  /** Execute: fetch all matching rows. */
  findMany(): Promise<T[]>;

  /** Execute: fetch the first matching row. */
  findFirst(): Promise<T | undefined>;

  /** Inspect the accumulated query descriptor. */
  descriptor(): QueryDescriptor;
}

// ============================================================================
// BUILDER OPTIONS
// ============================================================================

export interface QueryBuilderOptions<T, TContext extends QueryServiceContext = QueryServiceContext> {
  /** The backend adapter. */
  adapter: DescriptorAdapter<T>;
  /** Ordered interceptors. Scoping should be last. */
  interceptors?: QueryInterceptor<T, TContext>[];
  /** Ambient service context (passed to interceptors). */
  service?: TContext;
  /** Entity name (for interceptor context). */
  entity?: string;
  /** Initial descriptor values. */
  initial?: Partial<QueryDescriptor>;
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a mutable Query<T> builder.
 *
 * Composition methods mutate in place (no new objects). Execution freezes
 * the descriptor and runs the interceptor pipeline.
 *
 * @example
 * ```ts
 * const query = createQueryBuilder({
 *   adapter: createDrizzleDescriptorAdapter(db.query.tasks),
 *   interceptors: [workspaceScope("ws-1"), softDeleteScope()],
 *   entity: "task",
 * });
 *
 * const tasks = await query
 *   .filter({ status: "active" })
 *   .sort({ createdAt: "desc" })
 *   .include({ assignedToUser: true })
 *   .take(20)
 *   .findMany();
 * ```
 */
export function createQueryBuilder<T, TContext extends QueryServiceContext = QueryServiceContext>(
  options: QueryBuilderOptions<T, TContext>,
): Query<T> {
  const { adapter, interceptors = [], service = {} as TContext, entity = "unknown", initial } = options;

  // Mutable state — mutated by composition methods, frozen at execution
  let filter: Filter | undefined = initial?.filter;
  let sort: Sort | undefined = initial?.sort;
  let include: Include | undefined = initial?.include;
  let select: Select | undefined = initial?.select;
  let take: number | undefined = initial?.take;
  let skip: number | undefined = initial?.skip;

  function buildDescriptor(): QueryDescriptor {
    return Object.freeze({
      filter,
      sort,
      include,
      select,
      take,
      skip,
    });
  }

  async function executeAdapted(desc: QueryDescriptor, operation: "findMany" | "findFirst" | "count"): Promise<T[]> {
    if (operation === "findMany") {
      return adapter.findMany(desc);
    }
    if (operation === "findFirst") {
      const result = await adapter.findFirst(desc);
      return result !== undefined ? [result] : [];
    }
    // count not yet supported at adapter level
    return [];
  }

  const self: Query<T> = {
    filter(conditions: Filter): Query<T> {
      filter = filter ? mergeFilters(filter, conditions) : conditions;
      return self;
    },

    sort(order: Sort): Query<T> {
      sort = order;
      return self;
    },

    include(relations: Include): Query<T> {
      include = include ? mergeIncludes(include, relations) : relations;
      return self;
    },

    select(columns: Select): Query<T> {
      select = select ? { ...select, ...columns } : columns;
      return self;
    },

    take(n: number): Query<T> {
      take = n;
      return self;
    },

    skip(n: number): Query<T> {
      skip = n;
      return self;
    },

    async findMany(): Promise<T[]> {
      const desc = buildDescriptor();
      return executePipeline(interceptors, executeAdapted, entity, "findMany", desc, service);
    },

    async findFirst(): Promise<T | undefined> {
      const desc = buildDescriptor();
      const results = await executePipeline(interceptors, executeAdapted, entity, "findFirst", desc, service);
      return results[0];
    },

    descriptor(): QueryDescriptor {
      return buildDescriptor();
    },
  };

  return self;
}
