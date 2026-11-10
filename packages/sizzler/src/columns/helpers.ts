import {
  index as sqliteIndex,
  integer as sqliteInteger,
  real as sqliteReal,
  sqliteTable,
  text as sqliteText,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";

type EnumValues = readonly [string, ...string[]];

// Re-export drizzle primitives with consistent naming
export const table = sqliteTable;
export const index = sqliteIndex;
export const integer = sqliteInteger;
export const real = sqliteReal;
export const text = sqliteText;
export const uniqueIndex = sqliteUniqueIndex;

/**
 * Creates a boolean column stored as integer (0/1).
 *
 * @param name - Column name
 * @returns An integer column in boolean mode
 *
 * @example
 * ```ts
 * const users = table("users", {
 *   isActive: boolean("is_active"),
 * });
 * ```
 */
export const boolean = (name: string) => integer(name, { mode: "boolean" });

/**
 * Creates an enum column with type-safe values.
 * Stored as text in SQLite with validation at the application level.
 *
 * @param name - Column name
 * @param values - Tuple of allowed string values
 * @param defaultValue - Optional default value (defaults to first value)
 * @returns A text column with enum type
 *
 * @example
 * ```ts
 * const taskPriority = ["low", "medium", "high"] as const;
 *
 * const tasks = table("tasks", {
 *   priority: enums("priority", taskPriority, "medium"),
 * });
 * ```
 */
export const enums = <T extends EnumValues>(name: string, values: T, defaultValue?: T[number]) =>
  text(name, {
    enum: values,
  }).default(defaultValue ? defaultValue : values[0]);

/**
 * Creates a JSON array column with type parameter.
 *
 * @param name - Column name
 * @returns A text column storing JSON with typed array access
 *
 * @example
 * ```ts
 * const posts = table("posts", {
 *   // Array of user IDs who liked the post
 *   likedBy: jsonArray<string[]>("liked_by"),
 *   // Array of tag objects
 *   tags: jsonArray<{ id: string; name: string }[]>("tags"),
 * });
 * ```
 */
export const jsonArray = <T = string[]>(name: string) => text(name, { mode: "json" }).$type<T>();
