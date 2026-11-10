// ============================================================================
// QUERY ALGEBRA
// ============================================================================
// Backend-agnostic, immutable query composition.
//
// Query<T> is the expression tree that sits above both the parser
// (string → Filter) and the backend adapters (Filter → DB query).
// Each method returns a new Query<T> — conditions compose as a monoid
// under shallow merge.

import { distinct } from "./distinct.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backend-agnostic filter conditions.
 *
 * Simple equality: `{ status: "active" }`
 * Operators:       `{ age: { gte: 18 } }`
 * Negation:        `{ status: { ne: "archived" } }`
 * OR logic:        `{ OR: [{ status: "a" }, { status: "b" }] }`
 * AND logic:       `{ AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }] }` (same key twice)
 *
 * From RQB `compileFilter` it may also hold `RAW` (a function, for escaped
 * LIKE), so it isn't always plain JSON.
 *
 * The frizzle compiler produces this type. The Drizzle adapter consumes it.
 * Other adapters (Postgres, in-memory, etc.) can consume it too.
 */
export type Filter = Record<string, unknown> & { OR?: Filter[]; AND?: Filter[] };

/**
 * Backend-agnostic sort specification.
 *
 * `{ createdAt: "desc", title: "asc" }`
 */
export type Sort = Record<string, "asc" | "desc">;

/**
 * The accumulated, immutable query configuration.
 *
 * Built up by chaining `.filter()`, `.sort()`, `.take()`, `.skip()`.
 * Passed to a `QueryAdapter` for execution.
 */
export interface QueryConfig {
  readonly filter: Filter;
  readonly sort?: Sort;
  readonly take?: number;
  readonly skip?: number;
}

// ============================================================================
// QUERY INTERFACE
// ============================================================================

/**
 * Immutable, composable query description.
 *
 * Each method returns a **new** Query<T> — the original is never mutated.
 * This is the core algebra: filter conditions form a monoid under merge,
 * sort/take/skip are last-write-wins.
 *
 * Query<T> describes *what* data you want. It says nothing about *how*
 * to get it — that's the adapter's job.
 */
export interface Query<T> {
  /** Add filter conditions (merged with existing via monoid combine). */
  filter(conditions: Filter): Query<T>;

  /** Set sort order (replaces any previous sort). */
  sort(order: Sort): Query<T>;

  /** Limit the number of results. */
  take(n: number): Query<T>;

  /** Skip the first N results. */
  skip(n: number): Query<T>;

  /** Inspect the accumulated query configuration. */
  config(): QueryConfig;
}

// ============================================================================
// QUERY ADAPTER (BRIDGE PATTERN)
// ============================================================================

/**
 * Bridge between the query algebra and a specific backend.
 *
 * The adapter translates QueryConfig into backend-specific calls.
 * Each backend (Drizzle, Postgres, in-memory, etc.) implements this
 * interface once.
 */
export interface QueryAdapter<T> {
  findMany(config: QueryConfig): Promise<T[]>;
  findFirst(config: QueryConfig): Promise<T | undefined>;
}

// ============================================================================
// EXECUTABLE QUERY
// ============================================================================

/**
 * A Query<T> bound to an adapter — can be both composed and executed.
 *
 * This is what consumers work with. Chain `.filter()` / `.sort()` to
 * refine, then call `.findMany()` / `.findFirst()` to execute.
 */
export interface ExecutableQuery<T> extends Query<T> {
  filter(conditions: Filter): ExecutableQuery<T>;
  sort(order: Sort): ExecutableQuery<T>;
  take(n: number): ExecutableQuery<T>;
  skip(n: number): ExecutableQuery<T>;
  findMany(): Promise<T[]>;
  findFirst(): Promise<T | undefined>;
}

// ============================================================================
// FILTER MERGE (MONOID COMBINE)
// ============================================================================

// A Filter (a compiled where object: RQB output, scopes, descriptor filters)
// is a conjunction: each object key is one condition, and `AND` / `OR` hold
// nested filters. `andWhere` and `orWhere` are its two combinators, with
// `{}` ("no condition") as the identity of `andWhere` and the absorbing element
// of `orWhere`. Both are idempotent: repeating a condition or branch adds
// nothing.

/** One ANDed condition: a key and its value (`["status", "active"]`). */
type Condition = readonly [key: string, value: unknown];

/** The flat list of conditions a filter ANDs: every key is one, `AND` items expand recursively. */
const conditions = (filter: Filter): Condition[] =>
  Object.entries(filter).flatMap(([key, value]): Condition[] =>
    key === "AND" ? (value as Filter[]).flatMap(conditions) : [[key, value]],
  );

/** A filter with no conditions (`{}`, or a degenerate `{ AND: [] }`) matches everything. */
const isEmpty = (filter: Filter): boolean => conditions(filter).length === 0;

/**
 * Packs conditions into as few objects as possible. A key can appear once per
 * object, so object `i` takes the `i`-th distinct value of every key: one
 * object when keys don't repeat, more (to be ANDed) when they do. One pass
 * groups the conditions by key, so this is linear in their number.
 */
