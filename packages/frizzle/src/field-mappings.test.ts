// ============================================================================
// FIELD MAPPINGS: ONE MAP FOR FILTER + SORT, RESOLVER CONTEXT, CASE-INSENSITIVE
// ============================================================================
// Runs against an in-memory SQLite database, so these check which rows come
// back (and in what order) rather than the shape of the generated SQL.

import Database from "better-sqlite3";
import { defineRelations, eq, inArray, or, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { FilterNode, QueryAst } from "./ast-types.js";
import { compileFilter, compileSort, type WhereResolver } from "./drizzle-rqb.js";
import {
  compileFilterNodeToSQL,
  compileFilterToSQL,
  generateDrizzleQuery,
  type SQLColumnMapping,
  type SQLColumnResolver,
} from "./drizzle-sql.js";
import { f } from "./filter-builders.js";

const countries = sqliteTable("countries", {
  id: integer("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
});

const aliases = sqliteTable("aliases", {
  countryId: integer("country_id").notNull(),
  alias: text("alias").notNull(),
});

const relations = defineRelations({ countries, aliases });

const COUNTRIES: [string, string][] = [
  ["FR", "France"],
  ["DE", "Germany"],
  ["CI", "Côte d'Ivoire"],
  ["GB", "United Kingdom"],
  ["A_", "Under_score"],
];

let db: ReturnType<typeof drizzle<typeof relations>>;
type Db = typeof db;

beforeAll(() => {
  const client = new Database(":memory:");
  client.exec("create table countries (id integer primary key, code text not null, name text not null)");
  client.exec("create table aliases (country_id integer not null, alias text not null)");
  const insert = client.prepare("insert into countries (code, name) values (?, ?)");
  for (const [code, name] of COUNTRIES) {
    insert.run(code, name);
  }
  client.prepare("insert into aliases (country_id, alias) values (4, 'Britain'), (2, 'Deutschland')").run();
  db = drizzle({ client, relations });
});

/** name matches the country name or one of its aliases; needs the request's db. */
const nameOrAlias: SQLColumnResolver<{ db: Db }> = (_operator, value, { db }) =>
  or(
    eq(countries.name, String(value)),
    inArray(
      countries.id,
      db
        .select({ id: aliases.countryId })
        .from(aliases)
        .where(eq(aliases.alias, String(value))),
    ),
  ) as SQL;

const codes = (rows: { code: string }[]) => rows.map((r) => r.code);

describe("SQL: { column, where } serves filtering and sorting", () => {
  const fields = {
    code: countries.code,
    name: { column: countries.name, where: nameOrAlias },
  };

  test("one map, one call: filter through the resolver, sort by the column", () => {
    const ast: QueryAst = {
      filter: f.or(f.eq("name", "Britain"), f.eq("name", "Deutschland"), f.eq("name", "France")),
      sort: [{ field: "name", direction: "desc" }],
    };
    const query = generateDrizzleQuery(ast, db.select().from(countries).$dynamic(), fields, { db });
    if (!query.success) {
      throw new Error(query.error.message);
    }
    expect(codes(query.data.all())).toEqual(["GB", "DE", "FR"]);
  });

  test("without where, the column is used for both", () => {
    const query = generateDrizzleQuery(
      { filter: f.startsWith("name", "U"), sort: [{ field: "name", direction: "asc" }] },
      db.select().from(countries).$dynamic(),
      { name: { column: countries.name } },
    );
    expect(query.success && codes(query.data.all())).toEqual(["A_", "GB"]);
  });

  test("a resolver on its own still can't be sorted", () => {
    const query = generateDrizzleQuery(
      { sort: [{ field: "name", direction: "asc" }] },
      db.select().from(countries).$dynamic(),
      { name: nameOrAlias },
      { db },
    );
    expect(!query.success && query.error.code).toBe("UNSORTABLE_FIELD");
  });
});

describe("SQL: resolver context", () => {
  test("compileFilterToSQL passes options.context", () => {
    const where = compileFilterToSQL("name eq 'Britain'", { name: nameOrAlias }, { context: { db } });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    expect(codes(db.select().from(countries).where(where.data).all())).toEqual(["GB"]);
  });

  test("compileFilterNodeToSQL passes its third argument", () => {
    const resolver = vi.fn((_op, _value, ctx: { tenant: string }) => eq(countries.code, ctx.tenant));
    const where = compileFilterNodeToSQL(f.eq("x", 1), { x: resolver }, { tenant: "DE" });
    expect(resolver).toHaveBeenCalledWith("eq", 1, { tenant: "DE" });
    expect(where.success && codes(db.select().from(countries).where(where.data).all())).toEqual(["DE"]);
  });

  test("two-argument resolvers keep working, with or without a context", () => {
    const twoArgs = (_op: unknown, value: unknown) => eq(countries.code, String(value));
    const fields: Record<string, SQLColumnMapping> = { code: twoArgs };
    for (const where of [
      compileFilterToSQL("code eq 'FR'", fields),
      compileFilterToSQL("code eq 'FR'", fields, { context: { db } }),
    ]) {
      expect(where.success && codes(db.select().from(countries).where(where.data).all())).toEqual(["FR"]);
    }
  });
});

describe("SQL: resolver context types", () => {
  // Checked by `tsc` (npm run typecheck), not at runtime: each @ts-expect-error
  // must be an error, or typechecking fails.
  test("an untyped resolver can be called with two arguments", () => {
    const untyped: SQLColumnResolver = (_op, value) => eq(countries.code, String(value));
    expect(untyped("eq", "FR")).toBeDefined();
  });

  test("a resolver that declares a context can't be compiled without one", () => {
    const needsDb: SQLColumnResolver<{ db: Db }> = (_op, value, { db }) =>
      inArray(
        countries.id,
        db
          .select({ id: aliases.countryId })
          .from(aliases)
          .where(eq(aliases.alias, String(value))),
      );
    const fields = { name: needsDb };
    const typeOnly = () => {
      // @ts-expect-error context is required
      compileFilterToSQL("name eq 'x'", fields);
      // @ts-expect-error context is required
      compileFilterToSQL("name eq 'x'", fields, { schema: undefined });
      // @ts-expect-error context is required
      compileFilterNodeToSQL(f.eq("name", "x"), fields);
      // @ts-expect-error context is required
      generateDrizzleQuery({}, db.select().from(countries).$dynamic(), fields);
    };
    expect(typeOnly).toBeTypeOf("function");
    expect(compileFilterToSQL("name eq 'Britain'", fields, { context: { db } }).success).toBe(true);
  });
});

describe("SQL: caseInsensitive", () => {
  const fields = { name: { column: countries.name, caseInsensitive: true } };
  const run = (filter: string) => {
    const where = compileFilterToSQL(filter, fields);
    if (!where.success) {
      throw new Error(where.error.message);
    }
    return codes(db.select().from(countries).where(where.data).orderBy(countries.id).all());
  };

  test.each([
    ["name eq 'FRANCE'", ["FR"]],
    ["name ne 'france'", ["DE", "CI", "GB", "A_"]],
    ["name contains 'KING'", ["GB"]],
    ["name starts_with 'uNiTeD'", ["GB"]],
    ["name ends_with 'ANY'", ["DE"]],
    // Still literal: '_' is escaped, not a wildcard
    ["name contains 'R_S'", ["A_"]],
    ["name contains 'd_'", []],
  ])("%s", (filter, expected) => {
    expect(run(filter)).toEqual(expected);
  });

  test("non-string values compare as-is", () => {
    // On SQLite, lower(?) of a bound 30 is "30.0", so a folded eq never matched
    const where = compileFilterToSQL("id eq 3 or id ne 3", { id: { column: countries.id, caseInsensitive: true } });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    expect(codes(db.select().from(countries).where(where.data).orderBy(countries.id).all())).toEqual([
      "FR",
      "DE",
      "CI",
      "GB",
      "A_",
    ]);
    const eqOnly = compileFilterToSQL("id eq 3", { id: { column: countries.id, caseInsensitive: true } });
    expect(eqOnly.success && codes(db.select().from(countries).where(eqOnly.data).all())).toEqual(["CI"]);
    const neOnly = compileFilterToSQL("id ne 3", { id: { column: countries.id, caseInsensitive: true } });
    expect(neOnly.success && codes(db.select().from(countries).where(neOnly.data).all())).toHaveLength(4);
  });

  test("without it, eq is case-sensitive", () => {
    const where = compileFilterToSQL("name eq 'FRANCE'", { name: countries.name });
    expect(where.success && db.select().from(countries).where(where.data).all()).toEqual([]);
  });
});

describe("RQB: { field, where } serves compileFilter and compileSort", () => {
  const byAlias: WhereResolver<{ ids: number[] }> = (_op, _value, ctx) => ({ id: { in: ctx.ids } });
  const fields = { code: "code", name: { field: "name", where: byAlias } };

  test("filter uses the resolver", async () => {
    const where = await compileFilter("name eq 'Britain'", fields, { context: { ids: [4] } });
    expect(where.success && where.data).toEqual({ id: { in: [4] } });
  });

  test("sort uses the field", () => {
    expect(compileSort("name:desc,code", fields)).toEqual({ success: true, data: { name: "desc", code: "asc" } });
  });

  test("without where, the field is used for both", async () => {
    const where = await compileFilter("name eq 'France'", { name: { field: "name" } });
    expect(where.success && where.data).toEqual({ name: "France" });
  });
});

describe("SQL: trees of any size", () => {
  test("a 50,000-condition hand-built chain compiles and renders, not a RangeError", () => {
    let chain: FilterNode = f.eq("code", "FR");
    for (let i = 0; i < 50_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: f.eq("code", "DE") };
    }
    const where = compileFilterNodeToSQL(chain, { code: countries.code });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    // One flat or(...), so Drizzle can render it too (it overflows on ~5,000 nested ones)
    expect(db.select().from(countries).where(where.data).toSQL().params).toHaveLength(50_001);
  });
});

describe("SQL: chains at the default limits", () => {
  /** How deeply Drizzle's SQL chunks nest: what its recursive renderer has to walk. */
  const sqlDepth = (root: unknown): number => {
    let max = 0;
    const pending: [unknown, number][] = [[root, 1]];
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [node, depth] = next;
      const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
      if (Array.isArray(chunks)) {
        max = Math.max(max, depth);
        for (const chunk of chunks) {
          pending.push([chunk, depth + 1]);
        }
      }
    }
    return max;
  };
  const chainOf = (terms: number, operator: "and" | "or") =>
    Array.from({ length: terms }, () => "name is_null").join(` ${operator} `);

  test.each(["and", "or"] as const)("a %s chain nests no deeper at 1,000 terms than at 3", (operator) => {
    // In a plain `node` process, Drizzle's renderer overflowed the stack on
    // ~820 nested and()/or() — inside the default maxConditions of 1,000.
    // Vitest's workers have a larger stack, so check the depth, not a crash.
    const depth = (terms: number) => {
      const where = compileFilterToSQL(chainOf(terms, operator), { name: countries.name });
      if (!where.success) {
        throw new Error(where.error.message);
      }
      return sqlDepth(where.data);
    };
    expect(depth(1000)).toBe(depth(3));
  });

  test("a long flat chain runs on a real database", () => {
    // The depth check above is synthetic; this runs the SQL. 900 terms, since
    // SQLite parses `a OR b OR ...` into a binary tree and rejects one 1,000
    // deep, which Drizzle's parentheses reach at 999 terms.
    const where = compileFilterToSQL(chainOf(900, "or"), { name: countries.name });
    expect(where.success && db.select().from(countries).where(where.data).all()).toEqual([]);
  });
});
