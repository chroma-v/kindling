// ============================================================================
// DISTINCT: THE DEDUPE BEHIND andWhere / orWhere
// ============================================================================
// `distinct` compares up to 8 values pairwise and buckets more by a hash
// first. These check both paths keep exactly what pairwise comparison keeps
// (the first of each), that values which only look alike are never merged
// (merging one would silently drop a condition), and that large inputs stay
// fast.

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { distinct, hash, sameValue } from "./distinct.js";
import { andWhere, type Filter, orWhere } from "./query.js";

/** The reference: compare every value with every earlier one. */
function pairwise<T>(values: readonly T[]): T[] {
  const kept: T[] = [];
  for (const value of values) {
    if (!kept.some((other) => sameValue(other, value))) {
      kept.push(value);
    }
  }
  return kept;
}

/** Fresh symbols equal nothing else, so padding with them forces the hashed path without adding repeats. */
const padding = (n: number): symbol[] => Array.from({ length: n }, (_, i) => Symbol(`pad${i}`));

/** Keeps exactly `expected`, the same instances in the same order. */
function expectSameInstances(actual: readonly unknown[], expected: readonly unknown[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => {
    expect(Object.is(value, expected[i])).toBe(true);
  });
}

/** An equal copy built in reverse key order, so key order must not matter. */
function reorderedCopy(value: unknown): unknown {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  // Same own keys, so holes stay holes (equality ignores an array's length)
  const source = value as Record<string, unknown>;
  const copy = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
  for (const key of Object.keys(source).reverse()) {
    copy[key] = reorderedCopy(source[key]);
  }
  return copy;
}

const shared = [() => 1, () => 2];
const holey: unknown[] = [1];
holey[2] = 3; // [1, <hole>, 3]

// Strings biased toward the characters a serialization would need to escape
const trickyString = fc
  .array(fc.constantFrom("a", "b", "1", '"', ",", ":", "[", "{", "S", "N", "D"), { maxLength: 4 })
  .map((chars) => chars.join(""));
const valueArb = fc.oneof(
  fc.anything({ withDate: true, withBigInt: true, withSparseArray: true, withNullPrototype: true, maxDepth: 3 }),
  // `{ length }` is the shape that broke nearMisses on seed 770081324
  fc.constantFrom<unknown>(
    0,
    -0,
    Number.NaN,
    "1",
    1,
    1n,
    true,
    null,
    undefined,
    new Date(Number.NaN),
    { length: ":" },
    ...shared,
  ),
  trickyString,
);

