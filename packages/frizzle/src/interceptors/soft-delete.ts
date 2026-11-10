// ============================================================================
// SOFT-DELETE INTERCEPTORS (Read + Write)
// ============================================================================
// Automatically filter out soft-deleted rows on reads and transform
// DELETE → UPDATE on writes.

import type { QueryInterceptor } from "../query-interceptor.js";
import type { Filter } from "../query.js";
import { mergeFilters } from "../query.js";
import type { WriteInterceptor } from "../write-interceptor.js";

/**
 * Configuration for soft-delete interceptors.
 */
export interface SoftDeleteConfig {
  /** Column that holds the deleted flag. Default: `"isDeleted"`. */
  column?: string;
  /** Column that holds the deletion timestamp. Default: `"deletedAt"`. */
  deletedAtColumn?: string;
  /** Column that holds the deleter's user ID. Default: `"deletedById"`. */
  deletedByColumn?: string;
  /** Set of column names that actually exist on the table (for capability checks). */
  columns?: Set<string>;
}

const DEFAULTS = {
  column: "isDeleted",
  deletedAtColumn: "deletedAt",
  deletedByColumn: "deletedById",
} as const;

/**
 * Filter out soft-deleted rows on every query.
 *
 * Appends `{ [column]: false }` to the filter. Typically paired with
 * `scopeQueryInterceptor` — this runs before scope so both conditions
 * are present.
 *
 * @example
 * ```ts
 * softDeleteQueryInterceptor()
 * softDeleteQueryInterceptor({ column: "archived" })
 * ```
 */
export function softDeleteQueryInterceptor<T>(config?: Pick<SoftDeleteConfig, "column">): QueryInterceptor<T> {
  const col = config?.column ?? DEFAULTS.column;
  return {
    onExecuting: (ctx) =>
      ctx.rewrite({
        filter: mergeFilters(ctx.descriptor.filter ?? {}, { [col]: false } as Filter),
      }),
  };
}

/**
 * Transform remove/restore operations for soft-delete.
 *
 * On `remove`:
 * - Changes mutation from `"delete"` → `"update"`
 * - Sets `isDeleted: true`, `deletedAt: new Date()`, `deletedById: userId`
 *
 * On `restore`:
 * - Sets `isDeleted: false`, clears `deletedAt` and `deletedById`
 *
 * Column names are configurable. Only writes columns that exist in the
 * provided `columns` set (if given).
 *
 * @param userId - The current user's ID (for `deletedById`).
 * @param config - Column name overrides and column existence set.
 *
 * @example
 * ```ts
 * softDeleteWriteInterceptor("user-1")
 * softDeleteWriteInterceptor("user-1", {
 *   columns: new Set(["isDeleted", "deletedAt"]),
 * })
 * ```
 */
export function softDeleteWriteInterceptor<T>(userId: string, config?: SoftDeleteConfig): WriteInterceptor<T> {
  const col = config?.column ?? DEFAULTS.column;
  const deletedAtCol = config?.deletedAtColumn ?? DEFAULTS.deletedAtColumn;
  const deletedByCol = config?.deletedByColumn ?? DEFAULTS.deletedByColumn;
  const has = (name: string) => !config?.columns || config.columns.has(name);

  return {
    onWriting: (ctx) => {
      if (ctx.operation === "remove") {
        const values: Record<string, unknown> = { [col]: true };
        if (has(deletedAtCol)) {
          values[deletedAtCol] = new Date();
        }
        if (has(deletedByCol)) {
          values[deletedByCol] = userId;
        }

        return ctx.rewrite({ mutation: "update", values });
      }

      if (ctx.operation === "restore") {
        const values: Record<string, unknown> = { [col]: false };
        if (has(deletedAtCol)) {
          values[deletedAtCol] = null;
        }
        if (has(deletedByCol)) {
          values[deletedByCol] = null;
        }

        return ctx.rewrite({ values });
      }

      return ctx;
    },
  };
}
