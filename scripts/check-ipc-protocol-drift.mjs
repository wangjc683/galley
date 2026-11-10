#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const debugTiming = process.argv.includes("--debug-timing");

const FILES = {
  python: path.join(repoRoot, "runner/ipc.py"),
  rust: path.join(repoRoot, "core/src/ipc.rs"),
  ts: path.join(repoRoot, "gui/src/types/ipc.ts"),
};

const DOMAIN_BY_KIND_SUFFIX = {
  Event: "events",
  Command: "commands",
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function fail(message) {
  throw new Error(message);
}

function timed(label, fn) {
  const started = performance.now();
  const result = fn();
  if (debugTiming) {
    const elapsed = Math.round((performance.now() - started) * 10) / 10;
    console.error(`[ipc-drift] ${label}: ${elapsed}ms`);
  }
  return result;
}

function snakeToCamel(name) {
  return name.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function pascalToSnake(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function fieldMapEntries(fields) {
  return sorted([...fields.keys()]);
}

// The GUI mirror carries no version constant: nothing on the desktop side
// checks `ready.protocolVersion` (docs/ipc-protocol.md §9), so only the
// runner's and Core's constants are compared.
function parseProtocolVersion(source, language) {
  const patterns = {
    python: /\bPROTOCOL_VERSION\s*=\s*"([^"]+)"/,
    rust: /\bPROTOCOL_VERSION\s*:\s*&str\s*=\s*"([^"]+)"/,
  };
  const match = source.match(patterns[language]);
  if (!match) fail(`Could not find PROTOCOL_VERSION in ${language}`);
  return match[1];
}

function classDomain(name) {
  for (const [suffix, domain] of Object.entries(DOMAIN_BY_KIND_SUFFIX)) {
    if (name.endsWith(suffix)) return domain;
  }
  return null;
}

function parsePython(source) {
  const protocolVersion = parseProtocolVersion(source, "python");
  const result = { protocolVersion, events: new Map(), commands: new Map() };
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "@dataclass") continue;
    const classLine = lines[i + 1] ?? "";
    const classMatch = classLine.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)[^\n]*:/);
    if (!classMatch) continue;
    const className = classMatch[1];
    const domain = classDomain(className);
    if (!domain) continue;
    const bodyLines = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() !== "" && !line.startsWith("    ")) break;
      bodyLines.push(line);
    }
    const body = bodyLines.join("\n");
    const kindMatch = body.match(/^\s{4}kind:\s*str\s*=\s*"([^"]+)"/m);
    if (!kindMatch) {
      fail(`Python ${className} is missing a literal kind field`);
    }
    const fields = [];
    for (const line of body.split("\n")) {
      const field = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.+)$/);
      if (!field) continue;
      if (field[1] === "kind") continue;
      const declaration = field[2].split("#", 1)[0].trim();
      const equalsIndex = declaration.indexOf("=");
      const typeExpr =
        equalsIndex >= 0
          ? declaration.slice(0, equalsIndex).trim()
          : declaration;
      const defaultExpr =
        equalsIndex >= 0 ? declaration.slice(equalsIndex + 1).trim() : null;
      fields.push([
        field[1],
        {
          nullable: /\bNone\b/.test(typeExpr),
          optional: defaultExpr !== null,
        },
      ]);
    }
    result[domain].set(kindMatch[1], new Map(fields));
  }
  return result;
}

function findRustEnumVariants(source, enumName) {
  const enumStart = source.indexOf(`pub enum ${enumName}`);
  if (enumStart < 0) fail(`Could not find Rust enum ${enumName}`);
  const open = source.indexOf("{", enumStart);
  if (open < 0) fail(`Could not find Rust enum body for ${enumName}`);
  const close = findMatchingBrace(source, open);
  const body = source.slice(open + 1, close);
  const variants = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const tuple = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\),?$/);
    if (tuple) {
      variants.push({ kind: pascalToSnake(tuple[1]), structName: tuple[2] });
      continue;
    }
    const bare = line.match(/^([A-Za-z_][A-Za-z0-9_]*),?$/);
    if (bare) {
      variants.push({ kind: pascalToSnake(bare[1]), structName: null });
    }
  }
  return variants;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  fail(`Could not find matching brace at index ${openIndex}`);
}

