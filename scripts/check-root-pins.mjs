#!/usr/bin/env node
/**
 * Fail if this repo's ROOT package.json `overrides` force a version on a
 * dependency that a mirrored package already declares for itself.
 *
 * Why this invariant exists:
 *
 * cobaltplan is the source of truth. Its sync-kindling script copies each
 * packages/<pkg> here, carrying that package's own package.json — but never
 * this root one, which is kindling-owned. So a dependency named in BOTH
 * places has two sources of truth, and only one of them is kept current by
 * the sync. An `overrides` entry then outranks whatever a workspace declares
 * for itself, so the stale half is the half that takes effect.
 *
 * That is not hypothetical. The root pinned drizzle-orm 1.0.0-beta.22 and
 * re-exported it via `overrides: { "drizzle-orm": "$drizzle-orm" }`. When
 * cobaltplan moved to 1.0.0-rc.5 — which renamed the SQLite database type
 * BaseSQLiteDatabase -> SQLiteAsyncDatabase — the sync delivered rc.5 source
 * into a beta.22 install. That failed publish.yml twice (2026-08-31 and
 * 09-01) at `npm ci` with ERESOLVE, since drizzle-seed@rc.5 needs peer
 * drizzle-orm@rc.5 and the override contradicted it; past that, the build
 * fails TS2305. See #7, which realigned the pin, and this script's sibling
 * .github/workflows/check.yml.
 *
 * Only packages/* is examined. apps/* is kindling-owned and editable here,
 * so a root pin covering it is a normal monorepo decision, not drift.
 *
 * The fix was to stop pinning shared deps here and let the packages' own
 * synced devDependencies govern (npm hoists a single copy). This check keeps
 * it that way, since re-adding a pin looks locally reasonable and the damage
 * only shows up one cobaltplan bump later.
 *
 * Root-only tooling (biome, and semver for this script) is fine and expected —
 * the rule is about deps the packages themselves declare. Genuine exceptions
 * go in ALLOWED below, with a reason, so adding one is a deliberate act.
 *
 * Usage:
 *   npm run check:root-pins     # part of `npm run check`
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

/**
 * Deps the root is allowed to pin despite a package also declaring them.
 * Each entry is a standing decision to accept the drift risk above — so it
 * needs a reason someone can re-evaluate later, not just a name.
 *
 * An entry here exempts the pin from the "remove it" rule, NOT from being
 * correct: the pinned version must still satisfy every range the synced
 * packages ask for (see the compatibility pass below). Without that second
 * half, an exception is just the original bug with paperwork — a root pin of
 * better-sqlite3@12.9.0 against a synced `^13.0.0` installs 12.9.0 silently,
 * with no ERESOLVE, and surfaces one bump later as native test failures.
 */
const ALLOWED = {
  "better-sqlite3": "native module — one exact build avoids Node/Electron ABI mismatches across workspaces",
};

/**
 * Override keys are not always bare names. npm accepts a version selector
 * (`"pkg@1.2.3": "..."`) and arbitrary nesting, and npm's own EOVERRIDE error
 * ("may not set an override for a package that you directly depend on unless
 * both share the exact same spec") pushes people toward the selector form —
 * so it is the spelling a future fix is most likely to reach for. Collect
 * every name at every depth, with any trailing `@<spec>` stripped.
 *
 * @param {unknown} node
 * @param {Set<string>} out
 */
function collectOverrideNames(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    // "." and similar npm meta-keys carry a version, not a dep name.
    if (key !== ".") {
      const at = key.lastIndexOf("@");
      out.add(at > 0 ? key.slice(0, at) : key);
    }
    if (value && typeof value === "object") collectOverrideNames(value, out);
  }
  return out;
}

