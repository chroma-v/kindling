// ============================================================================
// MALFORMED OPERANDS INSIDE A CHAIN
// ============================================================================
// A hand-built logical node with a missing child, nested in a chain of the
// same operator, must be reported, not silently dropped along with the
// conditions after it.

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import type { FilterNode } from "./ast-types.js";
import { compileFilterNodeToSQL } from "./drizzle-sql.js";
import { f } from "./filter-builders.js";
import { validateFilter } from "./parse.js";
import { serializeFilterNode } from "./query-string.js";
import { compileFilterNode } from "./sql/compile-where.js";
import { sqliteDialect } from "./sql/sqlite-dialect.js";
import { SchemaValidator } from "./validation/schema-validator.js";

const schema = { a: { type: "number" as const } };
const missingLeft = { type: "logical", operator: "and", right: f.eq("a", 2) } as unknown as FilterNode;
const tree: FilterNode = { type: "logical", operator: "and", left: missingLeft, right: f.eq("a", 3) };

describe("a logical node with a missing child, nested in a chain", () => {
  test("f.and keeps it as an operand instead of dropping conditions", () => {
    // Before: f.and(missingLeft, a eq 3) came back as just `a eq 3`
    const combined = f.and(missingLeft, f.eq("a", 3));
    expect(combined).toEqual({
      type: "logical",
      operator: "and",
      left: { type: "group", expression: missingLeft },
      right: f.eq("a", 3),
    });
    expect(validateFilter(combined as FilterNode, schema).success).toBe(false);
  });

  test("validateFilter and SchemaValidator report it", () => {
    for (const result of [validateFilter(tree, schema), new SchemaValidator(schema).validateFilterNode(tree)]) {
      expect(!result.success && result.error).toMatchObject({
        code: "SYNTAX_ERROR",
        message: "Malformed logical node: missing left or right",
      });
    }
  });

  test("both SQL generators report it", () => {
    const table = sqliteTable("t", { a: text("a") });
    const drizzle = compileFilterNodeToSQL(tree, { a: table.a });
    const raw = compileFilterNode(tree, { a: "a" }, sqliteDialect);
    for (const result of [drizzle, raw]) {
      expect(!result.success && result.error.code).toBe("SYNTAX_ERROR");
    }
  });
});

describe("other malformed trees", () => {
  test("an unknown logical operator is reported, not read as AND by one target and OR by another", () => {
    const upper = {
      type: "logical",
      operator: "AND",
      left: f.eq("a", 1),
      right: f.eq("a", 2),
    } as unknown as FilterNode;
    const table = sqliteTable("t", { a: text("a") });
    for (const result of [
      validateFilter(upper, schema),
      compileFilterNodeToSQL(upper, { a: table.a }),
      compileFilterNode(upper, { a: "a" }, sqliteDialect),
    ]) {
      expect(!result.success && result.error.message).toBe("Malformed logical node: unknown operator 'AND'");
    }
  });

  test("the leftmost error wins over a malformed node after it", () => {
    const node = {
      type: "logical",
      operator: "and",
      left: f.eq("nope", 1),
      right: { type: "group" },
    } as unknown as FilterNode;
    const result = compileFilterNode(node, { a: "a" }, sqliteDialect);
    expect(!result.success && result.error.code).toBe("UNKNOWN_FIELD");
  });

  test("serializeFilterNode throws, naming the problem", () => {
    expect(() => serializeFilterNode(tree)).toThrow("Malformed logical node: missing left or right");
    expect(() => serializeFilterNode({ type: "xor" } as unknown as FilterNode)).toThrow("unknown type 'xor'");
  });
});
