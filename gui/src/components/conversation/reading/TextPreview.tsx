import { useMemo } from "react";

import { PlainFileLines } from "@/components/conversation/diff/PlainFileLines";
import { useCopy } from "@/lib/i18n";
import { isDelimitedPath, isJsonPath } from "@/lib/local-file-path";
import { parseDelimited, prettyJson } from "@/lib/text-preview";
import { PanelNotice } from "./PanelNotice";

/** Rows rendered as a table before the notice takes over; a data file an
 * agent produced is scanned for shape, not read row by row. */
const MAX_TABLE_ROWS = 1000;
/**
 * The reading panel's view of a text file: numbered plain lines in the
 * Git review's gutter register, with two readable specialisations —
 * delimited data (.csv / .tsv) as a table when it parses cleanly, and
 * single-line JSON re-indented. No syntax highlighting in this cut; the
 * diff view has none either, and the two should read as one surface.
 */
export function TextPreview({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const copy = useCopy().localFiles;
  const delimiter = isDelimitedPath(path);
  const table = useMemo(
    () => (delimiter ? parseDelimited(content, delimiter) : null),
    [content, delimiter],
  );
  const json = useMemo(
    () => (isJsonPath(path) ? prettyJson(content) : null),
    [content, path],
  );

  if (table) {
    const shown = table.rows.slice(0, MAX_TABLE_ROWS);
    return (
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-ui-tertiary text-ink-muted">
          <span>{copy.tableRows(table.rows.length, table.header.length)}</span>
        </div>
        {table.rows.length > shown.length && (
          <PanelNotice kind="info">
            {copy.tableTruncated(shown.length, table.rows.length)}
          </PanelNotice>
        )}
        <div className="overflow-auto px-4 py-3">
          <table className="reading-table border-separate border-spacing-0 font-mono text-[12px] leading-[1.5] text-ink">
            <thead>
              <tr>
                <th
                  aria-hidden="true"
                  className="sticky top-0 z-10 select-none border-b border-line bg-app pr-3 text-right tabular-nums font-normal text-ink-muted"
                />
                {table.header.map((cell, index) => (
                  <th
                    key={index}
                    className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-app px-2 py-1 text-left font-semibold"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="select-none pr-3 text-right tabular-nums text-ink-muted">
                    {rowIndex + 1}
                  </td>
                  {table.header.map((_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="max-w-[48ch] truncate border-b border-line/60 px-2 py-1 align-top"
                      title={row[cellIndex]}
                    >
                      {row[cellIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const body = json ?? content;
  const lineCount = body.split("\n").length;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-ui-tertiary text-ink-muted">
        <span>{copy.lines(lineCount)}</span>
        {json !== null && <span>· {copy.jsonPretty}</span>}
        {delimiter !== null && table === null && (
          <span>· {copy.tableFallback}</span>
        )}
      </div>
      <div className="px-4 py-3">
        <PlainFileLines content={body} />
      </div>
    </div>
  );
}
