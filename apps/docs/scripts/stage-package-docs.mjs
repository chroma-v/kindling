/**
 * Stage the packages' docs into this app's content tree.
 *
 * Why a copy at all: Blume ids every content entry by its path relative to the
 * `docs` collection base, and hard-errors (`BLUME_ENTRY_ID_MISMATCH`) when a
 * filesystem source is rooted anywhere else — including a subdirectory of
 * `content.root`. So "read `../../packages/<pkg>/docs` in place" isn't
 * expressible: every filesystem source has to be rooted at `content.root`.
 *
 * Why this copy is safe, where a committed one wouldn't be: `packages/*` here
 * are `git subtree` prefixes synced one-way from cobaltplan, so a *committed*
 * duplicate would silently drift the moment upstream changed. These copies are
 * gitignored and regenerated from the subtree on every dev/build run, so they
 * cannot drift — the subtree stays the single source of truth for the prose.
 *
 * Staged files are `.md`; everything authored in this repo is `.mdx` or `.ts`.
 * `.gitignore` splits them on exactly that, so a stale copy can't be committed.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(APP_ROOT, "..", "..");

/** Packages whose `docs/` are published on the site, keyed by route prefix. */
const PACKAGES = ["frizzle", "sizzler"];

/**
 * Sidebar labels for pages whose upstream H1 reads as a document title rather
 * than a nav entry, and truncates in the sidebar. Keyed by `<pkg>/<slug>`.
 * Overriding here keeps the upstream prose untouched — the alternative is
 * `sidebar.label` frontmatter, which would have to be added in cobaltplan and
 * would render as a YAML block when the file is read on GitHub.
 */
const SIDEBAR_LABELS = new Map([
  ["frizzle/url-examples", "URL Examples"],
  ["frizzle/query-spec", "Language Spec"],
]);

/** Matches a leading `# Heading` line, capturing the heading text. */
const LEADING_H1 = /^\s*#[^\S\n]+(?<title>.+?)\s*(?:\n|$)/u;

/** YAML-escape a scalar for a double-quoted frontmatter value. */
const yamlString = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * Hoist a leading `# Heading` into frontmatter `title`.
 *
 * Blume renders the frontmatter `title` as the page's heading. These upstream
 * files carry no frontmatter, so Blume infers the title from the first H1 and
 * *then* renders the H1 from the body too — every page came out with its title
 * twice. Hoisting it removes the duplicate and gives the page an explicit title
 * for `<title>`, OG images, and search.
 *
 * Deliberately conservative: a file that already has frontmatter, or doesn't
 * open with an H1, is passed through untouched rather than guessed at.
 */
const hoistTitle = (source, labelKey) => {
  if (source.startsWith("---")) {
    return source;
  }

  const match = source.match(LEADING_H1);
  const title = match?.groups?.title;
  if (!title) {
    return source;
  }

  const frontmatter = [`title: ${yamlString(title)}`];
  const label = SIDEBAR_LABELS.get(labelKey);
  if (label) {
    frontmatter.push("sidebar:", `  label: ${yamlString(label)}`);
  }

  const body = source.slice(match[0].length).replace(/^\n+/u, "");
  return `---\n${frontmatter.join("\n")}\n---\n\n${body}`;
};

/**
 * An inline link to a sibling doc: `](name.md)` or `](./name.md)`, with an
 * optional `#anchor` and an optional `"title"`.
 */
const SIBLING_LINK = /\]\((?:\.\/)?(?<slug>[\w-]+)\.md(?<anchor>#[^\s)]*)?(?<title>\s+"[^"]*")?\)/gu;

/** A fenced code block (``` or ~~~), which must be left as written. */
const FENCED_BLOCK = /^(?<fence>`{3,}|~{3,})[^\n]*\n[\s\S]*?^\k<fence>[^\S\n]*$/gmu;

/**
 * Point links between sibling docs at their site routes.
 *
 * Upstream docs link to each other as `schema-validation.md`, which is right on
 * GitHub (relative to the file) but not on the site: Blume resolves a relative
 * link against the page URL, so from `/frizzle/getting-started` it becomes
 * `/frizzle/getting-started/schema-validation.md`, which doesn't exist. Rewriting
 * here, rather than upstream, keeps the source links working on GitHub.
 *
 * Only links to a doc that is actually being staged are rewritten, so a typo
 * still shows up as a broken link in `blume audit`. Code blocks are skipped.
 */
const rewriteSiblingLinks = (source, pkg, slugs) => {
  const rewrite = (text) =>
    text.replace(SIBLING_LINK, (link, ...args) => {
      const { slug, anchor = "", title = "" } = args.at(-1);
      return slugs.has(slug) ? `](/${pkg}/${slug}${anchor}${title})` : link;
    });

  let out = "";
  let last = 0;
  for (const block of source.matchAll(FENCED_BLOCK)) {
    out += rewrite(source.slice(last, block.index)) + block[0];
    last = block.index + block[0].length;
  }
  return out + rewrite(source.slice(last));
};

/** Read a directory, returning [] when it doesn't exist. */
const listMarkdown = async (dir) => {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".md"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

let staged = 0;
let pruned = 0;

for (const pkg of PACKAGES) {
  const from = join(REPO_ROOT, "packages", pkg, "docs");
  const to = join(APP_ROOT, "docs", pkg);

  const sources = await listMarkdown(from);
  if (sources.length === 0) {
    // A missing or empty upstream docs dir is a real problem, not a no-op: it
    // would silently publish a package with no pages.
    throw new Error(
      `stage-package-docs: no .md files found in packages/${pkg}/docs — is the subtree synced?`
    );
  }

  await mkdir(to, { recursive: true });

  // Prune first, so a doc deleted upstream disappears from the site instead of
  // lingering as an orphan page that outlived its source.
  for (const existing of await listMarkdown(to)) {
    if (!sources.includes(existing)) {
      await rm(join(to, existing));
      pruned += 1;
    }
  }

  const slugs = new Set(sources.map((name) => name.replace(/\.md$/u, "")));
  for (const name of sources) {
    const slug = name.replace(/\.md$/u, "");
    const source = await readFile(join(from, name), "utf8");
    const content = rewriteSiblingLinks(hoistTitle(source, `${pkg}/${slug}`), pkg, slugs);
    await writeFile(join(to, name), content);
    staged += 1;
  }
}

console.log(
  `stage-package-docs: staged ${staged} file(s) from ${PACKAGES.length} package(s)` +
    (pruned > 0 ? `, pruned ${pruned} stale` : "")
);
