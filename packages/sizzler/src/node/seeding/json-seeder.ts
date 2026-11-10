import fs from "fs";
import path from "path";

export interface JSONSeederOptions {
  baseDir: string;
  transformers?: Record<string, (value: unknown) => unknown>;
}

/**
 * Apply transformations to loaded data recursively.
 */
function applyTransformers(data: unknown, transformers: Record<string, (value: unknown) => unknown>): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => applyTransformers(item, transformers));
  }

  if (data && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (transformers[key]) {
        result[key] = transformers[key](value);
      } else {
        result[key] = applyTransformers(value, transformers);
      }
    }
    return result;
  }

  return data;
}

/**
 * Utility for seeding databases from structured JSON files.
 * Handles date parsing, transformations, and nested directory structures.
 *
 * @param options - Configuration options
 * @returns Object with loadJSON, loadJSONDirectory, and fileExists methods
 *
 * @example
 * ```ts
 * const seeder = createJSONSeeder({
 *   baseDir: path.join(__dirname, "seed-data"),
 *   transformers: {
 *     ...commonTransformers.dateFields(["createdAt", "updatedAt"]),
 *   },
 * });
 *
 * const users = seeder.loadJSON<User[]>("users.json");
 * const posts = seeder.loadJSONDirectory<Post>("posts/");
 * ```
 */
export function createJSONSeeder(options: JSONSeederOptions) {
  const { baseDir, transformers = {} } = options;

  /**
   * Load and parse JSON file with optional transformations.
   */
  function loadJSON<T = unknown>(relativePath: string): T {
    const filePath = path.join(baseDir, relativePath);
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);

    return applyTransformers(data, transformers) as T;
  }

  /**
   * Load multiple JSON files from a directory.
   */
  function loadJSONDirectory<T = unknown>(relativePath: string): T[] {
    const dirPath = path.join(baseDir, relativePath);
    const files = fs.readdirSync(dirPath).filter((file) => file.endsWith(".json"));

    return files.map((file) => loadJSON<T>(path.join(relativePath, file)));
  }

  /**
   * Check if a file exists.
   */
  function fileExists(relativePath: string): boolean {
    return fs.existsSync(path.join(baseDir, relativePath));
  }

  return {
    loadJSON,
    loadJSONDirectory,
    fileExists,
  };
}

/**
 * Common transformers for typical database seeding scenarios.
 */
export const commonTransformers = {
  /**
   * Convert ISO date strings to Date objects.
   *
   * @example
   * ```ts
   * const seeder = createJSONSeeder({
   *   baseDir: "./seed-data",
   *   transformers: commonTransformers.dateFields(["createdAt", "updatedAt"]),
   * });
   * ```
   */
  dateFields: (fieldNames: string[]) => {
    const transformers: Record<string, (value: unknown) => unknown> = {};
    fieldNames.forEach((field) => {
      transformers[field] = (value: unknown) => new Date(value as string);
    });
    return transformers;
  },

  /**
   * Convert string values to numbers.
   *
   * @example
   * ```ts
   * const seeder = createJSONSeeder({
   *   baseDir: "./seed-data",
   *   transformers: commonTransformers.numberFields(["age", "count"]),
   * });
   * ```
   */
  numberFields: (fieldNames: string[]) => {
    const transformers: Record<string, (value: unknown) => unknown> = {};
    fieldNames.forEach((field) => {
      transformers[field] = (value: unknown) => Number(value);
    });
    return transformers;
  },
};
