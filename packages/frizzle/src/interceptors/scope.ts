// ============================================================================
// SCOPE INTERCEPTORS (Read + Write)
// ============================================================================
// Tenant/workspace scoping. Place LAST in the interceptor chain to make
// scope conditions unforgeable — later interceptors overwrite earlier ones.

import type { QueryInterceptor } from "../query-interceptor.js";
import type { Filter } from "../query.js";
import { mergeFilters } from "../query.js";
import type { WriteInterceptor } from "../write-interceptor.js";

/**
 * Append scope fields to every query's filter.
 *
 * Designed to run last so that user-provided filters cannot override
 * the scope. Supports any set of scope fields (workspaceId, tenantId, etc.).
 *
 * @example
 * ```ts
 * scopeQueryInterceptor({ workspaceId: "ws-1" })
 * scopeQueryInterceptor({ tenantId: "t-1", isDeleted: false })
 * ```
 */
export function scopeQueryInterceptor<T>(scopeFields: Filter): QueryInterceptor<T> {
  return {
    onExecuting: (ctx) =>
      ctx.rewrite({
        filter: mergeFilters(ctx.descriptor.filter ?? {}, scopeFields),
      }),
  };
}

/**
 * Inject scope fields into every write's values.
 *
 * Designed to run last so that user-provided values cannot override
 * the scope. The write-side dual of `scopeQueryInterceptor`.
 *
 * @example
 * ```ts
 * scopeWriteInterceptor({ workspaceId: "ws-1" })
 * ```
 */
export function scopeWriteInterceptor<T>(scopeFields: Record<string, unknown>): WriteInterceptor<T> {
  return {
    onWriting: (ctx) => ctx.rewrite({ values: scopeFields }),
  };
}
