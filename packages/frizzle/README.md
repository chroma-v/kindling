# frizzle

A type-safe query compiler and service layer toolkit. Parse URL-safe filter strings, compile to database queries (Drizzle ORM or raw SQL), and compose interceptor pipelines for scoping, soft-delete, and audit trails — with zero exceptions thrown.

```
?filter=status eq 'active' AND priority eq 'high'&sort=createdAt:desc&limit=50
```

## Install

```bash
npm install @chromav/frizzle
```

Drizzle ORM is an optional peer dependency — only needed if you use the Drizzle code generators.

```bash
npm install drizzle-orm  # if using @chromav/frizzle/drizzle
```

The peer range is `>=0.30.0 || >=1.0.0-beta.1`. The RQB `compileFilter` needs drizzle-orm 1.0 (beta/rc), because its output uses the v2 relational-query object filter syntax (`OR`, `AND`, `RAW`), which drizzle-orm 0.x doesn't have. `compileFilterToSQL` and `@chromav/frizzle/sql` work across the whole range.

## Quick Start

### Filter a query

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter } from "@chromav/frizzle/drizzle";

const result = await compileFilter(
  "status eq 'active' and priority eq 'high'",
  { status: "status", priority: "priority" }
);

if (isSuccess(result)) {
  const tasks = await db.query.tasks.findMany({
    where: result.data,
  });
}
```

`compileFilter` targets Drizzle's relational queries (`db.query.*`) and requires drizzle-orm 1.0 (beta/rc); see [Install](#install). To add your own conditions, wrap both in `AND` — `{ AND: [{ workspaceId }, result.data] }` — rather than spreading `result.data`, which would let a user filter replace your keys.

### Filter + sort with schema validation

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { Schema } from "@chromav/frizzle";

const schema: Schema = {
  status: { type: "enum", enumValues: ["active", "pending", "done"] },
  priority: { type: "enum", enumValues: ["low", "medium", "high"] },
  title: { type: "string" },
  createdAt: { type: "date" },
};

const columns = {
  status: "status",
  priority: "priority",
  title: "title",
  createdAt: "createdAt",
};

// Validates field names, operators, and value types before compiling
const filterResult = await compileFilter(
  "status eq 'active' and title contains 'deploy'",
  columns,
  { schema }
);

const sortResult = compileSort("createdAt:desc", columns);

if (isSuccess(filterResult) && isSuccess(sortResult)) {
  const tasks = await db.query.tasks.findMany({
    where: filterResult.data,
    orderBy: sortResult.data,
  });
}
```

### SQL builder alternative (Drizzle)

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilterToSQL } from "@chromav/frizzle/drizzle";

// Pass Drizzle column objects instead of strings
const result = compileFilterToSQL("status eq 'active'", {
  status: tasks.status,
  priority: tasks.priority,
});

if (isSuccess(result)) {
  const rows = await db.select().from(tasks).where(result.data);
}
```

### Build filters in code, validate once

There are two levels to combine at, each with its own `and` / `or`:

| You have | Combine with | Examples |
|---|---|---|
| **Filter trees**, before compiling: what `parseFilter` returns, or nodes from the `f` builders | `f.and`, `f.or` | AND shorthand params into a user filter, then `validateFilter` |
| **Where objects**, after compiling: `compileFilter` output, scopes, descriptor filters | `andWhere`, `orWhere` | AND a compiled user filter with `{ workspaceId }` |

Prefer combining trees when you can: the result is validated (limits, schema) as one filter.

```typescript
import { f, isError, validateFilter } from "@chromav/frizzle";
import { generateDrizzleQuery } from "@chromav/frizzle/drizzle";

// f.and / f.or skip undefined, and group an or inside an and so the tree means what it says
const filter = f.and(
  userFilter,                                        // e.g. from parseFilter(params.filter)
  region ? f.in("region", region.split(",")) : undefined,
);

// Schema checks plus the limits (maxParameters etc.) on the combined tree.
// On an error, reject the request: running the query without the filter
// would also drop the region restriction.
const valid = filter ? validateFilter(filter, schema) : undefined;
if (valid && isError(valid)) {
  return badRequest(valid.error);
}

// One field map filters and sorts: `name` is filtered through a resolver, sorted by its column
const query = generateDrizzleQuery(
  { filter: valid?.data, sort: [{ field: "name", direction: "asc" }] },
  db.select().from(countries).$dynamic(),
  { region: countries.region, name: { column: countries.name, where: nameOrAlias } },
  { db }, // passed to resolvers as their third argument
);
```

See [Schema Validation](docs/schema-validation.md#validating-filters-built-in-code) and
[Drizzle Integration](docs/drizzle-integration.md#one-map-for-filtering-and-sorting).

### Raw SQL target

For databases Drizzle doesn't cover (e.g., Trino, Spark, Iceberg):

```typescript
import { compileSelect } from "@chromav/frizzle/sql";
import { sqliteDialect } from "@chromav/frizzle/sql";

