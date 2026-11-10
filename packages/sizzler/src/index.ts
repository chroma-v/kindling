/**
 * Sizzler
 *
 * Workers-safe column factories and utilities for Drizzle ORM with SQLite/D1/Turso.
 *
 * For Node.js utilities (seeding, connection helpers), import from:
 * ```ts
 * import { getLocalD1Path, createJSONSeeder } from "sizzler/node";
 * ```
 *
 * @example
 * ```ts
 * import {
 *   primaryKey,
 *   foreignKey,
 *   createdAt,
 *   updatedAt,
 *   table,
 *   text,
 * } from "sizzler";
 *
 * const users = table("users", {
 *   id: primaryKey(),
 *   name: text("name").notNull(),
 *   createdAt: createdAt(),
 *   updatedAt: updatedAt(),
 * });
 * ```
 */

// Column factories
export {
  boolean,
  createdAt,
  enums,
  foreignKey,
  index,
  integer,
  jsonArray,
  primaryKey,
  real,
  // Re-exported drizzle primitives
  table,
  text,
  timestamp,
  timestamp_ms,
  uniqueIndex,
  updatedAt,
} from "./columns/index.js";
