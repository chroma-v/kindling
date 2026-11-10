// ============================================================================
// SQL CODE GENERATOR — Barrel Export
// ============================================================================
// Entry point for `@chromav/frizzle/sql`. Zero runtime dependencies.
//
// Usage:
//   import { compileSelect, compileWrite, sqliteDialect } from "@chromav/frizzle/sql";

export { compileSelect } from "./sql/compile-query.js";
export { compileFilter, compileFilterNode } from "./sql/compile-where.js";
export { compileDelete, compileInsert, compileUpdate, compileWrite } from "./sql/compile-write.js";
export type { Dialect } from "./sql/dialect.js";
export { sqliteDialect } from "./sql/sqlite-dialect.js";
export type { CompiledQuery, SqlColumnMap, WriteCompileOptions } from "./sql/types.js";
