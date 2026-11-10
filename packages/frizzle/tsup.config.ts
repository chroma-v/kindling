import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    drizzle: "src/drizzle.ts",
    sql: "src/sql.ts",
  },
  format: ["esm"],
  dts: false, // declarations emitted by native `tsc --emitDeclarationOnly` (see build script)
  clean: true,
  splitting: false,
  external: ["drizzle-orm"],
});
