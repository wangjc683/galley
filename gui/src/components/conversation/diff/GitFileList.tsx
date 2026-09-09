import { useRef } from "react";

import { useCopy } from "@/lib/i18n";
import type { GitReviewFile } from "@/lib/git-review";
import { cn } from "@/lib/utils";

/**
 * Galley's own changed-file picker (the first increment used a native
 * <select>, which the design rules reserve against: it cannot carry a
 * status chip, a mono path, or the panel's selected-row register).
 * Two groups under eyebrow headers, one row per file: status chip +
 * relative path, current row on `bg-selected`. Arrow keys move the
 * selection like a listbox; the list scrolls inside a bounded height
 * so a long change set never pushes the diff off screen.
 */
export function GitFileList({
  tracked,
  untracked,
  selectedPath,
  onSelect,
}: {
  tracked: GitReviewFile[];
  untracked: GitReviewFile[];
  selectedPath: string | null;
  onSelect: (file: GitReviewFile) => void;
}) {
  const copy = useCopy().gitReview;
  const list = useRef<HTMLDivElement>(null);
  const groups = [
    { key: "tracked", label: copy.tracked, files: tracked, hint: undefined },
    {
      key: "untracked",
      label: copy.untracked,
      files: untracked,
      hint: copy.untrackedHint,
    },
  ].filter((group) => group.files.length > 0);
  const ordered = groups.flatMap((group) => group.files);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (ordered.length === 0) return;
    event.preventDefault();
    const index = ordered.findIndex((file) => file.path === selectedPath);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index < 0
        ? delta > 0
          ? 0
          : ordered.length - 1
        : (index + delta + ordered.length) % ordered.length;
    const file = ordered[next];
    onSelect(file);
    list.current
      ?.querySelector<HTMLElement>(`[data-git-file="${CSS.escape(file.path)}"]`)
      ?.focus({ preventScroll: false });
  };

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={copy.selectFile}
      onKeyDown={onKeyDown}
      className="max-h-[38vh] min-h-0 overflow-y-auto border-b border-line py-1"
    >
      {groups.map((group) => (
        <div key={group.key}>
          <div
            title={group.hint}
            className="flex items-center gap-1.5 px-4 pb-1 pt-2 text-ui-label font-semibold uppercase tracking-[0.08em] text-ink-muted"
          >
            <span className="min-w-0 truncate">{group.label}</span>
            <span className="tabular-nums tracking-normal">
              {group.files.length}
            </span>
          </div>
          {group.files.map((file) => {
            const selected = file.path === selectedPath;
            return (
              <button
                key={file.path}
                type="button"
                role="option"
                aria-selected={selected}
                data-git-file={file.path}
                title={file.path}
                onClick={() => onSelect(file)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-1 text-left outline-none",
                  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30",
                  selected ? "bg-selected text-ink" : "text-ink-soft hover:bg-hover hover:text-ink",
                )}
              >
                <StatusChip status={file.status} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {file.path}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Status as a small chip in the row's own register: additions lean
 * success, deletions lean error, everything else stays neutral ink.
 * Same "one grey chip grammar" as the model rows — colour only where
 * it carries meaning. */
function StatusChip({ status }: { status: GitReviewFile["status"] }) {
  const copy = useCopy().gitReview;
  const tone =
    status === "added" || status === "untracked"
      ? "border-success/20 bg-success/[var(--opacity-subtle)] text-success"
      : status === "deleted"
        ? "border-error/20 bg-error/[var(--opacity-subtle)] text-error"
        : status === "conflicted"
          ? "border-warning/30 bg-warning/[var(--opacity-subtle)] text-warning"
          : "border-line bg-ink-muted/10 text-ink-muted";
  return (
    <span
      className={cn(
        "inline-flex min-w-[3.5em] shrink-0 items-center justify-center whitespace-nowrap rounded-sm border px-1 py-px text-ui-micro leading-4",
        tone,
      )}
    >
      {copy.status[status]}
    </span>
  );
}
