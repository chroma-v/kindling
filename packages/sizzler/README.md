# sizzler 🔥

**Sensible defaults for Drizzle + SQLite. Now we're sizzling.**

Stop bikeshedding IDs, timestamps, and foreign keys. Define your schema, seed your database, and get back to building.

```typescript
import { primaryKey, foreignKey, createdAt, updatedAt, table, text, enums } from "@chromav/sizzler";

const status = ["pending", "in_progress", "done"] as const;

export const tasks = table("tasks", {
  id: primaryKey(),                              // ULID — sortable, client-generatable
  title: text("title").notNull(),
  status: enums("status", status),               // type-safe, defaults to first value
  assigneeId: foreignKey("assignee_id", users.id),
  createdAt: createdAt(),                        // unixepoch() default
  updatedAt: updatedAt(),
});
```

Works with D1, Turso, libsql, better-sqlite3 — anywhere Drizzle's SQLite adapter runs.

## What's in the box

### 1. Schema factories

Sensible defaults so you don't have to think about it:

| Factory | What you get |
|---------|--------------|
| `primaryKey()` | Text ULID — sortable by time, generate client-side, no DB roundtrip |
| `foreignKey(name, ref)` | Text FK to match ULID PKs (pass `"integer"` for numeric refs) |
| `createdAt()` / `updatedAt()` | Timestamps with `unixepoch()` default |
| `timestamp(name)` | Bare timestamp, no default |
| `boolean(name)` | Integer 0/1 (SQLite has no boolean type) |
| `enums(name, values)` | Type-safe text column, defaults to first value |
| `jsonArray<T>(name)` | Typed JSON storage |
| `timestampMs(name)` | Integer timestamp in milliseconds (for BetterAuth compatibility) |

Every factory returns a standard Drizzle column builder. Chain `.notNull()`, `.unique()`, whatever — then use `drizzle-kit` like normal.

### 2. Local dev helpers

The `@chromav/sizzler/node` entry point gets you connected and seeded fast:

```typescript
import { computeD1Filename, getLocalD1Path, createJSONSeeder, resetDatabase } from "@chromav/sizzler/node";

// Compute the exact filename miniflare uses for a D1 database
const filename = computeD1Filename("3c9d1256-e9bd-4617-ad46-22315915a680");
// => "feed28b9d46e13dcb8b4ff9ebe14a54b3b84fc08efd83b1de4251b30f50c9f10.sqlite"

// Find your local D1 database (uses computeD1Filename internally)
const dbPath = getLocalD1Path();

// Load seed data with automatic transforms
const seeder = createJSONSeeder({
  baseDir: "./seeds",
  transformers: commonTransformers.dateFields(["createdAt", "updatedAt"]),
});
const users = seeder.loadJSON("users.json");

// Reset and reseed (requires explicit confirmation)
await resetDatabase(db, schema, { confirm: true });
```

No more hunting for SQLite files in `.wrangler/`. No more reverse-engineering miniflare's hashed filenames. No more manual date parsing in seed scripts.

Running D1 code on a plain SQLite file? `attachD1BatchShim(db, sqlite)` gives a better-sqlite3 Drizzle instance D1's atomic `db.batch([...])`. See [Node utilities](docs/node-utilities.md#attachd1batchshimdb-sqlite).

### 3. Golden snapshots

Also on `@chromav/sizzler/node`: helpers for creating and restoring self-contained SQLite
"golden" snapshots — the foundation of fast, reproducible E2E tests (build the DB
once, restore the file per run instead of migrating + seeding every time).

```typescript
import { createSnapshot, restoreSnapshot } from "@chromav/sizzler/node";

// Create a golden snapshot from a live DB: checkpoints the WAL into the main
// file (so the .sqlite is self-contained), copies it, and verifies it has data.
createSnapshot(liveDbPath, "test-data/golden/test.sqlite", {
  verify: { countQuery: "SELECT COUNT(*) as count FROM user", min: 1 },
});

// Restore it onto a target DB atomically (temp file + rename — no torn/missing
// window), with a corruption guard and optional post-restore verification.
restoreSnapshot("test-data/golden/test.sqlite", liveDbPath, {
  minBytes: 100 * 1024,
  verify: { countQuery: "SELECT COUNT(*) as count FROM user", min: 1 },
});
```

Lower-level primitives are exported too: `checkpointDatabase`, `removeWalFiles`,
`removeOldSnapshot`, `verifySnapshot`, and `countRows`. These require the optional
`better-sqlite3` peer dependency (node-only — never imported in a Worker bundle),
and pair with `computeD1Filename`/`parseWranglerConfig` to locate the miniflare D1
file to snapshot or restore.

> ⚠️ **Restore semantics:** `restoreSnapshot` creates a new inode at the target
> path. Run it *before the server process opens the DB* (e.g. a `pretest` step),
> not mid-session against a live server — a running worker's mmap won't see the
> swapped file. (For mid-session resets, reset *within* the live DB connection
> instead.)

## Installation

```bash
npm install @chromav/sizzler drizzle-orm
```

## The boilerplate it replaces

<details>
<summary>See before/after</summary>

**Before:**

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { ulid } from "ulid";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey().notNull().$defaultFn(() => ulid()),
  title: text("title").notNull(),
  status: text("status", { enum: ["pending", "in_progress", "done"] }).default("pending"),
  assigneeId: text("assignee_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
```

**After:**

```typescript
import { primaryKey, foreignKey, createdAt, updatedAt, table, text, enums } from "@chromav/sizzler";

const status = ["pending", "in_progress", "done"] as const;

export const tasks = table("tasks", {
  id: primaryKey(),
  title: text("title").notNull(),
  status: enums("status", status),
  assigneeId: foreignKey("assignee_id", users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
```

</details>

## Why ULIDs?

The primary key choice is the most opinionated default. Here's the reasoning:

- **Sortable** — First 10 chars encode a millisecond timestamp. `ORDER BY id` works like `ORDER BY created_at`.
- **Client-generatable** — Know the ID before the insert hits the database. Essential for optimistic UI.
- **No coordination** — Works across edge locations, replicas, offline-first apps.

Integer autoincrement requires a roundtrip to learn the ID. ULIDs let client and server agree on the ID upfront.

## Documentation

- [API Reference](docs/api-reference.md) — Full signatures and examples for all factories
- [Node.js Utilities](docs/node-utilities.md) — D1 path resolution, JSON seeding, database reset

## License

MIT
