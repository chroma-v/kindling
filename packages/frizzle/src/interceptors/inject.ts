// ============================================================================
// INJECT WRITE INTERCEPTOR — Audit Trail
// ============================================================================
// Auto-inject context fields (createdById, updatedById) based on
// operation type. Column names are configurable.

import type { WriteInterceptor } from "../write-interceptor.js";

/**
 * Configuration for the inject interceptor.
 */
export interface InjectConfig {
  /** Column to inject on insert. Default: `"createdById"`. */
  createdByColumn?: string;
  /** Column to inject on update. Default: `"updatedById"`. */
  updatedByColumn?: string;
  /** Set of column names that exist on the table (for capability checks). */
  columns?: Set<string>;
}

const DEFAULTS = {
  createdByColumn: "createdById",
  updatedByColumn: "updatedById",
} as const;

/**
 * Auto-inject user ID into writes based on operation type.
 *
 * On insert: sets `createdById` (if column exists).
 * On update: sets `updatedById` (if column exists).
 *
 * @param userId - The current user's ID.
 * @param config - Column name overrides and column existence set.
 *
 * @example
 * ```ts
 * injectWriteInterceptor("user-1")
 * injectWriteInterceptor("user-1", {
 *   createdByColumn: "authorId",
 *   updatedByColumn: "lastEditedById",
 *   columns: new Set(["authorId", "lastEditedById"]),
 * })
 * ```
 */
export function injectWriteInterceptor<T>(userId: string, config?: InjectConfig): WriteInterceptor<T> {
  const createdByCol = config?.createdByColumn ?? DEFAULTS.createdByColumn;
  const updatedByCol = config?.updatedByColumn ?? DEFAULTS.updatedByColumn;
  const has = (name: string) => !config?.columns || config.columns.has(name);

  return {
    onWriting: (ctx) => {
      const inject: Record<string, unknown> = {};

      if (ctx.descriptor.mutation === "insert" && has(createdByCol)) {
        inject[createdByCol] = userId;
      }
      if (ctx.descriptor.mutation === "update" && has(updatedByCol)) {
        inject[updatedByCol] = userId;
      }

      return Object.keys(inject).length > 0 ? ctx.rewrite({ values: inject }) : ctx;
    },
  };
}
