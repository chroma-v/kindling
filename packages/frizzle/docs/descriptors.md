# Descriptors

Descriptors are frizzle's database-agnostic intermediate representations (IRs). They describe *what* to do without coupling to *how* it's done. Interceptors transform descriptors; adapters execute them.

```
User request
    ↓
Descriptor (created)
    ↓ interceptor pipeline
Descriptor (enriched)
    ↓ adapter
Database operation
```

## QueryDescriptor

Describes a read operation — filter, sort, pagination, projection, and relation includes.

```typescript
import { mergeDescriptors } from "@chromav/frizzle";
import type { QueryDescriptor } from "@chromav/frizzle";
```

### Creating

A `QueryDescriptor` is a plain object — there is no factory function.

```typescript
// Empty descriptor (returns all rows)
const empty: QueryDescriptor = {};

// With initial values
const desc: QueryDescriptor = {
  filter: { status: "active" },
  sort: { createdAt: "desc" },
  take: 20,
};
```

### Merging

`mergeDescriptors(a, b)` produces a new descriptor. Filters are combined with `mergeFilters`, which ANDs them: the result matches only what both match. Disjoint keys share one object; the same key with different values (or two different `OR` arrays) becomes `{ AND: [...] }`; conditions already present aren't repeated, so merging a filter with a superset of itself adds nothing. Includes deep-merge, selects shallow-merge, and sort/take/skip are last-write-wins.

The same combinators are exported for combining where objects yourself: `andWhere(...filters)` (AND, what `mergeFilters` uses) and `orWhere(first, ...rest)` (OR), e.g. `andWhere({ workspaceId }, orWhere({ ownerId: me }, { shared: true }), userFilter)`. They work on compiled where objects; to combine filter trees before compiling (`parseFilter` output, `f` builders), use `f.and` / `f.or`. (`allOf` / `anyOf`, their 0.3.0 names, are deprecated aliases.)

Because filters AND, a `.filter()` or interceptor can narrow a query but never widen or replace an earlier condition: `createQuery().filter({ status: "draft" }).filter({ status: "published" })` matches nothing, and a user filter can't swap out a scope's `workspaceId`.

```typescript
const base: QueryDescriptor = { filter: { status: "active" } };

// Interceptor adds workspace scope
const scoped = mergeDescriptors(base, {
  filter: { workspaceId: "ws-1" },
});
// scoped.filter = { status: "active", workspaceId: "ws-1" }
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `filter` | `Filter` | Key-value filter with operator objects and OR branches |
| `sort` | `Sort` | `{ field: "asc" \| "desc" }` |
| `take` | `number` | Max rows to return (LIMIT) |
| `skip` | `number` | Rows to skip (OFFSET) |
| `select` | `Select` | `{ field: true }` — column projection |
| `include` | `Include` | `{ relation: true \| { ... } }` — relation loading |

### Filter type

The `Filter` type supports bare values (equality), operator objects, and OR branches:

```typescript
const filter: Filter = {
  // Bare value = equality
  status: "active",

  // Operator object
  priority: { gte: 3 },

  // Multiple operators (AND within the field)
  createdAt: { gte: "2026-01-01", lte: "2026-12-31" },

  // NULL
  assignedTo: null,

  // OR branches
  OR: [
    { status: "active" },
    { priority: { gte: 4 } },
  ],
};
```

Available operators: `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `isNull`, `isNotNull`.

## WriteDescriptor

Describes a write operation — mutation type, values, and target IDs.

```typescript
import { createWriteDescriptor, mergeWriteDescriptor } from "@chromav/frizzle";
import type { WriteDescriptor } from "@chromav/frizzle";
```

### Creating

```typescript
// Insert with values
const insert = createWriteDescriptor("insert", {
  title: "New task",
  status: "backlog",
  priority: 0,
});

// Update with values (no targets yet)
const update = createWriteDescriptor("update", { status: "done" });

// Delete (no values needed)
const remove = createWriteDescriptor("delete");
```

### Merging

`mergeWriteDescriptor` produces a new descriptor by merging values and metadata:

```typescript
// Add target IDs
const targeted = mergeWriteDescriptor(update, {
  targetIds: ["task-1", "task-2"],
});

// Interceptor injects audit fields
const audited = mergeWriteDescriptor(targeted, {
  values: { updatedById: "user-1" },
});
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `mutation` | `"insert" \| "update" \| "delete"` | SQL operation type |
| `values` | `Record<string, unknown>` | Column values for INSERT/UPDATE |
| `targetIds` | `string[]` | Row IDs for UPDATE/DELETE |

### Mutation vs operation

An important distinction for interceptors: the `mutation` field describes the SQL operation, but the *semantic operation* may differ. For example, soft-delete:

```typescript
// Semantic operation: "remove" (user wants to delete)
// But soft-delete interceptor transforms it:
const original = createWriteDescriptor("delete");
// → after interceptor:
const transformed = createWriteDescriptor("update", {
  isDeleted: true,
  deletedAt: new Date().toISOString(),
});
```

The mutation changed from `delete` to `update`, but the intent was always "remove".

## Immutability

`createWriteDescriptor` and `mergeWriteDescriptor` return frozen objects. `mergeDescriptors` returns a new object. None of the merge functions mutate their input. This makes interceptor pipelines safe: each interceptor sees the output of the previous one, and the original is preserved.

```typescript
const a: QueryDescriptor = { filter: { status: "active" } };
const b = mergeDescriptors(a, { filter: { workspaceId: "ws-1" } });

a.filter; // { status: "active" } — unchanged
b.filter; // { status: "active", workspaceId: "ws-1" } — new object
a === b;  // false
```
