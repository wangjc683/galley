import { textColumns } from "@/lib/text-columns";

/**
 * Which columns of a Markdown table keep their cells on one line (main
 * chat PRD ruling 136, ticket 92).
 *
 * WebKit's automatic table layout shares the width out roughly by how
 * long each column is unwrapped, and Chinese may break between any two
 * characters, so a short Chinese column can be squeezed down to one
 * character: next to a column of 56-character cells, a column of team
 * names got 8% of the table and stood 「凯尔特人」 one character a line.
 * A column whose every cell, header included, is short does not wrap;
 * the rest wrap as before. The rule reads the text only, so it comes
 * out the same in every surface and at every reading size.
 */

/** A column is short when no cell of it, header included, is wider than
 * this many columns (8 CJK characters; `textColumns`). */
export const SHORT_COLUMN_MAX = 16;

/** The most columns the short columns may take between them, about 20
 * CJK characters (at most 310px of text at the largest table size, under
 * half the ~641px inside a bubble in the 760 column). Past it none of
 * them is kept whole and the table wraps as before: an unwrapped cell
 * raises the least width the table can take, and without the cap 7 of
 * the 269 tables in the database would newly scroll sideways (ruling
 * 136 item 3). */
export const SHORT_COLUMNS_BUDGET = 40;

/**
 * The columns to keep on one line, by position. `rows` is each row's
 * cells as they read (Markdown markers off), the header row included.
 * Rows may be ragged: a column is measured on the cells it has.
 */
export function shortTableColumns(
  rows: readonly (readonly string[])[],
): Set<number> {
  const widest: number[] = [];
  for (const row of rows) {
    row.forEach((cell, column) => {
      widest[column] = Math.max(widest[column] ?? 0, textColumns(cell));
    });
  }
  const short = new Set<number>();
  let total = 0;
  widest.forEach((width, column) => {
    if (width > SHORT_COLUMN_MAX) return;
    short.add(column);
    total += width;
  });
  return total > SHORT_COLUMNS_BUDGET ? new Set() : short;
}

interface Node {
  type: string;
  value?: string;
  align?: unknown[];
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
}

/** A cell's text as it renders: text and inline code by their value,
 * emphasis and links by their children; whitespace collapses. */
function renderedText(node: Node): string {
  const text = (n: Node): string =>
    n.value ?? n.children?.map(text).join("") ?? "";
  return text(node).replace(/\s+/g, " ").trim();
}

/** Marks the cells of each table's short columns (`shortTableColumns`)
 * with `data-short-col`, which MarkdownView's table styles key
 * `white-space: nowrap` off. */
export function remarkTableShortColumns() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (node.type === "table") markShortColumns(node);
      else node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function markShortColumns(table: Node) {
  // GFM draws as many columns as the delimiter row has; a row's cells
  // past that are parsed but never drawn, so they do not count.
  const rows = (table.children ?? []).map((row) =>
    (row.children ?? []).slice(0, table.align?.length),
  );
  const short = shortTableColumns(rows.map((cells) => cells.map(renderedText)));
  for (const cells of rows) {
    cells.forEach((cell, column) => {
      if (!short.has(column)) return;
      cell.data = {
        ...cell.data,
        hProperties: { ...cell.data?.hProperties, "data-short-col": "" },
      };
    });
  }
}
