// ============================================================================
// FILTER NODE BUILDER TESTS
// ============================================================================

import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { FilterNode } from "./ast-types.js";
import { f } from "./filter-builders.js";
import { parseFilter, validateFilter } from "./parse.js";
import { serializeFilterNode } from "./query-string.js";
import type { Schema } from "./schema-types.js";

/** parse(serialize(node)), which must equal node. */
const roundTrip = (node: FilterNode): FilterNode => {
  const parsed = parseFilter(serializeFilterNode(node));
  if (!parsed.success) {
    throw new Error(`${serializeFilterNode(node)}: ${parsed.error.message}`);
  }
  return parsed.data;
};

describe("comparison builders", () => {
  test.each([
    [f.eq("a", "x"), 'a eq "x"'],
    [f.ne("a", null), "a ne null"],
    [f.gt("a", 1), "a gt 1"],
    [f.gte("a", -2.5), "a gte -2.5"],
    [f.lt("a", "m"), 'a lt "m"'],
    [f.lte("a", 3), "a lte 3"],
    [f.like("a", "x"), 'a like "x"'],
    [f.ilike("a", "x"), 'a ilike "x"'],
    [f.contains("a", "%"), 'a contains "%"'],
    [f.startsWith("a", "x"), 'a starts_with "x"'],
    [f.endsWith("a", "x"), 'a ends_with "x"'],
    [f.in("a", ["x", 1, true]), 'a in ["x",1,true]'],
    [f.notIn("a", ["x"]), 'a not_in ["x"]'],
    [f.between("a", 1, 9), "a between [1,9]"],
    [f.isNull("a"), "a is_null"],
    [f.isNotNull("a"), "a is_not_null"],
  ])("%j serializes to %s and parses back", (node, text) => {
    expect(serializeFilterNode(node)).toBe(text);
    expect(roundTrip(node)).toEqual(node);
  });

  test("in copies the list", () => {
    const values = ["x"];
    const node = f.in("a", values);
    values.push("y");
    expect(node.value).toEqual(["x"]);
  });
});

describe("and / or", () => {
  const a = f.eq("a", 1);
  const b = f.eq("b", 2);
  const c = f.eq("c", 3);

  test("skip undefined, and return undefined when nothing is left", () => {
    expect(f.and()).toBeUndefined();
    expect(f.and(undefined, undefined)).toBeUndefined();
    expect(f.or(undefined)).toBeUndefined();
    expect(f.and(undefined, a, undefined)).toBe(a);
    expect(f.or(a, undefined, b)).toEqual({ type: "logical", operator: "or", left: a, right: b });
  });

  test("a single operand comes back as-is, even an OR passed to and", () => {
    const either = f.or(a, b);
    expect(f.and(either)).toBe(either);
    expect(f.and(undefined, either, undefined)).toBe(either);
  });

  test("chain left to right, as the parser does", () => {
    const parsed = parseFilter("a eq 1 and b eq 2 and c eq 3");
    expect(parsed.success && parsed.data).toEqual(f.and(a, b, c));
    expect(serializeFilterNode(f.and(a, b, c)!)).toBe("a eq 1 and b eq 2 and c eq 3");
  });

  test("an OR inside an AND keeps its meaning", () => {
    const node = f.and(a, f.or(b, c))!;
    expect(serializeFilterNode(node)).toBe("a eq 1 and (b eq 2 or c eq 3)");
    expect(roundTrip(node)).toEqual(node);
    // First position too: without the group, "b OR c AND a" would bind as b OR (c AND a)
    expect(serializeFilterNode(f.and(f.or(b, c), a)!)).toBe("(b eq 2 or c eq 3) and a eq 1");
  });

  test("an operand with the same operator is spliced into the chain, wherever it is", () => {
    expect(f.and(f.and(a, b), c)).toEqual(f.and(a, b, c));
    expect(f.and(a, f.and(b, c))).toEqual(f.and(a, b, c));
    expect(f.or(a, f.or(b, c))).toEqual(f.or(a, b, c));
    expect(serializeFilterNode(f.and(a, f.and(b, c))!)).toBe("a eq 1 and b eq 2 and c eq 3");
  });

  test("an AND inside an OR needs no group", () => {
    const node = f.or(a, f.and(b, c))!;
    expect(serializeFilterNode(node)).toBe("a eq 1 or b eq 2 and c eq 3");
    expect(roundTrip(node)).toEqual(node);
  });

  test("building a long chain in any order adds no nesting", () => {
    const schema: Schema = { a: { type: "number" } };
    let rightFolded = f.eq("a", 0) as FilterNode;
    let leftFolded = f.eq("a", 0) as FilterNode;
    for (let i = 1; i < 60; i++) {
      rightFolded = f.and(f.eq("a", i), rightFolded)!;
      leftFolded = f.and(leftFolded, f.eq("a", i))!;
    }
    // Was LIMIT_EXCEEDED "nested more than 32 levels deep" for the right fold
    expect(validateFilter(rightFolded, schema).success).toBe(true);
    expect(validateFilter(leftFolded, schema).success).toBe(true);
  });

  test("the combined tree validates once against a schema", () => {
    const schema: Schema = { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } };
    expect(validateFilter(f.and(a, f.or(b, c))!, schema).success).toBe(true);
    expect(validateFilter(f.and(a, f.eq("d", 1))!, schema).success).toBe(false);
  });
});

