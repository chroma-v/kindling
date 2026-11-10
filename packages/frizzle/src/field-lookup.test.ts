// ============================================================================
// FIELD LOOKUPS IGNORE INHERITED PROPERTIES
// ============================================================================
// Column maps and schemas are plain objects, so `columns[field]` also finds
// Object.prototype members. A filter on `isPrototypeOf` or `constructor`
// (both valid field names in the grammar) used to find a function there:
// the generators called it as a virtual-column resolver (RQB `isPrototypeOf`
// compiled to `false`, which matched every row) and the schema validator
// threw. Every lookup of a user-supplied field name must be own-property only.

import Database from "better-sqlite3";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, test } from "vitest";
import { Compiler } from "./compiler.js";
import { compileFilter, compileSort } from "./drizzle-rqb.js";
import { compileFilterToSQL } from "./drizzle-sql.js";
import { parseFilter } from "./parse.js";
import type { Result } from "./result-types.js";
import { createSuccess } from "./result-types.js";
import { compileFilterNode } from "./sql/compile-where.js";
import { sqliteDialect } from "./sql/sqlite-dialect.js";

const INHERITED = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "toLocaleString"];

const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});
const relations = defineRelations({ people });

let db: ReturnType<typeof drizzle<typeof relations>>;

beforeAll(() => {
  const client = new Database(":memory:");
  client.prepare("create table people (id integer primary key, name text not null)").run();
  for (const name of ["a", "b", "c"]) {
    client.prepare("insert into people (name) values (?)").run(name);
  }
  db = drizzle({ client, relations });
});

const expectUnknownField = (result: Result<unknown>, field: string) => {
  expect(result.success, `${field} should be rejected`).toBe(false);
  if (!result.success) {
    expect(result.error.code).toBe("UNKNOWN_FIELD");
  }
};

describe.each(INHERITED)("field '%s'", (field) => {
  const filter = `${field} = 1`;

  test("is an unknown field to the schema validator (no throw)", () => {
    expectUnknownField(parseFilter(filter, { name: { type: "string" } }), field);
  });

  test("is an unknown field to Compiler with a schema (no throw)", () => {
    const compiler = new Compiler({
      codeGenerator: { generate: () => createSuccess(null) },
      schema: { name: { type: "string" } },
    });
    expectUnknownField(compiler.parseFilter(filter), field);
  });

  test("is an unknown column to RQB compileFilter", async () => {
    expectUnknownField(await compileFilter(filter, { name: "name" }), field);
  });

  test("is an unknown column to compileFilterToSQL", () => {
    expectUnknownField(compileFilterToSQL(filter, { name: people.name }), field);
  });

  test("is an unknown column to the raw SQL generator", () => {
    const parsed = parseFilter(filter);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    expectUnknownField(compileFilterNode(parsed.data, { name: "name" }, sqliteDialect), field);
  });

  test("is an unknown sort field to RQB compileSort", () => {
    expectUnknownField(compileSort(`${field}:asc`, { name: "name" }), field);
  });
});

test("known columns still compile and match (RQB, real SQLite)", async () => {
  const where = await compileFilter("name = 'b'", { name: "name" });
  if (!where.success) {
    throw new Error(where.error.message);
  }
  const rows = await db.query.people.findMany({ where: where.data as never });
  expect(rows.map((r) => r.name)).toEqual(["b"]);
});
