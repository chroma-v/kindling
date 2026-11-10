# kindling

- `packages/*` is a read-only mirror of the cobaltplan monorepo. Don't edit,
  commit or merge changes under `packages/` here: fix them upstream in
  cobaltplan, and they arrive with the next sync. See the note at the top of
  `README.md`.
- kindling owns everything else: `apps/docs`, `scripts/`, `.github/` and the
  root files.
- Before pushing, run `npm run check:mirror` (and `npm run check`).