function pack(all: readonly Condition[]): Filter[] {
  const byKey = new Map<string, unknown[]>();
  for (const [key, value] of all) {
    const values = byKey.get(key);
    if (values === undefined) {
      byKey.set(key, [value]);
    } else {
      values.push(value);
    }
  }
  const rows: [string, unknown][][] = [];
  for (const [key, values] of byKey) {
    distinct(values).forEach((value, i) => {
      if (rows[i] === undefined) {
        rows[i] = [];
      }
      rows[i].push([key, value]);
    });
  }
  return rows.map((entries) => Object.fromEntries(entries));
}

/**
 * AND: matches only what every filter matches. The result is the union of
 * their conditions, packed back into one object when keys don't collide
 * (`{ status, workspaceId }`) and into one flat `{ AND: [...] }` when they do
 * (the same field twice, two different `OR`s, two `RAW` filters).
 *
 * Idempotent, so `andWhere(f, { ...f, workspaceId })` is `{ ...f, workspaceId }`:
 * interceptors that hand `ctx.rewrite` a pre-merged filter don't duplicate
 * conditions. With at most one non-empty filter it's returned as-is.
 *
 * Combines compiled where objects (`compileFilter` output, scopes, descriptor
 * filters). To combine filter trees before compiling (`parseFilter` output,
 * `f` builders), use `f.and`.
 */
export function andWhere(...filters: Filter[]): Filter {
  const nonEmpty = filters.filter((f) => !isEmpty(f));
  if (nonEmpty.length <= 1) {
    return nonEmpty[0] ?? {};
  }
  const objects = pack(nonEmpty.flatMap(conditions));
  return objects.length > 1 ? { AND: objects } : (objects[0] ?? {});
}

/**
 * OR: matches what any filter matches. `{}` matches everything, so it absorbs
 * the whole OR (Drizzle would otherwise drop the empty branch). Nested ORs and
 * repeated branches flatten into one `{ OR: [...] }`.
 *
 * Combines compiled where objects; for filter trees use `f.or`.
 */
export function orWhere(first: Filter, ...rest: Filter[]): Filter {
  const filters = [first, ...rest];
  if (filters.some(isEmpty)) {
    return {};
  }
  const onlyOr = (f: Filter): f is Filter & { OR: Filter[] } => Object.keys(f).length === 1 && Array.isArray(f.OR);
  const branches = distinct(filters.flatMap((f) => (onlyOr(f) ? f.OR : [f])));
  return branches.length > 1 ? { OR: branches } : (branches[0] as Filter);
}

/**
 * Combine two Filters with AND (the monoid combine behind `.filter()`,
 * `mergeDescriptors` and interceptors): `andWhere(a, b)`.
 *
 * Scoping relies on this: `mergeFilters(userFilter, { workspaceId })` keeps
 * the user's conditions and the scope's, so a user filter can neither remove
 * nor widen the scope.
 */
export const mergeFilters = (a: Filter, b: Filter): Filter => andWhere(a, b);

/** @deprecated Renamed {@link andWhere} (it combines where objects, not `f` filter nodes). */
export const allOf = andWhere;

/** @deprecated Renamed {@link orWhere} (it combines where objects, not `f` filter nodes). */
export const anyOf = orWhere;

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an immutable Query<T> with no adapter (introspection only).
 *
 * Use this when you need to build up a query description without
 * executing it. Pass the result's `.config()` to an adapter manually.
 */
export function createQuery<T>(initial?: Partial<QueryConfig>): Query<T> {
  const cfg: QueryConfig = {
    filter: initial?.filter ?? {},
    sort: initial?.sort,
    take: initial?.take,
    skip: initial?.skip,
  };

  return Object.freeze({
    filter(conditions: Filter): Query<T> {
      return createQuery<T>({
        ...cfg,
        filter: mergeFilters(cfg.filter, conditions),
      });
    },
    sort(order: Sort): Query<T> {
      return createQuery<T>({ ...cfg, sort: order });
    },
    take(n: number): Query<T> {
      return createQuery<T>({ ...cfg, take: n });
    },
    skip(n: number): Query<T> {
      return createQuery<T>({ ...cfg, skip: n });
    },
    config(): QueryConfig {
      return cfg;
    },
  });
}

/**
 * Create an ExecutableQuery<T> bound to an adapter.
 *
 * This is the main entry point for consumers. The adapter handles
 * execution; the query handles composition.
 */
export function createExecutableQuery<T>(adapter: QueryAdapter<T>, initial?: Partial<QueryConfig>): ExecutableQuery<T> {
  const cfg: QueryConfig = {
    filter: initial?.filter ?? {},
    sort: initial?.sort,
    take: initial?.take,
    skip: initial?.skip,
  };

  return Object.freeze({
    filter(conditions: Filter): ExecutableQuery<T> {
      return createExecutableQuery<T>(adapter, {
        ...cfg,
        filter: mergeFilters(cfg.filter, conditions),
      });
    },
    sort(order: Sort): ExecutableQuery<T> {
      return createExecutableQuery<T>(adapter, { ...cfg, sort: order });
    },
    take(n: number): ExecutableQuery<T> {
      return createExecutableQuery<T>(adapter, { ...cfg, take: n });
    },
    skip(n: number): ExecutableQuery<T> {
      return createExecutableQuery<T>(adapter, { ...cfg, skip: n });
    },
    config(): QueryConfig {
      return cfg;
    },
    findMany(): Promise<T[]> {
      return adapter.findMany(cfg);
    },
    findFirst(): Promise<T | undefined> {
      return adapter.findFirst(cfg);
    },
  });
}