const columns = { status: "status", priority: "priority", createdAt: "created_at" };

const { sql, parameters } = compileSelect("tasks", {
  filter: { status: "active", priority: { gte: 3 } },
  sort: { createdAt: "desc" },
  take: 20,
}, columns, sqliteDialect);

// sql: SELECT * FROM "tasks" WHERE "status" = ? AND "priority" >= ? ORDER BY "created_at" DESC LIMIT ?
// parameters: ["active", 3, 20]
```

### Interceptor pipelines

Compose cross-cutting concerns as reusable interceptors:

```typescript
import {
  scopeQueryInterceptor,
  softDeleteQueryInterceptor,
  scopeWriteInterceptor,
  softDeleteWriteInterceptor,
  injectWriteInterceptor,
} from "@chromav/frizzle";

// Read pipeline: every query is scoped to workspace + excludes deleted
const queryInterceptors = [
  scopeQueryInterceptor({ workspaceId: "ws-123" }),
  softDeleteQueryInterceptor(),
];

// Write pipeline: scope + audit + soft-delete transform
const writeInterceptors = [
  scopeWriteInterceptor({ workspaceId: "ws-123" }),
  injectWriteInterceptor("user-456"),
  softDeleteWriteInterceptor("user-456"),
];
```

## Query Syntax

### Filter operators

| Operator | Category | Example |
|----------|----------|---------|
| `eq`, `ne` | Comparison | `status eq 'active'` |
| `gt`, `gte`, `lt`, `lte` | Comparison | `age gte 18` |
| `like`, `ilike` | String (substring) | `name like 'john'` |
| `contains`, `starts_with`, `ends_with` | String | `title contains 'deploy'` |
| `in`, `not_in` | Array | `status in ['active', 'pending']` |
| `between` | Range | `age between [18, 65]` |
| `is_null`, `is_not_null` | Null check | `assignedTo is_null` |

Symbol aliases work too: `=`, `!=`, `>`, `>=`, `<`, `<=`.

String operators match the value literally: `%` and `_` are ordinary characters, not wildcards (`title contains '50%'` finds the text `50%`).

### Logical operators

```
status eq 'active' and priority eq 'high'
status eq 'active' or status eq 'pending'
(status eq 'active' or status eq 'pending') and priority eq 'high'
```

`AND` binds tighter than `OR`. Parentheses override precedence.

### Sorting and pagination

```
sort=name:asc,createdAt:desc
limit=50
offset=100
```

Sort direction must be `asc` or `desc`; `limit` must be an integer from 1 to `maxLimit` (default 1000) and `offset` a non-negative integer. Anything else is an `INVALID_VALUE` error.

### Limits

Filters are capped at 32 levels of parenthesis nesting (`maxDepth`), 100 values (`maxParameters`, matching Cloudflare D1's bound-parameter cap), and 1000 comparisons (`maxConditions`). Exceeding one returns a `LIMIT_EXCEEDED` error. Override them per call, e.g. `compileFilter(expr, columns, { maxParameters: 50 })`. See [Limits](docs/query-language.md#limits).

## Error Handling

All operations return `Result<T>` — no exceptions thrown.

```typescript
import { isSuccess, isError } from "@chromav/frizzle";

const result = await compileFilter("bad ?? syntax", columns);

if (isError(result)) {
  result.error.message;     // "Expected operator, got '?'"
  result.error.position;    // 4
  result.error.code;        // "SYNTAX_ERROR"
  result.error.suggestions; // Possible fixes (e.g. close field names, for UNKNOWN_FIELD)
}
```

## Entry Points

| Import | Contents |
|--------|----------|
| `@chromav/frizzle` | Core: compiler, parser, AST types, result types, schema types, query string parsing, descriptors, interceptors |
| `@chromav/frizzle/drizzle` | Drizzle ORM: `compileFilter`, `compileFilterToSQL`, `compileSort`, `DrizzleCodeGenerator` |
| `@chromav/frizzle/sql` | Raw SQL: `compileSelect`, `compileFilter`, `compileFilterNode`, `compileInsert`, `compileUpdate`, `compileDelete`, `Dialect`, `sqliteDialect` |

The core package has zero dependencies. `@chromav/frizzle/drizzle` requires `drizzle-orm` as a peer dependency. `@chromav/frizzle/sql` has zero dependencies.

## Descriptors

Frizzle uses database-agnostic intermediate representations that flow through interceptor pipelines before reaching a database adapter.

**`QueryDescriptor`** — describes a read operation:

```typescript
import { mergeDescriptors } from "@chromav/frizzle";
import type { QueryDescriptor } from "@chromav/frizzle";

// A QueryDescriptor is a plain object; mergeDescriptors combines two
const base: QueryDescriptor = { filter: { workspaceId: "ws-1" } };
const descriptor = mergeDescriptors(base, {
  filter: { status: "active" },
  sort: { createdAt: "desc" },
  take: 20,
  skip: 0,
  select: { id: true, title: true, status: true },
  include: { assignee: true },
});
```

**`WriteDescriptor`** — describes a write operation:

```typescript
import { createWriteDescriptor, mergeWriteDescriptor } from "@chromav/frizzle";

