// ============================================================================
// DISTINCT: THE DEDUPE BEHIND andWhere / orWhere
// ============================================================================
// Internal: `andWhere` drops repeated values of one key and `orWhere` drops
// repeated branches. Equality is `sameValue`; the hash only narrows which
// values get compared, so it can never make two different values one.

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isEnumerableOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.propertyIsEnumerable.call(value, key);

/**
 * A real Date's time (`NaN` for an Invalid Date), or `undefined` for anything
 * else. `instanceof` alone isn't enough: an object whose prototype is a Date
 * passes it, and `getTime` throws on it ("this is not a Date object"). Such an
 * object is compared as plain data instead.
 */
function dateTime(value: unknown): number | undefined {
  if (!(value instanceof Date)) {
    return undefined;
  }
  try {
    return Date.prototype.getTime.call(value);
  } catch {
    return undefined;
  }
}

/**
 * Structural equality for filter values: plain data by own enumerable keys
 * (order ignored; an array is never equal to an object), Dates by time, and
 * everything else by `Object.is`, so `NaN` equals itself, `0` and `-0` differ,
 * and functions (`RAW` filters) and symbols compare by reference. An Invalid
 * Date equals itself too.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const timeA = dateTime(a);
  const timeB = dateTime(b);
  if (timeA !== undefined || timeB !== undefined) {
    return timeA !== undefined && timeB !== undefined && Object.is(timeA, timeB);
  }
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) {
    return Object.is(a, b);
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => isEnumerableOwn(b, k) && sameValue(a[k], b[k]));
}

const mix = (h: number, x: number): number => Math.imul(h ^ x, 0x9e3779b1) ^ (h >>> 15);

function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return h;
}

/**
 * A number that is the same for any two values {@link sameValue} calls equal
 * (different values may share one). Object entries are combined in an
 * order-independent way, so there's no sorting and no string building:
 * linear in the size of the value. Exported for tests.
 */
export function hash(value: unknown, ids: Map<unknown, number> = new Map()): number {
  const time = dateTime(value);
  if (time !== undefined) {
    return mix(1, hashString(String(time)));
  }
  if (typeof value === "function" || typeof value === "symbol") {
    let id = ids.get(value);
    if (id === undefined) {
      id = ids.size;
      ids.set(value, id);
    }
    return mix(2, id);
  }
  if (isObject(value)) {
    let h = 0;
    for (const key of Object.keys(value)) {
      h = (h + mix(hashString(key), hash(value[key], ids))) | 0;
    }
    return mix(Array.isArray(value) ? 3 : 4, h);
  }
  return mix(5, hashString(`${typeof value}:${Object.is(value, -0) ? "-0" : String(value)}`));
}

/**
 * Up to this many values are compared pairwise. That's the cheapest for the
 * common calls (two or three filters, the same field twice) and doesn't hash
 * a large value that is only compared once.
 */
const PAIRWISE_MAX = 8;

/**
 * `values` without repeats (by {@link sameValue}), keeping the first of each in
 * first-seen order. Beyond a handful of values they're bucketed by
 * {@link hash} first, so an `OR` of thousands of different branches costs
 * one pass instead of comparing every pair.
 */
export function distinct<T>(values: readonly T[]): T[] {
  const kept: T[] = [];
  if (values.length <= PAIRWISE_MAX) {
    for (const value of values) {
      if (!kept.some((other) => sameValue(other, value))) {
        kept.push(value);
      }
    }
    return kept;
  }
  const ids = new Map<unknown, number>();
  const buckets = new Map<number, T[]>();
  for (const value of values) {
    const h = hash(value, ids);
    const bucket = buckets.get(h);
    if (bucket === undefined) {
      buckets.set(h, [value]);
    } else if (bucket.some((other) => sameValue(other, value))) {
      continue;
    } else {
      bucket.push(value);
    }
    kept.push(value);
  }
  return kept;
}
