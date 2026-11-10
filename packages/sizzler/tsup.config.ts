import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    node: "src/node.ts",
  },
  format: ["esm"],
  dts: false, // declarations emitted by native `tsc --emitDeclarationOnly` (see build script)
  clean: true,
  splitting: false,
  external: ["drizzle-orm", "drizzle-orm/sqlite-core", "better-sqlite3"],
});
