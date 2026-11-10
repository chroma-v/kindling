# Getting Started

## Two approaches

Frizzle offers two ways to compile queries. Pick the one that fits your use case.

### Standalone functions (recommended)

Use `compileFilter`, `compileSort`, and `compileFilterToSQL` when you want simple, one-call compilation. This is the right choice for most applications.

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";

const filterResult = await compileFilter(
  "status eq 'active' and priority eq 'high'",
  { status: "status", priority: "priority" }
);

const sortResult = compileSort("createdAt:desc,status:asc", {
  status: "status",
  createdAt: "createdAt",
});

if (isSuccess(filterResult) && isSuccess(sortResult)) {
  const tasks = await db.query.tasks.findMany({
    where: filterResult.data,
    orderBy: sortResult.data,
  });
}
```

### Compiler class (full pipeline)

Use the `Compiler` class when you want the full pipeline — filter + sort + limit + offset compiled together, with schema validation baked into every operation.

```typescript
import { createCompiler, parseQueryString, isSuccess } from "@chromav/frizzle";
import { DrizzleCodeGenerator } from "@chromav/frizzle/drizzle";

const compiler = createCompiler({
  schema: {
    status: { type: "enum", enumValues: ["active", "pending", "done"] },
    age: { type: "number", min: 0, max: 120 },
  },
  codeGenerator: new DrizzleCodeGenerator(),
});

// Parse URL query string into structured params
const params = parseQueryString("filter=age gte 18&sort=age:desc&limit=50");

if (isSuccess(params)) {
  // Parse into AST
  const ast = compiler.parse(params.data);

  if (isSuccess(ast)) {
    // Compile to Drizzle query
    const query = compiler.compile(ast.data, {
      baseQuery: db.select().from(users),
      tableColumns: { age: users.age, status: users.status },
    });
  }
}
```

## How it works

Frizzle processes queries in four stages:

```
Filter string → AST → Validated AST → Database query
              (Parser) (Validator)   (Code Generator)
```

### 1. Parser

A grammar written with [parser combinators](https://en.wikipedia.org/wiki/Parser_combinator) reads the string directly into an AST, with no separate tokenizing step: whether a word is a field or a value follows from its position in `field operator value`. It handles quoted strings, numbers, booleans, arrays and parentheses, and normalizes symbol operators (`>=`) to named ones (`gte`). `and` binds tighter than `or` (both case-insensitive), and parentheses override precedence. Errors say what was expected, e.g. `Expected operator, got '18'`.

(`Lexer`, `PrattParser`, `tokenizeFilterExpression` and `parseTokens`, the earlier tokenizer-plus-Pratt-parser implementation, are still exported but deprecated, as is `Compiler`'s `tokenizer` option.)

The parser also enforces size limits (nesting depth, number of values, number of conditions) and does not URL-decode its input. See [Limits](query-language.md#limits).

```typescript
// "age gte 18 and active eq true"
{
  type: "logical",
  operator: "and",
  left: { type: "comparison", field: "age", operator: "gte", value: 18 },
  right: { type: "comparison", field: "active", operator: "eq", value: true },
}
```

### 2. Validator (optional)

If a schema is provided, the validator checks:
- Field names exist
- Operators are compatible with the field type
- Values are valid (type coercion, enum membership, range bounds)

Invalid filters return descriptive errors with suggestions — they never reach the database.

### 3. Code generator / adapter

Walks the AST or descriptor and produces output for the target backend. Frizzle ships three targets:

- **Drizzle RQB** (`@chromav/frizzle/drizzle`) → `{ status: "active", priority: { gte: "high" } }` for `db.query.*.findMany({ where })`
- **Drizzle SQL** (`@chromav/frizzle/drizzle`) → Drizzle `SQL` objects for `db.select().from().where()`
- **Raw SQL** (`@chromav/frizzle/sql`) → parameterized SQL strings for any database (Trino, Spark, Iceberg, etc.)

The code generator is pluggable — you can implement the `CodeGenerator` interface for other backends.

### 4. Interceptor pipeline (optional)

Before reaching the adapter, descriptors can flow through interceptor pipelines that add cross-cutting concerns:

```
QueryDescriptor → [scope] → [softDelete] → [defaults] → adapter
WriteDescriptor → [scope] → [inject] → [softDelete] → adapter
```

Frizzle ships reference interceptors for scoping, soft-delete, audit injection, and more. See [Interceptors](interceptors.md).

## What each function returns

Every frizzle function returns a `Result<T>` — either a success with data or an error with details. No exceptions are thrown.

```typescript
import { isSuccess, isError } from "@chromav/frizzle";

