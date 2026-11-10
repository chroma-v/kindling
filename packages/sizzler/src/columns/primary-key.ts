import { text } from "drizzle-orm/sqlite-core";
import { ulid } from "ulid";

/**
 * Creates a primary key column with auto-generated ULID.
 *
 * @param name - Column name (default: "id")
 * @returns A text column configured as primary key with ULID generation
 *
 * @example
 * ```ts
 * const users = table("users", {
 *   id: primaryKey(),
 *   name: text("name"),
 * });
 * ```
 */
export const primaryKey = (name = "id") =>
  text(name)
    .primaryKey()
    .notNull()
    .$defaultFn(() => ulid());
