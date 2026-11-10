import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

/**
 * Creates a timestamp column storing Unix epoch seconds.
 *
 * @param columnName - Column name
 * @returns An integer column in timestamp mode
 *
 * @example
 * ```ts
 * const events = table("events", {
 *   occurredAt: timestamp("occurred_at"),
 * });
 * ```
 */
export const timestamp = (columnName: string) => integer(columnName, { mode: "timestamp" });

/**
 * Creates a timestamp column storing Unix epoch milliseconds.
 *
 * Use this for BetterAuth plugin tables (api keys, etc.) which expect
 * `timestamp_ms` mode. Cobaltplan's own tables use `timestamp` (seconds).
 *
 * @param columnName - Column name
 * @returns An integer column in timestamp_ms mode
 *
 * @example
 * ```ts
 * const apikey = table("apikey", {
 *   expiresAt: timestampMs("expires_at"),
 * });
 * ```
 */
export const timestamp_ms = (columnName: string) => integer(columnName, { mode: "timestamp_ms" });

/**
 * Creates a created_at timestamp column with automatic default.
 * Uses SQLite's unixepoch() for the default value.
 *
 * @returns A non-null timestamp column defaulting to current time
 *
 * @example
 * ```ts
 * const users = table("users", {
 *   id: primaryKey(),
 *   createdAt: createdAt(),
 * });
 * ```
 */
export const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .default(sql`(unixepoch())`);

/**
 * Creates an updated_at timestamp column that maintains itself.
 *
 * `unixepoch()` supplies the value on INSERT; `$onUpdate` re-stamps it on every
 * UPDATE. The `$onUpdate` half matters more than it looks: drizzle applies it in
 * `buildUpdateSet` at the **dialect** layer, so it fires for every `.update().set()`
 * — ORM helpers, hand-written statements, and anything inside `db.batch()` alike.
 * There is no code path that silently skips it, which is the point: without it the
 * column is insert-time-only and freezes at `created_at` for the life of the row.
 *
 * `$onUpdate` is runtime-only and invisible to drizzle-kit, so adding it needs no
 * migration.
 *
 * **Opting out of one write.** A caller-supplied value wins (drizzle only applies
 * `onUpdateFn` when the column is absent from `set`), so a write that must NOT
 * count as a modification — acquiring a lock, bookkeeping — can hold the column
 * still by setting it to itself:
 *
 * ```ts
 * db.update(tasks).set({ lockedAt: now, updatedAt: sql`updated_at` })
 * ```
 *
 * @returns A non-null timestamp column defaulting to, and refreshed with, current time
 *
 * @example
 * ```ts
 * const users = table("users", {
 *   id: primaryKey(),
 *   updatedAt: updatedAt(),
 * });
 * ```
 */
export const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date());
