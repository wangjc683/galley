// What the managed GA payload must and must not contain. Both payload gates
// read these lists: check-managed-ga-payload.mjs on managed-ga/ in the
// source tree, check-managed-ga-app-bundle.mjs on the same tree after Tauri
// copies it into Galley.app. They used to keep hand copies, and the app
// bundle copy fell behind (no ultraplan_sop.md, no frontends/ entries).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to managed-ga/code.
export const criticalCodeFiles = [
  "agentmain.py",
  "agent_loop.py",
  "llmcore.py",
  // llmcore.py imports it at its end (upstream 4ca9028); a missing file
  // fails `import llmcore` with ModuleNotFoundError.
  "legacy_llmcore.py",
  "frontends/wechatapp.py",
  "frontends/fsapp.py",
  "frontends/dcapp.py",
  "frontends/workspace_cmd.py",
];

// Paths relative to managed-ga/state-seed/memory.
export const criticalMemorySeedFiles = [
  "memory_management_sop.md",
  "plan_sop.md",
  "tmwebdriver_sop.md",
  "web_setup_sop.md",
  "deliverable_audit_sop.md",
  "supervisor_sop.md",
  "project_mode_sop.md",
  "ultraplan_sop.md",
  "L4_raw_sessions/salient_mining_sop.md",
  "L4_raw_sessions/compress_session.py",
];

// User memory GA writes from templates; the seed must never carry one.
export const forbiddenMemorySeedFiles = new Set([
  "global_mem.txt",
  "global_mem_insight.txt",
  "file_access_stats.json",
  "all_histories.txt",
]);

// Generated, local or secret-bearing entries, at any depth.
export const forbiddenNames = new Set([
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
export const forbiddenNameSuffixes = [".pyc", ".egg-info"];

export function isForbiddenName(name) {
  return (
    forbiddenNames.has(name) ||
    forbiddenNameSuffixes.some((suffix) => name.endsWith(suffix))
  );
}

// State GA writes beside its own code, relative to managed-ga/code. The
// managed runtime keeps it under GALLEY_GA_STATE_ROOT; none of it ships.
// `sche_tasks` holds upstream's scheduled tasks, `frontends/temp` its
// frontends' scratch files.
export const forbiddenStatePaths = [
  "memory",
  "sop",
  "skills",
  "temp",
  "model_responses",
  "sche_tasks",
  "frontends/temp",
];

// Upstream media the payload leaves out, relative to managed-ga/code. The
// list lives in managed-ga-excluded-paths.txt, which build-managed-ga.sh
// also reads.
export const excludedUpstreamPaths = fs
  .readFileSync(path.join(scriptDir, "managed-ga-excluded-paths.txt"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

// Lists every entry (files and directories) under `dir`; empty when `dir`
// does not exist.
export function walk(dir) {
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