function parseRustStructFields(source, structName) {
  const structStart = source.indexOf(`pub struct ${structName}`);
  if (structStart < 0) fail(`Could not find Rust struct ${structName}`);
  const open = source.indexOf("{", structStart);
  if (open < 0) fail(`Could not find Rust struct body for ${structName}`);
  const close = findMatchingBrace(source, open);
  const fields = [];
  const attrs = [];
  for (const rawLine of source.slice(open + 1, close).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#[")) {
      attrs.push(line);
      continue;
    }
    const field = line.match(/^pub\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,]+),?/);
    if (!field) {
      attrs.length = 0;
      continue;
    }
    const attrText = attrs.join(" ");
    const renameAttr = attrText.match(/\brename\s*=\s*"([^"]+)"/);
    const typeExpr = field[2].trim();
    fields.push([
      renameAttr ? renameAttr[1] : snakeToCamel(field[1]),
      {
        nullable: /\bOption\s*</.test(typeExpr),
        optional:
          /\bOption\s*</.test(typeExpr) || /\bserde\s*\([^)]*\bdefault\b/.test(attrText),
        skipIfNone: /skip_serializing_if\s*=\s*"Option::is_none"/.test(
          attrText,
        ),
      },
    ]);
    attrs.length = 0;
  }
  return new Map(fields);
}

function parseRust(source) {
  const protocolVersion = parseProtocolVersion(source, "rust");
  const result = { protocolVersion, events: new Map(), commands: new Map() };
  for (const { kind, structName } of findRustEnumVariants(source, "IpcEvent")) {
    result.events.set(
      kind,
      structName ? parseRustStructFields(source, structName) : [],
    );
  }
  for (const { kind, structName } of findRustEnumVariants(source, "IpcCommand")) {
    result.commands.set(
      kind,
      structName ? parseRustStructFields(source, structName) : [],
    );
  }
  return result;
}

function parseTypeScript(source) {
  const result = { protocolVersion: null, events: new Map(), commands: new Map() };
  const commandMarker = source.indexOf("// ---------------- Commands");
  if (commandMarker < 0) fail("Could not find TypeScript commands marker");

  let index = 0;
  while (index < source.length) {
    const match = /export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(
      source.slice(index),
    );
    if (!match) break;
    const start = index + match.index;
    const open = source.indexOf("{", start);
    const close = findMatchingBrace(source, open);
    const body = source.slice(open + 1, close);
    index = close + 1;

    const kindMatch = body.match(/^\s*kind\??:\s*"([^"]+)"/m);
    if (!kindMatch) continue;
    const domain = start < commandMarker ? "events" : "commands";
    const fields = [];
    for (const line of body.split("\n")) {
      const field = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?:\s*(.+)$/);
      if (!field) continue;
      if (field[1] === "kind") continue;
      fields.push([
        field[1],
        {
          nullable: /\bnull\b/.test(field[3]),
          optional: field[2] === "?",
        },
      ]);
    }
    result[domain].set(kindMatch[1], new Map(fields));
  }
  return result;
}

function compareVersions(specs) {
  const versions = Object.entries(specs)
    .filter(([, spec]) => spec.protocolVersion !== null)
    .map(([name, spec]) => [name, spec.protocolVersion]);
  const expected = versions[0][1];
  return versions
    .filter(([, version]) => version !== expected)
    .map(
      ([name, version]) =>
        `PROTOCOL_VERSION mismatch: ${name} has ${version}, expected ${expected}`,
    );
}

function compareDomain(domain, specs) {
  const names = Object.keys(specs);
  const allKinds = new Set(
    names.flatMap((name) => [...specs[name][domain].keys()]),
  );
  const errors = [];
  for (const kind of sorted(allKinds)) {
    const present = names.filter((name) => specs[name][domain].has(kind));
    const missing = names.filter((name) => !specs[name][domain].has(kind));
    if (missing.length > 0) {
      errors.push(
        `${domain}.${kind}: missing in ${missing.join(", ")} (present in ${present.join(", ")})`,
      );
      continue;
    }
    const fieldMaps = Object.fromEntries(
      names.map((name) => [name, specs[name][domain].get(kind) ?? new Map()]),
    );
    const allFields = new Set(Object.values(fieldMaps).flatMap(fieldMapEntries));
    for (const name of names) {
      const fields = new Set(fieldMapEntries(fieldMaps[name]));
      const missingFields = sorted([...allFields].filter((field) => !fields.has(field)));
      const extraFields = sorted([...fields].filter((field) => !allFields.has(field)));
      if (missingFields.length > 0) {
        errors.push(
          `${domain}.${kind}: ${name} missing field(s): ${missingFields.join(", ")}`,
        );
      }
      if (extraFields.length > 0) {
        errors.push(
          `${domain}.${kind}: ${name} extra field(s): ${extraFields.join(", ")}`,
        );
      }
    }
  }
  return errors;
}

