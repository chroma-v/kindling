import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { Filter, QueryAdapter } from "./query.js";
import { allOf, andWhere, anyOf, createExecutableQuery, createQuery, mergeFilters, orWhere } from "./query.js";

// ============================================================================
// mergeFilters (monoid combine)
// ============================================================================

describe("mergeFilters", () => {
  it("identity: merging with empty object returns original", () => {
    const a: Filter = { status: "active", priority: "high" };
    expect(mergeFilters(a, {})).toEqual(a);
    expect(mergeFilters({}, a)).toEqual(a);
  });

  it("the same key twice keeps both conditions (AND), not the later one", () => {
    const result = mergeFilters({ status: "draft" }, { status: "published" });
    expect(result).toEqual({ AND: [{ status: "draft" }, { status: "published" }] });
  });

  it("non-overlapping keys are merged", () => {
    const result = mergeFilters({ status: "active" }, { priority: "high" });
    expect(result).toEqual({ status: "active", priority: "high" });
  });

  it("two ORs are ANDed, not concatenated into one OR", () => {
    // Concatenating turned (a or b) and (c or d) into a or b or c or d.
    const result = mergeFilters({ OR: [{ status: "a" }, { status: "b" }] }, { OR: [{ status: "c" }, { status: "d" }] });
    expect(result).toEqual({
      AND: [{ OR: [{ status: "a" }, { status: "b" }] }, { OR: [{ status: "c" }, { status: "d" }] }],
    });
  });

  it("a chain on one key is one flat AND list", () => {
    const result = mergeFilters(mergeFilters({ age: { gte: 18 } }, { age: { lte: 65 } }), { age: { ne: 30 } });
    expect(result).toEqual({ AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }, { age: { ne: 30 } }] });
  });

  it("OR from b is appended when a has no OR", () => {
    const result = mergeFilters({ status: "active" }, { OR: [{ priority: "high" }] });
    expect(result).toEqual({
      status: "active",
      OR: [{ priority: "high" }],
    });
  });

  it("is idempotent: merging a filter with itself or with a superset repeats nothing", () => {
    const a: Filter = { status: "active", OR: [{ priority: "high" }, { priority: "urgent" }] };
    expect(mergeFilters(a, a)).toEqual(a);
    // The interceptor idiom: rewrite({ filter: { ...ctx.descriptor.filter, workspaceId } }) is
    // merged into the old filter again; that must not duplicate the old conditions.
    expect(mergeFilters(a, { ...a, workspaceId: "ws-1" })).toEqual({ ...a, workspaceId: "ws-1" });
    const chained = mergeFilters({ age: { gte: 18 } }, { age: { lte: 65 } });
    expect(mergeFilters(chained, chained)).toEqual(chained);
  });

  it("keeps disjoint keys in one object even next to an AND", () => {
    const user: Filter = { status: "active", OR: [{ priority: "high" }, { priority: "low" }] };
    const scope: Filter = { workspaceId: "ws-1", OR: [{ assignee: "me" }, { shared: true }] };
    expect(mergeFilters(user, scope)).toEqual({
      AND: [
        { status: "active", OR: [{ priority: "high" }, { priority: "low" }], workspaceId: "ws-1" },
        { OR: [{ assignee: "me" }, { shared: true }] },
      ],
    });
  });

  it("does not mutate inputs", () => {
    const a: Filter = { status: "active" };
    const b: Filter = { priority: "high" };
    mergeFilters(a, b);
    expect(a).toEqual({ status: "active" });
    expect(b).toEqual({ priority: "high" });
  });

  it("associativity: (a ⊕ b) ⊕ c = a ⊕ (b ⊕ c)", () => {
    const a: Filter = { x: 1 };
    const b: Filter = { y: 2 };
    const c: Filter = { z: 3 };

    const left = mergeFilters(mergeFilters(a, b), c);
    const right = mergeFilters(a, mergeFilters(b, c));
    expect(left).toEqual(right);
  });
});

// ============================================================================
// andWhere / orWhere: the filter algebra, checked against a reference evaluator
// ============================================================================

