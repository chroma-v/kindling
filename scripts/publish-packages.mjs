#!/usr/bin/env node
/**
 * Publish packages/* to npm under the @chromav scope, skipping any package
 * whose current version is already published.
 *
 * The internal package name (e.g. "frizzle") is kept as-is in git — renaming
 * it would ripple into cobaltplan, which is where these packages actually
 * live and get imported by that name. Instead this script transiently
 * rewrites just the `name` field to "@chromav/<name>" right before
 * `npm publish`, then restores the original name — nothing is committed.
 *
 * Usage:
 *   npm run publish:packages             # build must have already run
 *   node scripts/publish-packages.mjs --dry-run   # check only, never publishes
 *
 * Auth: expects `npm publish` to already be authenticated (via .npmrc +
 * NODE_AUTH_TOKEN, which actions/setup-node's registry-url wires up in CI).
 *
 * See README.md and docs/development/kindling-mirror.md (cobaltplan) for
 * the full model — cobaltplan is source of truth; version bumps happen
 * there and flow through sync-kindling before landing here.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NPM_SCOPE = "@chromav";
const PACKAGES_DIR = join(import.meta.dirname, "..", "packages");

const dryRun = process.argv.includes("--dry-run");

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

/** Already-published versions for a scoped package, or [] if it's never been published. */
function publishedVersions(scopedName) {
  try {
    const out = sh(process.cwd(), "npm", ["view", scopedName, "versions", "--json"]);
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return []; // E404 -- package has never been published
  }
}

const pkgDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

let published = 0;
let skipped = 0;

for (const dir of pkgDirs) {
  const pkgPath = join(PACKAGES_DIR, dir, "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  const scopedName = `${NPM_SCOPE}/${pkg.name}`;

  if (publishedVersions(scopedName).includes(pkg.version)) {
    console.log(`publish-packages: ${scopedName}@${pkg.version} already published — skipping.`);
    skipped++;
    continue;
  }

  console.log(`publish-packages: ${scopedName}@${pkg.version} not yet published.`);

  // Transiently rename, publish (or validate via --dry-run), then restore --
  // never commit the rename. --dry-run still exercises `npm publish`'s own
  // tarball/exports validation, it just doesn't push to the registry.
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, name: scopedName }, null, 2) + "\n");
  try {
    const args = ["publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])];
    sh(join(PACKAGES_DIR, dir), "npm", args);
    console.log(`publish-packages: ${dryRun ? "dry run OK for" : "published"} ${scopedName}@${pkg.version}.`);
    published++;
  } finally {
    writeFileSync(pkgPath, raw);
  }
}

console.log(`publish-packages: done. ${published} published, ${skipped} already up to date.`);
