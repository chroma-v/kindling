// ============================================================================
// EXTRA SCOPE WRITE INTERCEPTOR
// ============================================================================
// Inject additional scope fields on insert. The write-side dual of
// `extraScopeInterceptor` (query side).

import type { WriteInterceptor } from "../write-interceptor.js";

/**
 * Inject additional scope fields from a factory function on insert.
 *
 * Used for entity-specific scoping like per-user favorites where
 * the userId must be injected into every new row.
 *
 * Only applies on `insert` — updates and deletes don't need scope injection
 * (the row already has the correct scope from creation).
 *
 * @example
 * ```ts
 * extraScopeWriteInterceptor(() => ({ userId: session.userId }))
 * ```
 */
export function extraScopeWriteInterceptor<T>(scopeFn: () => Record<string, unknown>): WriteInterceptor<T> {
  return {
    onWriting: (ctx) => {
      if (ctx.descriptor.mutation === "insert") {
        return ctx.rewrite({ values: scopeFn() });
      }
      return ctx;
    },
  };
}
