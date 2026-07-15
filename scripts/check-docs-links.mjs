#!/usr/bin/env node

// Docs link gate. Two checks, both hard failures:
//
// 1. Broken relative links: every markdown link/image in the checked set must
//    resolve to an existing file or directory (fragments are stripped, not
//    verified — CJK heading anchors are not worth the false positives).
// 2. Index coverage: every living doc directly under docs/ must be reachable
//    from the routing index (docs/README.md) or AGENTS.md, per the
//    single-source-of-truth rule in docs/README.md. Subdirectories are exempt
//    because their own README is the covered entry point.
//
// Checked set: root-level *.md plus everything under docs/. Code-adjacent
// markdown (core/experiments, managed-ga vendored docs, skill reference
// copies) is out of scope — the skill copies are already gated verbatim by
// check-supervisor-sop-drift.mjs.
//
// Historical docs (docs/devlog/**, docs/archive/**) get a narrower check:
// only links resolving INSIDE docs/ are verified. Their links into code were
// valid when written and rot as code moves; fixing them would rewrite
// history and produce permanent noise. Links between docs stay checked even
// there, because archiving moves files and the mechanical path fix is
// expected (see docs/README.md § Lifecycle).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

function listMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...listMarkdown(full));
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// Gitignored markdown (e.g. docs/design-handoff/ local uploads) is absent
// from CI checkouts; scanning it makes the local gate fail where CI
// passes. Filter through git's ignore rules so both see the same set.
// `check-ignore` exits 0 (some ignored) or 1 (none); >1 means git itself
// failed — keep everything rather than silently narrowing the gate.
function withoutGitignored(paths) {
  const result = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: repoRoot,
    input: paths.join("\0"),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status === null || result.status > 1) {
    return paths;
  }
  const ignored = new Set(
    result.stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((p) => path.resolve(repoRoot, p)),
  );
  return paths.filter((p) => !ignored.has(p));
}

const files = withoutGitignored([
  ...fs
    .readdirSync(repoRoot)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .map((name) => path.join(repoRoot, name)),
  ...listMarkdown(path.join(repoRoot, "docs")),
]);

// Inline links/images: [text](target) — tolerates one level of nested
// brackets in the text. Reference definitions: [label]: target
const INLINE_LINK = /!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^()\s]+(?:\([^()]*\))?)[^)]*\)/g;
const REF_DEF = /^\[[^\]]+\]:\s+(\S+)/gm;

function isExternal(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // http:, https:, mailto:, tauri:, …
    target.startsWith("#") // same-file anchor
  );
}

function stripCodeBlocks(text) {
  // Remove fenced code blocks and inline code spans so example links like
  // [x](path) inside ``` fences don't count.
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

const docsRoot = path.join(repoRoot, "docs");
const historicalRoots = [
  path.join(docsRoot, "devlog"),
  path.join(docsRoot, "archive"),
];

const broken = [];
for (const file of files) {
  const historical = historicalRoots.some((root) =>
    file.startsWith(root + path.sep),
  );
  const text = stripCodeBlocks(fs.readFileSync(file, "utf8"));
  const targets = [];
  for (const match of text.matchAll(INLINE_LINK)) targets.push(match[1]);
  for (const match of text.matchAll(REF_DEF)) targets.push(match[1]);

  for (const raw of targets) {
    let target = raw.replace(/^<|>$/g, "");
    if (isExternal(target)) continue;
    target = target.split("#")[0];
    if (target === "") continue;
    target = decodeURIComponent(target);
    const resolved = path.resolve(path.dirname(file), target);
    if (historical && !resolved.startsWith(docsRoot + path.sep)) continue;
    if (!fs.existsSync(resolved)) {
      broken.push(`${path.relative(repoRoot, file)} -> ${raw}`);
    }
  }
}

// Index coverage: living top-level docs must appear in docs/README.md or
// AGENTS.md.
const indexText =
  fs.readFileSync(path.join(repoRoot, "docs/README.md"), "utf8") +
  fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
const uncovered = [];
for (const entry of fs.readdirSync(path.join(repoRoot, "docs"), {
  withFileTypes: true,
})) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  if (entry.name === "README.md") continue;
  if (!indexText.includes(entry.name)) uncovered.push(`docs/${entry.name}`);
}

let failed = false;
if (broken.length > 0) {
  failed = true;
  console.error(`Broken relative links (${broken.length}):`);
  for (const line of broken) console.error(`  ${line}`);
}
if (uncovered.length > 0) {
  failed = true;
  console.error(
    `Top-level docs missing from the routing index (docs/README.md or AGENTS.md) (${uncovered.length}):`,
  );
  for (const line of uncovered) console.error(`  ${line}`);
}

if (failed) {
  console.error(
    "\nFix the links, or archive the doc per docs/README.md § Lifecycle.",
  );
  process.exit(1);
}
console.log(`docs link gate OK: ${files.length} files checked.`);
