# Query Language

Frizzle uses a human-readable, URL-safe expression language for filtering, sorting, and paginating data.

## Filter expressions

A filter is a string passed as the `filter` query parameter:

```
?filter=status eq 'active' AND priority eq 'high'
```

### Comparison operators

Every filter condition follows the pattern: `field operator value`.

| Operator | Aliases | Description | Example |
|----------|---------|-------------|---------|
| `eq` | `=` | Equal | `status eq 'active'` |
| `ne` | `!=` | Not equal | `status ne 'done'` |
| `gt` | `>` | Greater than | `age gt 18` |
| `gte` | `>=` | Greater than or equal | `age gte 18` |
| `lt` | `<` | Less than | `price lt 100` |
| `lte` | `<=` | Less than or equal | `score lte 50` |

Both named and symbol operators are valid. Named operators are recommended for URLs since symbols need encoding.

```
// These are equivalent
age gte 18
age >= 18
```

### String operators

| Operator | Description | Example |
|----------|-------------|---------|
| `like` | Contains substring | `name like 'john'` |
| `ilike` | Contains substring, case-insensitive | `name ilike 'john'` |
| `contains` | Contains substring | `title contains 'deploy'` |
| `starts_with` | Starts with prefix | `name starts_with 'Dr.'` |
| `ends_with` | Ends with suffix | `email ends_with '@gmail.com'` |

All five match the value **literally**. `like`, `ilike`, and `contains` match anywhere in the column; `starts_with` and `ends_with` anchor to the start or end. A `%`, `_` or `\` in the value is an ordinary character, not a wildcard or escape: `title contains '50%'` matches titles containing the text `50%`. Frizzle escapes them and compiles with `ESCAPE '\'`. There is no wildcard/pattern operator.

On SQLite, `LIKE` is case-insensitive for ASCII letters only, so `like` and `ilike` behave the same there, and non-ASCII letters (`É` vs `é`) compare case-sensitively.

### Array operators

| Operator | Description | Example |
|----------|-------------|---------|
| `in` | Value is in array | `status in ['active', 'pending']` |
| `not_in` | Value is not in array | `role not_in ['guest', 'banned']` |

Arrays are written with square brackets and comma-separated values:

```
priority in ['high', 'urgent']
id in [1, 2, 3, 4, 5]
```

A single value is automatically wrapped in an array:

```
// These produce the same result
status in 'active'
status in ['active']
```

### Range operator

| Operator | Description | Example |
|----------|-------------|---------|
| `between` | Value is between two bounds (inclusive) | `age between [18, 65]` |

`between` requires a 2-element array:

```
price between [10, 100]
date between ['2024-01-01', '2024-12-31']
```

### Null-check operators

| Operator | Description | Example |
|----------|-------------|---------|
| `is_null` | Value is null | `assignedTo is_null` |
| `is_not_null` | Value is not null | `dueDate is_not_null` |

These operators take no value — the field name is sufficient:

```
assignedTo is_null
dueDate is_not_null
```

Using `eq null` also works and is automatically converted to `is_null`:

```
// These are equivalent
assignedTo eq null
assignedTo is_null
```

## Logical operators

Combine conditions with `AND` and `OR` (case-insensitive):

```
status eq 'active' and priority eq 'high'
role eq 'admin' or role eq 'moderator'
```

### Precedence

`AND` binds tighter than `OR`:

```
// This expression:
a eq 1 or b eq 2 and c eq 3

// Is parsed as:
a eq 1 or (b eq 2 and c eq 3)

// NOT as:
(a eq 1 or b eq 2) and c eq 3
```

### Grouping with parentheses

Use parentheses to override precedence:

```
(status eq 'active' or status eq 'pending') and priority eq 'high'
(role eq 'admin' or (role eq 'user' and verified eq true)) and active eq true
```

## Value types

| Type | Examples | Notes |
|------|----------|-------|
| String | `'hello'`, `"world"` | Single or double quotes |
| Number | `42`, `-17`, `3.14`, `1e5`, `1.5e-7` | Integers, decimals, and exponents |
| Boolean | `true`, `false` | Case-insensitive |
| Null | `null` | Case-insensitive |
| Array | `[1, 2, 3]`, `['a', 'b']` | Used with `in`, `not_in`, `between` |

### String escaping

Strings support escape sequences:

| Sequence | Character |
|----------|-----------|
| `\'` | Single quote |
| `\"` | Double quote |
| `\\` | Backslash |
| `\n` | Newline |
| `\t` | Tab |

A number is `-?digits(.digits)?(e±digits)?`. A number that runs into letters or dots (`1.2.3`, `18abc`) is an `Invalid number` syntax error, and so is one too large to be finite (`1e999`).

### Type coercion

Unquoted values are automatically coerced:
- `42` → number
- `true` / `false` → boolean
- `null` → null
- `'42'` → string (quotes preserve type)

## Sort expressions

Sorting is specified with the `sort` query parameter:

```
?sort=name:asc,createdAt:desc
```

### Format

Comma-separated `field:direction` pairs. Direction defaults to `asc` if omitted.

```
sort=name              → name ascending
sort=name:asc          → name ascending (explicit)
sort=name:desc         → name descending
sort=name:asc,age:desc → name ascending, then age descending
```

