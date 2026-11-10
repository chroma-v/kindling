# SQL Target

The `@chromav/frizzle/sql` entry point compiles descriptors into parameterized SQL strings. Use it when your database isn't supported by Drizzle ORM — or when you need raw SQL for any reason.

## When to use

| Scenario | Use |
|----------|-----|
| Drizzle-supported database (Postgres, SQLite, MySQL) | `@chromav/frizzle/drizzle` |
| Trino, Spark, Iceberg, or other analytical databases | `@chromav/frizzle/sql` |
| Custom query execution (e.g., HTTP API to a query engine) | `@chromav/frizzle/sql` |
| Need raw SQL for debugging or logging | `@chromav/frizzle/sql` |

## Quick start

```typescript
import { compileSelect } from "@chromav/frizzle/sql";
import { sqliteDialect } from "@chromav/frizzle/sql";

const columns = {
  status: "status",
  priority: "priority",
  createdAt: "created_at",
};

const { sql, parameters } = compileSelect("tasks", {
  filter: { status: "active", priority: { gte: 3 } },
  sort: { createdAt: "desc" },
  take: 20,
}, columns, sqliteDialect);

// Execute with your database driver
const rows = db.prepare(sql).all(...parameters);
```

## Column mapping

The `SqlColumnMap` maps descriptor field names (what your application uses) to SQL column names (what the database uses):

```typescript
const columns = {
  status: "status",           // same name
  createdAt: "created_at",    // camelCase → snake_case
  assignedTo: "assigned_to_user_id",  // rename
};
```

Unmapped fields in the Filter POJO path fall through as-is. The FilterNode AST path returns an error for unknown fields (strict mode).

## Dialect interface

A `Dialect` tells the compiler how to generate SQL for a specific database:

```typescript
import type { Dialect } from "@chromav/frizzle/sql";

interface Dialect {
  name: string;
  quoteIdentifier(name: string): string;   // "col" vs `col` vs [col]
  parameter(index: number): string;         // ? vs $1 vs :p0
  booleanLiteral(value: boolean): string;   // TRUE/FALSE vs 1/0
  supportsILike: boolean;                   // ILIKE vs LOWER(col) LIKE LOWER(?)
  escapeLikePattern(pattern: string): string;
}
```

### Built-in: SQLite

```typescript
import { sqliteDialect } from "@chromav/frizzle/sql";
// Double-quoted identifiers, ? parameters, 0/1 booleans, no ILIKE
```

### Custom: Trino/Spark

```typescript
const trinoDialect: Dialect = {
  name: "trino",
  quoteIdentifier: (name) => `"${name}"`,
  parameter: (index) => `$${index + 1}`,
  booleanLiteral: (v) => v ? "TRUE" : "FALSE",
  supportsILike: true,
  escapeLikePattern: (p) => p.replace(/[%_\\]/g, "\\$&"),
};
```

### Custom: PostgreSQL

```typescript
const postgresDialect: Dialect = {
  name: "postgres",
  quoteIdentifier: (name) => `"${name}"`,
  parameter: (index) => `$${index + 1}`,
  booleanLiteral: (v) => v ? "TRUE" : "FALSE",
  supportsILike: true,
  escapeLikePattern: (p) => p.replace(/[%_\\]/g, "\\$&"),
};
```

## Compilers

### SELECT

```typescript
import { compileSelect } from "@chromav/frizzle/sql";

const { sql, parameters } = compileSelect("tasks", {
  filter: { status: "active" },
  sort: { createdAt: "desc" },
  take: 20,
  skip: 40,
  select: { id: true, title: true, status: true },
}, columns, sqliteDialect);

// SELECT "id", "title", "status" FROM "tasks"
//   WHERE "status" = ?
//   ORDER BY "created_at" DESC
//   LIMIT ? OFFSET ?
```

`descriptor.include` is intentionally ignored — relation resolution is the consumer's responsibility (JOINs, separate queries, etc.).

### WHERE clause only

Two compilation paths, matching the two ways filters are represented:

```typescript
import { compileFilter, compileFilterNode } from "@chromav/frizzle/sql";

// Path A: Filter POJO (from QueryDescriptor.filter)
const { sql, parameters } = compileFilter(
  { status: "active", priority: { gte: 3 } },
  columns,
  sqliteDialect,
);
// "status" = ? AND "priority" >= ?

// Path B: FilterNode AST (from parsed filter expression string)
import { parseFilter, isSuccess } from "@chromav/frizzle";

const parsed = parseFilter("status eq 'active' and priority gte 3");
if (isSuccess(parsed)) {
  const result = compileFilterNode(parsed.data, columns, sqliteDialect);
  // ("status" = ? AND "priority" >= ?)
}
```

