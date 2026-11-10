#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  criticalCodeFiles,
  criticalMemorySeedFiles,
  excludedUpstreamPaths,
  forbiddenMemorySeedFiles,
  forbiddenStatePaths,
  isForbiddenName,
  walk,
} from "./managed-ga-payload-rules.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const appPath =
  process.argv[2] ??
  path.join(
    repoRoot,
    "core",
    "target",
    "release",
    "bundle",
    "macos",
    "Galley.app",
  );
const macOsRoot = path.join(appPath, "Contents", "MacOS");
const resourcesRoot = path.join(appPath, "Contents", "Resources");
const runnerRoot = path.join(resourcesRoot, "runner");
const repoRunnerRoot = path.join(repoRoot, "runner");
const managedRoot = path.join(resourcesRoot, "managed-ga");
const codeRoot = path.join(managedRoot, "code");
const memorySeedRoot = path.join(managedRoot, "state-seed", "memory");
const manifestPath = path.join(managedRoot, "manifest.json");

const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${display(file)} (${error.message})`);
    return null;
  }
}

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`missing file: ${display(file)}`);
  }
}

function requireExecutableFile(file) {
  requireFile(file);
  if (!fs.existsSync(file)) return;
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    fail(`file is not executable: ${display(file)}`);
  }
}

function requireDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail(`missing directory: ${display(dir)}`);
  }
}

function display(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

requireDir(appPath);
requireDir(macOsRoot);
requireExecutableFile(path.join(macOsRoot, "galley"));
requireDir(resourcesRoot);
requireDir(runnerRoot);
requireFile(path.join(runnerRoot, "workbench_bridge.py"));
requireDir(path.join(resourcesRoot, "python"));
requireDir(managedRoot);
requireDir(codeRoot);
requireDir(memorySeedRoot);
requireFile(manifestPath);
requireFile(path.join(managedRoot, "patches", "manifest.md"));
for (const rel of criticalCodeFiles) {
  requireFile(path.join(codeRoot, ...rel.split("/")));
}
if (fs.existsSync(path.join(managedRoot, "galley-prompts"))) {
  fail("managed prompt profile is embedded in Core; app bundle must not ship managed-ga/galley-prompts");
}

const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
if (manifest) {
  if (manifest.schemaVersion !== 1) {
    fail(`managed-ga manifest schemaVersion must be 1, got ${manifest.schemaVersion}`);
  }
  if (!manifest.upstream?.commit) {
    fail("managed-ga manifest must pin upstream.commit");
  }
  const patches = manifest.patchStack?.patches;
  if (!Array.isArray(patches) || patches.length === 0) {
    fail("managed-ga manifest must list at least one replayable patch");
  } else {
    for (const patchName of patches) {
      if (
        typeof patchName !== "string" ||
        patchName.includes("/") ||
        patchName.includes("\\") ||
        patchName.includes("..")
      ) {
        fail(`invalid managed GA patch name: ${patchName}`);
        continue;
      }
      requireFile(path.join(managedRoot, "patches", patchName));
    }
  }
}

// All of managed-ga/, not only code/: Tauri copies the directory whole, so a
// local build also picks up .DS_Store or __pycache__ beside manifest.json,
// in patches/ or in state-seed/.
for (const entryPath of walk(managedRoot)) {
  const name = path.basename(entryPath);
  if (isForbiddenName(name)) {
    fail(`app bundle managed GA contains generated/secret artifact: ${display(entryPath)}`);
  }
}

for (const rel of forbiddenStatePaths) {
  const entryPath = path.join(codeRoot, ...rel.split("/"));
  if (fs.existsSync(entryPath)) {
    fail(`app bundle managed GA contains user-state root: ${display(entryPath)}`);
  }
}

for (const rel of excludedUpstreamPaths) {
  const entryPath = path.join(codeRoot, ...rel.split("/"));
  if (fs.existsSync(entryPath)) {
    fail(
      `app bundle managed GA contains an excluded upstream path (scripts/managed-ga-excluded-paths.txt): ${display(entryPath)}`,
    );
  }
}

// core/tauri.conf.json bundles only the runner's modules (`../runner/*.py`).
// Nothing generated or test-only may ride along, and nothing the runner
// needs may be left behind by that glob (a subpackage or a data file would
// be).
for (const entryPath of walk(runnerRoot)) {
  const name = path.basename(entryPath);
  if (name === "tests" || isForbiddenName(name)) {
    fail(`app bundle runner contains a test or generated artifact: ${display(entryPath)}`);
  }
}
if (fs.existsSync(repoRunnerRoot)) {
  for (const name of fs.readdirSync(repoRunnerRoot)) {
    if (name === "tests" || isForbiddenName(name)) continue;
    if (!fs.existsSync(path.join(runnerRoot, name))) {
      fail(
        `app bundle is missing runner/${name} (core/tauri.conf.json bundles only ../runner/*.py)`,
      );
    }
  }
}

if (fs.existsSync(memorySeedRoot)) {
  for (const rel of criticalMemorySeedFiles) {
    requireFile(path.join(memorySeedRoot, ...rel.split("/")));
  }
  // Generated and secret names are caught by the managed-ga/ walk above.
  for (const entryPath of walk(memorySeedRoot)) {
    const name = path.basename(entryPath);
    if (forbiddenMemorySeedFiles.has(name)) {
      fail(`app bundle managed GA memory seed contains generated/secret artifact: ${display(entryPath)}`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[managed-ga-app-bundle] ${error}`);
  }
  process.exit(1);
}

console.log(`[managed-ga-app-bundle] OK ${display(appPath)}`);