function compareSemantics(domain, specs) {
  const errors = [];
  const names = Object.keys(specs);
  const allKinds = new Set(
    names.flatMap((name) => [...specs[name][domain].keys()]),
  );
  for (const kind of sorted(allKinds)) {
    if (!names.every((name) => specs[name][domain].has(kind))) continue;
    const fields = new Set(
      names.flatMap((name) => fieldMapEntries(specs[name][domain].get(kind))),
    );
    for (const field of sorted(fields)) {
      const python = specs.python[domain].get(kind)?.get(field);
      const rust = specs.rust[domain].get(kind)?.get(field);
      const ts = specs.ts[domain].get(kind)?.get(field);
      if (!python || !rust || !ts) continue;

      if (domain === "commands") {
        if (ts.optional && !rust.optional) {
          errors.push(
            `${domain}.${kind}.${field}: ts allows omission but rust requires the field`,
          );
        }
        if (ts.optional && !python.optional) {
          errors.push(
            `${domain}.${kind}.${field}: ts allows omission but python has no default`,
          );
        }
        if (ts.nullable && !rust.nullable) {
          errors.push(
            `${domain}.${kind}.${field}: ts allows null but rust is not Option`,
          );
        }
        if (ts.nullable && !python.nullable) {
          errors.push(
            `${domain}.${kind}.${field}: ts allows null but python type does not include None`,
          );
        }
        if (ts.optional && !ts.nullable && rust.nullable && !rust.skipIfNone) {
          errors.push(
            `${domain}.${kind}.${field}: ts omits rather than sends null, but rust Option serializes None as null`,
          );
        }
        if (rust.skipIfNone && !python.optional) {
          errors.push(
            `${domain}.${kind}.${field}: rust may omit None, but python has no default`,
          );
        }
      } else {
        if (python.nullable && !rust.nullable) {
          errors.push(
            `${domain}.${kind}.${field}: python can emit null but rust is not Option`,
          );
        }
        if (python.nullable && !ts.nullable) {
          errors.push(
            `${domain}.${kind}.${field}: python can emit null but ts type does not include null`,
          );
        }
        if (rust.skipIfNone && !ts.optional) {
          errors.push(
            `${domain}.${kind}.${field}: rust may omit None, but ts field is required`,
          );
        }
        if (rust.nullable && !rust.skipIfNone && !ts.nullable) {
          errors.push(
            `${domain}.${kind}.${field}: rust Option can serialize null, but ts type does not include null`,
          );
        }
      }
    }
  }
  return errors;
}

function summarize(specs) {
  return Object.entries(specs)
    .map(([name, spec]) => {
      const eventCount = spec.events.size;
      const commandCount = spec.commands.size;
      return `${name}: ${eventCount} events, ${commandCount} commands`;
    })
    .join("; ");
}

const specs = {
  python: timed("parse python", () => parsePython(read(FILES.python))),
  rust: timed("parse rust", () => parseRust(read(FILES.rust))),
  ts: timed("parse ts", () => parseTypeScript(read(FILES.ts))),
};

const errors = [
  ...timed("compare versions", () => compareVersions(specs)),
  ...timed("compare event fields", () => compareDomain("events", specs)),
  ...timed("compare command fields", () => compareDomain("commands", specs)),
  ...timed("compare event semantics", () => compareSemantics("events", specs)),
  ...timed("compare command semantics", () =>
    compareSemantics("commands", specs),
  ),
];

if (errors.length > 0) {
  console.error("[ipc-drift] IPC protocol drift detected:");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `[ipc-drift] IPC protocol fields and optional/null semantics aligned (${summarize(specs)})`,
);
