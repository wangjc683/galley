// Update proxy prefix (Settings → General, 2026-11-19, issue #33): an
// address the user types for when GitHub is unreachable. Galley puts it
// in front of the update manifest and package URLs
// (`<prefix><original URL>`); the rules for using it live in
// `core/src/app_update.rs`, which re-checks the saved value with the same
// rule as here and treats anything invalid as off.
//
// The rule, word for word on both sides:
// - empty or blank: off (saved as "");
// - valid: trimmed, it parses as a URL whose scheme is `https` and that
//   has a host; saved with every trailing `/` removed and exactly one
//   added back;
// - anything else is invalid and is not saved.

export type UpdateProxyPrefixInput =
  | { kind: "empty" }
  | { kind: "valid"; normalized: string }
  | { kind: "invalid" };

export function parseUpdateProxyPrefix(raw: string): UpdateProxyPrefixInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "invalid" };
  }
  if (url.protocol !== "https:" || url.hostname === "") {
    return { kind: "invalid" };
  }
  return { kind: "valid", normalized: `${trimmed.replace(/\/+$/, "")}/` };
}