/** Values that look like `value` but aren't equal to it: one leaf changed, or one key dropped. */
function nearMisses(value: unknown): unknown[] {
  const leaf = new Map<unknown, unknown[]>([
    [0, [-0, "0", 0n, false]],
    [1, ["1", 1n, true, new Date(1)]],
    [null, [undefined, "null", 0]],
    [undefined, [null, "undefined"]],
    [true, [1, "true"]],
    ["", [0, null, []]],
  ]);
  if (value instanceof Date) {
    return [value.getTime(), new Date(value.getTime() + 1)];
  }
  if (typeof value !== "object" || value === null) {
    if (Object.is(value, -0)) {
      return [0];
    }
    const known = leaf.get(value);
    if (known) {
      return known;
    }
    return typeof value === "string" ? [`${value}x`, value.length] : [String(value), [value]];
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  // The same entries in the other shape (an object with a `length` key can't
  // become an array, so it gets an empty one)
  const otherShape = Array.isArray(value)
    ? { ...source }
    : Object.hasOwn(source, "length")
      ? []
      : Object.assign([], source);
  const misses: unknown[] = [otherShape];
  for (const key of keys.slice(0, 3)) {
    const { [key]: _dropped, ...rest } = source;
    misses.push(Array.isArray(value) ? Object.assign([], rest) : rest);
    for (const changed of nearMisses(source[key]).slice(0, 2)) {
      misses.push(
        Array.isArray(value)
          ? Object.assign([...(value as unknown[])], { [key]: changed })
          : { ...source, [key]: changed },
      );
    }
  }
  if (Array.isArray(value)) {
    misses.push([...value, undefined]);
  }
  return misses;
}

describe("distinct", () => {
  test("keeps what pairwise comparison keeps, on both the pairwise and the hashed path", () => {
    fc.assert(
      fc.property(fc.array(valueArb, { maxLength: 20 }), fc.array(fc.nat(), { maxLength: 20 }), (values, picks) => {
        // Mix in equal copies of earlier values so there is something to drop
        const copies = values.length > 0 ? picks.map((i) => reorderedCopy(values[i % values.length])) : [];
        const all = [...values, ...copies];
        expectSameInstances(distinct(all), pairwise(all));
      }),
      { numRuns: 500 },
    );
  });

  test("never merges a value with one that only looks like it", () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        for (const miss of nearMisses(value)) {
          if (sameValue(value, miss)) {
            continue; // not actually a miss (e.g. a change below an ignored array length)
          }
          expect(distinct([value, miss])).toHaveLength(2);
          expect(distinct([miss, value])).toHaveLength(2);
          expect(distinct([value, miss, ...padding(9)])).toHaveLength(11);
          expect(distinct([miss, value, ...padding(9)])).toHaveLength(11);
        }
      }),
      { numRuns: 500 },
    );
  });

  test.each([
    ["0 and -0 differ", [0, -0], 2],
    ["NaN equals NaN", [Number.NaN, Number.NaN], 1],
    ["an Invalid Date equals itself", [new Date(Number.NaN), new Date(Number.NaN)], 1],
    ["a string, a number and a bigint differ", ["1", 1, 1n], 3],
    ["a Date differs from its time", [new Date(5), 5], 2],
    ["Dates compare by time", [new Date(5), new Date(5), new Date(6)], 2],
    ["functions compare by reference", [shared[0], shared[0], shared[1]], 2],
    [
      "key order is ignored",
      [
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ],
      1,
    ],
    ["an array differs from an object with index keys", [["x"], { 0: "x" }], 2],
    ["strings can't run together", [['a,"1":Sb'], ["a", "b"]], 2],
    ["keys can't run together", [{ "a:N1,b": 2 }, { a: 1, b: 2 }], 2],
    ["a hole differs from undefined", [holey, [1, undefined, 3]], 2],
    ["null differs from undefined", [null, undefined], 2],
    // fast-check found it (seed -1439156234): `instanceof Date` passes, `getTime` throws.
    ["an object built on a Date isn't a Date", [Object.create(new Date(0)), new Date(0)], 2],
    ["two objects built on Dates are plain data", [Object.create(new Date(0)), Object.create(new Date(1))], 1],
  ])("%s", (_name, values, expected) => {
    expect(distinct(values as unknown[])).toHaveLength(expected);
    // Same answer on the hashed path
    expect(distinct([...(values as unknown[]), ...padding(9)])).toHaveLength(expected + 9);
  });

  test("two different values with the same hash are both kept", () => {
    // The first {id} collision, found by search; searching here would build a
    // 1.5-million-entry map on every run
    const a: Filter = { id: 281_908 };
    const b: Filter = { id: 1_482_906 };
    expect(hash(a)).toBe(hash(b)); // if the hash changes, find a new pair
    expect(distinct([a, b, ...padding(9)])).toHaveLength(11);
    // The second one goes into the bucket too, so a repeat of it is dropped
    expect(distinct([a, b, { id: 1_482_906 }, ...padding(9)])).toHaveLength(11);
  });

  test("a non-enumerable property doesn't count, from either side", () => {
    const hidden = Object.defineProperty({ y: 2 }, "x", { value: 1, enumerable: false });
    expect(sameValue({ x: 1 }, hidden)).toBe(false);
    expect(sameValue(hidden, { x: 1 })).toBe(false);
    expect(sameValue({ y: 2 }, hidden)).toBe(true);
  });
});

