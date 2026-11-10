// ============================================================================
// SEMANTIC PROPERTY TESTS (fast-check)
// ============================================================================
//
// The round-trip properties check the shape of strings; these check meaning.
// Random filter trees, including hand-built shapes the parser never produces
// (right-nested chains, an OR directly under an AND), are run through each
// target against a real SQLite table, and the rows that come back must be the
// rows a small reference evaluator picks.
//
// The evaluator follows SQL's three-valued logic (a comparison with NULL is
// unknown, and WHERE keeps only true) and SQLite's LIKE, which ignores ASCII
// case. Strings use `%`, `_` and `\` so LIKE escaping is exercised too.
//
// This found the serializer dropping the parentheses of an OR under an AND,
// which the string round-trip never generated.
// ============================================================================

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { ComparisonNode, FilterNode } from "./ast-types.js";
import { compileFilterNodeToSQL } from "./drizzle-sql.js";
import { parseFilter, validateFilter } from "./parse.js";
import { serializeFilterNode } from "./query-string.js";
import type { Schema } from "./schema-types.js";
import { compileFilterNode } from "./sql/compile-where.js";
import type { Dialect } from "./sql/dialect.js";
import { sqliteDialect } from "./sql/sqlite-dialect.js";

// ---------------------------------------------------------------------------
// The table: every combination of a nullable integer and a nullable string
// ---------------------------------------------------------------------------

type Row = { id: number; n: number | null; s: string | null };

const NUMBERS = [null, 0, 1, 2];
const STRINGS = [null, "", "a", "A", "ab", "a_b", "a%b", "b\\a"];

const rows: Row[] = NUMBERS.flatMap((n) => STRINGS.map((s) => ({ n, s }))).map((row, i) => ({ id: i + 1, ...row }));

const table = sqliteTable("t", { id: integer("id").primaryKey(), n: integer("n"), s: text("s") });
const client = new Database(":memory:");
client.exec("create table t (id integer primary key, n integer, s text)");
const insert = client.prepare("insert into t (id, n, s) values (?, ?, ?)");
for (const row of rows) {
  insert.run(row.id, row.n, row.s);
}
const db = drizzle({ client });

const schema: Schema = {
  n: {
    type: "number",
    nullable: true,
    operators: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "between", "is_null", "is_not_null"],
  },
  s: {
    type: "string",
    nullable: true,
    operators: [
      "eq",
      "ne",
      "gt",
      "lt",
      "in",
      "not_in",
      "like",
      "ilike",
      "contains",
      "starts_with",
      "ends_with",
      "is_null",
      "is_not_null",
    ],
  },
};

/** A dialect with numbered placeholders, to check they come out in order. */
const numbered: Dialect = { ...sqliteDialect, name: "numbered", parameter: (index) => `$${index + 1}` };

// ---------------------------------------------------------------------------
// Reference evaluator: true, false, or null (unknown)
// ---------------------------------------------------------------------------

type Truth = boolean | null;
type Scalar = number | string;

const lowerAscii = (value: string) => value.replaceAll(/[A-Z]/g, (c) => c.toLowerCase());

function compare(column: Scalar | null, node: ComparisonNode): Truth {
  const { operator, value } = node;
  if (operator === "is_null" || operator === "is_not_null") {
    return (column === null) === (operator === "is_null");
  }
  if (value === null) {
    // eq / ne null compile to IS NULL / IS NOT NULL
    return (column === null) === (operator === "eq");
  }
  if (operator === "in" || operator === "not_in") {
    const list = value as Scalar[];
    if (list.length === 0) {
      return operator === "not_in";
    }
    if (column === null) {
      return null;
    }
    return list.includes(column) === (operator === "in");
  }
  if (column === null) {
    return null;
  }
  switch (operator) {
    case "eq":
      return column === value;
    case "ne":
      return column !== value;
    case "gt":
      return column > (value as Scalar);
    case "gte":
      return column >= (value as Scalar);
    case "lt":
      return column < (value as Scalar);
    case "lte":
      return column <= (value as Scalar);
    case "between": {
      const [min, max] = value as [Scalar, Scalar];
      return column >= min && column <= max;
    }
    default: {
      // SQLite's LIKE ignores ASCII case, so every LIKE operator does here
      const text = lowerAscii(String(column));
      const part = lowerAscii(String(value));
      if (operator === "starts_with") {
        return text.startsWith(part);
      }
      if (operator === "ends_with") {
        return text.endsWith(part);
      }
      return text.includes(part);
    }
  }
}

