import { defineConfig } from "blume";

/**
 * Docs site for the kindling packages.
 *
 * The load-bearing constraint: `packages/frizzle` and `packages/sizzler` are
 * `git subtree` prefixes synced one-way from cobaltplan, so anything written
 * there is overwritten on the next sync. This app lives outside those prefixes
 * and reads their docs *in place* — never copies them. A copy would silently
 * rot on the next sync.
 *
 * That splits authorship cleanly:
 *   - docs prose            -> cobaltplan (upstream), arrives via sync
 *   - site chrome + ordering-> here (landing pages, meta.ts, theme, config)
 */
export default defineConfig({
  title: "kindling",
  description:
    "Small, dependency-light packages other things build on — a type-safe query compiler and Drizzle column factories for SQLite, D1, and Turso.",

  // One filesystem source, rooted at the default `docs`. Blume ids entries by
  // their path relative to the `docs` collection base and hard-errors
  // (BLUME_ENTRY_ID_MISMATCH) on any source rooted elsewhere, so the packages'
  // docs are staged into `docs/<pkg>/` by `scripts/stage-package-docs.mjs`
  // rather than read in place. Those copies are gitignored and regenerated on
  // every dev/build run, so the subtree stays the source of truth.
  content: {},

  navigation: {
    // A tab's `path` folder becomes its sidebar section, so these line up with
    // the source prefixes above and scope the sidebar with no extra config.
    tabs: [
      { label: "Frizzle", path: "/frizzle", icon: "filter" },
      { label: "Sizzler", path: "/sizzler", icon: "database" },
    ],
  },

  // Both repos are private, so "Edit on GitHub" and feedback links would 404
  // for any public visitor. Re-enable `github` when kindling goes public.
  feedback: false,

  deployment: {
    // Cloudflare is auto-detected only via CF_PAGES; deploying to Workers with
    // `wrangler deploy` leaves that unset, so the origin has to be explicit or
    // the sitemap, canonicals, and OG images point at the wrong host.
    //
    // Mind the account subdomain: a workers.dev URL is
    // `<worker>.<account-subdomain>.workers.dev`, not `<worker>.workers.dev`.
    // Dropping `dax70` resolves NXDOMAIN, and since this value is baked into
    // every absolute URL the build emits, the site still serves fine while its
    // sitemap and canonicals all point at a host that doesn't exist. Take the
    // value from the URL `wrangler deploy` prints, not from the worker name.
    site: "https://kindling-docs.dax70.workers.dev",
  },
});
