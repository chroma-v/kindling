# Drizzle Integration

Frizzle ships two code generators for [Drizzle ORM](https://orm.drizzle.team/). Both accept the same filter expressions and share the same validation layer — they differ in output format and use case.

## Two generators

| | RQB (`compileFilter`) | SQL (`compileFilterToSQL`) |
|---|---|---|
| **Output** | `DrizzleWhere` object | Drizzle `SQL` object |
| **Use with** | `db.query.*.findMany({ where })` | `db.select().from().where()` |
| **Async** | Yes: `compileFilter` always returns a Promise, since a `WhereResolver` may be async | No: resolvers must return `SQL` synchronously |
| **Column mappings** | Strings, `WhereResolver` functions, or `{ field, where? }` | Drizzle column objects, `SQLColumnResolver` functions, or `{ column, where? }` |
| **Nested paths** | Yes (`"taskTags.tag.name"`) | No |
| **Sorting** | `compileSort()` | `generateDrizzleQuery()` / `DrizzleCodeGenerator` (same field map) |
| **drizzle-orm** | 1.0 (beta/rc) | `>=0.30.0 \|\| >=1.0.0-beta.1` (the peer range) |

**When to use which:**

- Use **RQB** (`compileFilter`) for relational queries with `db.query.*`, especially when you need nested relation filtering or async resolvers.
- Use **SQL** (`compileFilterToSQL`) for `db.select().from()` query builder chains where you want direct Drizzle SQL objects.

## Column mappings

Column mappings tell frizzle how to translate filter field names to database columns. There are three forms.

### Direct mapping (string)

Maps a filter field to a database column name. The simplest form.

```typescript
const columns = {
  title: "title",
  status: "status",
  createdAt: "createdAt",
};

const result = await compileFilter("status eq 'active'", columns);
// → { status: "active" }
```

### Nested path (string with dots)

Maps a filter field to a relation path. Drizzle v2 RQB resolves these as nested relation filters.

```typescript
const columns = {
  title: "title",
  status: "status",
  // Filter by tag name through: tasks → taskTags → tag → name
  tags: "taskTags.tag.name",
};

const result = await compileFilter("tags eq 'bug'", columns);
// → { taskTags: { tag: { name: "bug" } } }
```

This works with `compileFilter` (RQB) only. Nested paths cannot be used for sorting — `compileSort` will return an error.

### Resolver function (WhereResolver)

For complex filtering that can't be expressed as a simple path — like many-to-many subqueries:

```typescript
import type { WhereResolver } from "@chromav/frizzle/drizzle";

const tagResolver: WhereResolver<{ db: DrizzleDb }> = async (operator, value, ctx) => {
  const names = Array.isArray(value) ? value : [String(value)];

  const matchingTaskIds = await ctx.db
    .select({ taskId: taskTags.taskId })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(inArray(tags.name, names));

  return { id: { in: matchingTaskIds.map(r => r.taskId) } };
};

const result = await compileFilter(
  "tags eq 'bug'",
  { tags: tagResolver },
  { context: { db } }
);
```

Resolvers receive the operator, value, and an optional context object. They can be sync or async. They return a `DrizzleWhere` object that gets merged into the query.

Resolvers cannot be used for sorting.

## compileFilter (RQB)

Compiles a filter string to a Drizzle RQB `where` object. Async because resolvers can be async.

`compileFilter` requires drizzle-orm 1.0 (beta/rc). Its output uses the v2 relational-query object filter syntax (`OR`, `AND`, `RAW`), which doesn't exist in drizzle-orm 0.x. On 0.x, use `compileFilterToSQL` or the raw `@chromav/frizzle/sql` generator; both work across the whole peer range `>=0.30.0 || >=1.0.0-beta.1`.

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter } from "@chromav/frizzle/drizzle";

const result = await compileFilter(filterString, columns);
const result = await compileFilter(filterString, columns, { schema });
const result = await compileFilter(filterString, columns, { schema, context });
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `filterString` | `string` | The filter expression to compile |
| `columns` | `Record<string, string \| WhereResolver>` | Column mappings |
| `options.schema` | `Schema` | Optional schema for validation |
| `options.context` | `TContext` | Optional context passed to resolvers |
| `options.maxDepth` | `number` | Deepest parenthesis nesting. Default `32` |
| `options.maxParameters` | `number` | Most values the filter may carry. Default `100` |
| `options.maxConditions` | `number` | Most comparisons the filter may contain. Default `1000` |

