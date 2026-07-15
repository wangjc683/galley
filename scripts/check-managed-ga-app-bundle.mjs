#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const managedRoot = path.join(resourcesRoot, "managed-ga");
const codeRoot = path.join(managedRoot, "code");
const memorySeedRoot = path.join(managedRoot, "state-seed", "memory");
const manifestPath = path.join(managedRoot, "manifest.json");

const errors = [];
const criticalMemorySeedFiles = [
  "memory_management_sop.md",
  "plan_sop.md",
  "tmwebdriver_sop.md",
  "web_setup_sop.md",
  "deliverable_audit_sop.md",
  "supervisor_sop.md",
  "project_mode_sop.md",
  "L4_raw_sessions/salient_mining_sop.md",
  "L4_raw_sessions/compress_session.py",
];
const forbiddenMemorySeedFiles = new Set([
  "global_mem.txt",
  "global_mem_insight.txt",
  "file_access_stats.json",
  "all_histories.txt",
]);

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

function walk(dir) {
  const pending = [dir];
  const entries = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      entries.push(entryPath);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return entries;
}

requireDir(appPath);
requireDir(macOsRoot);
requireExecutableFile(path.join(macOsRoot, "galley"));
requireDir(resourcesRoot);
requireDir(path.join(resourcesRoot, "runner"));
requireFile(path.join(resourcesRoot, "runner", "workbench_bridge.py"));
requireDir(path.join(resourcesRoot, "python"));
requireDir(managedRoot);
requireDir(codeRoot);
requireDir(memorySeedRoot);
requireFile(manifestPath);
requireFile(path.join(managedRoot, "patches", "manifest.md"));
requireFile(path.join(codeRoot, "agentmain.py"));
requireFile(path.join(codeRoot, "agent_loop.py"));
requireFile(path.join(codeRoot, "llmcore.py"));
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

const forbiddenNames = new Set([
  ".DS_Store",
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  "env",
  "mykey.py",
  "mykey.json",
  ".env",
  "auth.json",
]);
const forbiddenRootState = new Set([
  "memory",
  "sop",
  "skills",
  "temp",
  "model_responses",
]);

for (const entryPath of walk(codeRoot)) {
  const name = path.basename(entryPath);
  if (forbiddenNames.has(name) || name.endsWith(".pyc")) {
    fail(`app bundle managed GA contains generated/secret artifact: ${display(entryPath)}`);
  }
}

for (const name of forbiddenRootState) {
  const entryPath = path.join(codeRoot, name);
  if (fs.existsSync(entryPath)) {
    fail(`app bundle managed GA contains user-state root: ${display(entryPath)}`);
  }
}

if (fs.existsSync(memorySeedRoot)) {
  for (const rel of criticalMemorySeedFiles) {
    requireFile(path.join(memorySeedRoot, ...rel.split("/")));
  }
  for (const entryPath of walk(memorySeedRoot)) {
    const name = path.basename(entryPath);
    if (
      forbiddenNames.has(name) ||
      forbiddenMemorySeedFiles.has(name) ||
      name.endsWith(".pyc")
    ) {
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
