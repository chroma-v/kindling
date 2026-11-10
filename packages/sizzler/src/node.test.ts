import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  commonTransformers,
  computeD1Filename,
  createJSONSeeder,
  getLocalD1Path,
  parseWranglerConfig,
  resetDatabase,
} from "./node.js";

describe("Node.js Utilities", () => {
  describe("parseWranglerConfig", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("parses standard wrangler.json", () => {
      const config = {
        name: "my-worker",
        d1_databases: [{ binding: "DB", database_id: "abc123" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      const result = parseWranglerConfig(tempDir);
      expect(result.d1_databases).toHaveLength(1);
      expect(result.d1_databases![0].binding).toBe("DB");
      expect(result.d1_databases![0].database_id).toBe("abc123");
    });

    test("parses wrangler.jsonc with line comments", () => {
      const content = `{
        // This is a comment
        "name": "my-worker",
        "d1_databases": [
          {
            "binding": "DB", // inline comment
            "database_id": "abc123"
          }
        ]
      }`;
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), content);

      const result = parseWranglerConfig(tempDir);
      expect(result.d1_databases![0].database_id).toBe("abc123");
    });

    test("parses wrangler.jsonc with block comments", () => {
      const content = `{
        /* Block comment */
        "name": "my-worker",
        "d1_databases": [
          {
            "binding": "DB",
            "database_id": "abc123"
          }
        ]
      }`;
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), content);

      const result = parseWranglerConfig(tempDir);
      expect(result.d1_databases![0].database_id).toBe("abc123");
    });

    // A block-comment regex over the whole file read `/*` in the first
    // pattern as a comment and deleted through the next `*/`.
    test("keeps comment markers inside strings", () => {
      const content = `{
        /* block */
        "vars": { "URL": "https://example.com/a//b" }, // line
        "d1_databases": [
          { "binding": "DB", "migrations_pattern": "drizzle/migrations/*/migration.sql" },
          { "binding": "QA", "migrations_pattern": "drizzle/migrations/*/migration.sql" }, /* trailing */
        ],
        "note": "escaped \\" quote // and /* still a string */",
      }`;
      fs.writeFileSync(path.join(tempDir, "wrangler.jsonc"), content);

      const result: Record<string, unknown> = { ...parseWranglerConfig(tempDir) };
      const databases = result.d1_databases as { migrations_pattern: string }[];
      expect(databases.map((d) => d.migrations_pattern)).toEqual([
        "drizzle/migrations/*/migration.sql",
        "drizzle/migrations/*/migration.sql",
      ]);
      expect(result.vars).toEqual({ URL: "https://example.com/a//b" });
      expect(result.note).toBe('escaped " quote // and /* still a string */');
    });

    test("handles trailing commas", () => {
      const content = `{
        "name": "my-worker",
        "d1_databases": [
          {
            "binding": "DB",
            "database_id": "abc123",
          },
        ],
      }`;
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), content);

      const result = parseWranglerConfig(tempDir);
      expect(result.d1_databases![0].database_id).toBe("abc123");
    });

    test("preserves URLs with // in strings", () => {
      const content = `{
        "name": "my-worker",
        "vars": {
          "API_URL": "https://example.com/api"
        }
      }`;
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), content);

      const result = parseWranglerConfig(tempDir);
      expect((result as { vars: { API_URL: string } }).vars.API_URL).toBe("https://example.com/api");
    });

    test("falls back to wrangler.jsonc if wrangler.json not found", () => {
      const config = {
        name: "my-worker",
        d1_databases: [{ binding: "DB", database_id: "jsonc-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.jsonc"), JSON.stringify(config));

      const result = parseWranglerConfig(tempDir);
      expect(result.d1_databases![0].database_id).toBe("jsonc-id");
    });

    test("throws when neither config file exists", () => {
      expect(() => parseWranglerConfig(tempDir)).toThrow();
    });
  });

  describe("computeD1Filename", () => {
    test("produces deterministic 64-char hex filename", () => {
      const filename = computeD1Filename("test-db-id");
      expect(filename).toMatch(/^[0-9a-f]{64}\.sqlite$/);
    });

    test("same input always produces same output", () => {
      const a = computeD1Filename("my-database-id");
      const b = computeD1Filename("my-database-id");
      expect(a).toBe(b);
    });

    test("different inputs produce different filenames", () => {
      const a = computeD1Filename("database-a");
      const b = computeD1Filename("database-b");
      expect(a).not.toBe(b);
    });

    test("matches known miniflare output for cobaltplan database_id", () => {
      // This is the actual database_id from wrangler.jsonc and its known miniflare filename
      const filename = computeD1Filename("3c9d1256-e9bd-4617-ad46-22315915a680");
      expect(filename).toBe("feed28b9d46e13dcb8b4ff9ebe14a54b3b84fc08efd83b1de4251b30f50c9f10.sqlite");
    });
  });

  describe("getLocalD1Path", () => {
    let tempDir: string;
    const originalEnv = process.env;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-d1-test-"));
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      process.env = originalEnv;
    });

    test("finds SQLite file in default .wrangler directory", () => {
      // Setup wrangler.json
      const config = {
        d1_databases: [{ binding: "DB", database_id: "test-db-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      // Setup D1 directory structure
      const d1Dir = path.join(tempDir, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
      fs.mkdirSync(d1Dir, { recursive: true });
      fs.writeFileSync(path.join(d1Dir, "test-db-id.sqlite"), "");

      const result = getLocalD1Path("DB", tempDir);
      expect(result).toContain("test-db-id.sqlite");
    });

    test("finds first SQLite file when no exact match", () => {
      const config = {
        d1_databases: [{ binding: "DB", database_id: "prod-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      const d1Dir = path.join(tempDir, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
      fs.mkdirSync(d1Dir, { recursive: true });
      fs.writeFileSync(path.join(d1Dir, "different-id.sqlite"), "");

      const result = getLocalD1Path("DB", tempDir);
      expect(result).toContain("different-id.sqlite");
    });

    test("respects TEST_STATE_DIR environment variable", () => {
      process.env.TEST_STATE_DIR = ".wrangler-test";

      const config = {
        d1_databases: [{ binding: "DB", database_id: "test-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      // Note: TEST_STATE_DIR uses different path structure (no 'state' subdirectory)
      const d1Dir = path.join(tempDir, ".wrangler-test/v3/d1/miniflare-D1DatabaseObject");
      fs.mkdirSync(d1Dir, { recursive: true });
      fs.writeFileSync(path.join(d1Dir, "test-id.sqlite"), "");

      const result = getLocalD1Path("DB", tempDir);
      expect(result).toContain(".wrangler-test");
      expect(result).toContain("test-id.sqlite");
    });

    test("throws when binding not found in config", () => {
      const config = {
        d1_databases: [{ binding: "OTHER_DB", database_id: "test-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      expect(() => getLocalD1Path("DB", tempDir)).toThrow("Database binding 'DB' not found");
    });

    test("throws when no SQLite files found", () => {
      const config = {
        d1_databases: [{ binding: "DB", database_id: "test-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      const d1Dir = path.join(tempDir, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
      fs.mkdirSync(d1Dir, { recursive: true });
      // No .sqlite files created

      expect(() => getLocalD1Path("DB", tempDir)).toThrow("No D1 database");
    });

    test("throws when D1 directory does not exist", () => {
      const config = {
        d1_databases: [{ binding: "DB", database_id: "test-id" }],
      };
      fs.writeFileSync(path.join(tempDir, "wrangler.json"), JSON.stringify(config));

      expect(() => getLocalD1Path("DB", tempDir)).toThrow("No D1 database directory");
    });
  });

  describe("createJSONSeeder", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-seeder-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("loadJSON loads and parses JSON file", () => {
      const data = [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
      fs.writeFileSync(path.join(tempDir, "users.json"), JSON.stringify(data));

      const seeder = createJSONSeeder({ baseDir: tempDir });
      const result = seeder.loadJSON<typeof data>("users.json");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Alice");
    });

    test("loadJSON applies transformers", () => {
      const data = [{ id: "1", createdAt: "2024-01-15T10:30:00Z" }];
      fs.writeFileSync(path.join(tempDir, "items.json"), JSON.stringify(data));

      const seeder = createJSONSeeder({
        baseDir: tempDir,
        transformers: {
          createdAt: (value) => new Date(value as string),
        },
      });

      const result = seeder.loadJSON<{ id: string; createdAt: Date }[]>("items.json");
      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].createdAt.getFullYear()).toBe(2024);
    });

    test("loadJSON applies transformers recursively to nested objects", () => {
      const data = {
        user: {
          profile: {
            createdAt: "2024-01-15T10:30:00Z",
          },
        },
      };
      fs.writeFileSync(path.join(tempDir, "nested.json"), JSON.stringify(data));

      const seeder = createJSONSeeder({
        baseDir: tempDir,
        transformers: {
          createdAt: (value) => new Date(value as string),
        },
      });

      const result = seeder.loadJSON<{
        user: { profile: { createdAt: Date } };
      }>("nested.json");
      expect(result.user.profile.createdAt).toBeInstanceOf(Date);
    });

    test("loadJSONDirectory loads all JSON files from directory", () => {
      const subDir = path.join(tempDir, "posts");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "post1.json"), JSON.stringify({ id: "1", title: "First" }));
      fs.writeFileSync(path.join(subDir, "post2.json"), JSON.stringify({ id: "2", title: "Second" }));
      fs.writeFileSync(path.join(subDir, "readme.txt"), "Not JSON");

      const seeder = createJSONSeeder({ baseDir: tempDir });
      const result = seeder.loadJSONDirectory<{ id: string; title: string }>("posts");

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.title)).toContain("First");
      expect(result.map((p) => p.title)).toContain("Second");
    });

    test("fileExists returns true for existing file", () => {
      fs.writeFileSync(path.join(tempDir, "exists.json"), "{}");

      const seeder = createJSONSeeder({ baseDir: tempDir });
      expect(seeder.fileExists("exists.json")).toBe(true);
    });

    test("fileExists returns false for non-existing file", () => {
      const seeder = createJSONSeeder({ baseDir: tempDir });
      expect(seeder.fileExists("does-not-exist.json")).toBe(false);
    });
  });

  describe("commonTransformers", () => {
    test("dateFields converts ISO strings to Date objects", () => {
      const transformers = commonTransformers.dateFields(["createdAt", "updatedAt"]);

      expect(transformers.createdAt("2024-01-15T10:30:00Z")).toBeInstanceOf(Date);
      expect(transformers.updatedAt("2024-06-20T15:45:00Z")).toBeInstanceOf(Date);
    });

    test("numberFields converts strings to numbers", () => {
      const transformers = commonTransformers.numberFields(["age", "count"]);

      expect(transformers.age("25")).toBe(25);
      expect(transformers.count("100")).toBe(100);
    });

    test("numberFields preserves decimal values", () => {
      const transformers = commonTransformers.numberFields(["price", "rate"]);

      expect(transformers.price("19.99")).toBe(19.99);
      expect(transformers.rate("0.075")).toBe(0.075);
    });
  });

  describe("resetDatabase", () => {
    test("throws when confirm is false", async () => {
      const mockDb = {} as any;
      const mockSchema = {};

      await expect(resetDatabase(mockDb, mockSchema, { confirm: false })).rejects.toThrow(
        "requires explicit confirmation",
      );
    });

    test("throws when confirm is not provided", async () => {
      const mockDb = {} as any;
      const mockSchema = {};

      await expect(resetDatabase(mockDb, mockSchema)).rejects.toThrow("requires explicit confirmation");
    });

    // Note: Testing actual reset functionality requires a real database connection
    // which is better suited for integration tests
  });
});
