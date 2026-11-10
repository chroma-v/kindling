import { defineMeta } from "blume";

/**
 * Sidebar order for the frizzle docs.
 *
 * These pages come from a *different* content source — `packages/frizzle/docs`,
 * a read-only subtree synced from cobaltplan. Folder meta is keyed by the
 * sidebar group path (source `prefix` + dir), not by physical location, so this
 * file orders those pages without editing them. That's what keeps ordering
 * mirror-safe: a `meta.ts` placed upstream would be fine too, but it would have
 * to be maintained in cobaltplan.
 *
 * The list is additive, not exclusive: a new upstream doc that isn't named here
 * still appears (ordered after these), so a sync can add a page but never make
 * one silently vanish. Add it here to give it a considered position.
 */
export default defineMeta({
  title: "Frizzle",
  pages: [
    // Start with the narrative path a new reader needs.
    "getting-started",
    "query-language",
    "schema-validation",
    // Then the two Drizzle targets, then the raw-SQL escape hatch.
    "drizzle-integration",
    "drizzle-code-generator",
    "sql-target",
    // Internals worth understanding once the basics land.
    "descriptors",
    "interceptors",
    "error-handling",
    // Reference material, longest last.
    "recipes",
    "url-examples",
    "query-spec",
  ],
});