/** Every dependency a package declares for itself, in any field: name -> range. */
function declaredBy(pkgJson) {
  return {
    ...(pkgJson.peerDependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
    ...(pkgJson.dependencies ?? {}),
  };
}

const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Which package declares what, and at which range — so the error can name the
// owner, and the compatibility pass can check the pin against it.
/** @type {Map<string, { pkg: string; range: string }[]>} */
const owners = new Map();
for (const dir of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const manifest = join(PACKAGES_DIR, dir.name, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (err) {
    // A directory with no manifest is simply not a package. Anything else —
    // notably malformed JSON in a real package — must not pass silently, or
    // the whole check succeeds vacuously.
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") continue;
    console.error(`check-root-pins: cannot read ${manifest}\n  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  for (const [dep, range] of Object.entries(declaredBy(pkg))) {
    owners.set(dep, [...(owners.get(dep) ?? []), { pkg: dir.name, range }]);
  }
}

// Only `overrides` is checked, and that is deliberate. A plain root
// devDependency cannot force a version on a workspace — npm resolves each
// workspace from its own declared range, nesting a copy if they disagree —
// so a stale one is untidy but inert. (This repo demonstrates it: the root
// hoists typescript 6.x for the docs toolchain while both packages resolve
// their own 7.x.) An `overrides` entry applies to the whole tree, workspaces
// included, which is what silently replaced the packages' rc.5 with beta.22.
//
// npm honours `overrides` only in the root manifest, which is also what makes
// the apps/* exemption below safe — a kindling-owned app cannot reintroduce
// this even in principle. yarn's `resolutions` and pnpm's `overrides` /
// `peerDependencyRules` are ignored by npm entirely: inert here, and not worth
// "hardening" this check by scanning for them.
//
// Caveat worth knowing: a dep a package declares ONLY as an optional peer is
// not installed on its own, so whatever else in the tree provides it becomes
// the single copy — and a plain root devDependency would then govern it,
// invisibly to this check. Not true today (every peer is backed by a matching
// devDependency), but it is the one shape that escapes the reasoning above.
const overrideNames = [...collectOverrideNames(root.overrides)];
const conflicts = overrideNames.filter((name) => owners.has(name) && !Object.hasOwn(ALLOWED, name));

if (conflicts.length > 0) {
  console.error("check-root-pins: the root package.json pins deps that mirrored packages own.\n");
  for (const name of conflicts) {
    const who = (owners.get(name) ?? []).map((o) => `${o.pkg} (${o.range})`).join(", ");
    console.error(`  ${name}  (root overrides)  — also declared by: ${who}`);
  }
  console.error(
    "\nThe root is never synced from cobaltplan, so these pins go stale and" +
      "\nsilently outrank the packages' own synced versions at install time." +
      "\nRemove them from the root and let packages/*/package.json govern." +
      "\nIf a pin is genuinely required, add it to ALLOWED in this script" +
      "\nwith a reason. See the header for the break this already caused.",
  );
  process.exit(1);
}

// An ALLOWED pin still has to be a version the synced packages can live with.
// This is the half that stops an exception from quietly becoming the original
// bug the next time cobaltplan bumps the dep.
const allowed = overrideNames.filter((name) => Object.hasOwn(ALLOWED, name) && owners.has(name));
/** @type {string[]} */
const incompatible = [];
for (const name of allowed) {
  const pinned = root.overrides[name];
  // Only a concrete version can be range-checked; `$name`, URLs and fork specs
  // resolve elsewhere, so assert nothing rather than assert wrongly.
  if (typeof pinned !== "string" || !semver.valid(pinned)) continue;
  for (const { pkg, range } of owners.get(name) ?? []) {
    if (!semver.validRange(range)) continue;
    if (!semver.satisfies(pinned, range)) {
      incompatible.push(`  ${name}@${pinned} (root overrides) does not satisfy ${pkg}'s ${range}`);
    }
  }
}

if (incompatible.length > 0) {
  console.error("check-root-pins: an allowed root pin has drifted out of range.\n");
  console.error(incompatible.join("\n"));
  console.error(
    "\nThe pin is exempt from removal, not from being correct. npm applies it" +
      "\nwith no ERESOLVE, so the packages silently get a version they did not" +
      "\nask for and the damage shows up later as runtime or native failures." +
      "\nRaise the root pin to a version inside the synced range, or drop it.",
  );
  process.exit(1);
}

const suffix =
  allowed.length > 0
    ? ` (${allowed.length} documented exception${allowed.length === 1 ? "" : "s"}, version-checked: ${allowed.join(", ")})`
    : "";
console.log(`✓ root package.json pins no dep owned by packages/*${suffix}`);