const result = await compileFilter("status eq 'active'", columns);

if (isSuccess(result)) {
  // result.data is the compiled output
  console.log(result.data); // { status: "active" }
}

if (isError(result)) {
  // result.error has message, code, suggestions, position
  console.log(result.error.message);
}
```

### compileFilter

Returns a `DrizzleWhere` object for use with Drizzle RQB queries.

```typescript
// Input
await compileFilter("status eq 'active' and age gte 18", columns);

// Output (success)
{ status: "active", age: { gte: 18 } }

// When both sides of an AND use the same key, the result is an AND list
await compileFilter("age gte 18 and age lte 65", columns);
{ AND: [{ age: { gte: 18 } }, { age: { lte: 65 } }] }
```

See [Drizzle Integration](drizzle-integration.md#output-shape) for the full output shape and how to combine it with your own conditions.

### compileSort

Returns a `DrizzleOrderBy` object.

```typescript
// Input
compileSort("createdAt:desc,name:asc", columns);

// Output (success)
{ createdAt: "desc", name: "asc" }
```

### compileFilterToSQL

Returns a Drizzle `SQL` object for the query builder pattern.

```typescript
// Input
compileFilterToSQL("status eq 'active'", { status: tasks.status });

// Output (success) — a Drizzle SQL object
// Use with: db.select().from(tasks).where(result.data)
```

### parseQueryString

Extracts filter, sort, limit, and offset from a URL query string.

```typescript
// Input — accepts string, URL, or URLSearchParams
parseQueryString("filter=age gte 18&sort=name:asc&limit=50");

// Output (success)
{
  filter: "age gte 18",
  sort: [{ field: "name", direction: "asc" }],
  limit: 50,
}
```

`limit` must be an integer from 1 to `maxLimit` and `offset` a non-negative integer; anything else (`limit=10abc`, `limit=2.9`, `offset=-1`) is an `INVALID_VALUE` error. A sort direction other than `asc` / `desc` (any case) is an error too. Pass `QueryStringOptions` to change the bounds:

```typescript
parseQueryString(url, { maxLimit: 100, defaultLimit: 25 });
// no limit in the URL → limit: 25
// limit=500           → error: Invalid limit: 500. Must be between 1 and 100
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxLimit` | `1000` | Largest accepted `limit` |
| `defaultLimit` | none | `limit` when the query string has none; capped at `maxLimit` |

To parse just a sort string, use `parseSort("name:asc,age:desc")`, which returns `Result<SortNode[]>`. It replaces the deprecated `parseSortExpression`, which silently treats anything but `desc` as `asc`.

## Next steps

- **[Descriptors](descriptors.md)** — QueryDescriptor and WriteDescriptor as database-agnostic IRs
- **[Interceptors](interceptors.md)** — Pipeline concept, reference implementations, writing your own
- **[Query Language](query-language.md)** — All operators, value types, and syntax rules
- **[Schema Validation](schema-validation.md)** — Validate filters before they hit the database
- **[Drizzle Integration](drizzle-integration.md)** — Column mappings, nested paths, resolvers
- **[SQL Target](sql-target.md)** — Raw SQL compilation, dialect interface, write operations
- **[Recipes](recipes.md)** — Full-stack examples with Express, Hono, Next.js, and React Router