describe("round-trip property", () => {
  const FIELDS = ["name", "age", "status", "code", "region"];
  const field = fc.constantFrom(...FIELDS);
  const text = fc
    .array(fc.constantFrom(..."abAB01 _%-.,:'\"\\[]()".split("")), { maxLength: 12 })
    .map((cs) => cs.join(""));
  const num = fc.oneof(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.constantFrom(0.5, -2.25, 100.01));
  const scalar = fc.oneof(text, num, fc.boolean(), fc.constant(null));

  const comparison: fc.Arbitrary<FilterNode> = fc.oneof(
    fc.tuple(field, scalar).map(([k, v]) => f.eq(k, v)),
    fc.tuple(field, scalar).map(([k, v]) => f.ne(k, v)),
    fc.tuple(field, fc.oneof(text, num)).map(([k, v]) => f.gt(k, v)),
    fc.tuple(field, fc.oneof(text, num)).map(([k, v]) => f.lte(k, v)),
    fc.tuple(field, text).map(([k, v]) => f.contains(k, v)),
    fc.tuple(field, text).map(([k, v]) => f.startsWith(k, v)),
    fc.tuple(field, text).map(([k, v]) => f.ilike(k, v)),
    fc.tuple(field, fc.array(scalar, { minLength: 1, maxLength: 4 })).map(([k, v]) => f.in(k, v)),
    fc.tuple(field, fc.array(scalar, { minLength: 1, maxLength: 4 })).map(([k, v]) => f.notIn(k, v)),
    fc.tuple(field, num, num).map(([k, lo, hi]) => f.between(k, lo, hi)),
    field.map((k) => f.isNull(k)),
    field.map((k) => f.isNotNull(k)),
  );

  const { tree } = fc.letrec<{ tree: FilterNode }>((tie) => ({
    tree: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      comparison,
      fc
        .array(fc.option(tie("tree"), { nil: undefined }), { minLength: 2, maxLength: 4 })
        .map((nodes) => f.and(...nodes) ?? f.isNull("name")),
      fc
        .array(fc.option(tie("tree"), { nil: undefined }), { minLength: 2, maxLength: 4 })
        .map((nodes) => f.or(...nodes) ?? f.isNull("name")),
      tie("tree").map((node) => f.group(node)),
    ),
  }));

  test("parseFilter(serializeFilterNode(node)) equals node", () => {
    fc.assert(
      fc.property(tree, (node) => {
        expect(roundTrip(node)).toEqual(node);
      }),
      { numRuns: 500 },
    );
  });
});