function evaluate(node: FilterNode, row: Row): Truth {
  switch (node.type) {
    case "comparison":
      return compare(row[node.field as "n" | "s"], node);
    case "group":
      return evaluate(node.expression, row);
    case "logical": {
      const left = evaluate(node.left, row);
      const right = evaluate(node.right, row);
      if (node.operator === "and") {
        return left === false || right === false ? false : left === null || right === null ? null : true;
      }
      return left === true || right === true ? true : left === null || right === null ? null : false;
    }
  }
}

const expectedIds = (node: FilterNode) => rows.filter((row) => evaluate(node, row) === true).map((row) => row.id);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const numberArb = fc.constantFrom(0, 1, 2, 3);
const stringArb = fc.array(fc.constantFrom("a", "A", "b", "_", "%", "\\"), { maxLength: 3 }).map((cs) => cs.join(""));

const comparisonArb: fc.Arbitrary<ComparisonNode> = fc.oneof(
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constant("n"),
    operator: fc.constantFrom(
      "eq" as const,
      "ne" as const,
      "gt" as const,
      "gte" as const,
      "lt" as const,
      "lte" as const,
    ),
    value: numberArb,
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constant("n"),
    operator: fc.constantFrom("in" as const, "not_in" as const),
    value: fc.array(numberArb, { maxLength: 3 }),
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constant("n"),
    operator: fc.constant("between" as const),
    value: fc.tuple(numberArb, numberArb),
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constant("s"),
    operator: fc.constantFrom(
      "eq" as const,
      "ne" as const,
      "gt" as const,
      "lt" as const,
      "like" as const,
      "ilike" as const,
      "contains" as const,
      "starts_with" as const,
      "ends_with" as const,
    ),
    value: stringArb,
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constant("s"),
    operator: fc.constantFrom("in" as const, "not_in" as const),
    value: fc.array(stringArb, { maxLength: 3 }),
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constantFrom("n", "s"),
    operator: fc.constantFrom("eq" as const, "ne" as const),
    value: fc.constant(null),
  }),
  fc.record({
    type: fc.constant("comparison" as const),
    field: fc.constantFrom("n", "s"),
    operator: fc.constantFrom("is_null" as const, "is_not_null" as const),
    value: fc.constant(null),
  }),
);

/** Any tree shape, including ones the parser never builds (right-nested chains, OR under AND). */
const treeArb: fc.Arbitrary<FilterNode> = fc.letrec<{ node: FilterNode }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 5, depthIdentifier: "tree" },
    comparisonArb,
    fc.record({
      type: fc.constant("logical" as const),
      operator: fc.constantFrom("and" as const, "or" as const),
      left: tie("node"),
      right: tie("node"),
    }),
    fc.record({ type: fc.constant("group" as const), expression: tie("node") }),
  ),
})).node;

const RUNS = { numRuns: 500 };

function unwrap<T>(result: { success: true; data: T } | { success: false; error: { message: string } }): T {
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("every target selects the rows the filter means", () => {
  test("raw SQL: the right rows, with numbered placeholders in text order", () => {
    fc.assert(
      fc.property(treeArb, (node) => {
        const { sql, parameters } = unwrap(compileFilterNode(node, { n: "n", s: "s" }, numbered));
        const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
        expect(placeholders).toEqual(placeholders.map((_, i) => i + 1));
        // better-sqlite3 binds $1 as a named parameter "1"
        const named = Object.fromEntries(parameters.map((value, i) => [String(i + 1), value]));
        const ids = client
          .prepare(`select id from t where ${sql} order by id`)
          .all(named)
          .map((row) => (row as { id: number }).id);
        expect(ids).toEqual(expectedIds(node));
      }),
      RUNS,
    );
  });

  test("Drizzle: the right rows", () => {
    fc.assert(
      fc.property(treeArb, (node) => {
        const where = unwrap(compileFilterNodeToSQL(node, { n: table.n, s: table.s }));
        const ids = db
          .select({ id: table.id })
          .from(table)
          .where(where)
          .orderBy(table.id)
          .all()
          .map((row) => row.id);
        expect(ids).toEqual(expectedIds(node));
      }),
      RUNS,
    );
  });

  test("serialize then parse keeps the meaning", () => {
    fc.assert(
      fc.property(treeArb, (node) => {
        const text = serializeFilterNode(node);
        expect(expectedIds(unwrap(parseFilter(text, undefined, { maxDepth: 100 }))), text).toEqual(expectedIds(node));
      }),
      RUNS,
    );
  });

  test("validateFilter keeps the meaning of the tree it returns", () => {
    fc.assert(
      fc.property(treeArb, (node) => {
        expect(expectedIds(unwrap(validateFilter(node, schema, { maxDepth: 100 })))).toEqual(expectedIds(node));
      }),
      RUNS,
    );
  });
});
