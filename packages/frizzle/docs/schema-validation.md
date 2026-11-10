# Schema Validation

Schema validation catches invalid filters before they reach the database. When you define a schema, frizzle validates field names, operator compatibility, value types, and enum membership — returning descriptive errors with suggestions instead of broken queries.

Schema validation is optional. Without a schema, frizzle compiles any syntactically valid expression. With a schema, it enforces your data model's constraints.

## Defining a schema

A schema maps field names to their type definitions:

```typescript
import type { Schema } from "@chromav/frizzle";

const schema: Schema = {
  title: { type: "string" },
  age: { type: "number", min: 0, max: 120 },
  active: { type: "boolean" },
  role: { type: "enum", enumValues: ["admin", "user", "guest"] },
  email: { type: "string", nullable: true },
  joinedAt: { type: "date" },
  userId: { type: "uuid" },
};
```

## SchemaField options

| Option | Type | Description |
|--------|------|-------------|
| `type` | `FieldType` | **Required.** One of: `string`, `number`, `boolean`, `date`, `uuid`, `enum` |
| `nullable` | `boolean` | Whether the field accepts `null`. Default: `false` |
| `enumValues` | `string[]` | Valid values for `enum` fields. Empty `[]` skips value validation |
| `min` | `number` | Minimum value for `number` fields |
| `max` | `number` | Maximum value for `number` fields. Limits each value, not how many an `in` list holds |
| `maxValues` | `number` | Most values an `in` / `not_in` list on this field may hold. Beyond it: `LIMIT_EXCEEDED` |
| `operators` | `ComparisonOperator[]` | Replace the default operators allowed for this field type (see [Overriding operators](#overriding-operators)) |
| `sortable` | `boolean` | Whether schema-aware sort parsing accepts this field. Default: `true` (see [Sorting](#sorting)) |

## Field types

### string

Supports text matching and pattern operators.

```typescript
{ type: "string" }
```

```
title eq 'Deploy v2'
title contains 'deploy'
name starts_with 'Dr.'
email ends_with '@company.com'
name like 'john'
```

### number

Supports comparison and range operators. Values are coerced from strings (`"18"` → `18`).

```typescript
{ type: "number", min: 0, max: 1000 }
```

```
age gte 18
price lt 100
score between [80, 100]
priority in [1, 2, 3]
```

### boolean

Only supports equality checks.

```typescript
{ type: "boolean" }
```

```
active eq true
verified eq false
```

### date

Supports comparison and range operators. Date strings are validated but not parsed — they pass through as strings to the database.

```typescript
{ type: "date" }
```

```
createdAt gte '2024-01-01'
dueDate lt '2024-12-31'
updatedAt between ['2024-01-01', '2024-06-30']
```

### uuid

Supports equality and membership checks.

```typescript
{ type: "uuid" }
```

```
userId eq '550e8400-e29b-41d4-a716-446655440000'
assignedTo in ['id-1', 'id-2', 'id-3']
```

### enum

Supports equality and membership checks. Values are validated against `enumValues`.

```typescript
{ type: "enum", enumValues: ["active", "pending", "done"] }
```

```
status eq 'active'
status in ['active', 'pending']
status ne 'done'
```

## Default operators by field type

Each field type has a default set of allowed operators. Filters using an unsupported operator return an `INVALID_OPERATOR` error.

| Type | Default operators |
|------|-------------------|
| `string` | `eq`, `ne`, `like`, `ilike`, `contains`, `starts_with`, `ends_with`, `in`, `not_in`, `is_null`, `is_not_null` |
| `number` | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `not_in`, `is_null`, `is_not_null` |
| `boolean` | `eq`, `ne`, `is_null`, `is_not_null` |
| `date` | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `is_null`, `is_not_null` |
| `uuid` | `eq`, `ne`, `in`, `not_in`, `is_null`, `is_not_null` |
| `enum` | `eq`, `ne`, `in`, `not_in`, `is_null`, `is_not_null` |

### Overriding operators

Use the `operators` field to restrict or expand the allowed operators for a specific field:

```typescript
const schema: Schema = {
  // Only allow exact match on status
  status: {
    type: "enum",
    enumValues: ["active", "pending", "done"],
    operators: ["eq", "ne"],
  },
  // Allow range queries on a string field
  name: {
    type: "string",
    operators: ["eq", "ne", "gt", "gte", "lt", "lte", "contains"],
  },
};
```

## What validation checks

### 1. Field names

Unknown fields are rejected. The error suggests similar field names for typos:

```typescript
// Schema has "status", user types "statis"
// → Error: Unknown field 'statis' (suggestions: ["status", ...])
```

Field names that happen to be JavaScript object properties (`constructor`, `toString`, `isPrototypeOf`) are unknown fields like any other, unless your schema or column mappings define them. (Names starting with `_`, such as `__proto__`, aren't valid field names at all: fields start with a letter.)

### 2. Operator compatibility

Operators must be valid for the field type:

```typescript
// Schema: age is type "number"
// Filter: "age like 'eighteen'"
// → Error: Operator 'like' not supported for field 'age' of type 'number'
```

### 3. Value type coercion

Values are coerced to the field's type, so a filter means the same thing
whether or not the user quoted a value:

- `age eq '18'` → `18` for number fields
- `active eq 'true'` → `true` for boolean fields
- `name eq 5` → `"5"` for string, uuid and enum fields. This is intended: any
  literal can be read as text, and `name eq 5` and `name eq '5'` compare against
  the same string. Enum membership is checked after coercion.
- Coercions that can't succeed (`age eq 'abc'`, `active eq 3`) return a
  `TYPE_MISMATCH` error

The validated tree carries the coerced values, so compile the tree that
validation returns, not the one you passed in.

### 4. Range constraints

Number values are checked against `min` and `max`:

```typescript
// Schema: { age: { type: "number", min: 0, max: 120 } }
// Filter: "age eq 150"
// → Error: Value 150 is above maximum 120 for field 'age'
```

### 5. Enum membership

Values are checked against `enumValues`:

```typescript
// Schema: { status: { type: "enum", enumValues: ["active", "pending", "done"] } }
// Filter: "status eq 'deleted'"
// → Error: Value 'deleted' is not a valid option for field 'status'
//   (suggestions: ["active", "pending", "done"])
```

## Runtime-populated enums

Some enum fields have values that aren't known at compile time — like workspace-specific statuses or user-defined categories. Set `enumValues: []` to skip value validation while still checking field names, types, and operators:

```typescript
const schema: Schema = {
  // Values loaded from database at runtime — skip value checking
  status: {
    type: "enum",
    enumValues: [],
  },
  // Static values — validate normally
  priority: {
    type: "enum",
    enumValues: ["low", "medium", "high"],
  },
};
```

## Nullable fields

By default, `is_null` and `is_not_null` are allowed on all field types. The `nullable` option is informational — it doesn't currently restrict null-check operators, but documents whether your database column accepts NULL.

```typescript
const schema: Schema = {
  email: { type: "string", nullable: true },
  name: { type: "string" },  // nullable defaults to false
};
```

## Validating filters built in code

`parseFilter(expression, schema)` validates as it parses. When the tree comes
from code instead (shorthand query parameters, server-side conditions, or a
combination of those with the user's filter), build it with the `f` builders
and validate the combined tree once with `validateFilter`:

```typescript
import { f, isError, parseFilter, validateFilter, type Schema } from "@chromav/frizzle";
import { compileFilterNodeToSQL } from "@chromav/frizzle/drizzle";

const schema: Schema = {
  name: { type: "string", operators: ["eq", "contains", "starts_with"] },
  region: { type: "enum", enumValues: ["europe", "asia", "africa"], maxValues: 10 },
};

// ?filter=name contains 'land'&region=europe,asia
export function countryWhere(params: URLSearchParams) {
  // 1. Parse the user's expression without a schema: validation comes once, at the end
  const user = params.get("filter") ? parseFilter(params.get("filter")!) : undefined;
  if (user && isError(user)) {
    return user;
  }

  // 2. AND in the shorthand parameters; f.and skips the undefined ones
  const regions = params.get("region")?.split(",");
  const combined = f.and(user?.data, regions ? f.in("region", regions) : undefined);
  if (!combined) {
    return undefined; // no filter at all
  }

  // 3. Validate the combined tree: fields, operators, values and the limits
  const valid = validateFilter(combined, schema, { maxParameters: 90 });
  if (isError(valid)) {
    return valid;
  }
  return compileFilterNodeToSQL(valid.data, { name: countries.name, region: countries.region });
}
```

Why the whole tree, once:

- **Limits are totals.** `maxParameters` (default 100, Cloudflare D1's
  per-statement cap) counts every value the filter binds. Checking the user's
  filter alone would let the shorthand parameters push the statement over.
  Lower it if the query binds other parameters too.
- **Hand-built trees skip the parser's checks.** `validateFilter` applies
  `maxParameters`, `maxConditions` and `maxDepth` to any tree, then the schema.
  `new SchemaValidator(schema).validateFilterNode(node)` checks the schema only.
- **Per-field rules apply to every condition**, including the ones you added:
  `operators`, `maxValues`, `enumValues`, `min` / `max`.

`f.and(...)` puts a nested `or` in a group, so the tree means what it says and
`serializeFilterNode` writes it back with the right parentheses
(`name contains "land" and (region eq "europe" or region eq "asia")`). That
group counts as one level toward `maxDepth`. A nested chain with the same
operator is spliced in instead, so combining filters with `f.and` over and
over never adds nesting.

## Sorting

Fields are sortable by default. Mark a field `sortable: false` to reject it
(e.g. a long text column with no index), and pass the schema wherever sort is
parsed:

```typescript
import { parseQueryString, parseSort } from "@chromav/frizzle";

const schema: Schema = {
  name: { type: "string" },
  notes: { type: "string", sortable: false },
};

parseSort("name:desc", schema);           // success
parseSort("notes:asc", schema);           // UNSORTABLE_FIELD: Field 'notes' can't be sorted
parseSort("nam:asc", schema);             // UNKNOWN_FIELD, suggestions: ["name"]
parseSort("name:sideways", schema);       // INVALID_VALUE
parseQueryString(url, { schema });        // validates sort=... the same way
```

`Compiler` checks `sortable` for the sort nodes it's given. A field can also
be unsortable because of how it's mapped (a resolver with no column); the
generators report that as `UNSORTABLE_FIELD` too.

## Passing schemas to functions

### Standalone functions

```typescript
import { compileFilter, compileFilterToSQL } from "@chromav/frizzle/drizzle";

// RQB (async)
const result = await compileFilter(filterString, columns, { schema });

// SQL builder (sync)
const result = compileFilterToSQL(filterString, tableColumns, { schema });
```

### Compiler class

```typescript
import { createCompiler } from "@chromav/frizzle";

const compiler = createCompiler({
  schema,  // Baked into every operation
  codeGenerator: new DrizzleCodeGenerator(),
});
```
