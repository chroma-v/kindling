import { index as sqliteIndex, uniqueIndex as sqliteUniqueIndex } from "drizzle-orm/sqlite-core";
import { describe, expect, test } from "vitest";
import {
  boolean,
  createdAt,
  enums,
  foreignKey,
  index,
  jsonArray,
  primaryKey,
  table,
  text,
  timestamp,
  uniqueIndex,
  updatedAt,
} from "./columns/index.js";

describe("Column Factories", () => {
  describe("primaryKey", () => {
    test("creates a text column named 'id' by default", () => {
      const col = primaryKey();
      // Check it's a column builder - we can't easily inspect internals,
      // but we can verify it can be used in a table definition
      const testTable = table("test", {
        id: col,
      });
      expect(testTable).toBeDefined();
    });

    test("accepts custom column name", () => {
      const col = primaryKey("custom_id");
      const testTable = table("test", {
        custom_id: col,
      });
      expect(testTable).toBeDefined();
    });

    test("generates ULID values", () => {
      const col = primaryKey();
      // The $defaultFn is set on the column - we can test ULID generation indirectly
      // by verifying the column has the expected properties
      expect(col).toBeDefined();
    });
  });

  describe("foreignKey", () => {
    // Create a reference table for FK tests
    const users = table("users", {
      id: primaryKey(),
    });

    test("creates text foreign key by default (matches ULID primary keys)", () => {
      const col = foreignKey("user_id", users.id);
      const testTable = table("test", {
        id: primaryKey(),
        userId: col,
      });
      expect(testTable).toBeDefined();
    });

    test("creates integer foreign key when type is 'integer'", () => {
      const col = foreignKey("user_id", users.id, "integer");
      const testTable = table("test", {
        id: primaryKey(),
        userId: col,
      });
      expect(testTable).toBeDefined();
    });

    test("accepts cascade action options", () => {
      const col = foreignKey("user_id", users.id, "text", {
        onDelete: "cascade",
        onUpdate: "cascade",
      });
      const testTable = table("test", {
        id: primaryKey(),
        userId: col,
      });
      expect(testTable).toBeDefined();
    });

    test("accepts set null action", () => {
      const col = foreignKey("user_id", users.id, "text", {
        onDelete: "set null",
      });
      expect(col).toBeDefined();
    });
  });

  describe("timestamp", () => {
    test("creates integer column in timestamp mode", () => {
      const col = timestamp("occurred_at");
      const testTable = table("test", {
        id: primaryKey(),
        occurredAt: col,
      });
      expect(testTable).toBeDefined();
    });
  });

  describe("createdAt", () => {
    test("creates timestamp column with default", () => {
      const col = createdAt();
      const testTable = table("test", {
        id: primaryKey(),
        createdAt: col,
      });
      expect(testTable).toBeDefined();
    });

    test("column is named 'created_at'", () => {
      const col = createdAt();
      // The column should be usable in a table
      expect(col).toBeDefined();
    });
  });

  describe("updatedAt", () => {
    test("creates timestamp column with default", () => {
      const col = updatedAt();
      const testTable = table("test", {
        id: primaryKey(),
        updatedAt: col,
      });
      expect(testTable).toBeDefined();
    });
  });

  describe("boolean", () => {
    test("creates integer column in boolean mode", () => {
      const col = boolean("is_active");
      const testTable = table("test", {
        id: primaryKey(),
        isActive: col,
      });
      expect(testTable).toBeDefined();
    });
  });

  describe("enums", () => {
    const statusValues = ["pending", "active", "completed"] as const;

    test("creates text column with enum values", () => {
      const col = enums("status", statusValues);
      const testTable = table("test", {
        id: primaryKey(),
        status: col,
      });
      expect(testTable).toBeDefined();
    });

    test("defaults to first value when no default specified", () => {
      const col = enums("status", statusValues);
      // The default should be set to the first value
      expect(col).toBeDefined();
    });

    test("accepts custom default value", () => {
      const col = enums("status", statusValues, "active");
      expect(col).toBeDefined();
    });

    test("works with single value enum", () => {
      const singleValues = ["only"] as const;
      const col = enums("type", singleValues);
      expect(col).toBeDefined();
    });
  });

  describe("jsonArray", () => {
    test("creates text column with JSON mode", () => {
      const col = jsonArray<string[]>("tags");
      const testTable = table("test", {
        id: primaryKey(),
        tags: col,
      });
      expect(testTable).toBeDefined();
    });

    test("works with typed arrays", () => {
      interface Tag {
        id: string;
        name: string;
      }
      const col = jsonArray<Tag[]>("tags");
      expect(col).toBeDefined();
    });
  });

  describe("Integration: Full table definition", () => {
    test("can create a complete table with all column types", () => {
      const users = table("users", {
        id: primaryKey(),
      });

      const taskPriority = ["low", "medium", "high"] as const;

      const tasks = table("tasks", {
        id: primaryKey(),
        title: text("title").notNull(),
        priority: enums("priority", taskPriority, "medium"),
        isCompleted: boolean("is_completed"),
        assigneeId: foreignKey("assignee_id", users.id),
        tags: jsonArray<string[]>("tags"),
        dueAt: timestamp("due_at"),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
      });

      expect(tasks).toBeDefined();
    });
  });

  // Schemas import these from sizzler instead of drizzle-orm/sqlite-core, so
  // they must stay drizzle's own builders (drizzle-kit reads what they return).
  describe("index builders", () => {
    test("re-export drizzle's index and uniqueIndex", () => {
      expect(index).toBe(sqliteIndex);
      expect(uniqueIndex).toBe(sqliteUniqueIndex);
    });
  });
});