describe("andWhere / orWhere with an Invalid Date", () => {
  // It used to be dropped: an Invalid Date never equalled itself, so the dedupe
  // kept no copy of it, silently removing a condition (AND) or a branch (OR).
  const bad: Filter = { createdAt: { gt: new Date(Number.NaN) } };

  test("andWhere keeps the condition", () => {
    expect(andWhere(bad, { status: "active" })).toEqual({ createdAt: bad.createdAt, status: "active" });
  });

  test("orWhere keeps the branch", () => {
    expect(orWhere(bad, { status: "active" })).toEqual({ OR: [bad, { status: "active" }] });
  });

  test("repeats of it collapse to one, rather than to nothing", () => {
    const again: Filter = { createdAt: { gt: new Date(Number.NaN) } };
    // These were {} (every row) and undefined (not a filter)
    expect(andWhere(bad, again)).toEqual(bad);
    expect(orWhere(bad, again)).toEqual(bad);
  });
});

// A long timeout so the budget below decides, not vitest
describe("andWhere / orWhere at scale", { timeout: 60_000 }, () => {
  // Each of these took 20 s or more when every value was compared with every
  // other. Stryker's instrumented code runs several times slower, so its
  // budget is wider (a quadratic mutant still blows through it).
  const budget = process.env.STRYKER_MUTATOR_WORKER === undefined ? 2000 : 20_000;
  const branches = Array.from({ length: 20_000 }, (_, i): Filter => ({ id: i }));
  const timed = <T>(run: () => T): T => {
    const started = Date.now();
    const result = run();
    expect(Date.now() - started).toBeLessThan(budget);
    return result;
  };

  test("an OR of 20,000 different branches keeps them all", () => {
    const result = timed(() => orWhere(branches[0] as Filter, ...branches.slice(1)));
    expect((result.OR as Filter[]).length).toBe(20_000);
  });

  test("an OR of 20,000 branches differing only in their field keeps them all", () => {
    const fields = Array.from({ length: 20_000 }, (_, i): Filter => ({ [`f${i}`]: 0 }));
    expect((timed(() => orWhere(fields[0] as Filter, ...fields.slice(1))).OR as Filter[]).length).toBe(20_000);
  });

  test("20,000 different Dates and 20,000 different functions are each bucketed apart", () => {
    // Dates hash by time and functions by identity; hashing either as a plain
    // object (no own keys) would put them all in one bucket
    const dates = Array.from({ length: 20_000 }, (_, i) => new Date(i));
    const functions = Array.from({ length: 20_000 }, () => () => 0);
    expect(timed(() => distinct(dates))).toHaveLength(20_000);
    expect(timed(() => distinct(functions))).toHaveLength(20_000);
  });

  test("an AND of 20,000 values of one field keeps them all", () => {
    expect((timed(() => andWhere(...branches)).AND as Filter[]).length).toBe(20_000);
  });

  test("an AND of 20,000 different fields is one object", () => {
    const fields = Array.from({ length: 20_000 }, (_, i): Filter => ({ [`f${i}`]: i }));
    expect(Object.keys(timed(() => andWhere(...fields)))).toHaveLength(20_000);
  });

  test("folding a 2,000-level alternating tree stays fast", () => {
    // What compileFilterNode does for a deep hand-built tree: each step
    // combines the result so far with one more condition
    const result = timed(() => {
      let where: Filter = { a: 0 };
      for (let i = 1; i <= 2_000; i++) {
        where = i % 2 === 0 ? orWhere({ a: i }, where) : andWhere({ b: i }, where);
      }
      return where;
    });
    expect(result.OR).toHaveLength(2);
  });

  test("an OR of 100 branches sharing a 10,000-id list keeps them all", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const wide = Array.from({ length: 100 }, (_, n): Filter => ({ n, id: { in: ids } }));
    expect((timed(() => orWhere(wide[0] as Filter, ...wide.slice(1))).OR as Filter[]).length).toBe(100);
  });
});