describe("andWhere / orWhere", () => {
  type Row = Record<"x" | "y", number>;

  // What a Filter means: every key must hold; AND = all items, OR = any item.
  const matches = (filter: Filter, row: Row): boolean =>
    Object.entries(filter).every(([key, value]) =>
      key === "AND"
        ? (value as Filter[]).every((f) => matches(f, row))
        : key === "OR"
          ? (value as Filter[]).some((f) => matches(f, row))
          : row[key as keyof Row] === value,
    );

  const ROWS: Row[] = [1, 2, 3].flatMap((x) => [1, 2, 3].map((y) => ({ x, y })));
  const meaning = (filter: Filter) => ROWS.map((row) => matches(filter, row));

  const leaf = fc
    .record({ x: fc.integer({ min: 1, max: 3 }) }, { requiredKeys: [] })
    .chain((f) =>
      fc.record({ y: fc.integer({ min: 1, max: 3 }) }, { requiredKeys: [] }).map((g) => ({ ...f, ...g }) as Filter),
    );
  const filterArb: fc.Arbitrary<Filter> = fc.letrec<{ f: Filter }>((tie) => ({
    f: fc.oneof(
      { depthSize: "small" },
      leaf,
      fc.array(tie("f"), { minLength: 1, maxLength: 3 }).map((items) => ({ OR: items })),
      fc.array(tie("f"), { minLength: 1, maxLength: 3 }).map((items) => ({ AND: items })),
      fc.tuple(leaf, fc.array(tie("f"), { minLength: 1, maxLength: 2 })).map(([l, items]) => ({ ...l, OR: items })),
    ),
  })).f;

  // Top-level ANDed conditions, the way andWhere counts them.
  const conditionCount = (filter: Filter): number =>
    Object.entries(filter).reduce(
      (n, [key, value]) => n + (key === "AND" ? (value as Filter[]).reduce((m, f) => m + conditionCount(f), 0) : 1),
      0,
    );

  it("andWhere(a, b) matches exactly the rows both match", () => {
    fc.assert(
      fc.property(filterArb, filterArb, (a, b) => {
        expect(meaning(andWhere(a, b))).toEqual(ROWS.map((row) => matches(a, row) && matches(b, row)));
      }),
      { numRuns: 2000 },
    );
  });

  it("orWhere(a, b) matches exactly the rows either matches", () => {
    fc.assert(
      fc.property(filterArb, filterArb, (a, b) => {
        expect(meaning(orWhere(a, b))).toEqual(ROWS.map((row) => matches(a, row) || matches(b, row)));
      }),
      { numRuns: 2000 },
    );
  });

  it("{} is the identity of andWhere and absorbs orWhere", () => {
    fc.assert(
      fc.property(filterArb, (f) => {
        expect(meaning(andWhere(f, {}))).toEqual(meaning(f));
        expect(orWhere(f, {})).toEqual({});
        // A lone filter with conditions comes back as-is, not copied.
        if (conditionCount(f) > 0) {
          expect(andWhere(f, {})).toBe(f);
          expect(andWhere({}, f)).toBe(f);
        }
      }),
    );
  });

  it("merging a result with itself repeats no condition (so bound parameters don't double)", () => {
    fc.assert(
      fc.property(filterArb, filterArb, (a, b) => {
        const merged = andWhere(a, b);
        expect(conditionCount(andWhere(merged, merged))).toBeLessThanOrEqual(conditionCount(merged));
        expect(meaning(andWhere(merged, merged))).toEqual(meaning(merged));
        expect(meaning(orWhere(merged, merged))).toEqual(meaning(merged));
      }),
      { numRuns: 2000 },
    );
  });

  it("andWhere is associative in meaning", () => {
    fc.assert(
      fc.property(filterArb, filterArb, filterArb, (a, b, c) => {
        expect(meaning(andWhere(andWhere(a, b), c))).toEqual(meaning(andWhere(a, andWhere(b, c))));
      }),
      { numRuns: 1000 },
    );
  });

  it("composes: andWhere(scope, orWhere(mine, shared), userFilter)", () => {
    expect(andWhere({ workspaceId: "ws-1" }, orWhere({ owner: "me" }, { shared: true }), { status: "open" })).toEqual({
      workspaceId: "ws-1",
      OR: [{ owner: "me" }, { shared: true }],
      status: "open",
    });
  });

  it("the 0.3.0 names allOf / anyOf are aliases", () => {
    expect(allOf).toBe(andWhere);
    expect(anyOf).toBe(orWhere);
  });

  it("orWhere flattens nested ORs and drops repeated branches", () => {
    expect(orWhere(orWhere({ x: 1 }, { x: 2 }), { x: 3 }, { x: 1 })).toEqual({ OR: [{ x: 1 }, { x: 2 }, { x: 3 }] });
    expect(orWhere({ x: 1 })).toEqual({ x: 1 });
  });
});

