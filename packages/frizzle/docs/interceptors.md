# Interceptors

Interceptors are composable middleware for query and write pipelines. They transform descriptors before they reach the database — adding scoping, soft-delete filtering, audit trails, and other cross-cutting concerns.

## Concept

```
QueryDescriptor → [scope] → [softDelete] → [defaults] → enriched QueryDescriptor → adapter
WriteDescriptor → [scope] → [inject] → [softDelete] → enriched WriteDescriptor → adapter
```

Each interceptor receives a context with the current descriptor and can either pass it through or rewrite it. Interceptors are composed in order — the output of one feeds the next.

## Query interceptors

Query interceptors implement `QueryInterceptor<T>` with `onExecuting` (before execute, receives a `QueryExecutingContext`) and `onExecuted` (after execute, receives a `QueryExecutedContext`) hooks:

```typescript
import type { QueryInterceptor, QueryExecutingContext } from "@chromav/frizzle";

const myInterceptor: QueryInterceptor<MyEntity> = {
  onExecuting(ctx: QueryExecutingContext<MyEntity>) {
    // Pass through unchanged
    return ctx;

    // Or rewrite the descriptor
    return ctx.rewrite({
      filter: { ...ctx.descriptor.filter, isActive: true },
    });
  },
};
```

## Write interceptors

Write interceptors implement `WriteInterceptor<T>` with `onWriting` (before execute) and `onWritten` (after execute) hooks:

```typescript
import type { WriteInterceptor, WritingContext, WrittenContext } from "@chromav/frizzle";

const myInterceptor: WriteInterceptor<MyEntity> = {
  onWriting(ctx: WritingContext<MyEntity>) {
    // Transform the descriptor before execution
    return ctx.rewrite({
      values: { ...ctx.descriptor.values, updatedAt: new Date().toISOString() },
    });
  },

  onWritten(ctx: WrittenContext<MyEntity>) {
    // React after execution (logging, cache invalidation, etc.)
    console.log(`Wrote ${ctx.descriptor.targetIds?.length} rows`);
    return ctx;
  },
};
```

## Reference interceptors

Frizzle ships reference implementations for common patterns. All are exported from the main `@chromav/frizzle` entry point.

### scopeQueryInterceptor

Appends tenant/workspace filter to every query. Place last in the pipeline so user filters can't override it.

```typescript
import { scopeQueryInterceptor } from "@chromav/frizzle";

// Every query gets { workspaceId: "ws-123" } merged into its filter
const scope = scopeQueryInterceptor({ workspaceId: "ws-123" });
```

Accepts any `Record<string, unknown>` — not limited to workspace scoping:

```typescript
// Multi-field scope
const scope = scopeQueryInterceptor({
  workspaceId: "ws-123",
  tenantId: "t-456",
});
```

### scopeWriteInterceptor

Injects scope values into every write's values (insert and update):

```typescript
import { scopeWriteInterceptor } from "@chromav/frizzle";

const scope = scopeWriteInterceptor({ workspaceId: "ws-123" });
// Insert: { title: "Task" } → { title: "Task", workspaceId: "ws-123" }
// Update: { status: "done" } → { status: "done", workspaceId: "ws-123" }
```

### softDeleteQueryInterceptor

Excludes soft-deleted rows by appending `{ isDeleted: false }` to every query filter:

```typescript
import { softDeleteQueryInterceptor } from "@chromav/frizzle";

const softDelete = softDeleteQueryInterceptor();
// Every query gets: filter.isDeleted = false
```

Custom column name:

```typescript
const softDelete = softDeleteQueryInterceptor({ column: "deleted" });
// Every query gets: filter.deleted = false
```

### softDeleteWriteInterceptor

Transforms delete operations into updates that set soft-delete flags:

```typescript
import { softDeleteWriteInterceptor } from "@chromav/frizzle";

const softDelete = softDeleteWriteInterceptor("user-456");
```

What it does:
- **Delete** → mutation becomes `update` with `{ isDeleted: true, deletedAt: <ISO string>, deletedById: <userId> }`
- **Insert/Update** → passed through unchanged

Custom column names:

