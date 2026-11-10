// ============================================================================
// DRIZZLE QUERY ADAPTER (BRIDGE PATTERN)
// ============================================================================
// Bridges the Query<T> algebra to Drizzle's Relational Query Builder.
//
// Filter maps directly to Drizzle v2 RQB's `where` object syntax.
// Sort maps directly to Drizzle v2 RQB's `orderBy` object syntax.
// The adapter is intentionally thin — the formats already align.

import type { DescriptorAdapter } from "./query-builder.js";
import type { Include, IncludeDescriptor, QueryDescriptor } from "./query-descriptor.js";
import type { QueryAdapter, QueryConfig } from "./query.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Drizzle-specific options passed alongside every query.
 *
 * These are execution concerns (how to load data), not query algebra
 * concerns (which data to load). They live here, not on Query<T>.
 */
export interface DrizzleAdapterOptions {
  /** Relations to eager-load (Drizzle `with`). */
  with?: Record<string, unknown>;
  /** Column selection (Drizzle `columns`). */
  columns?: Record<string, boolean>;
}

/**
 * Minimal interface matching Drizzle v2's RQB query table.
 *
 * This is what `db.query.tableName` provides. By depending on the
 * interface rather than the concrete type, the adapter stays testable
 * without a real database.
 */
export interface DrizzleQueryTable<T> {
  findFirst(config?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    with?: Record<string, unknown>;
    columns?: Record<string, boolean>;
    limit?: number;
  }): Promise<T | undefined>;

  findMany(config?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    with?: Record<string, unknown>;
    columns?: Record<string, boolean>;
    limit?: number;
    offset?: number;
  }): Promise<T[]>;
}

// ============================================================================
// LEGACY FACTORY (backward compatible — uses QueryConfig)
// ============================================================================

/**
 * Create a QueryAdapter<T> that delegates to a Drizzle RQB query table.
 *
 * **Legacy:** Uses the old `QueryConfig` shape (filter/sort/take/skip).
 * For the new `QueryDescriptor` shape (with Include/Select support),
 * use `createDrizzleDescriptorAdapter`.
 *
 * @param queryTable - Drizzle RQB accessor (e.g., `db.query.tasks`)
 * @param options - Drizzle-specific config (relations, column selection)
 */
export function createDrizzleAdapter<T>(
  queryTable: DrizzleQueryTable<T>,
  options?: DrizzleAdapterOptions,
): QueryAdapter<T> {
  return {
    findMany(config: QueryConfig): Promise<T[]> {
      return queryTable.findMany({
        where: config.filter,
        orderBy: config.sort,
        with: options?.with,
        columns: options?.columns,
        limit: config.take,
        offset: config.skip,
      });
    },

    findFirst(config: QueryConfig): Promise<T | undefined> {
      return queryTable.findFirst({
        where: config.filter,
        orderBy: config.sort,
        with: options?.with,
        columns: options?.columns,
      });
    },
  };
}

// ============================================================================
// DESCRIPTOR ADAPTER (new — uses QueryDescriptor with Include/Select)
// ============================================================================

/**
 * Create a DescriptorAdapter<T> that delegates to a Drizzle RQB query table.
 *
 * Unlike `createDrizzleAdapter`, this supports the full `QueryDescriptor`
 * including `Include` (composable per-query relations) and `Select`
 * (column projection). Relations are no longer fixed at construction time.
 *
 * @param queryTable - Drizzle RQB accessor (e.g., `db.query.tasks`)
 *
 * @example
 * ```ts
 * const adapter = createDrizzleDescriptorAdapter(db.query.tasks);
 *
 * const query = createQueryBuilder({
 *   adapter,
 *   interceptors: [workspaceScope("ws-1")],
 *   entity: "task",
 * });
 *
 * const tasks = await query
 *   .filter({ status: "active" })
 *   .include({ assignedToUser: true })
 *   .findMany();
 * ```
 */
export function createDrizzleDescriptorAdapter<T>(queryTable: DrizzleQueryTable<T>): DescriptorAdapter<T> {
  return {
    findMany(descriptor: QueryDescriptor): Promise<T[]> {
      return queryTable.findMany({
        where: descriptor.filter,
        orderBy: descriptor.sort,
        with: toRqbWith(descriptor.include),
        columns: descriptor.select,
        limit: descriptor.take,
        offset: descriptor.skip,
      });
    },

    findFirst(descriptor: QueryDescriptor): Promise<T | undefined> {
      return queryTable.findFirst({
        where: descriptor.filter,
        orderBy: descriptor.sort,
        with: toRqbWith(descriptor.include),
        columns: descriptor.select,
      });
    },
  };
}

// ============================================================================
// INCLUDE → DRIZZLE `with` TRANSLATION
// ============================================================================

/**
 * Translate an Include tree to Drizzle RQB's `with` format.
 *
 * The formats are nearly identical:
 * - `{ relation: true }` → `{ relation: true }`
 * - `{ relation: { filter, sort, ... } }` → `{ relation: { where, orderBy, ... } }`
 *
 * The main translation is renaming IncludeDescriptor fields to RQB field names
 * and recursing into nested includes.
 */
export function toRqbWith(include?: Include): Record<string, unknown> | undefined {
  if (!include) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(include)) {
    if (typeof value === "boolean") {
      result[key] = value;
    } else {
      result[key] = toRqbRelationConfig(value);
    }
  }

  return result;
}

function toRqbRelationConfig(desc: IncludeDescriptor): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (desc.filter) {
    config.where = desc.filter;
  }
  if (desc.sort) {
    config.orderBy = desc.sort;
  }
  if (desc.select) {
    config.columns = desc.select;
  }
  if (desc.include) {
    config.with = toRqbWith(desc.include);
  }
  if (desc.take !== undefined) {
    config.limit = desc.take;
  }

  // If the descriptor only had nested include/select but no filter/sort,
  // still return the config (Drizzle accepts partial configs)
  return config;
}
