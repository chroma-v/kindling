# Node.js Utilities

These utilities require Node.js and should **only** be imported in CLI scripts, never in Workers code.

```typescript
import {
  computeD1Filename,
  getLocalD1Path,
  parseWranglerConfig,
  createJSONSeeder,
  commonTransformers,
  resetDatabase,
} from "@chromav/sizzler/node";
```

## `computeD1Filename(databaseId)`

Computes the hashed SQLite filename that miniflare uses for a D1 database. Miniflare doesn't use the human-readable `database_id` from `wrangler.jsonc` as the filename — it derives a 64-character hex name via HMAC-SHA256 using the Durable Object namespace identifier `"miniflare-D1DatabaseObject"`.

This function replicates that algorithm so scripts can create or find the correct file deterministically, without starting a dev server first.

```typescript
import { computeD1Filename } from "@chromav/sizzler/node";

const filename = computeD1Filename("3c9d1256-e9bd-4617-ad46-22315915a680");
// => "feed28b9d46e13dcb8b4ff9ebe14a54b3b84fc08efd83b1de4251b30f50c9f10.sqlite"
```

**How the hash works:**

1. SHA-256 hash the fixed key `"miniflare-D1DatabaseObject"` → `key`
2. HMAC-SHA256 the `databaseId` with `key`, take first 16 bytes → `nameHmac`
3. HMAC-SHA256 the `nameHmac` with `key`, take first 16 bytes → `hmac`
4. Concatenate `nameHmac + hmac` (32 bytes), hex-encode → 64-char filename + `.sqlite`

**Used by:** `migrate-local.ts`, `golden-db-restore.ts`, `golden-db-create.ts`, `getLocalD1Path()`

## `getLocalD1Path(bindingName?, projectRoot?)`

Finds the local D1 SQLite file by parsing your `wrangler.json` or `wrangler.jsonc`. Uses `computeD1Filename()` to look for the correct hashed filename. This is useful for CLI scripts that need to connect directly to the local D1 database (seeding, migrations, data export, etc.).

```typescript
const dbPath = getLocalD1Path();
// => "/path/to/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/xxx.sqlite"

// Custom binding name (default is "DB")
const dbPath = getLocalD1Path("MY_DB");

// Test isolation via environment variable
process.env.TEST_STATE_DIR = ".wrangler-test";
const testDbPath = getLocalD1Path();
// => "/path/to/.wrangler-test/v3/d1/miniflare-D1DatabaseObject/xxx.sqlite"
```

## `parseWranglerConfig(projectRoot?)`

Parses `wrangler.json` (or `wrangler.jsonc` as fallback) with support for comments and trailing commas.

```typescript
const config = parseWranglerConfig();
console.log(config.d1_databases);
// [{ binding: "DB", database_id: "abc123" }]
```

## `createJSONSeeder(options)`

Loads JSON files and recursively applies field-name-based transformers. Useful for preparing seed data where dates are stored as ISO strings but need to be `Date` objects.

```typescript
const seeder = createJSONSeeder({
  baseDir: "./seed-data",
  transformers: {
    ...commonTransformers.dateFields(["createdAt", "updatedAt"]),
    ...commonTransformers.numberFields(["age", "count"]),
  },
});

// Load a single file
const users = seeder.loadJSON<User[]>("users.json");

// Load all .json files in a directory
const posts = seeder.loadJSONDirectory<Post>("posts/");

// Check if a file exists
if (seeder.fileExists("optional-data.json")) {
  // ...
}
```

Transformers are applied recursively — a `createdAt` field nested three levels deep will still be transformed.

## `commonTransformers`

Pre-built transformer helpers for common field types.

```typescript
commonTransformers.dateFields(["createdAt", "updatedAt"])
// Converts ISO date strings → Date objects

commonTransformers.numberFields(["age", "sortOrder"])
// Converts string values → numbers (via Number(), preserves decimals)
```

## `resetDatabase(db, schema, options)`

Resets the database using `drizzle-seed`. Requires explicit confirmation to prevent accidents.

```typescript
await resetDatabase(db, schema, {
  confirm: true,   // Required — throws without this
  verbose: true,   // Optional — logs progress
  logger: myLogger, // Optional — custom logger (default: console)
});
```

The `logger` option accepts any object with `log()` and `error()` methods, useful for directing output to a custom logging system instead of `console`.

## `attachD1BatchShim(db, sqlite)`

Gives a better-sqlite3 Drizzle instance D1's `db.batch([...])`, so code written against D1 runs unchanged on a local SQLite file (a desktop app, a Node entry, tests). Statements run in order inside one transaction and their results come back in order. If any statement throws, everything rolls back and the error propagates.

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { attachD1BatchShim } from "@chromav/sizzler/node";

const sqlite = new Database("app.sqlite");
const db = drizzle({ client: sqlite });
attachD1BatchShim(db, sqlite); // pass the same handle the Drizzle instance uses

await db.batch([db.insert(users).values(a), db.insert(users).values(b)]); // both, or neither
```

It mutates `db`, so call it once, right after creating the instance. If a statement fails in a way that makes SQLite roll back on its own (a `RAISE(ROLLBACK, …)` trigger, and some disk-full or I/O errors), the shim skips its own `ROLLBACK`, so the caller gets the original error. Requires the optional `better-sqlite3` and `drizzle-orm` peers.

### Concurrency

A better-sqlite3 handle is one connection, and one connection holds one transaction. D1 runs batches one at a time, so the shim queues them: a batch called while another is open waits for it to commit or roll back, then runs. A failed batch doesn't hold up the ones behind it.

Queries outside `batch()` are not queued. A Drizzle builder runs its SQL when it is awaited, and the shim awaits each statement in turn. better-sqlite3 runs each query synchronously, so a request that arrives mid-batch can't start until the batch is done, but code already partway through its own awaits can run between the batch's statements. In a server handling several requests at once (a desktop app's local server), that means another request between two of its steps. A plain query it runs in that gap lands inside the open transaction:

- a read sees the batch's uncommitted writes;
- a write, or a `db.transaction()` (which becomes a savepoint inside the batch), commits or rolls back with the batch. If the batch fails, that write is undone after its own caller saw it succeed.

D1 doesn't do this: every query outside a batch commits on its own. Queuing those queries too would mean wrapping every Drizzle entry point, so the shim leaves it. Code that needs a write to survive a concurrent batch's failure should put the write in a batch of its own.

## Full Example: CLI Seed Script

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  getLocalD1Path,
  createJSONSeeder,
  commonTransformers,
  resetDatabase,
} from "@chromav/sizzler/node";
import * as schema from "./schema";

// 1. Connect to local D1 database
const dbPath = getLocalD1Path();
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

// 2. Reset the database (requires explicit confirmation)
await resetDatabase(db, schema, { confirm: true, verbose: true });

// 3. Load and insert seed data
const seeder = createJSONSeeder({
  baseDir: "./seed-data",
  transformers: {
    ...commonTransformers.dateFields(["createdAt", "updatedAt"]),
    ...commonTransformers.numberFields(["age", "sortOrder"]),
  },
});

const users = seeder.loadJSON<typeof schema.users.$inferInsert[]>("users.json");
await db.insert(schema.users).values(users);

const tasks = seeder.loadJSONDirectory<typeof schema.tasks.$inferInsert>("tasks/");
await db.insert(schema.tasks).values(tasks);
```