### INSERT

```typescript
import { compileInsert } from "@chromav/frizzle/sql";
import { createWriteDescriptor } from "@chromav/frizzle";

const desc = createWriteDescriptor("insert", {
  id: "task-1",
  title: "New task",
  status: "backlog",
});

const { sql, parameters } = compileInsert("tasks", desc, sqliteDialect);
// INSERT INTO "tasks" ("id", "title", "status") VALUES (?, ?, ?)
```

### UPDATE

```typescript
import { compileUpdate } from "@chromav/frizzle/sql";
import { createWriteDescriptor, mergeWriteDescriptor } from "@chromav/frizzle";

const desc = mergeWriteDescriptor(
  createWriteDescriptor("update", { status: "done", priority: 5 }),
  { targetIds: ["task-1"] },
);

const { sql, parameters } = compileUpdate("tasks", desc, sqliteDialect);
// UPDATE "tasks" SET "status" = ?, "priority" = ? WHERE "id" = ?
```

Multiple target IDs use `IN`:

```typescript
const desc = mergeWriteDescriptor(
  createWriteDescriptor("update", { isDeleted: true }),
  { targetIds: ["task-1", "task-2", "task-3"] },
);
// UPDATE "tasks" SET "isDeleted" = ? WHERE "id" IN (?, ?, ?)
```

### DELETE

```typescript
import { compileDelete } from "@chromav/frizzle/sql";
import { createWriteDescriptor, mergeWriteDescriptor } from "@chromav/frizzle";

const desc = mergeWriteDescriptor(
  createWriteDescriptor("delete"),
  { targetIds: ["task-1"] },
);

const { sql, parameters } = compileDelete("tasks", desc, sqliteDialect);
// DELETE FROM "tasks" WHERE "id" = ?
```

### Custom ID column

All write compilers default to `"id"` for the WHERE clause. Override with options:

```typescript
compileUpdate("items", desc, sqliteDialect, { idColumn: "itemId" });
// UPDATE "items" SET ... WHERE "itemId" = ?
```

## Safety

- **Empty filter** → `WHERE 1 = 1` (returns all rows, not an error)
- **Empty IN array** → `1 = 0` (returns no rows)
- **Empty NOT IN array** → `1 = 1` (returns all rows)
- **Empty targetIds on UPDATE/DELETE** → `WHERE 1 = 0` (affects no rows — prevents accidental full-table writes)
- **NULL values** → `IS NULL` / `IS NOT NULL` (never `= NULL`)
- **Boolean values** → dialect literal (`1`/`0` for SQLite, `TRUE`/`FALSE` for Postgres)
- **LIKE patterns** → escaped via `dialect.escapeLikePattern()` with `ESCAPE '\'`

## Filter POJO operators

These operators work in `QueryDescriptor.filter` objects (Path A):

| Filter syntax | SQL output |
|--------------|------------|
| `{ status: "active" }` | `"status" = ?` |
| `{ status: { ne: "done" } }` | `"status" != ?` |
| `{ priority: { gt: 2 } }` | `"priority" > ?` |
| `{ priority: { gte: 3 } }` | `"priority" >= ?` |
| `{ priority: { lt: 4 } }` | `"priority" < ?` |
| `{ priority: { lte: 2 } }` | `"priority" <= ?` |
| `{ status: { in: ["a", "b"] } }` | `"status" IN (?, ?)` |
| `{ status: { notIn: ["done"] } }` | `"status" NOT IN (?)` |
| `{ title: { like: "%test%" } }` | `"title" LIKE ? ESCAPE '\'` |
| `{ assignedTo: null }` | `"assignedTo" IS NULL` |
| `{ assignedTo: { ne: null } }` | `"assignedTo" IS NOT NULL` |
| `{ assignedTo: { isNull: true } }` | `"assignedTo" IS NULL` |
| `{ assignedTo: { isNotNull: true } }` | `"assignedTo" IS NOT NULL` |
| `{ isDeleted: false }` | `"isDeleted" = 0` (SQLite) |
| `{ priority: { gte: 1, lte: 3 } }` | `"priority" >= ? AND "priority" <= ?` |
| `{ OR: [{ status: "a" }, { status: "b" }] }` | `(("status" = ?) OR ("status" = ?))` |
