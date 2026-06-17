#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const templatePath = path.join(
  repoRoot,
  "docs",
  "galley-native",
  "dogfood",
  "support-readiness-record-template.md",
);

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[init-native-dogfood] ${error.message}`);
  process.exit(1);
}

if (args.help) {
  printUsage();
  process.exit(0);
}

main().catch((error) => {
  console.error(`[init-native-dogfood] ${error.message}`);
  process.exit(1);
});

async function main() {
  const scope = args.scope ?? "support-readiness";
  if (scope !== "support-readiness") {
    throw new Error("only --scope support-readiness is supported for Slice 9E-B");
  }

  const date = args.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--date must use YYYY-MM-DD");
  }

  const root = path.resolve(
    repoRoot,
    args.root ?? path.join(".cache", "galley-native-dogfood", "9e-b"),
  );
  const parityDir = path.join(root, "parity");
  const screenshotsDir = path.join(root, "screenshots");
  const recordPath = path.join(root, `support-readiness-${date}.md`);
  const force = args.force === true;
  const dryRun = args["dry-run"] === true;

  if (!fsSync.existsSync(templatePath)) {
    throw new Error(`missing template: ${relative(templatePath)}`);
  }
  if (fsSync.existsSync(recordPath) && !force) {
    throw new Error(
      `record already exists: ${relative(recordPath)} (pass --force to overwrite)`,
    );
  }

  const template = await fs.readFile(templatePath, "utf8");
  const filled = fillTemplate(template, {
    date,
    operator: args.operator ?? process.env.USER ?? process.env.USERNAME ?? "",
    commit: gitCommit(),
    build: args.build ?? "local desktop / CLI dogfood",
    nativeGate: args["native-gate"] ?? "GALLEY_NATIVE_EXPERIMENTAL=1",
    model: args.model ?? "",
    workspace: args.workspace ?? "",
    browser: args.browser ?? "",
    root: relative(root),
    p08Command: relative(path.join(parityDir, "p08-command.json")),
    p19Command: relative(path.join(parityDir, "p19-command.json")),
  });

  const summary = {
    scope,
    date,
    dryRun,
    root: relative(root),
    record: relative(recordPath),
    parityDir: relative(parityDir),
    screenshotsDir: relative(screenshotsDir),
  };

  if (!dryRun) {
    await fs.mkdir(parityDir, { recursive: true });
    await fs.mkdir(screenshotsDir, { recursive: true });
    await fs.writeFile(recordPath, filled);
  }

  console.log(JSON.stringify(summary, null, 2));
}

function fillTemplate(template, values) {
  let body = template;
  body = replaceLine(body, "Date", values.date);
  body = replaceLine(body, "Operator", values.operator);
  body = replaceLine(body, "Galley commit", values.commit);
  body = replaceLine(body, "Build/runtime", values.build);
  body = replaceLine(body, "Native gate state", values.nativeGate);
  body = replaceLine(body, "Model/provider", values.model);
  body = replaceLine(body, "Workspace status", values.workspace);
  body = replaceLine(body, "Browser/profile", values.browser);
  body = replaceLine(body, "Raw artifact root", values.root);
  body = replaceListItem(body, "P08 command evidence", values.p08Command);
  body = replaceListItem(body, "P19 command evidence", values.p19Command);
  return body;
}

function replaceLine(body, label, value) {
  return body.replace(
    new RegExp(`^${escapeRegExp(label)}:.*$`, "m"),
    `${label}: ${value}`,
  );
}

function replaceListItem(body, label, value) {
  return body.replace(
    new RegExp(`^- ${escapeRegExp(label)}:.*$`, "m"),
    `- ${label}: ${value}`,
  );
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force" || arg === "--dry-run") {
      parsed[arg.slice(2)] = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      parsed[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printUsage() {
  console.log(`Usage: node scripts/init-native-dogfood.mjs [options]

Create a local ignored P08/P18/P19 support-readiness dogfood record.

Options:
  --scope support-readiness     Only supported scope; default support-readiness
  --date YYYY-MM-DD             Record date; default today
  --operator NAME               Operator name; default USER/USERNAME
  --model TEXT                  Model/provider note
  --browser TEXT                Browser/profile note
  --workspace TEXT              Workspace note
  --build TEXT                  Build/runtime note
  --native-gate TEXT            Native gate note; default GALLEY_NATIVE_EXPERIMENTAL=1
  --root PATH                   Artifact root; default .cache/galley-native-dogfood/9e-b
  --force                       Overwrite existing record for the date
  --dry-run                     Print paths without writing files
  --help, -h                    Show this help
`);
}