// ============================================================================
// createQuery (pure, no adapter)
// ============================================================================

describe("createQuery", () => {
  it("starts with empty filter", () => {
    const q = createQuery();
    expect(q.config()).toEqual({ filter: {} });
  });

  it("accepts initial config", () => {
    const q = createQuery({
      filter: { status: "active" },
      sort: { createdAt: "desc" },
      take: 10,
      skip: 5,
    });
    expect(q.config()).toEqual({
      filter: { status: "active" },
      sort: { createdAt: "desc" },
      take: 10,
      skip: 5,
    });
  });

  it("filter() returns a new query with merged conditions", () => {
    const q1 = createQuery<unknown>();
    const q2 = q1.filter({ status: "active" });
    const q3 = q2.filter({ priority: "high" });

    // Original unchanged
    expect(q1.config().filter).toEqual({});
    // Each step accumulates
    expect(q2.config().filter).toEqual({ status: "active" });
    expect(q3.config().filter).toEqual({ status: "active", priority: "high" });
  });

  it("filter() on the same key narrows (both conditions apply) instead of overriding", () => {
    const q = createQuery<unknown>().filter({ status: "draft" }).filter({ status: "published" });
    expect(q.config().filter).toEqual({ AND: [{ status: "draft" }, { status: "published" }] });
  });

  it("sort() replaces previous sort", () => {
    const q = createQuery<unknown>().sort({ createdAt: "desc" }).sort({ title: "asc" });
    expect(q.config().sort).toEqual({ title: "asc" });
  });

  it("take() and skip() set pagination", () => {
    const q = createQuery<unknown>().take(20).skip(40);
    expect(q.config().take).toBe(20);
    expect(q.config().skip).toBe(40);
  });

  it("is frozen (immutable)", () => {
    const q = createQuery<unknown>();
    expect(Object.isFrozen(q)).toBe(true);
  });
});

// ============================================================================
// createExecutableQuery (with adapter)
// ============================================================================

describe("createExecutableQuery", () => {
  function mockAdapter<T>(): QueryAdapter<T> & {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  } {
    return {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("findMany() delegates to adapter with accumulated config", async () => {
    const adapter = mockAdapter();
    const q = createExecutableQuery(adapter, {
      filter: { workspaceId: "ws-1" },
    });

    const result = await q.filter({ status: "active" }).sort({ createdAt: "desc" }).take(10).findMany();

    expect(result).toEqual([]);
    expect(adapter.findMany).toHaveBeenCalledWith({
      filter: { workspaceId: "ws-1", status: "active" },
      sort: { createdAt: "desc" },
      take: 10,
      skip: undefined,
    });
  });

  it("config() returns the accumulated config", () => {
    const q = createExecutableQuery(mockAdapter(), { filter: { workspaceId: "ws-1" } }).take(5);
    expect(q.config()).toEqual({ filter: { workspaceId: "ws-1" }, take: 5 });
  });

  it("findFirst() delegates to adapter with accumulated config", async () => {
    const adapter = mockAdapter();
    adapter.findFirst.mockResolvedValue({ id: "1", name: "Test" });

    const result = await createExecutableQuery(adapter).filter({ id: "1" }).findFirst();

    expect(result).toEqual({ id: "1", name: "Test" });
    expect(adapter.findFirst).toHaveBeenCalledWith({
      filter: { id: "1" },
      sort: undefined,
      take: undefined,
      skip: undefined,
    });
  });

  it("chaining returns new ExecutableQuery (still executable)", async () => {
    const adapter = mockAdapter();
    const q1 = createExecutableQuery(adapter);
    const q2 = q1.filter({ a: 1 });
    const q3 = q2.filter({ b: 2 });

    // All are executable
    await q1.findMany();
    await q2.findMany();
    await q3.findMany();

    expect(adapter.findMany).toHaveBeenCalledTimes(3);
  });

  it("does not execute until findMany/findFirst is called", () => {
    const adapter = mockAdapter();
    createExecutableQuery(adapter).filter({ status: "active" }).sort({ createdAt: "desc" }).take(10);

    expect(adapter.findMany).not.toHaveBeenCalled();
    expect(adapter.findFirst).not.toHaveBeenCalled();
  });

  it("is frozen (immutable)", () => {
    const adapter = mockAdapter();
    const q = createExecutableQuery(adapter);
    expect(Object.isFrozen(q)).toBe(true);
  });
});
