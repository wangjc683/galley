import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind v4 writes `translate-*`, `scale-*` and `rotate-*` as their own CSS
// properties (`translate`, `scale`, `rotate`), not into `transform`. A
// hand-written property list that names `transform` therefore never animates
// them: the press sink, the settings caret and the project group's slide-in
// were all instant until press-transition ticket 01. Name the real properties
// instead. (This comment avoids spelling such a list out: Tailwind scans this
// file too and would emit a junk utility for it.)
//
// The rule is "no `transform` in a hand-written list" rather than "`transform`
// plus all three": nothing in gui/src uses a utility that still writes
// `transform` (skew, `transform-[…]`), so a `transform` entry is always the v3
// habit and never does anything. Tailwind's own `transition-transform` and
// `transition` already cover translate / scale / rotate and are not scanned.
describe("hand-written transition property lists", () => {
  const SRC = path.resolve(__dirname, "..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("name translate / scale / rotate, never transform", () => {
    const self = path.resolve(__filename);
    const hits = sources(SRC)
      .filter((file) => file !== self)
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            [...line.matchAll(/transition-\[([^\]]*)\]/g)]
              .filter((match) =>
                match[1].split(",").some((prop) => prop.trim() === "transform"),
              )
              .map(
                (match) =>
                  `${path.relative(SRC, file)}:${index + 1}: ${match[0]}`,
              ),
          ),
      );
    expect(hits).toEqual([]);
  });
});
