# Error Handling

Every frizzle function returns a `Result<T>` — a discriminated union of success or error. No exceptions are thrown. This makes error handling explicit and composable.

## The Result type

```typescript
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: ParseError }
```

Use the `isSuccess` and `isError` type guards:

```typescript
import { isSuccess, isError } from "@chromav/frizzle";

const result = await compileFilter("status eq 'active'", columns);

if (isSuccess(result)) {
  result.data;  // DrizzleWhere — the compiled output
}

if (isError(result)) {
  result.error;  // ParseError — structured error details
}
```

## ParseError shape

Every error includes structured metadata for logging, debugging, and user-facing messages:

```typescript
interface ParseError {
  message: string;          // Human-readable message
  code: ParseErrorCode;     // Machine-readable error code
  position: number;         // Character offset in the input
  context: string;          // Snippet around the error
  field?: string;           // Field name (for field-specific errors)
  suggestions?: string[];   // Possible fixes
}
```

### Example

```typescript
const result = await compileFilter("statis eq 'active'", columns, { schema });

if (isError(result)) {
  result.error.message;     // "Unknown field 'statis'"
  result.error.code;        // "UNKNOWN_FIELD"
  result.error.position;    // 0
  result.error.field;       // "statis"
  result.error.suggestions; // ["status", ...] — closest schema fields first
}
```

## Error codes

| Code | Meaning | Example cause |
|------|---------|---------------|
| `SYNTAX_ERROR` | Malformed expression, including a missing value or unbalanced parentheses | `"age ?? 18"`, `"(age eq 18"`, `"status eq"` |
| `UNKNOWN_FIELD` | Field not in column mappings or schema | `"statis eq 'active'"` when schema has `status` |
| `INVALID_FIELD_NAME` | Field name is a reserved word, in a tree built in code (the parser rejects `"and eq 1"` as a `SYNTAX_ERROR` before any field check) | `validateFilter(f.eq("and", 1), schema)` |
| `UNSORTABLE_FIELD` | The field exists but can't be sorted: mapped to a resolver, a nested relation path, or `sortable: false` in the schema | `sort=tags:asc` when `tags` is a resolver |
| `INVALID_OPERATOR` | Operator not supported for this field type, or not in the field's `operators` list | `"age like 'eighteen'"` on a number field |
| `TYPE_MISMATCH` | Value can't be coerced to field's type, or operator/value combo is invalid | `"age eq 'abc'"` with a schema; `"age gt null"` in the generators (a schema rejects `null` on a non-nullable field first, as `INVALID_VALUE`) |
| `INVALID_VALUE` | Value fails validation (out of range, not in enum), a bad `limit` / `offset` / sort direction, or an invalid limit option | `"age eq 150"` with `max: 120`, `limit=10abc`, `sort=name:sideways` |
| `LIMIT_EXCEEDED` | Filter is nested too deeply, carries too many values, has too many conditions, or has an `in` list longer than the field's `maxValues` (see [Limits](query-language.md#limits)) | 150-element `in` list with the default `maxParameters: 100` |
| `MISSING_VALUE` | No longer produced — a missing value is a `SYNTAX_ERROR` (`Expected value, got end of input`). Kept in the `ParseErrorCode` union for compatibility. | — |
| `UNBALANCED_PARENTHESES` | No longer produced — mismatched parentheses are a `SYNTAX_ERROR` (`Unbalanced parentheses: missing closing parenthesis`). Kept in the `ParseErrorCode` union for compatibility. | — |

Syntax error messages say what the parser expected at `position`, for example `Expected operator, got '18'` (for `"age 18"`), `Expected and, or or end of input, got '18'` (for `"age gte 18 18"`), `Unterminated string literal`, or `Invalid number` (for `"age eq 18abc"`).

## Resilient error handling

When filters come from user input (URL query strings), you want the page to render even if the filter is invalid. Don't let a bad filter string cause a 500.

### Pattern: compile, fallback, show error

```typescript
import { isSuccess } from "@chromav/frizzle";
import { compileFilter } from "@chromav/frizzle/drizzle";

// Default query — always valid
let where = { projectId: id, isDeleted: false };
let filterError: string | undefined;

if (filterString) {
  const result = await compileFilter(filterString, columns, { schema });

  if (isSuccess(result)) {
    where = { AND: [where, result.data] };
  } else {
    // Log for debugging, surface to user
    console.warn("[filter]", result.error.code, result.error.message);
    filterError = result.error.message;
  }
}

// Query always runs — with or without filter
const tasks = await db.query.tasks.findMany({ where });

// Return error to UI for inline display (error pill, toast, etc.)
return { tasks, filterError };
```

### Two-level defense

Even with compile-time validation, it's good practice to catch query execution errors as a safety net — for resolver bugs, Drizzle ORM changes, or edge cases validation didn't anticipate.

```typescript
// Level 1: Check the Result (catches most errors)
const filterResult = await compileFilter(filterString, columns, { schema });

if (isSuccess(filterResult)) {
  // Combine with AND — never object spread: `{ ...baseWhere, ...filterResult.data }`
  // lets a user-supplied key (e.g. `projectId`) replace yours.
  where = { AND: [baseWhere, filterResult.data] };
}

// Level 2: Catch query execution errors (safety net)
const project = await db.query.projects
  .findFirst({
    where: { id: params.id },
    with: { tasks: { where } },
  })
  .catch(async (err) => {
    // If no filter was applied, this is a real error — re-throw
    if (!filterString) throw err;

    // Filter caused a query error — fall back to unfiltered
    filterError = "Filter could not be applied";
    return db.query.projects.findFirst({
      where: { id: params.id },
      with: { tasks: { where: baseWhere } },
    });
  });
```

| Scenario | Level 1 catches | Level 2 catches |
|----------|-----------------|-----------------|
| Syntax error (`?? syntax`) | Yes | N/A |
| Invalid operator/value (`gt null`) | Yes | N/A |
| Unknown field name | Yes | N/A |
| Resolver returns bad shape | No | Yes |
| Drizzle ORM bug | No | Yes |
| New operator without validation | Yes | N/A |

## Creating Results (advanced)

If you're building custom code generators or middleware, you can create Result values directly:

```typescript
import { createSuccess, createError, createParseError } from "@chromav/frizzle";

// Success
const ok = createSuccess({ status: "active" });

// Error with full ParseError:
// createParseError(message, position, input, code, field?, suggestions?)
const err = createError(createParseError(
  "Custom error message",
  0,              // position in the input
  filterString,   // input — used to build the error's `context` snippet
  "SYNTAX_ERROR",
));

// Propagate an error from one Result to another type
import { propagateError } from "@chromav/frizzle";
const propagated = propagateError<NewType>(err);
```
