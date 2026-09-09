/** Only re-indent JSON that is actually hard to read (minified). A file
 * the agent already pretty-printed is shown byte-for-byte. */
const MAX_PRETTY_JSON_BYTES = 1024 * 1024;

export interface DelimitedTable {
  header: string[];
  rows: string[][];
}

/**
 * RFC 4180-style parser: quoted fields may contain the delimiter,
 * newlines and doubled quotes. Returns null when the file does not look
 * like a regular table (fewer than two columns, or ragged beyond one
 * trailing empty column), so the caller falls back to plain lines rather
 * than showing a misleading grid.
 */
export function parseDelimited(
  content: string,
  delimiter: "," | "\t",
): DelimitedTable | null {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) return null;
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const rows = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return null;
  const [header, ...body] = rows;
  if (header.length < 2) return null;
  const width = header.length;
  const regular = body.every(
    (r) => r.length === width || (r.length === width + 1 && r[width] === ""),
  );
  if (!regular) return null;
  return {
    header,
    rows: body.map((r) => r.slice(0, width)),
  };
}

/** Re-indent JSON that sits on one line; leave everything else as is. */
export function prettyJson(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.includes("\n") || trimmed.length > MAX_PRETTY_JSON_BYTES)
    return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}
