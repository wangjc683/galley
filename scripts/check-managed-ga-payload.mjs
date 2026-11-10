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
const managedRoot = path.join(repoRoot, "managed-ga");
const codeRoot = path.join(managedRoot, "code");
const memorySeedRoot = path.join(managedRoot, "state-seed", "memory");
const manifestPath = path.join(managedRoot, "manifest.json");
const tauriConfigPath = path.join(repoRoot, "core", "tauri.conf.json");
const patchRoot = path.join(managedRoot, "patches");

const errors = [];
const pythonAssetPathPattern =
  /os\.path\.join\([^)\n]*script_dir[^)\n]*(?:f?["']assets\/|["']assets\/)/;

function fail(message) {
  errors.push(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${relative(file)} (${error.message})`);
    return null;
  }
}

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`missing file: ${relative(file)}`);
  }
}

function requireDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail(`missing directory: ${relative(dir)}`);
  }
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

requireDir(managedRoot);
requireDir(codeRoot);
requireDir(memorySeedRoot);
requireFile(manifestPath);
requireFile(path.join(patchRoot, "manifest.md"));
for (const rel of criticalCodeFiles) {
  requireFile(path.join(codeRoot, ...rel.split("/")));
}
if (fs.existsSync(path.join(managedRoot, "galley-prompts"))) {
  fail("managed prompt profile is embedded in Core; remove managed-ga/galley-prompts");
}

const tauriConfig = readJson(tauriConfigPath);
const resourceMap = tauriConfig?.bundle?.resources;
if (!resourceMap || resourceMap["../managed-ga"] !== "managed-ga") {
  fail("core/tauri.conf.json must bundle ../managed-ga as managed-ga");
}
// Only the runner's modules ship: mapping the whole directory would also
// bundle runner/tests (and, on a local build, __pycache__ and .DS_Store).
if (!resourceMap || resourceMap["../runner/*.py"] !== "runner/") {
  fail('core/tauri.conf.json must bundle the runner modules as "../runner/*.py": "runner/"');
}
if (resourceMap && Object.hasOwn(resourceMap, "../runner")) {
  fail("core/tauri.conf.json must not bundle ../runner whole (it ships runner/tests)");
}
const externalBin = tauriConfig?.bundle?.externalBin;
if (
  !Array.isArray(externalBin) ||
  !externalBin.includes("target/tauri-sidecars/galley")
) {
  fail("core/tauri.conf.json must bundle the Galley CLI via target/tauri-sidecars/galley");
}

const manifest = readJson(manifestPath);
if (manifest) {
  if (manifest.schemaVersion !== 1) {
    fail(`managed-ga/manifest.json schemaVersion must be 1, got ${manifest.schemaVersion}`);
  }
  if (!manifest.upstream?.commit) {
    fail("managed-ga/manifest.json must pin upstream.commit");
  }
  if (!manifest.patchStack?.id) {
    fail("managed-ga/manifest.json must declare patchStack.id");
  }
  const patches = manifest.patchStack?.patches;
  if (!Array.isArray(patches) || patches.length === 0) {
    fail("managed-ga/manifest.json must list at least one replayable patch");
  } else {
    const listedPatches = new Set();
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
      listedPatches.add(patchName);
      requireFile(path.join(patchRoot, patchName));
    }
    for (const entry of fs.readdirSync(patchRoot)) {
      if (entry.endsWith(".patch") && !listedPatches.has(entry)) {
        fail(`managed-ga/manifest.json must list patch file: patches/${entry}`);
      }
    }
  }
}

if (fs.existsSync(codeRoot)) {
  for (const entryPath of walk(codeRoot)) {
    const name = path.basename(entryPath);
    if (isForbiddenName(name)) {
      fail(`managed GA payload contains generated/secret artifact: ${relative(entryPath)}`);
    }
    if (entryPath.endsWith(".py")) {
      const source = fs.readFileSync(entryPath, "utf8");
      if (pythonAssetPathPattern.test(source)) {
        fail(`managed GA Python must join assets with path segments, not slash strings: ${relative(entryPath)}`);
      }
    }
  }
  for (const rel of forbiddenStatePaths) {
    const entryPath = path.join(codeRoot, ...rel.split("/"));
    if (fs.existsSync(entryPath)) {
      fail(`managed GA payload contains user-state root: ${relative(entryPath)}`);
    }
  }
  for (const rel of excludedUpstreamPaths) {
    const entryPath = path.join(codeRoot, ...rel.split("/"));
    if (fs.existsSync(entryPath)) {
      fail(
        `managed GA payload contains an excluded upstream path (scripts/managed-ga-excluded-paths.txt): ${relative(entryPath)}`,
      );
    }
  }
}

if (fs.existsSync(memorySeedRoot)) {
  for (const rel of criticalMemorySeedFiles) {
    requireFile(path.join(memorySeedRoot, ...rel.split("/")));
  }
  for (const entryPath of walk(memorySeedRoot)) {
    const name = path.basename(entryPath);
    if (isForbiddenName(name) || forbiddenMemorySeedFiles.has(name)) {
      fail(`managed GA memory seed contains generated/secret artifact: ${relative(entryPath)}`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[managed-ga-payload] ${error}`);
  }
  process.exit(1);
}

console.log("[managed-ga-payload] OK");
