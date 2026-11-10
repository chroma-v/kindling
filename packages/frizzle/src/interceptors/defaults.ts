// ============================================================================
// DEFAULT INCLUDES & EXTRA SCOPE — Read Interceptors
// ============================================================================

import type { Include } from "../query-descriptor.js";
import { mergeIncludes } from "../query-descriptor.js";
import type { QueryInterceptor } from "../query-interceptor.js";
import type { Filter } from "../query.js";
import { mergeFilters } from "../query.js";

/**
 * Deep-merge default relation includes into every query.
 *
 * User-provided includes are merged on top — they can add relations
 * or override sub-descriptors, but the defaults are always present.
 *
 * @example
 * ```ts
 * defaultIncludesInterceptor({ author: true, tags: { select: { name: true } } })
 * ```
 */
export function defaultIncludesInterceptor<T>(defaults: Include): QueryInterceptor<T> {
  return {
    onExecuting: (ctx) =>
      ctx.rewrite({
        include: mergeIncludes(defaults, ctx.descriptor.include ?? {}),
      }),
  };
}

/**
 * Add entity-specific filter conditions from a factory function.
 *
 * Used for per-user scoping (e.g., favorites filtered by userId) or
 * entity-specific defaults (e.g., only non-archived items).
 *
 * The factory is called on each query — it can return different values
 * based on runtime context captured in its closure.
 *
 * @example
 * ```ts
 * extraScopeInterceptor(() => ({ userId: session.userId }))
 * extraScopeInterceptor(() => ({ isArchived: false }))
 * ```
 */
export function extraScopeInterceptor<T>(scopeFn: () => Record<string, unknown>): QueryInterceptor<T> {
  return {
    onExecuting: (ctx) =>
      ctx.rewrite({
        filter: mergeFilters(ctx.descriptor.filter ?? {}, scopeFn() as Filter),
      }),
  };
}
