# Drizzle Code Generator

Guide to the two Drizzle code generators, operator validation, consumer-side resilience, and how to extend the system safely.

## Two Generators

The package ships two independent code generators for Drizzle ORM. Both share the same operator validation.

| Generator | Output | Async | Use Case |
|-----------|--------|-------|----------|
| `DrizzleCodeGenerator` / `compileFilterToSQL` | Drizzle `SQL` objects | No | `db.select().from(table).where(sql)` |
| `DrizzleWhereVisitor` / `compileFilter` | RQB object syntax | Yes | `db.query.table.findMany({ where: obj })` |

**When to use which:**
- Use `compileFilter` (RQB) for relational queries with `db.query.*` and nested `with` relations
- Use `compileFilterToSQL` (SQL) for `db.select().from()` query builder chains
- Both accept the same filter expression strings and column mappings

`compileFilter` (RQB) requires drizzle-orm 1.0 (beta/rc): its object filter syntax (`OR`, `AND`, `RAW`) doesn't exist in drizzle-orm 0.x. `compileFilterToSQL` and the raw `@chromav/frizzle/sql` generator work with the full peer range `>=0.30.0 || >=1.0.0-beta.1`.

## Operator x Value Validation

`validateOperatorValue()` validates every operator/value combination at compile time, before any SQL or RQB output is generated. Invalid combos return `Result<Error>` with `TYPE_MISMATCH` code, suggestions, and the field name.

### Validation Rules by Category

Rules are derived from the operator registry's `category` field in `language.ts`, not hardcoded operator names.

#### Comparison (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`)

| Value Type | `eq` / `ne` | `gt` / `gte` / `lt` / `lte` |
|------------|-------------|------------------------------|
| string | Valid | Valid |
| number | Valid | Valid |
| boolean | Valid | Valid |
| null | Valid (converts to `isNull`/`isNotNull`) | **Error** — use `is_null` |
| array | **Error** — use `in`/`not_in` | **Error** |
| undefined | Same as null | **Error** — use `is_null` |

#### String (`like`, `ilike`, `contains`, `starts_with`, `ends_with`)

| Value Type | Result |
|------------|--------|
| string | Valid |
| number | Valid (coerced to string in LIKE pattern) |
| boolean | Valid (coerced) |
| null | **Error** — use `is_null` |
| array | **Error** |

All five match the value literally (`%` and `_` are ordinary characters). `like`, `ilike`, and `contains` compile to `%value%`, `starts_with` to `value%`, and `ends_with` to `%value`. When the value contains `%` or `_`, they are backslash-escaped and the condition is compiled with `ESCAPE '\'`:

| Filter | RQB output | SQL output |
|--------|-----------|------------|
| `title contains 'deploy'` | `{ title: { like: "%deploy%" } }` | `like(title, "%deploy%")` |
| `title contains '50%'` | `{ RAW: (table, { sql }) => … }` | `` sql`${title} like ${"%50\\%%"} escape '\'` `` |

The RQB object syntax has no way to say `ESCAPE`, so an escaped pattern becomes a `RAW` filter. It sits beside the column, inside any relation objects: `author.name contains 'a_b'` → `{ author: { RAW: … } }`.

`ilike` compiles to `LIKE` in both generators (SQLite / D1 have no `ILIKE`). SQLite's `LIKE` is case-insensitive for ASCII letters only.

#### Array (`in`, `not_in`)

| Value Type | Result |
|------------|--------|
| array | Valid (including empty `[]`) |
| string/number/boolean | Valid (wrapped in `[value]`) |
| null | **Error** — use `is_null` (`IN (NULL)` never matches) |

#### Range (`between`)

| Value Type | Result |
|------------|--------|
| 2-element array | Valid |
| Everything else | **Error** — requires exactly 2 values |

#### Null (`is_null`, `is_not_null`)

Value is ignored — always valid.

### Why These Rules

These aren't style preferences — each rejected combo produces broken SQL:

- **`gt null`** — `column > NULL` is always `NULL` (false) in SQL. The user meant `is_null` or `is_not_null`.
- **`eq ["a","b"]`** — Drizzle RQB interprets `{ field: ["a","b"] }` as a tuple, not an IN list. The user meant `in ["a","b"]`.
- **`contains null`** — Produces `LIKE '%null%'`, matching the literal string "null", not NULL values.
- **`in null`** — `IN (NULL)` never matches any row. SQL NULL requires `IS NULL`.
- **`between "hello"`** — BETWEEN requires exactly two bounds: `BETWEEN a AND b`.

## Consumer-Side Resilience

Even with compile-time validation, consumers should handle errors at two levels:

### Level 1: Check the Result (primary)

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter } from "@chromav/frizzle/drizzle";

const result = await compileFilter(filterString, columnMappings);

if (isSuccess(result)) {
  tasksWhere = { AND: [baseWhere, result.data] };
} else {
  // Show inline error, fall back to unfiltered
  filterError = result.error.message;
}
```

Validation errors (`TYPE_MISMATCH`) are caught here — the query never executes.

### Level 2: Catch query execution errors (belt-and-suspenders)

```typescript
let project = await db.query.projects
  .findFirst({
    where: { id: params.id },
    with: { tasks: { where: tasksWhere } },
  })
  .catch(async (err) => {
    if (!filterString && !sortString) throw err;
    filterError = "Filter could not be applied";
    return db.query.projects.findFirst({
      where: { id: params.id },
      with: { tasks: { where: baseWhere } },
    });
  });
