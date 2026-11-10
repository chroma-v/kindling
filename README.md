# kindling

Framework-agnostic packages for building data-driven screens (filtering,
sorting, query compilation) on Drizzle/SQLite stacks — small, dependency-light
pieces that other apps build on.

> **`packages/*` is a mirror.** These packages are developed in a private
> monorepo (cobaltplan) and synced here one way, one `sync: cobaltplan <sha>`
> commit per change. Issues and pull requests are welcome: a maintainer applies
> an accepted change upstream, and it comes back with the next sync.
>
> Don't merge changes to `packages/*` here: the next sync overwrites them. The
> **Mirrored packages match cobaltplan** check (`npm run check:mirror`) fails
> any PR or push that leaves `packages/` different from the last sync.

Part of [ChromaV](https://github.com/chroma-v).

## Packages

| Package | Description |
|---|---|
| [`frizzle`](packages/frizzle) | Type-safe query compiler — parser-combinator grammar, pluggable code generators (Drizzle + raw SQL), filter/sort language, validation. Zero runtime deps. |
| [`sizzler`](packages/sizzler) | Column factories and utilities for Drizzle ORM on SQLite / D1 / Turso, plus Node-only tooling (`@chromav/sizzler/node`) for local D1 discovery, seeding, and golden snapshots. |

Entry points: `@chromav/frizzle`, `@chromav/frizzle/drizzle`,
`@chromav/frizzle/sql`, `@chromav/sizzler`, `@chromav/sizzler/node`.

## Installing

```sh
npm install @chromav/frizzle @chromav/sizzler
```

The published names are scoped (`@chromav/frizzle`, `@chromav/sizzler`) —
the unscoped names were already taken by unrelated packages on npm. Internally
(in cobaltplan, and in this repo's own `packages/*`) they're just `frizzle`
and `sizzler`; the scope is applied only at publish time.

> Previously published under `@knownkind/*` (through 0.1.1). Those versions stay
> on npm but are deprecated — the org moved to ChromaV. Use `@chromav/*`.

Prefer to vendor instead of installing from npm? Both packages are
self-contained (own build, tests, `exports` maps) — `git subtree add` this
repo into your monorepo, add `<prefix>/packages/*` to your npm `workspaces`,
then `npm install && npm run build`.

## Publishing

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) publishes
any package whose `package.json` `version` isn't already on npm — pushes
that don't bump a version (e.g. an ordinary sync from cobaltplan) are safe
no-ops. **Version bumps happen in cobaltplan** (the source of truth) and
flow here via the sync; this repo never bumps versions on its own.

```sh
npm run publish:packages            # real publish (needs npm auth)
node scripts/publish-packages.mjs --dry-run   # validates + packs, doesn't publish
```

## License

[MIT](LICENSE).

## Development

Requires **Node 24**.

```sh
npm install
npm run build        # build all packages
npm run typecheck    # tsc --noEmit per package
npm test             # vitest per package
npm run lint         # biome
npm run check        # lint + typecheck + build + test
```

Reminder: don't edit `packages/*` here expecting it to stick — upstream lives
in cobaltplan and the next sync overwrites it.

## Documentation site

[`apps/docs`](apps/docs) is a [Blume](https://useblume.dev) site covering both
packages, built as static HTML and deployed to Cloudflare Workers.

```sh
npm run docs:dev      # local dev server
npm run docs:build    # static build to apps/docs/dist
npm run docs:preview  # serve the build as a static host would
npm run docs:audit    # link/image/redirect audit
```

The site lives outside the synced `packages/*`, so it is safe to edit
here — unlike the packages themselves. The **prose** is not: each package's
`docs/*.md` is staged into `apps/docs/docs/<pkg>/` by
[`stage-package-docs.mjs`](apps/docs/scripts/stage-package-docs.mjs) on every
dev/build run, and those copies are gitignored. So:

- **Editing a doc page** → do it in cobaltplan; it arrives here via the sync.
- **Editing the site** → do it here (landing pages, sidebar order in
  `docs/<pkg>/meta.ts`, theme, config).

Blume requires every content source to be rooted at `content.root`, which is
why the packages' docs are staged rather than read in place. The staging script
also hoists each file's leading `# Heading` into frontmatter `title`, because
Blume renders the frontmatter title as the page heading and would otherwise
show it twice.
