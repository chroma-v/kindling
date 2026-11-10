import { readFileSync } from "fs";
import { join } from "path";

export interface WranglerConfig {
  d1_databases?: Array<{
    binding: string;
    database_id: string;
  }>;
}

/**
 * Parse wrangler.json/wrangler.jsonc configuration with JSONC support.
 * Handles comments and trailing commas.
 *
 * @param projectRoot - Project root directory (default: process.cwd())
 * @returns Parsed Wrangler configuration
 *
 * @example
 * ```ts
 * const config = parseWranglerConfig();
 * const dbId = config.d1_databases?.[0]?.database_id;
 * ```
 */
export function parseWranglerConfig(projectRoot: string = process.cwd()): WranglerConfig {
  let wranglerPath = join(projectRoot, "wrangler.json");

  // Try wrangler.jsonc if wrangler.json doesn't exist
  try {
    readFileSync(wranglerPath, "utf8");
  } catch {
    wranglerPath = join(projectRoot, "wrangler.jsonc");
  }

  const content = readFileSync(wranglerPath, "utf8");

  const cleanedContent = stripJsonComments(content).replaceAll(/,(\s*[}\]])/g, "$1"); // Remove trailing commas

  return JSON.parse(cleanedContent);
}

/**
 * Removes `//` and `/* *\/` comments outside strings. One pass, so a comment
 * marker inside a string (`"drizzle/migrations/*\/migration.sql"`, a URL's
 * `//`) stays.
 */
function stripJsonComments(content: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i++;
    } else if (char === "/" && next === "/") {
      const newline = content.indexOf("\n", i);
      i = newline === -1 ? content.length : newline;
    } else if (char === "/" && next === "*") {
      const close = content.indexOf("*/", i + 2);
      i = close === -1 ? content.length : close + 2;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}
