#!/usr/bin/env node

// Verify the galley-supervisor skill's bundled copies of the Supervisor SOP
// and reference stay verbatim with the canonical docs, and that the two
// host variants of SKILL.md stay identical apart from the supervisor id
// token (claude-skill-galley-supervisor vs codex-skill-galley-supervisor).
//
// Each reference copy may (and should) carry a leading HTML comment header
// with provenance and a "Last synced" date. Everything after that header
// must match the canonical file exactly. Sync is manual; this gate exists
// because the copies have drifted silently before (see
// docs/devlog/2026-07-03-supervisor-sop-frontier-recalibration.md, D4; the
// .claude SKILL.md later shipped without the Goal surface entirely).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const PAIRS = [
  {
    canonical: "docs/integrations/galley-supervisor-sop.md",
    copies: [
      ".claude/skills/galley-supervisor/references/galley-supervisor-sop.md",
      ".agents/skills/galley-supervisor/references/galley-supervisor-sop.md",
    ],
  },
  {
    canonical: "docs/integrations/galley-supervisor-reference.md",
    copies: [
      ".claude/skills/galley-supervisor/references/galley-supervisor-reference.md",
      ".agents/skills/galley-supervisor/references/galley-supervisor-reference.md",
    ],
  },
];

const errors = [];

function read(relPath) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`${relPath}: file is missing`);
    return null;
  }
  return fs.readFileSync(abs, "utf8");
}

function splitHeader(text, relPath, canonical) {
  if (!text.startsWith("<!--")) {
    errors.push(
      `${relPath}: expected a leading provenance comment (<!-- ... -->) naming ${canonical}`,
    );
    return null;
  }
  const end = text.indexOf("-->");
  if (end < 0) {
    errors.push(`${relPath}: unterminated provenance comment`);
    return null;
  }
  const header = text.slice(0, end + 3);
  if (!header.includes(canonical)) {
    errors.push(
      `${relPath}: provenance comment does not name the canonical source ${canonical}`,
    );
  }
  return text.slice(end + 3).replace(/^\r?\n+/, "");
}

function firstMismatchLine(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i += 1) {
    if (aLines[i] !== bLines[i]) return i + 1;
  }
  return null;
}

for (const pair of PAIRS) {
  const canonicalText = read(pair.canonical);
  if (canonicalText === null) continue;
  for (const copy of pair.copies) {
    const copyText = read(copy);
    if (copyText === null) continue;
    const body = splitHeader(copyText, copy, pair.canonical);
    if (body === null) continue;
    if (body !== canonicalText) {
      const line = firstMismatchLine(body, canonicalText);
      errors.push(
        `${copy}: body drifted from ${pair.canonical}` +
          (line === null
            ? ""
            : ` (first mismatch at canonical line ${line})`) +
          ` — re-copy the canonical file below the provenance header and update its "Last synced" date`,
      );
    }
  }
}

const SKILL_VARIANTS = [
  {
    path: ".claude/skills/galley-supervisor/SKILL.md",
    token: "claude-skill-galley-supervisor",
  },
  {
    path: ".agents/skills/galley-supervisor/SKILL.md",
    token: "codex-skill-galley-supervisor",
  },
];

const normalizedSkills = SKILL_VARIANTS.map((variant) => {
  const text = read(variant.path);
  if (text === null) return null;
  if (!text.includes(variant.token)) {
    errors.push(
      `${variant.path}: expected supervisor id token ${variant.token}/v1`,
    );
  }
  return text.split(variant.token).join("<host>-skill-galley-supervisor");
});

if (normalizedSkills.every((text) => text !== null)) {
  const [claude, codex] = normalizedSkills;
  if (claude !== codex) {
    const line = firstMismatchLine(claude, codex);
    errors.push(
      `SKILL.md variants drifted (first mismatch at line ${line}) — the ` +
        `.claude and .agents copies must be identical apart from the ` +
        `supervisor id token; edit both together`,
    );
  }
}

if (errors.length > 0) {
  console.error("[supervisor-sop-drift] skill copies drifted from canonical docs:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `[supervisor-sop-drift] ${PAIRS.reduce((n, p) => n + p.copies.length, 0)} reference copies verbatim with canonical docs; SKILL.md variants aligned`,
);
