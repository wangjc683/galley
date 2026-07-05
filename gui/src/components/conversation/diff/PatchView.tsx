import { diffLines } from "diff";
import { useMemo } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface PatchViewProps {
  /** File path; shown in the patch header. */
  path: string;
  /** Existing content (empty string for new-file creation). */
  oldContent: string;
  /** Proposed content. */
  newContent: string;
}

/**
 * Two-column split-diff view for the file_patch Approval Card body.
 * DESIGN.md §4.6 (file_patch renderer).
 *
 * Self-rendered using `diff.diffLines` to compute change blocks, then
 * laying them out as paired rows: deletions go on the left, additions
 * on the right, context lines mirror on both sides, and unbalanced
 * blocks pad the shorter side with "empty" rows so additions and
 * deletions align horizontally.
 *
 * Why not @pierre/diffs: tried it, but its Shiki backend pulls every
 * language bundle into the build (~+400 KB after gzip). For V0.1 we
 * don't need syntax highlighting in the approval surface — line-by-
 * line +/- with a clear path header is enough. We can revisit
 * @pierre/diffs in V0.2 if we want hover/highlight inside the diff,
 * scoped down to the languages we actually use.
 */
export function PatchView({ path, oldContent, newContent }: PatchViewProps) {
  const copy = useCopy();
  const { rows, added, removed } = useMemo(
    () => buildRows(oldContent, newContent),
    [oldContent, newContent],
  );
  const isNewFile = oldContent === "" && added > 0;

  return (
    <div className="overflow-hidden rounded-callout border border-line bg-surface font-mono text-[12px] leading-[1.55]">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-app px-3 py-2">
        <span className="select-text font-mono text-[12px] text-ink">{path}</span>
        <span className="flex items-center gap-2 text-ink-muted">
          {added > 0 && (
            <span className="text-success">
              {copy.conversation.diffLinesAdded(added)}
            </span>
          )}
          {removed > 0 && (
            <span className="text-error">
              {copy.conversation.diffLinesRemoved(removed)}
            </span>
          )}
          {isNewFile && (
            <span className="text-ink-muted">
              · {copy.conversation.diffNewFile}
            </span>
          )}
          {added === 0 && removed === 0 && (
            <span>{copy.conversation.diffNoChange}</span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2">
        <DiffSide rows={rows} side="old" />
        <DiffSide rows={rows} side="new" />
      </div>
    </div>
  );
}

// ---------------- internals ----------------

type RowKind = "context" | "del" | "add" | "empty";

interface SplitRow {
  /** Rendered on the left column. */
  oldLine: { num: number | null; text: string; kind: RowKind };
  /** Rendered on the right column. */
  newLine: { num: number | null; text: string; kind: RowKind };
}

interface BuildResult {
  rows: SplitRow[];
  added: number;
  removed: number;
}

/**
 * Convert a (old, new) text pair into paired split rows. Walk the
 * line-level diff; for each block:
 *
 *   - unchanged context: emit one row per line, mirrored on both sides
 *   - removal block: emit on the left, empty placeholders on the right
 *   - addition block: emit on the right, empty placeholders on the left
 *   - replace (removal + addition): pair line-by-line up to the shorter
 *     of the two; pad the rest with empty placeholders
 *
 * Line numbering tracks both sides independently; placeholder rows get
 * `num: null` so we render a hatched empty cell.
 */
function buildRows(oldContent: string, newContent: string): BuildResult {
  const changes = diffLines(oldContent ?? "", newContent ?? "");
  const rows: SplitRow[] = [];
  let added = 0;
  let removed = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lines = stripTrailingEmpty(splitLines(c.value));

    if (!c.added && !c.removed) {
      // context
      for (const line of lines) {
        rows.push({
          oldLine: { num: oldLineNo++, text: line, kind: "context" },
          newLine: { num: newLineNo++, text: line, kind: "context" },
        });
      }
      continue;
    }

    if (c.removed) {
      // Try to pair with a following addition for replace-style display.
      const next = changes[i + 1];
      const nextLines =
        next && next.added ? stripTrailingEmpty(splitLines(next.value)) : [];

      const pairLen = Math.max(lines.length, nextLines.length);
      for (let j = 0; j < pairLen; j++) {
        const oldText = lines[j];
        const newText = nextLines[j];
        rows.push({
          oldLine:
            oldText === undefined
              ? { num: null, text: "", kind: "empty" }
              : { num: oldLineNo++, text: oldText, kind: "del" },
          newLine:
            newText === undefined
              ? { num: null, text: "", kind: "empty" }
              : { num: newLineNo++, text: newText, kind: "add" },
        });
      }
      removed += lines.length;
      added += nextLines.length;

      if (next && next.added) i++; // consumed
      continue;
    }

    // Pure addition (no preceding removal merged into this row).
    if (c.added) {
      for (const line of lines) {
        rows.push({
          oldLine: { num: null, text: "", kind: "empty" },
          newLine: { num: newLineNo++, text: line, kind: "add" },
        });
      }
      added += lines.length;
    }
  }

  return { rows, added, removed };
}

function splitLines(value: string): string[] {
  // diff.diffLines values typically end with a newline. Split and
  // discard the trailing empty fragment that creates.
  return value.split("\n");
}

function stripTrailingEmpty(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function DiffSide({ rows, side }: { rows: SplitRow[]; side: "old" | "new" }) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden",
        side === "new" && "border-l border-line",
      )}
    >
      {rows.map((r, i) => {
        const cell = side === "old" ? r.oldLine : r.newLine;
        return (
          <DiffLine key={i} num={cell.num} text={cell.text} kind={cell.kind} />
        );
      })}
    </div>
  );
}

function DiffLine({
  num,
  text,
  kind,
}: {
  num: number | null;
  text: string;
  kind: RowKind;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[20px]",
        kind === "add" && "bg-success/[var(--opacity-soft)] text-ink",
        kind === "del" && "bg-error/[var(--opacity-soft)] text-ink",
        kind === "empty" && [
          "[background-image:repeating-linear-gradient(135deg,transparent_0_6px,var(--color-hover)_6px_7px)]",
        ],
      )}
    >
      <span
        className={cn(
          "shrink-0 select-none border-r border-line px-2 py-0 text-right text-[11px]",
          kind === "empty"
            ? "bg-app text-transparent"
            : "bg-app text-ink-muted",
        )}
        style={{ width: 32 }}
      >
        {num ?? ""}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 select-text overflow-x-auto whitespace-pre px-2",
          kind === "context" && "text-ink-soft",
        )}
      >
        {text}
      </span>
    </div>
  );
}
