// ============================================================================
// QUERY DESCRIPTOR — The Expression Tree
// ============================================================================
// A plain structured object that describes a query. Serializable, inspectable,
// walkable. The object IS the tree — no separate AST node types needed.
//
// This is the "IQueryable expression" in C# terms. Each key is a node.
// You visit by walking keys and checking types.
//
// See: docs/platform/semantic-query-layer.md

import type { Filter, Sort } from "./query.js";
import { mergeFilters } from "./query.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Relation inclusion — like Drizzle's `with`, accepts bool or nested descriptor.
 *
 * `{ assignedToUser: true }` — include relation with defaults
 * `{ tasks: { filter: { isDeleted: false }, sort: { order: "asc" } } }` — nested query
 */
export type Include = Record<string, boolean | IncludeDescriptor>;

/**
 * Nested relation descriptor — a sub-query within an include.
 */
export interface IncludeDescriptor {
  filter?: Filter;
  sort?: Sort;
  select?: Select;
  include?: Include; // recursive — nested relations
  take?: number;
}

/**
 * Column projection.
 *
 * `{ id: true, name: true }` — only these columns
 */
export type Select = Record<string, boolean>;

/**
 * The canonical query description. This is the expression tree.
 *
 * A plain object — serializable, inspectable, walkable. Built up by
 * chaining `.filter()`, `.sort()`, `.include()`, etc. on a Query<T>.
 * Passed through the interceptor pipeline, then to a QueryAdapter.
 */
export interface QueryDescriptor {
  readonly filter?: Filter;
  readonly sort?: Sort;
  readonly include?: Include;
  readonly select?: Select;
  readonly take?: number;
  readonly skip?: number;
}

// ============================================================================
// MERGE UTILITIES
// ============================================================================

/**
 * Deep-merge two Include specs.
 *
 * - `true` values are overridden by descriptors (more specific wins).
 * - Descriptors are deep-merged: filters combine via `mergeFilters`,
 *   nested includes recurse.
 */
export function mergeIncludes(a: Include, b: Include): Include {
  const result = { ...a };

  for (const [key, value] of Object.entries(b)) {
    const existing = result[key];

    if (existing === undefined || existing === true || value === true) {
      // No existing, or one side is `true` (simple include) — take the value
      result[key] = value;
    } else if (typeof existing === "object" && typeof value === "object") {
      // Both are descriptors — deep merge
      result[key] = mergeIncludeDescriptors(existing, value);
    }
  }

  return result;
}

/**
 * Deep-merge two IncludeDescriptors.
 */
function mergeIncludeDescriptors(a: IncludeDescriptor, b: IncludeDescriptor): IncludeDescriptor {
  return {
    ...a,
    ...b,
    filter: a.filter && b.filter ? mergeFilters(a.filter, b.filter) : (b.filter ?? a.filter),
    include: a.include && b.include ? mergeIncludes(a.include, b.include) : (b.include ?? a.include),
    select: a.select && b.select ? { ...a.select, ...b.select } : (b.select ?? a.select),
  };
}

/**
 * Merge two QueryDescriptors.
 *
 * Filters merge (monoid). Sort, select, take, skip are last-write-wins.
 * Includes deep-merge.
 */
export function mergeDescriptors(a: QueryDescriptor, b: Partial<QueryDescriptor>): QueryDescriptor {
  return {
    filter: a.filter && b.filter ? mergeFilters(a.filter, b.filter) : (b.filter ?? a.filter),
    sort: b.sort ?? a.sort,
    include: a.include && b.include ? mergeIncludes(a.include, b.include) : (b.include ?? a.include),
    select: a.select && b.select ? { ...a.select, ...b.select } : (b.select ?? a.select),
    take: b.take ?? a.take,
    skip: b.skip ?? a.skip,
  };
}

// ============================================================================
// TREE WALKING
// ============================================================================

/**
 * Walk all IncludeDescriptors in an Include tree, depth-first.
 *
 * @param include - The include tree to walk
 * @param visit - Called for each IncludeDescriptor with its path
 *
 * @example
 * ```ts
 * walkIncludes(descriptor.include, (path, desc) => {
 *   // path: ["tasks", "taskTags"]
 *   // desc: { include: { tag: true } }
 * });
 * ```
 */
export function walkIncludes(
  include: Include,
  visit: (path: string[], desc: IncludeDescriptor) => void,
  path: string[] = [],
): void {
  for (const [key, value] of Object.entries(include)) {
    if (typeof value === "boolean") {
      continue;
    }
    const currentPath = [...path, key];
    visit(currentPath, value);
    if (value.include) {
      walkIncludes(value.include, visit, currentPath);
    }
  }
}
