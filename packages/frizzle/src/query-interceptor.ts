// ============================================================================
// QUERY INTERCEPTORS — Pipeline Hooks
// ============================================================================
// Interceptors observe and rewrite queries before/after execution.
// Configured at factory time, invisible to callers.
//
// See: docs/platform/semantic-query-layer.md

import type { QueryDescriptor } from "./query-descriptor.js";
import { mergeDescriptors } from "./query-descriptor.js";

// ============================================================================
// SERVICE CONTEXT (minimal — extended by consumers like Cobalt)
// ============================================================================

/**
 * Minimal context about the service producing the query.
 *
 * Intentionally `object` (not `Record<string, unknown>` or an interface
 * with an index signature) so that concrete types like Cobalt's
 * `ServiceContext` — which have named properties without an explicit
 * index signature — satisfy the constraint without casting.
 */
export type QueryServiceContext = object;

// ============================================================================
// INTERCEPTOR TYPES
// ============================================================================

/**
 * A query interceptor — hooks into the execution pipeline.
 *
 * - `onExecuting`: Rewrite the query before it hits the adapter.
 *   Runs in order. Scoping interceptors run last (unforgeable).
 * - `onExecuted`: Transform or observe results after execution.
 *   Runs in order.
 *
 * Interceptors return a new context (immutable). Each interceptor
 * sees the output of the previous one.
 */
export interface QueryInterceptor<T = unknown, TContext extends QueryServiceContext = QueryServiceContext> {
  /** Rewrite the query before it hits the adapter. */
  onExecuting?: (
    ctx: QueryExecutingContext<T, TContext>,
  ) => QueryExecutingContext<T, TContext> | Promise<QueryExecutingContext<T, TContext>>;

  /** Transform or observe results after execution. */
  onExecuted?: (
    ctx: QueryExecutedContext<T, TContext>,
  ) => QueryExecutedContext<T, TContext> | Promise<QueryExecutedContext<T, TContext>>;
}

// ============================================================================
// EXECUTING CONTEXT (before adapter)
// ============================================================================

/**
 * Context available during the `onExecuting` phase.
 *
 * The descriptor can be rewritten via `rewrite()`. Each call returns
 * a new context — the original is never mutated.
 */
export interface QueryExecutingContext<T = unknown, TContext extends QueryServiceContext = QueryServiceContext> {
  readonly entity: string;
  readonly operation: "findMany" | "findFirst" | "count";
  readonly descriptor: QueryDescriptor;
  readonly service: TContext;

  /** Return a new context with a rewritten descriptor. */
  rewrite(changes: Partial<QueryDescriptor>): QueryExecutingContext<T, TContext>;
}

// ============================================================================
// EXECUTED CONTEXT (after adapter)
// ============================================================================

/**
 * Context available during the `onExecuted` phase.
 *
 * Results are available. Interceptors can transform or observe them.
 */
export interface QueryExecutedContext<T = unknown, TContext extends QueryServiceContext = QueryServiceContext> {
  readonly entity: string;
  readonly operation: "findMany" | "findFirst" | "count";
  readonly descriptor: QueryDescriptor;
  readonly service: TContext;
  readonly results: T[];
  readonly duration: number;

  /** Return a new context with transformed results. */
  mapResults(fn: (results: T[]) => T[]): QueryExecutedContext<T, TContext>;
}

// ============================================================================
// CONTEXT FACTORIES
// ============================================================================

/**
 * Create a QueryExecutingContext.
 */
export function createExecutingContext<T, TContext extends QueryServiceContext>(
  entity: string,
  operation: "findMany" | "findFirst" | "count",
  descriptor: QueryDescriptor,
  service: TContext,
): QueryExecutingContext<T, TContext> {
  return Object.freeze({
    entity,
    operation,
    descriptor,
    service,
    rewrite(changes: Partial<QueryDescriptor>): QueryExecutingContext<T, TContext> {
      return createExecutingContext(entity, operation, mergeDescriptors(descriptor, changes), service);
    },
  });
}

/**
 * Create a QueryExecutedContext.
 */
export function createExecutedContext<T, TContext extends QueryServiceContext>(
  entity: string,
  operation: "findMany" | "findFirst" | "count",
  descriptor: QueryDescriptor,
  service: TContext,
  results: T[],
  duration: number,
): QueryExecutedContext<T, TContext> {
  return Object.freeze({
    entity,
    operation,
    descriptor,
    service,
    results,
    duration,
    mapResults(fn: (results: T[]) => T[]): QueryExecutedContext<T, TContext> {
      return createExecutedContext(entity, operation, descriptor, service, fn(results), duration);
    },
  });
}

// ============================================================================
// PIPELINE EXECUTION
// ============================================================================

/**
 * Run the interceptor pipeline: onExecuting → execute → onExecuted.
 *
 * @param interceptors - Ordered interceptor list. Scoping should be last.
 * @param execute - The adapter execution function.
 * @param entity - Entity name for context.
 * @param operation - findMany | findFirst | count.
 * @param descriptor - The query descriptor to execute.
 * @param service - The ambient service context.
 * @returns The (possibly transformed) results.
 */
export async function executePipeline<T, TContext extends QueryServiceContext>(
  interceptors: QueryInterceptor<T, TContext>[],
  execute: (descriptor: QueryDescriptor, operation: "findMany" | "findFirst" | "count") => Promise<T[]>,
  entity: string,
  operation: "findMany" | "findFirst" | "count",
  descriptor: QueryDescriptor,
  service: TContext,
): Promise<T[]> {
  // Phase 1: onExecuting
  let execCtx = createExecutingContext<T, TContext>(entity, operation, descriptor, service);
  for (const interceptor of interceptors) {
    if (interceptor.onExecuting) {
      execCtx = await interceptor.onExecuting(execCtx);
    }
  }

  // Phase 2: execute
  const start = performance.now();
  const results = await execute(execCtx.descriptor, operation);
  const duration = performance.now() - start;

  // Phase 3: onExecuted
  let doneCtx = createExecutedContext<T, TContext>(entity, operation, execCtx.descriptor, service, results, duration);
  for (const interceptor of interceptors) {
    if (interceptor.onExecuted) {
      doneCtx = await interceptor.onExecuted(doneCtx);
    }
  }

  return doneCtx.results;
}
