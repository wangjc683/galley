#!/usr/bin/env node

// Build the Galley CLI and copy it to the target-triple-suffixed filename
// Tauri expects for bundle.externalBin.
//
// Cross-platform port of scripts/prepare-cli-sidecar.sh: the bash version
// cannot run as a Tauri beforeDevCommand / beforeBuildCommand on Windows
// (cmd has no `./script.sh`), which broke the documented local Windows
// build fallback. Node is already required by the frontend toolchain, so
// this version runs everywhere. CI (release.yml) keeps calling the .sh in
// an explicit `shell: bash` step; keep both scripts in sync until CI is
// switched over.
//
// Usage:
//   node scripts/prepare-cli-sidecar.mjs [--profile debug|release] [--target <triple>]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const USAGE = `Usage: node scripts/prepare-cli-sidecar.mjs [--profile debug|release] [--target <triple>]

Examples:
  node scripts/prepare-cli-sidecar.mjs
  node scripts/prepare-cli-sidecar.mjs --profile debug
  node scripts/prepare-cli-sidecar.mjs --target aarch64-apple-darwin
`;

function fail(message) {
  console.error(`[prepare-cli-sidecar] ${message}`);
  process.exit(1);
}

let profile = "release";
let target = "";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--profile") {
    profile = args[++i] ?? "";
  } else if (arg === "--target") {
    target = args[++i] ?? "";
  } else if (arg === "-h" || arg === "--help") {
    console.log(USAGE);
    process.exit(0);
  } else if (!target) {
    target = arg;
  } else {
    console.error(`[prepare-cli-sidecar] unexpected argument: ${arg}`);
    console.error(USAGE);
    process.exit(2);
  }
}

if (profile !== "debug" && profile !== "release") {
  console.error("[prepare-cli-sidecar] --profile must be debug or release");
  process.exit(2);
}

if (!target && process.env.TAURI_ENV_TARGET_TRIPLE) {
  target = process.env.TAURI_ENV_TARGET_TRIPLE;
}

if (!target) {
  const rustcOutput = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  target = rustcOutput.match(/^host:\s*(\S+)/m)?.[1] ?? "";
}

if (!target) {
  fail("could not resolve Rust target triple");
}

const binExt = target.includes("windows") ? ".exe" : "";
const destDir = path.join(repoRoot, "core", "target", "tauri-sidecars");
const dest = path.join(destDir, `galley-${target}${binExt}`);

// Building galley-cli also builds galley-core, whose Tauri build script
// validates bundle.externalBin before the CLI output exists. A temporary
// placeholder breaks that bootstrap cycle; the real CLI overwrites it below.
let placeholderCreated = false;
if (!fs.existsSync(dest)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, "#!/usr/bin/env sh\nexit 1\n");
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // Windows has no unix mode bits; existence is all Tauri checks.
  }
  placeholderCreated = true;
}

const cargoArgs = [
  "build",
  "--manifest-path",
  path.join(repoRoot, "core", "Cargo.toml"),
  "-p",
  "galley-cli",
  "--target",
  target,
];
if (profile === "release") {
  cargoArgs.push("--release");
}

console.log(
  `[prepare-cli-sidecar] building galley-cli profile=${profile} target=${target}`,
);

try {
  execFileSync("cargo", cargoArgs, { stdio: "inherit" });

  const source = path.join(
    repoRoot,
    "core",
    "target",
    target,
    profile,
    `galley${binExt}`,
  );
  if (!fs.existsSync(source)) {
    throw new Error(`missing built CLI: ${source}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(source, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // Windows: no-op, see above.
  }
  placeholderCreated = false;
  console.log(`[prepare-cli-sidecar] sidecar ready: ${dest}`);
} catch (error) {
  // Mirror the bash trap: never leave the fake placeholder behind as if
  // it were a real sidecar.
  if (placeholderCreated) {
    fs.rmSync(dest, { force: true });
  }
  fail(error instanceof Error ? error.message : String(error));
}