Direction is case-insensitive: `ASC`, `asc`, and `Asc` all work. Anything else is an `INVALID_VALUE` error rather than a silent ascending sort:

```
sort=name:sideways     → error: Invalid sort direction 'sideways' for 'name'. Use asc or desc
sort=:asc              → error: Missing sort field
sort=name:asc:desc     → error: Invalid sort item 'name:asc:desc'
```

To parse a sort string yourself, use `parseSort(expr)`, which returns `Result<SortNode[]>`. The older `parseSortExpression` is deprecated: it treats anything but `desc` as `asc`. With a schema, `parseSort(expr, schema)` also rejects unknown and `sortable: false` fields (see [Schema Validation](schema-validation.md#sorting)).

## Pagination

| Parameter | Description | Example |
|-----------|-------------|---------|
| `limit` | Maximum rows to return | `limit=50` |
| `offset` | Number of rows to skip | `offset=100` |

`limit` must be a plain integer from 1 to `maxLimit` (default 1000, `query.limits.max`). `offset` must be a plain non-negative integer. Values like `10abc`, `2.9`, `1e2`, or `+5` are rejected with `INVALID_VALUE` instead of being truncated.

`parseQueryString(input, options)` takes `QueryStringOptions`:

| Option | Default | Description |
|--------|---------|-------------|
| `maxLimit` | `1000` | Largest accepted `limit` |
| `defaultLimit` | none | `limit` to use when the query string has none; capped at `maxLimit` |

Both must be positive integers, or `parseQueryString` returns an `INVALID_VALUE` error. `Compiler` accepts `maxLimit` too and validates `limit` / `offset` the same way in `compiler.parse(...)`.

## Limits

Every filter is checked against three limits while it is parsed, so an oversized request becomes a `ParseError` before it reaches the database:

| Limit | Default | What it counts |
|-------|---------|----------------|
| `maxDepth` | `32` | Deepest parenthesis nesting |
| `maxParameters` | `100` | Values the filter carries: 1 per comparison, 1 per `in` / `not_in` element, 2 for `between`, 0 for `is_null` / `is_not_null` |
| `maxConditions` | `1000` | Comparisons in the filter |

`maxParameters` defaults to 100 because that is Cloudflare D1's per-query cap on bound parameters. Lower it if the route binds its own parameters alongside the filter (a workspace scope, a soft-delete flag). `maxConditions` bounds the size of the tree; `maxParameters` alone doesn't, since null checks bind no values. On SQLite and D1, a single chain near 1,000 terms fails anyway: SQLite parses `a AND b AND ...` into a binary tree and rejects one 1,000 levels deep ("Expression tree is too large"). Drizzle's own parentheses and any conditions the route adds around the filter use up a level or two, so through Drizzle it already fails at 999. If one chain of null checks could get that long, set `maxConditions` to 900 or so.

Exceeding a limit returns a `LIMIT_EXCEEDED` error:

```
Filter is nested more than 32 levels deep
Filter has 150 values; the limit is 100
Filter has 1001 conditions; the limit is 1000
```

Override them per call. The type is `FilterLimits`, and the defaults live in `query.limits`:

```typescript
import { Compiler, parseFilter } from "@chromav/frizzle";
import { compileFilter, compileFilterToSQL } from "@chromav/frizzle/drizzle";

parseFilter(expr, schema, { maxParameters: 50 });
await compileFilter(expr, columns, { schema, maxParameters: 50 });
compileFilterToSQL(expr, columns, { schema, maxDepth: 8 });
new Compiler({ schema, codeGenerator, maxParameters: 50, maxConditions: 200 });
```

`parseFilterExpression(input, limits)` takes the same object. A limit must be a non-negative integer; `undefined` or `null` means the default, and anything else (`NaN`, `Infinity`, `-1`, `2.5`) returns an `INVALID_VALUE` error. `countParameters(node)` returns the number of values a parsed filter binds, if you need to budget parameters yourself.

## Complete URL examples

```
# Simple filter
?filter=status eq 'active'

# Filter with sort
?filter=status eq 'active'&sort=createdAt:desc

# Complex filter with sort and pagination
?filter=(status eq 'active' OR status eq 'pending') AND priority eq 'high'&sort=priority:desc,createdAt:asc&limit=25&offset=0

# Array filter
?filter=id in [1, 2, 3, 4, 5]&sort=name:asc

# Null checks
?filter=assignedTo is_not_null AND dueDate lt '2024-12-31'&sort=dueDate:asc

# String search
?filter=title contains 'deploy' AND status ne 'done'&sort=updatedAt:desc&limit=20
```

## URL encoding

In real URLs, spaces and special characters must be encoded:

```
# Raw expression
filter=name eq 'John Doe' and age >= 18

# URL-encoded
filter=name%20eq%20%27John%20Doe%27%20and%20age%20%3E%3D%2018
```

Named operators (`eq`, `gte`, `in`) are URL-safe and don't need encoding. This is one reason to prefer them over symbols.

The filter parser does not URL-decode its input. `parseQueryString` (and `URLSearchParams`) already decode the `filter` parameter, so pass the decoded string to `parseFilter` / `compileFilter`. An encoded string such as `name%20eq%201` is a syntax error.

## Formal grammar

For the complete EBNF grammar, see [query-spec.md](query-spec.md).