// Insert
const insert = createWriteDescriptor("insert", { title: "New task", status: "backlog" });

// Update
const update = mergeWriteDescriptor(
  createWriteDescriptor("update", { status: "done" }),
  { targetIds: ["task-1", "task-2"] },
);

// Delete
const remove = mergeWriteDescriptor(
  createWriteDescriptor("delete"),
  { targetIds: ["task-3"] },
);
```

## Reference Interceptors

Reusable implementations for common service layer patterns. All exported from the main `@chromav/frizzle` entry point.

### Query interceptors

| Interceptor | Description |
|------------|-------------|
| `scopeQueryInterceptor(fields)` | Appends tenant/workspace filter to every query |
| `softDeleteQueryInterceptor(config?)` | Excludes soft-deleted rows (`isDeleted: false`) |
| `defaultIncludesInterceptor(defaults)` | Deep-merges default relation includes |
| `extraScopeInterceptor(scopeFn)` | Adds entity-specific filter conditions from a factory |

### Write interceptors

| Interceptor | Description |
|------------|-------------|
| `scopeWriteInterceptor(fields)` | Injects scope values into every write |
| `softDeleteWriteInterceptor(userId, config?)` | Transforms delete → update with `isDeleted: true` |
| `injectWriteInterceptor(userId, config?)` | Injects `createdById` on insert, `updatedById` on update |
| `extraScopeWriteInterceptor(scopeFn)` | Injects additional scope fields on insert |

All interceptors are generalized (configurable column names, generic scope fields) and use only frizzle's own types — zero external dependencies.

## SQL Target

The `@chromav/frizzle/sql` entry point compiles descriptors to parameterized SQL strings. It supports any SQL database through the `Dialect` interface.

### Dialect interface

```typescript
import type { Dialect } from "@chromav/frizzle/sql";

const trinoDialect: Dialect = {
  name: "trino",
  quoteIdentifier: (name) => `"${name}"`,
  parameter: (index) => `$${index + 1}`,
  booleanLiteral: (v) => v ? "TRUE" : "FALSE",
  supportsILike: true,
  escapeLikePattern: (p) => p.replace(/[%_\\]/g, "\\$&"),
};
```

### Write operations

```typescript
import { compileInsert, compileUpdate, compileDelete } from "@chromav/frizzle/sql";
import { createWriteDescriptor, mergeWriteDescriptor } from "@chromav/frizzle";
import { sqliteDialect } from "@chromav/frizzle/sql";

const insert = createWriteDescriptor("insert", { title: "Task", status: "backlog" });
const { sql, parameters } = compileInsert("tasks", insert, sqliteDialect);
// sql: INSERT INTO "tasks" ("title", "status") VALUES (?, ?)

const update = mergeWriteDescriptor(
  createWriteDescriptor("update", { status: "done" }),
  { targetIds: ["t-1"] },
);
const { sql, parameters } = compileUpdate("tasks", update, sqliteDialect);
// sql: UPDATE "tasks" SET "status" = ? WHERE "id" = ?
```

## Architecture

```
URL query string
    ↓ parseQueryString()
QueryDescriptor (database-agnostic IR)
    ↓ interceptor pipeline (scope, soft-delete, inject, ...)
QueryDescriptor (enriched)
    ↓ adapter
    ├── @chromav/frizzle/drizzle → Drizzle RQB findMany/findFirst
    └── @chromav/frizzle/sql     → parameterized SQL string
```

## Documentation

### Core
- **[Getting Started](docs/getting-started.md)** — Both approaches, architecture overview, what each step produces
- **[Descriptors](docs/descriptors.md)** — QueryDescriptor and WriteDescriptor as database-agnostic IRs
- **[Interceptors](docs/interceptors.md)** — Pipeline concept, reference implementations, writing your own
- **[Query Language](docs/query-language.md)** — Complete syntax reference with examples for every operator
- **[Schema Validation](docs/schema-validation.md)** — Field types, operator compatibility, runtime enums
- **[Error Handling](docs/error-handling.md)** — Result types, error codes, resilient patterns
- **[Query Spec (EBNF)](docs/query-spec.md)** — Formal grammar

### Database targets
- **[Drizzle Integration](docs/drizzle-integration.md)** — RQB vs SQL, column mappings, nested paths, resolvers
- **[Drizzle Code Generator](docs/drizzle-code-generator.md)** — Validation rules, adding operators, test coverage
- **[SQL Target](docs/sql-target.md)** — Raw SQL compilation, dialect interface, all compilers and operators

### Guides
- **[Recipes](docs/recipes.md)** — Express, Hono, Next.js, React Router examples + filter UI patterns
- **[URL Examples](docs/url-examples.md)** — 50+ real-world URL query patterns

## License

MIT