The limit options are `FilterLimits`; exceeding one returns a `LIMIT_EXCEEDED` error. See [Limits](query-language.md#limits).

**Returns:** `Result<DrizzleWhere>`

### Output examples

```typescript
// Simple equality
"status eq 'active'"
→ { status: "active" }

// Comparison operator
"age gte 18"
→ { age: { gte: 18 } }

// Null handling (automatic conversion)
"assignedTo eq null"
→ { assignedTo: { isNull: true } }

// String operators
"title contains 'deploy'"
→ { title: { like: "%deploy%" } }

// String operators match literally: a value with % or _ compiles to a RAW
// filter (LIKE ... ESCAPE '\'), placed beside the column
"title contains '50%'"
→ { RAW: (table, { sql }) => … }            // title LIKE '%50\%%' ESCAPE '\'
"author.name contains 'a_b'"  (with mapping { "author.name": "author.name" })
→ { author: { RAW: (table, { sql }) => … } } // name LIKE '%a\_b%' ESCAPE '\'

// Array operators
"status in ['active', 'pending']"
→ { status: { in: ["active", "pending"] } }

// AND (merged objects, when the fields are disjoint)
"status eq 'active' and priority eq 'high'"
→ { status: "active", priority: "high" }

// AND (list, when both sides share a key)
"age gte 18 and age lte 65"
→ { AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }] }

// OR (array wrapper)
"status eq 'active' or status eq 'pending'"
→ { OR: [{ status: "active" }, { status: "pending" }] }

// Nested paths
"tags eq 'bug'"  (with mapping { tags: "taskTags.tag.name" })
→ { taskTags: { tag: { name: "bug" } } }
```

### Output shape

An AND of disjoint fields merges into one object. When both sides of an AND share a key (the same field twice, two ORs, two RAW filters, or the same relation), the result is `{ AND: [...] }` instead, so neither side overwrites the other. Chains flatten into one list:

```typescript
"age gte 18 and age lte 65 and age ne 30"
→ { AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }, { age: { ne: 30 } }] }

"(status eq 'a' or status eq 'b') and (age eq 1 or age eq 2)"
→ { AND: [{ OR: [{ status: "a" }, { status: "b" }] }, { OR: [{ age: 1 }, { age: 2 }] }] }
```

To combine a compiled filter with your own conditions, always wrap both in `AND`:

```typescript
const where = { AND: [{ projectId, isDeleted: false }, result.data] };
```

Never use object spread (`{ projectId, ...result.data }`): a user filter on `projectId` would replace your scope, and an `AND` / `OR` key in the filter would replace yours.

## compileSort

Compiles a sort expression to a Drizzle RQB `orderBy` object. Sync.

```typescript
import { compileSort } from "@chromav/frizzle/drizzle";

const result = compileSort(sortString, columns);
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sortString` | `string` | Sort expression (e.g., `"name:asc,createdAt:desc"`) |
| `columns` | `Record<string, string \| WhereResolver>` | Column mappings (only string mappings work for sorting) |

**Returns:** `Result<DrizzleOrderBy>`

```typescript
compileSort("status:asc,createdAt:desc", columns);
// → { status: "asc", createdAt: "desc" }
```

**Restrictions:**
- Cannot sort by nested paths — returns an error
- Cannot sort by resolver columns — returns an error
- Empty expression returns an error
- Default direction is `asc` when omitted

## compileFilterToSQL (SQL builder)

Compiles a filter string to a Drizzle `SQL` object. Sync.

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilterToSQL } from "@chromav/frizzle/drizzle";

const result = compileFilterToSQL(filterString, tableColumns);
const result = compileFilterToSQL(filterString, tableColumns, { schema });
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `filterString` | `string` | The filter expression to compile |
| `tableColumns` | `Record<string, SQLColumnMapping>` | Drizzle columns, resolver functions, or `{ column, where?, caseInsensitive? }` |
| `options.schema` | `Schema` | Optional schema for validation |
| `options.context` | any | Passed to resolvers as their third argument |
| `options.maxDepth` | `number` | Deepest parenthesis nesting. Default `32` |
| `options.maxParameters` | `number` | Most values the filter may carry. Default `100` |
| `options.maxConditions` | `number` | Most comparisons the filter may contain. Default `1000` |

**Returns:** `Result<SQL>`

### Column mappings for SQL

Pass Drizzle column objects instead of strings:

```typescript
import { tasks } from "./schema";

const result = compileFilterToSQL("status eq 'active' and age gte 18", {
  status: tasks.status,
  age: tasks.age,
});

if (isSuccess(result)) {
  const rows = await db.select().from(tasks).where(result.data);
}
```

### SQL column resolvers

For virtual columns, use an `SQLColumnResolver` that returns a Drizzle `SQL`
object. It receives the operator, the value, and the `context` you pass in, so
resolvers that need the request's `db` (for a subquery) can be defined once
rather than per request:

