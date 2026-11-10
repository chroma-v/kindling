#!/usr/bin/env node
/**
 * Fail if packages/ differs from what the last cobaltplan sync produced.
 *
 * packages/* is mirrored from cobaltplan, and an edit made here makes the
 * next sync conflict. The reference is packages/ at the newest
 * cobaltplan-sync[bot] commit rather than "no edits since the last sync", so
 * a revert that restores parity passes. Needs full history (`fetch-depth: 0`).
 *
 * Rules, and what to do when it fails: cobaltplan
 * docs/development/kindling-mirror.md (Rules, Troubleshooting).
 */

import { execFileSync } from "node:child_process";

const SYNC_AUTHOR = "<sync@cobaltplan.dev>";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const sync = git("log", "-1", `--author=${SYNC_AUTHOR}`, "--format=%H %s", "HEAD");
if (!sync) {
  console.error(
    `check-mirror-parity: no sync commit (author ${SYNC_AUTHOR}) in HEAD's history. ` +
      "Is the checkout shallow? CI needs `fetch-depth: 0`.",
  );
  process.exit(1);
}

const [syncSha, ...subject] = sync.split(" ");
const drift = git("diff", "--name-status", syncSha, "HEAD", "--", "packages/");

if (drift) {
  console.error(`check-mirror-parity: packages/ differs from the last sync, ${syncSha.slice(0, 8)} (${subject.join(" ")}):\n`);
  console.error(
    drift
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );
  console.error(
    "\npackages/* is mirrored from cobaltplan and overwritten by every sync; editing it here makes the next " +
      "sync conflict and blocks publishing. Make the change in cobaltplan instead (it syncs here on merge), " +
      "or revert it here to match the last sync.",
  );
  process.exit(1);
}

console.log(`check-mirror-parity: packages/ matches the last sync, ${syncSha.slice(0, 8)} (${subject.join(" ")}).`);
