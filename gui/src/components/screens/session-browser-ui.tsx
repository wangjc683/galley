import * as Dialog from "@radix-ui/react-dialog";
import { CheckSquare, Square } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { useCopy } from "@/lib/i18n";

/**
 * Shared chrome for the session-history browser dialogs (EarlierDialog /
 * ArchivedDialog). The two are deliberate siblings — one browses "old
 * but still active", the other "explicitly retired" — so their shell,
 * header grammar, select-mode action bar, and empty state come from one
 * place; each dialog contributes only its own rows and actions.
 * Non-component shares (shell class, date formatting) live in
 * session-browser.ts.
 */

export function SessionBrowserHeader({
  title,
  total,
  shown,
  filtered,
  selectMode,
  selectedCount,
  totalSummary,
  actions,
  onEnterSelectMode,
  onCancelSelectMode,
}: {
  title: string;
  total: number;
  shown: number;
  filtered: boolean;
  selectMode: boolean;
  selectedCount: number;
  /** Summary label for the unfiltered browse state (caller supplies
   * its bucket-specific copy, e.g. "共 N 个" / "没有归档"). */
  totalSummary: string;
  /** Extra non-select-mode header actions (e.g. the empty-archive
   * ghost button), rendered after Select. */
  actions?: ReactNode;
  onEnterSelectMode: () => void;
  onCancelSelectMode: () => void;
}) {
  const copy = useCopy();
  // Right-side summary mirrors filter + select state so the user can
  // see at a glance whether they're viewing all, a subset, or
  // operating on a selection.
  const summary = selectMode
    ? copy.projects.selected(selectedCount)
    : filtered
      ? shown === 0
        ? copy.projects.noMatches
        : copy.projects.hits(shown, total)
      : totalSummary;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-app px-5 py-3.5">
      <Dialog.Title className="text-[16px] font-semibold text-ink">
        {title}
      </Dialog.Title>
      <span className="text-ui-secondary tabular-nums tracking-[0.01em] text-ink-muted">
        {summary}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {selectMode ? (
          <Button variant="secondary" size="sm" onClick={onCancelSelectMode}>
            {copy.common.cancel}
          </Button>
        ) : (
          <>
            {total > 0 && (
              <Button variant="secondary" size="sm" onClick={onEnterSelectMode}>
                {copy.projects.select}
              </Button>
            )}
            {actions}
          </>
        )}
        <DialogCloseButton />
      </div>
    </div>
  );
}

/**
 * Sticky bottom bar for select mode: select-all toggle + count on the
 * left, the dialog's bulk actions (children) on the right.
 */
export function SessionBrowserSelectBar({
  selectedCount,
  allVisibleSelected,
  onToggleSelectAllVisible,
  children,
}: {
  selectedCount: number;
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
  children: ReactNode;
}) {
  const copy = useCopy();
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line bg-app px-4 py-2.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSelectAllVisible}
        leadingIcon={
          allVisibleSelected ? (
            <CheckSquare
              size={13}
              weight="fill"
              className="text-brand-strong"
            />
          ) : (
            <Square size={13} weight="thin" />
          )
        }
      >
        {allVisibleSelected
          ? copy.projects.clearSelection
          : copy.projects.selectAll}
      </Button>
      <span className="text-ui-meta tabular-nums tracking-[0.01em] text-ink-muted">
        {copy.projects.selected(selectedCount)}
      </span>

      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function SessionBrowserEmpty({
  filtered,
  emptyLabel,
}: {
  filtered: boolean;
  emptyLabel: string;
}) {
  const copy = useCopy();
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-ui-compact italic text-ink-muted">
        {filtered ? copy.projects.noMatchingConversations : emptyLabel}
      </p>
    </div>
  );
}

/** Leading select-mode checkbox glyph shared by both dialogs' rows. */
export function SelectGlyph({ isSelected }: { isSelected: boolean }) {
  return (
    <span className="pt-0.5 text-ink-soft">
      {isSelected ? (
        <CheckSquare size={14} weight="fill" className="text-brand-strong" />
      ) : (
        <Square size={14} weight="thin" />
      )}
    </span>
  );
}
