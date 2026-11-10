import type {
  SQLiteColumn,
  SQLiteIntegerBuilder,
  SQLiteTextBuilder,
  UpdateDeleteAction,
} from "drizzle-orm/sqlite-core";
import { integer, text } from "drizzle-orm/sqlite-core";

type ActionConfig = {
  onUpdate?: UpdateDeleteAction;
  onDelete?: UpdateDeleteAction;
};

/**
 * Creates a foreign key column with configurable cascade actions.
 *
 * Defaults to `"text"` type to match sizzler's ULID-based `primaryKey()`.
 * Use `"integer"` for auto-increment or numeric foreign keys.
 *
 * @param name - Column name
 * @param col - Reference column from another table
 * @param type - Column type: `"text"` (default) or `"integer"`
 * @param actions - Optional cascade actions for onUpdate/onDelete
 * @returns A column configured as a foreign key
 *
 * @example
 * ```ts
 * const posts = table("posts", {
 *   id: primaryKey(),
 *   // Text foreign key (default — matches ULID primary keys)
 *   authorId: foreignKey("author_id", users.id),
 *   // With cascade options
 *   parentId: foreignKey("parent_id", posts.id, "text", { onDelete: "cascade" }),
 *   // Integer foreign key (for numeric references)
 *   legacyCategoryId: foreignKey("category_id", categories.id, "integer"),
 * });
 * ```
 */
export const foreignKey = <T extends "integer" | "text" = "text">(
  name: string,
  col: SQLiteColumn,
  type: T = "text" as T,
  actions?: ActionConfig,
): T extends "integer" ? SQLiteIntegerBuilder : SQLiteTextBuilder<[string, ...string[]]> =>
  (type === "integer"
    ? integer(name).references(() => col, actions)
    : text(name).references(() => col, actions)) as T extends "integer"
    ? SQLiteIntegerBuilder
    : SQLiteTextBuilder<[string, ...string[]]>;
