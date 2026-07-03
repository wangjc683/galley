#!/usr/bin/env node

// Verify the five version files agree, and optionally that a release tag
// matches them. This script is the authoritative list of version files;
// the release SOP pre-flight and project-status point here instead of
// maintaining their own copies.
//
// Usage:
//   node scripts/check-version-consistency.mjs            # files agree
//   node scripts/check-version-consistency.mjs --tag=v0.2.17

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

function readJsonVersion(relPath) {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(repoRoot, relPath), "utf8"),
  );
  if (typeof parsed.version !== "string") {
    throw new Error(`${relPath}: no "version" string field`);
  }
  return parsed.version;
}

function readCargoVersion(relPath) {
  const text = fs.readFileSync(path.join(repoRoot, relPath), "utf8");
  const header = text.match(/^\[package\]\s*$/m);
  if (!header) throw new Error(`${relPath}: no [package] section`);
  const packageStart = header.index;
  const rest = text.slice(packageStart + header[0].length);
  const nextSection = rest.search(/^\[/m);
  const section = nextSection < 0 ? rest : rest.slice(0, nextSection);
  const match = section.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${relPath}: no version in [package]`);
  return match[1];
}

const versions = {
  "package.json": readJsonVersion("package.json"),
  "gui/package.json": readJsonVersion("gui/package.json"),
  "core/tauri.conf.json": readJsonVersion("core/tauri.conf.json"),
  "core/Cargo.toml": readCargoVersion("core/Cargo.toml"),
  "cli/Cargo.toml": readCargoVersion("cli/Cargo.toml"),
};

const errors = [];
const expected = versions["package.json"];
for (const [file, version] of Object.entries(versions)) {
  if (version !== expected) {
    errors.push(`${file} has ${version}, package.json has ${expected}`);
  }
}

const tagArg = process.argv.find((arg) => arg.startsWith("--tag="));
if (tagArg) {
  const tag = tagArg.slice("--tag=".length);
  if (tag !== `v${expected}`) {
    errors.push(`tag ${tag} does not match version v${expected}`);
  }
}

if (errors.length > 0) {
  console.error("[version-consistency] version mismatch:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `[version-consistency] ${Object.keys(versions).length} files agree on ${expected}` +
    (tagArg ? ` and match ${tagArg.slice("--tag=".length)}` : ""),
);