```typescript
import type { SQLColumnResolver } from "@chromav/frizzle/drizzle";

const tagResolver: SQLColumnResolver<{ db: Db }> = (operator, value, { db }) => {
  const names = Array.isArray(value) ? value : [String(value)];

  const subquery = db
    .select({ taskId: taskTags.taskId })
    .from(taskTags)
    .innerJoin(tags, eq(taskTags.tagId, tags.id))
    .where(inArray(tags.name, names));

  if (operator === "ne" || operator === "not_in") {
    return notInArray(tasks.id, subquery);
  }
  return inArray(tasks.id, subquery);
};

const result = compileFilterToSQL(
  "tags eq 'bug'",
  { status: tasks.status, tags: tagResolver },
  { context: { db } },
);
```

`compileFilterNodeToSQL(node, fields, context)` and
`generateDrizzleQuery(ast, baseQuery, fields, context)` take the context as
their last argument. Resolvers written as `(operator, value) => SQL` still
work; with no context given they're called with exactly those two arguments.

### One map for filtering and sorting

A field mapped to a resolver can be filtered but not sorted (`UNSORTABLE_FIELD`).
To filter through a resolver and still sort by a real column, map the field to
`{ column, where }`. Sorting uses `column`; filtering uses `where`, or `column`
when there's no `where`:

```typescript
import { generateDrizzleQuery } from "@chromav/frizzle/drizzle";

const fields = {
  code: countries.code,                                   // plain column
  name: { column: countries.name, where: nameOrAlias },    // filter via resolver, sort by column
  region: { column: countries.region, caseInsensitive: true },
};

// ?filter=name eq 'Britain'&sort=name:asc — one map, one call
const query = generateDrizzleQuery(ast, db.select().from(countries).$dynamic(), fields, { db });
```

`caseInsensitive: true` compiles `eq` / `ne` to `lower(col) = lower(?)` and
`contains`, `starts_with`, `ends_with`, `like`, `ilike` to
`lower(col) like lower(?)`, still escaped. Other operators and sorting use the
column as-is, and so do non-string values (`id eq 3` on a number column is a
plain `=`). SQLite's `lower()` folds ASCII letters only, and its `LIKE` is
already case-insensitive for ASCII, so on SQLite the flag matters mostly for
`eq` / `ne`.

RQB takes the same idea as `{ field, where? }`: `compileFilter` uses the
resolver, `compileSort` uses `field`.

## DrizzleCodeGenerator (Compiler pipeline)

For the full `Compiler` class pipeline, use `DrizzleCodeGenerator`:

```typescript
import { createCompiler, parseQueryString, isSuccess } from "@chromav/frizzle";
import { DrizzleCodeGenerator } from "@chromav/frizzle/drizzle";

const compiler = createCompiler({
  schema,
  codeGenerator: new DrizzleCodeGenerator(),
});

const params = parseQueryString("filter=age gte 18&sort=age:desc&limit=50");

if (isSuccess(params)) {
  const ast = compiler.parse(params.data);

  if (isSuccess(ast)) {
    const query = compiler.compile(ast.data, {
      baseQuery: db.select().from(users),
      tableColumns: { age: users.age, name: users.name },
    });
  }
}
```

## Type exports

All types are exported from `@chromav/frizzle/drizzle`:

```typescript
import type {
  DrizzleWhere,         // RQB where object
  DrizzleOrderBy,       // RQB orderBy object
  WhereResolver,        // Async resolver for RQB (generic context)
  WhereFieldMapping,    // { field, where? }: sort by field, filter via where
  WhereColumnMapping,   // string | WhereResolver | WhereFieldMapping
  SQLColumnResolver,    // Sync resolver for SQL (returns SQL; optional context)
  SQLFieldMapping,      // { column, where?, caseInsensitive? }
  SQLColumnMapping,     // AnyColumn | SQLColumnResolver | SQLFieldMapping
} from "@chromav/frizzle/drizzle";
```

## Operator validation

Both generators validate operator/value combinations before producing output. Invalid combinations return errors instead of broken SQL.

Examples of caught errors:
- `gt null` → `>` NULL is always NULL in SQL. Use `is_null`.
- `eq ["a", "b"]` → Drizzle interprets arrays as tuples, not IN lists. Use `in`.
- `contains null` → Produces `LIKE '%null%'` matching the string "null". Use `is_null`.
- `in null` → `IN (NULL)` never matches. Use `is_null`.
- `between "hello"` → `between` requires a 2-element array.

For the full validation matrix, see [drizzle-code-generator.md](drizzle-code-generator.md).