```

This catches anything validation missed — a new Drizzle version changing behavior, a resolver that returns an invalid shape, etc. The page renders with unfiltered data and an error pill instead of a 500.

### Both levels are necessary

| Scenario | Level 1 catches? | Level 2 catches? |
|----------|-------------------|-------------------|
| `gt null` (invalid combo) | Yes | N/A (never reaches DB) |
| Resolver returns bad shape | No (resolver is a black box) | Yes |
| Drizzle ORM bug | No (valid input, broken output) | Yes |
| New operator without validation | Yes (`INVALID_OPERATOR`) | N/A |

## How to Add a New Operator

Adding an operator to the registry requires changes in three places. The test suite enforces all three — you can't skip one silently.

### 1. Register in `language.ts`

```typescript
export const operators = {
  // ...existing operators...
  not_like: { category: "string" },   // ← new operator
} as const;
```

The `category` field determines which validation rules apply (see table above).

### 2. Handle in the code generators (`drizzle-rqb.ts`, `drizzle-sql.ts`)

A string operator must build its pattern with `likePattern()` from `src/like-pattern.ts`, never by interpolating the value into `%${value}%`. Interpolating skips escaping, so a user's `%` or `_` would act as a wildcard.

- Add the operator to `isLikeOperator` and give it a case in `likePattern()` (which returns `{ pattern, escaped }`).
- **RQB generator** — `comparisonToWhereObject()` sends every `isLikeOperator` operator to `likeToWhereObject()`, which emits `{ like: pattern }` or, when `escaped`, a `RAW` filter with `ESCAPE '\'`. A negated operator needs its own branch there (`notLike` / `not like`).
- **SQL generator** — add an entry to `DRIZZLE_OPERATORS` built the same way as `likeLiteral()`: call `likePattern(operator, value)` and add `escape '\'` when `escaped` is true.
- **Raw SQL target** — add a case in `src/sql/compile-where.ts` that escapes with `dialect.escapeLikePattern`.

### 3. Validation is automatic (if the category exists)

If the new operator uses an existing category (`"string"` in this example), `validateOperatorValue` handles it automatically — the `switch (category)` routes it to the right rules.

If you add a **new category**, the TypeScript compiler will error on the exhaustive `default: never` case until you add a new `case` branch.

### What enforces this?

Three test-level guards prevent incomplete changes:

| Guard | What it catches | Test |
|-------|----------------|------|
| **Registry completeness** | New operator not handled by validation | `"every operator in the registry is handled"` |
| **Matrix completeness** | New operator not in test expectations | `"matrix expectations cover every registry operator"` |
| **TypeScript exhaustive switch** | New *category* not in validation | Compile error on `default: never` |

## Things to Watch Out For

### 1. The `default: never` pattern requires `as const`

The exhaustive switch only works because `language.ts` declares `operators` with `as const`. Without it, `category` widens to `string` and the `never` check doesn't fire.

```typescript
// language.ts — the `as const` is load-bearing
export const operators = {
  eq: { symbol: "=", category: "comparison" },
  // ...
} as const;
```

### 2. Resolvers bypass validation

`validateOperatorValue` runs before the resolver is called, so it validates the operator/value combo. But it can't validate what the resolver *returns*. A resolver that returns `{ id: { badOperator: true } }` will pass validation and fail at query time.

This is intentional — resolvers are escape hatches for complex queries (many-to-many, subqueries). The Level 2 `.catch()` is the safety net for resolver bugs.

### 3. `undefined` and `null` are treated identically

Both `null` and `undefined` values trigger the same validation rules. The parser produces `null` for literal `null` tokens, but `undefined` can appear when a value-bearing operator is somehow constructed without a value (e.g., programmatic AST construction).

### 4. Empty arrays are valid for `in`/`not_in`

`in []` passes validation and produces `{ in: [] }`. Drizzle handles this correctly (returns no rows). This is intentional — an empty filter selection (user unchecked everything) should return no results, not crash.

### 5. `between` validation happens in two places

`validateOperatorValue` checks the array length before `comparisonToWhereObject` is called. The `DRIZZLE_OPERATORS.between` builder also throws for non-2-element arrays as defense-in-depth. The validation catches it first, so the throw is a secondary safety net.

### 6. The SQL and RQB generators can diverge

Both generators call `validateOperatorValue`, but their output logic is separate. A bug fix in one doesn't automatically fix the other. The `eq null` bug (producing `{ field: null }` instead of `{ isNull: true }`) only affected the RQB generator — the SQL generator already handled it correctly.

When fixing operator behavior, check both:
- `DRIZZLE_OPERATORS` map (SQL generator)
- `comparisonToWhereObject` function (RQB generator)

### 7. The matrix test is the final arbiter

The exhaustive matrix test (`compileFilter: operator x value exhaustive matrix`) tests every operator against every value type the parser can produce (string, number, null, true, false, array). Each cell is either an expected RQB object or an expected error.

If you change validation rules, update the `expectations` map in the matrix test. The test will tell you exactly which combinations changed behavior.

## Test Coverage Summary

| Test Section | Count | What It Covers |
|-------------|-------|----------------|
| Completeness guards | 2 | Every registry operator is handled + in matrix |
| Valid combinations | 24 | Known-good operator/value pairs |
| Invalid combinations | 35 | Known-bad pairs with error messages |
| Error suggestions | 5 | Actionable hints in error messages |
| Edge cases | 5 | undefined, empty arrays, nullary ops |
| Exhaustive matrix (RQB) | 93 | Every operator x every value type |
| SQL generator validation | 3 | Invalid combos rejected in SQL path too |
| Nested paths | 7 | Dot-notation nesting works for all categories |

Total: ~175 tests covering the code generators (of 249 in `drizzle.test.ts`).
