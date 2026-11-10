// ============================================================================
// DRIZZLE GENERATORS AGAINST A REAL DATABASE
// ============================================================================
// Both Drizzle generators (SQL builder and RQB object syntax), executed on an
// in-memory SQLite database, so these tests check which rows come back rather
// than the shape of the generated query.

import Database from "better-sqlite3";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, test } from "vitest";
import { compileFilter } from "./drizzle-rqb.js";
import { compileFilterToSQL } from "./drizzle-sql.js";

const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age").notNull(),
});

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  authorId: integer("author_id").notNull(),
});

const tags = sqliteTable("tags", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

// Many-to-many: people -> personTags (many) -> tag (one).
const personTags = sqliteTable("person_tags", {
  id: integer("id").primaryKey(),
  personId: integer("person_id").notNull(),
  tagId: integer("tag_id").notNull(),
});

const relations = defineRelations({ people, posts, tags, personTags }, (r) => ({
  posts: { author: r.one.people({ from: r.posts.authorId, to: r.people.id }) },
  people: { personTags: r.many.personTags() },
  personTags: {
    person: r.one.people({ from: r.personTags.personId, to: r.people.id }),
    tag: r.one.tags({ from: r.personTags.tagId, to: r.tags.id }),
  },
}));

// Tag names on people (by name): wildcard characters in the tag, not the person.
const PERSON_TAGS: [string, string][] = [
  ["kid", "a_b"],
  ["adult", "axb"],
  ["senior", "100%"],
  ["a_b", "plain"],
];

const PEOPLE: [string, number][] = [
  ["kid", 10],
  ["adult", 30],
  ["senior", 80],
  ["a_b", 40],
  ["axb", 50],
  ["100%", 60],
  ["back\\slash", 20],
];

let db: ReturnType<typeof drizzle<typeof relations>>;

beforeAll(() => {
  const client = new Database(":memory:");
  client.exec("create table people (id integer primary key, name text not null, age integer not null)");
  client.exec("create table posts (id integer primary key, title text not null, author_id integer not null)");
  const insertPerson = client.prepare("insert into people (name, age) values (?, ?)");
  for (const [name, age] of PEOPLE) {
    insertPerson.run(name, age);
  }
  const insertPost = client.prepare("insert into posts (title, author_id) values (?, ?)");
  for (const [i, [name]] of PEOPLE.entries()) {
    insertPost.run(`post by ${name}`, i + 1);
  }
  client.exec("create table tags (id integer primary key, name text not null)");
  client.exec("create table person_tags (id integer primary key, person_id integer not null, tag_id integer not null)");
  for (const [i, [person, tag]] of PERSON_TAGS.entries()) {
    client.prepare("insert into tags (id, name) values (?, ?)").run(i + 1, tag);
    const personId = PEOPLE.findIndex(([n]) => n === person) + 1;
    client.prepare("insert into person_tags (person_id, tag_id) values (?, ?)").run(personId, i + 1);
  }
  db = drizzle({ client, relations });
});

/** Names matched by a filter through the SQL-builder generator. */
const viaSql = (filter: string): string[] => {
  const where = compileFilterToSQL(filter, { name: people.name, age: people.age });
  if (!where.success) {
    throw new Error(where.error.message);
  }
  return db
    .select({ name: people.name })
    .from(people)
    .where(where.data)
    .all()
    .map((r) => r.name)
    .sort();
};

/** Names matched by a filter through the RQB generator. */
const viaRqb = async (filter: string): Promise<string[]> => {
  const where = await compileFilter(filter, { name: "name", age: "age" });
  if (!where.success) {
    throw new Error(where.error.message);
  }
  const rows = await db.query.people.findMany({ where: where.data as never });
  return rows.map((r) => r.name).sort();
};

/** Authors of posts matched through a relation path in RQB. */
const viaRqbRelation = async (filter: string): Promise<string[]> => {
  const where = await compileFilter(filter, { author: "author.name", title: "title" });
  if (!where.success) {
    throw new Error(where.error.message);
  }
  const rows = await db.query.posts.findMany({ where: where.data as never });
  return rows.map((r) => r.title.replace("post by ", "")).sort();
};

const generators = [
  ["SQL builder", async (f: string) => viaSql(f)],
  ["RQB", viaRqb],
] as const;

describe.each(generators)("%s: LIKE operators match input literally", (_name, run) => {
  test.each([
    ["name contains '%'", ["100%"]],
    ["name contains 'a_b'", ["a_b"]],
    ["name starts_with '_'", []],
    ["name ends_with '%'", ["100%"]],
    ["name like '_'", ["a_b"]],
    ["name ilike 'A_B'", ["a_b"]],
    ["name contains '\\\\'", ["back\\slash"]],
    ["name contains 'dul'", ["adult"]],
  ])("%s", async (filter, expected) => {
    expect(await run(filter)).toEqual(expected);
  });
});

describe("LIKE escaping on dialects where backslash is the default escape", () => {
  // SQLite reads a backslash literally without ESCAPE, so the row tests above
  // pass either way; PostgreSQL doesn't. A value containing only a backslash
  // must still be escaped and run with ESCAPE '\'.
  test("SQL builder", () => {
    const where = compileFilterToSQL("name contains 'a\\\\b'", { name: people.name });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    const query = db.select().from(people).where(where.data).toSQL();
    expect(query.sql).toContain("like ? escape '\\'");
    expect(query.params).toEqual(["%a\\\\b%"]);
  });

  test("RQB", async () => {
    const where = await compileFilter("name contains 'a\\\\b'", { name: "name" });
    expect(where.success && Object.keys(where.data)).toEqual(["RAW"]);
  });
});

describe.each(generators)("%s: AND keeps both conditions", (_name, run) => {
  test("a range on one field", async () => {
    expect(await run("age gte 18 and age lte 65")).toEqual(["100%", "a_b", "adult", "axb", "back\\slash"]);
  });

  test("two OR groups", async () => {
    expect(await run("(name eq 'kid' or name eq 'adult') and (age eq 30 or age eq 80)")).toEqual(["adult"]);
  });

  test("two LIKE conditions on one field", async () => {
    expect(await run("name contains 'a' and name contains 'b'")).toEqual(["a_b", "axb", "back\\slash"]);
  });
});

describe("RQB: relation paths", () => {
  test("LIKE through a relation is escaped", async () => {
    expect(await viaRqbRelation("author contains '_'")).toEqual(["a_b"]);
  });

  test("AND through a relation keeps both conditions", async () => {
    expect(await viaRqbRelation("author starts_with 'a' and author ends_with 'b'")).toEqual(["a_b", "axb"]);
  });
});

describe.each(generators)("%s: chains of AND", (_name, run) => {
  test.each([
    ["age gt 15 and age lt 70 and age ne 40", ["100%", "adult", "axb", "back\\slash"]],
    ["age gt 15 and age lt 70 and age ne 40 and age ne 50", ["100%", "adult", "back\\slash"]],
    ["(age gt 15 and age lt 70) and (age ne 40 and age ne 50)", ["100%", "adult", "back\\slash"]],
    ["(age eq 10 or age eq 30) and (age eq 30 or age eq 40) and (age eq 30 or age eq 80)", ["adult"]],
    ["name contains 'a' and age gt 15 and age lt 45", ["a_b", "adult", "back\\slash"]],
  ])("%s", async (filter, expected) => {
    expect(await run(filter)).toEqual(expected);
  });
});

describe("RQB: AND output shape", () => {
  const where = async (filter: string) => {
    const result = await compileFilter(filter, { name: "name", age: "age" });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  };

  test("a single comparison is not wrapped", async () => {
    expect(await where("age eq 3")).toEqual({ age: 3 });
  });

  test("different fields merge into one object", async () => {
    expect(await where("name eq 'kid' and age eq 10")).toEqual({ name: "kid", age: 10 });
  });

  test("a chain on one field is one flat AND list", async () => {
    expect(await where("age gt 15 and age lt 70 and age ne 40 and age ne 50")).toEqual({
      AND: [{ age: { gt: 15 } }, { age: { lt: 70 } }, { age: { ne: 40 } }, { age: { ne: 50 } }],
    });
  });

  test("grouping doesn't add nesting", async () => {
    expect(await where("(age gt 15 and age lt 70) and (age ne 40 and age ne 50)")).toEqual(
      await where("age gt 15 and age lt 70 and age ne 40 and age ne 50"),
    );
  });

  test("OR groups become items of one AND list", async () => {
    expect(await where("(age eq 10 or age eq 30) and (age eq 30 or age eq 40) and (age eq 30 or age eq 80)")).toEqual({
      AND: [{ OR: [{ age: 10 }, { age: 30 }] }, { OR: [{ age: 30 }, { age: 40 }] }, { OR: [{ age: 30 }, { age: 80 }] }],
    });
  });
});

describe("RQB: many-to-many relation path (personTags.tag.name)", () => {
  const viaTag = async (filter: string, extra: Record<string, unknown> = {}) => {
    const where = await compileFilter(filter, { tag: "personTags.tag.name", name: "name", ...extra });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    const rows = await db.query.people.findMany({ where: where.data as never });
    return rows.map((r) => r.name).sort();
  };

  test.each([
    ["tag contains '_'", ["kid"]],
    ["tag ends_with '%'", ["senior"]],
    ["tag like 'a_b'", ["kid"]],
    ["tag starts_with 'a_'", ["kid"]],
    ["tag contains 'x'", ["adult"]],
    ["tag contains '_' or name eq 'senior'", ["kid", "senior"]],
    ["tag contains '_' and name eq 'kid'", ["kid"]],
    ["tag contains '_' and name eq 'adult'", []],
  ])("%s", async (filter, expected) => {
    expect(await viaTag(filter)).toEqual(expected);
  });

  test("the escaped LIKE sits beside the column, inside the relation objects", async () => {
    const where = await compileFilter("tag contains '_'", { tag: "personTags.tag.name" });
    expect(where.success && Object.keys(where.data)).toEqual(["personTags"]);
    expect(where.success && typeof (where.data as { personTags: { tag: { RAW: unknown } } }).personTags.tag.RAW).toBe(
      "function",
    );
  });
});

describe("RQB: resolvers combined with fields", () => {
  const run = async (filter: string, columns: Record<string, unknown>) => {
    const where = await compileFilter(filter, { name: "name", ...(columns as Record<string, string>) });
    if (!where.success) {
      throw new Error(where.error.message);
    }
    const rows = await db.query.people.findMany({ where: where.data as never });
    return { where: where.data, names: rows.map((r) => r.name).sort() };
  };

  test("a resolver result that collides with a field key is ANDed, not overwritten", async () => {
    const { where, names } = await run("notKid eq 1 and name ne 'adult'", { notKid: () => ({ name: { ne: "kid" } }) });
    expect(where).toEqual({ AND: [{ name: { ne: "kid" } }, { name: { ne: "adult" } }] });
    expect(names).not.toContain("kid");
    expect(names).not.toContain("adult");
  });

  test("a resolver can filter through a relation", async () => {
    const { names } = await run("tagged eq 'plain' and name ne 'kid'", {
      tagged: (_op: unknown, value: unknown) => ({ personTags: { tag: { name: value } } }),
    });
    expect(names).toEqual(["a_b"]);
  });

  test("a resolver returning {} adds no condition: dropped from an AND, and an OR containing it matches everything", async () => {
    const all = PEOPLE.map(([n]) => n).sort();
    const noCondition = { anything: () => ({}) };
    expect((await run("anything eq 1 and name eq 'kid'", noCondition)).where).toEqual({ name: "kid" });
    expect((await run("anything eq 1 or name eq 'kid'", noCondition)).names).toEqual(all);
  });
});
