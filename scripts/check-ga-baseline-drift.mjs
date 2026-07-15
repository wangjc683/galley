#!/usr/bin/env node

// GA baseline metadata drift gate.
//
// managed-ga/manifest.json is the source of truth for the audited
// upstream commit. Three other surfaces repeat that commit and have
// historically been synced by hand from memory (the 2026-07-10 and
// 2026-07-15 upgrades both rediscovered them via the previous devlog
// rather than the SOP):
//
//   - gui/src/stores/defaults.ts      (gaCommit / gaBaseline fallbacks)
//   - docs/ga-baseline.md             ("Locked commit: `<sha>`")
//   - managed-ga/patches/manifest.md  ("Last replay verified ... `<sha>`")
//
// This gate fails when any of them names a different commit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const manifest = JSON.parse(read("managed-ga/manifest.json"));
const commit = manifest?.upstream?.commit;
const errors = [];

if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error(
    `[ga-baseline-drift] managed-ga/manifest.json upstream.commit is not a full SHA: ${commit}`,
  );
  process.exit(1);
}

function expect(rel, pattern, description) {
  const content = read(rel);
  if (!pattern.test(content)) {
    errors.push(`${rel}: ${description}`);
  }
}

expect(
  "gui/src/stores/defaults.ts",
  new RegExp(`gaCommit:\\s*"${commit}"`),
  `gaCommit does not match manifest commit ${commit}`,
);
expect(
  "gui/src/stores/defaults.ts",
  new RegExp(`gaBaseline:\\s*"${commit}"`),
  `gaBaseline does not match manifest commit ${commit}`,
);
expect(
  "docs/ga-baseline.md",
  new RegExp("Locked commit: `" + commit + "`"),
  `"Locked commit" does not match manifest commit ${commit}`,
);
expect(
  "managed-ga/patches/manifest.md",
  new RegExp("`" + commit + "`"),
  `patch manifest does not name manifest commit ${commit}`,
);

if (errors.length > 0) {
  console.error("[ga-baseline-drift] FAIL");
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    "  Sync these to managed-ga/manifest.json's upstream.commit (see docs/ga-baseline.md upgrade procedure).",
  );
  process.exit(1);
}

console.log(`[ga-baseline-drift] OK (${commit.slice(0, 8)})`);
