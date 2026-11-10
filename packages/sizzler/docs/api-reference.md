# API Reference

All column factories are **Workers-safe** and return standard Drizzle column builders. You can chain any Drizzle method (`.notNull()`, `.unique()`, `.default()`, etc.) on the result.

## Column Factories

```typescript
import {
  primaryKey,
  foreignKey,
  createdAt,
  updatedAt,
  timestamp,
  boolean,
  enums,
  jsonArray,
} from "@chromav/sizzler";
```

### `primaryKey(name?)`

Creates a text column with auto-generated [ULID](https://github.com/ulid/spec) as the default value.

[ULIDs](https://github.com/ulid/spec) are like UUIDs but sortable by creation time (the first 10 characters encode a millisecond timestamp). They're 26 characters, URL-safe, and can be generated client-side without a database roundtrip — useful for optimistic UI.

```typescript
// Default column name is "id"
id: primaryKey(),

// Custom column name
pk: primaryKey("custom_id"),
```

### `foreignKey(name, ref, type?, actions?)`

Creates a foreign key column referencing another table's column.

Defaults to `"text"` type to match sizzler's ULID-based `primaryKey()`. Pass `"integer"` for numeric foreign keys.

```typescript
// Text FK (default) — matches ULID primary keys
authorId: foreignKey("author_id", users.id),

// With cascade delete
parentId: foreignKey("parent_id", tasks.id, "text", { onDelete: "cascade" }),

// Integer FK (for numeric references)
legacyCategoryId: foreignKey("category_id", categories.id, "integer"),

// Chaining works
ownerId: foreignKey("owner_id", users.id).notNull(),
```

### `createdAt()` / `updatedAt()`

Timestamp columns defaulting to SQLite's `unixepoch()`. Both are `.notNull()` by default.

```typescript
createdAt: createdAt(),  // Column name: "created_at"
updatedAt: updatedAt(),  // Column name: "updated_at"
```

> **Note on `updatedAt()`:** The default value is only set on row *creation*. SQLite does not auto-update timestamps on modification. You need to handle this in your application code:
>
> ```typescript
> await db.update(users)
>   .set({ name: "New Name", updatedAt: new Date() })
>   .where(eq(users.id, userId));
> ```
>
> Or create a database trigger:
>
> ```sql
> CREATE TRIGGER update_users_timestamp
>   AFTER UPDATE ON users
>   BEGIN UPDATE users SET updated_at = unixepoch() WHERE id = NEW.id; END;
> ```

### `timestamp(name)`

A bare integer column in timestamp mode (no automatic default).

```typescript
dueAt: timestamp("due_at"),
completedAt: timestamp("completed_at"),
```

### `boolean(name)`

Integer column in boolean mode (stores 0/1, reads as `true`/`false`).

```typescript
isActive: boolean("is_active"),
isPublished: boolean("is_published"),
```

### `enums(name, values, default?)`

Text column with type-safe enum validation. Defaults to the first value if no default is specified. The `default` parameter is type-constrained to values in the enum tuple — TypeScript will reject invalid defaults at compile time.

```typescript
const priority = ["low", "medium", "high"] as const;

taskPriority: enums("priority", priority),           // defaults to "low"
taskPriority: enums("priority", priority, "medium"),  // defaults to "medium"
// enums("priority", priority, "invalid")            // TS error: not assignable to "low" | "medium" | "high"
```

### `jsonArray<T>(name)`

Text column storing JSON with a typed generic parameter.

```typescript
// Simple string array
tags: jsonArray<string[]>("tags"),

// Typed object array
metadata: jsonArray<{ key: string; value: string }[]>("metadata"),
```

## Drizzle Primitives

Sizzler re-exports these from `drizzle-orm/sqlite-core` for convenience, so you don't need a separate import:

```typescript
import { table, text, integer, real, index, uniqueIndex } from "@chromav/sizzler";
```

`table` is `sqliteTable`, `index` and `uniqueIndex` are the table-level index builders, and the rest are the standard Drizzle column builders.