```typescript
import type { SoftDeleteConfig } from "@chromav/frizzle";

const config: SoftDeleteConfig = {
  column: "deleted",              // default: "isDeleted"
  deletedAtColumn: "removed_at",  // default: "deletedAt"
  deletedByColumn: "removed_by",  // default: "deletedById"
};

const softDelete = softDeleteWriteInterceptor("user-456", config);
```

### injectWriteInterceptor

Injects audit trail fields — `createdById` on insert, `updatedById` on update:

```typescript
import { injectWriteInterceptor } from "@chromav/frizzle";

const inject = injectWriteInterceptor("user-456");
// Insert: values.createdById = "user-456"
// Update: values.updatedById = "user-456"
// Delete: no change
```

Custom column names:

```typescript
import type { InjectConfig } from "@chromav/frizzle";

const config: InjectConfig = {
  createdByColumn: "created_by",   // default: "createdById"
  updatedByColumn: "modified_by",  // default: "updatedById"
};

const inject = injectWriteInterceptor("user-456", config);
```

### defaultIncludesInterceptor

Deep-merges default relation includes into every query:

```typescript
import { defaultIncludesInterceptor } from "@chromav/frizzle";

const defaults = defaultIncludesInterceptor({
  assignee: true,
  project: { columns: { id: true, name: true } },
});
// Every query gets these includes merged in (user includes take precedence)
```

### extraScopeInterceptor

Adds entity-specific filter conditions from a factory function:

```typescript
import { extraScopeInterceptor } from "@chromav/frizzle";

const extra = extraScopeInterceptor(() => ({
  status: { ne: "archived" },
}));
// Every query gets: filter.status = { ne: "archived" }
```

### extraScopeWriteInterceptor

Injects additional scope fields on insert only:

```typescript
import { extraScopeWriteInterceptor } from "@chromav/frizzle";

const extra = extraScopeWriteInterceptor(() => ({
  organizationId: "org-789",
}));
// Insert: values.organizationId = "org-789"
// Update/Delete: no change
```

## Composing a pipeline

Interceptors are applied in order. For reads, place the scope interceptor last so user filters can't override it:

```typescript
const queryInterceptors = [
  defaultIncludesInterceptor({ assignee: true }),
  extraScopeInterceptor(() => ({ status: { ne: "archived" } })),
  softDeleteQueryInterceptor(),
  scopeQueryInterceptor({ workspaceId }),  // last = unforgeable
];
```

For writes, scope and inject run first, soft-delete transforms the mutation:

```typescript
const writeInterceptors = [
  scopeWriteInterceptor({ workspaceId }),
  extraScopeWriteInterceptor(() => ({ projectId })),
  injectWriteInterceptor(userId),
  softDeleteWriteInterceptor(userId),
];
```

## Writing your own

### Query interceptor

```typescript
import type { QueryInterceptor } from "@chromav/frizzle";

function myQueryInterceptor<T>(): QueryInterceptor<T> {
  return {
    onExecuting(ctx) {
      // Add a filter
      return ctx.rewrite({
        filter: { ...ctx.descriptor.filter, myField: "value" },
      });
    },
  };
}
```

### Write interceptor

```typescript
import type { WriteInterceptor } from "@chromav/frizzle";
import { mergeWriteDescriptor } from "@chromav/frizzle";

function timestampInterceptor<T>(): WriteInterceptor<T> {
  return {
    onWriting(ctx) {
      const now = new Date().toISOString();
      const { mutation } = ctx.descriptor;

      if (mutation === "insert") {
        return ctx.rewrite({ values: { ...ctx.descriptor.values, createdAt: now } });
      }
      if (mutation === "update") {
        return ctx.rewrite({ values: { ...ctx.descriptor.values, updatedAt: now } });
      }
      return ctx;
    },
  };
}
```

## Entity type constraints

Frizzle exports marker interfaces for entities that support specific interceptor patterns:

```typescript
import type { Trashable, Orderable } from "@chromav/frizzle";

// Entity must have these fields to use soft-delete interceptors
interface Trashable {
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedById?: string | null;
}

// Entity must have this field to use ordering interceptors
interface Orderable {
  order: number;
}
```

These are compile-time constraints only — they help catch misuse when wiring interceptors to entity definitions.
