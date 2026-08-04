import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUUpLeft, Trash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { SessionSearchBar } from "@/components/screens/SessionSearchBar";
import {
  SESSION_BROWSER_CONTENT_CLASS,
  formatSessionDate,
} from "@/components/screens/session-browser";
import {
  SelectGlyph,
  SessionBrowserEmpty,
  SessionBrowserHeader,
  SessionBrowserSelectBar,
} from "@/components/screens/session-browser-ui";
import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useSessionSelectMode } from "@/hooks/useSessionSelectMode";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

export interface ArchivedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All sessions (any status); the dialog filters to archived ones
   * internally so the parent doesn't have to derive a separate list. */
  sessions: Session[];
  onRestore: (id: string) => void;
  /** Permanent delete with no confirm flow at this level — caller is
   * the dialog that already showed a confirm. */
  onDeletePermanently: (id: string) => Promise<void>;
  /** Permanently delete all archived sessions. The dialog shows a
   * second confirm prompt (checkbox + destructive button) before
   * calling this. */
  onEmptyAll: () => Promise<number>;
  /** Bulk restore — drains the user's checkbox selection into a
   * single store action. No confirm: restore is non-destructive. */
  onRestoreBulk: (ids: string[]) => void;
  /** Bulk permanent delete. The dialog shows a single-layer confirm
   * (count + cancel/confirm); the user already deliberated by
   * picking the rows, so the checkbox-acknowledge friction is
   * reserved for "empty all" where the destruction is undifferentiated. */
  onDeletePermanentlyBulk: (ids: string[]) => Promise<void>;
}

/**
 * Archived sessions browser. Three destructive operations live here:
 *
 *   - Single Delete (per row, right-side icon button): single-layer
 *     confirm (shared ConfirmActionDialog). Lower stakes (one row),
 *     no checkbox.
 *
 *   - Bulk Delete (select mode → action bar): single-layer confirm
 *     showing the count. The user picked the rows explicitly, so
 *     no GitHub-style checkbox friction.
 *
 *   - Delete all (header ghost action): two-layer confirm. The entry
 *     stays visible but low-priority; clicking it opens an AlertDialog
 *     that REQUIRES checking an acknowledgement checkbox to enable the
 *     final destructive button. Mirrors the GitHub "delete repository"
 *     pattern for undifferentiated batch destruction — this one stays
 *     a bespoke dialog because the checkbox gate IS its design.
 *
 * Restore is non-destructive — no confirm in any mode, just executes
 * and the row drops out of the archived list immediately.
 *
 * Select mode (Gmail-style): shared chrome with EarlierDialog via
 * session-browser-ui; this dialog contributes Restore / Delete bulk
 * actions.
 */
export function ArchivedDialog({
  open,
  onOpenChange,
  sessions,
  onRestore,
  onDeletePermanently,
  onEmptyAll,
  onRestoreBulk,
  onDeletePermanentlyBulk,
}: ArchivedDialogProps) {
  const copy = useCopy();
  const archived = useMemo(
    () =>
      [...sessions]
        .filter((s) => s.status === "archived")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions],
  );

  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [deletingOne, setDeletingOne] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [emptying, setEmptying] = useState(false);

  const {
    query,
    setQuery,
    filtered,
    isFiltered,
    selectMode,
    selected,
    selectedIds,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    allVisibleSelected,
    toggleSelectAllVisible,
  } = useSessionSelectMode(open, archived);

  // Dialog-specific open reset (shared resets live in the hook).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setBulkDeleteConfirmOpen(false), 0);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Dialog.Content
            aria-describedby={undefined}
            className={SESSION_BROWSER_CONTENT_CLASS}
          >
            <SessionBrowserHeader
              title={copy.projects.archivedTitle}
              total={archived.length}
              shown={filtered.length}
              filtered={isFiltered}
              selectMode={selectMode}
              selectedCount={selected.size}
              totalSummary={
                archived.length > 0
                  ? copy.projects.archivedCountLabel(archived.length)
                  : copy.projects.noArchived
              }
              actions={
                archived.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEmptyConfirmOpen(true)}
                    title={copy.projects.deleteAllArchived}
                    // tabular-nums: the count updates live as rows are
                    // deleted / restored while the dialog stays open.
                    className="px-1.5 font-normal tabular-nums text-ink-muted hover:bg-error/[var(--opacity-soft)] hover:text-error active:bg-error/[var(--opacity-medium)]"
                  >
                    {copy.projects.emptyArchive(archived.length)}
                  </Button>
                ) : undefined
              }
              onEnterSelectMode={enterSelectMode}
              onCancelSelectMode={exitSelectMode}
              onClose={() => onOpenChange(false)}
            />

            <SessionSearchBar query={query} onChange={setQuery} />

            <div className="min-h-0 flex-1 overflow-y-auto bg-app">
              {filtered.length === 0 ? (
                <SessionBrowserEmpty
                  filtered={isFiltered}
                  emptyLabel={copy.projects.noArchivedConversations}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {filtered.map((s) => (
                    <ArchivedRow
                      key={s.id}
                      session={s}
                      selectMode={selectMode}
                      isSelected={selected.has(s.id)}
                      onToggleSelect={() => toggleSelect(s.id)}
                      onRestore={() => onRestore(s.id)}
                      onDelete={() => setPendingDelete(s)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {selectMode && (
              <SessionBrowserSelectBar
                selectedCount={selected.size}
                allVisibleSelected={allVisibleSelected}
                onToggleSelectAllVisible={toggleSelectAllVisible}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (selectedIds.length === 0) return;
                    onRestoreBulk(selectedIds);
                    exitSelectMode();
                  }}
                  disabled={selected.size === 0}
                  aria-label={copy.projects.restoreSelectedAction(selected.size)}
                  title={copy.projects.restoreSelectedAction(selected.size)}
                  leadingIcon={<ArrowUUpLeft size={12} weight="thin" />}
                >
                  {copy.common.restore}
                </Button>
                <Button
                  variant="destructive-soft"
                  size="sm"
                  onClick={() => {
                    if (selectedIds.length === 0) return;
                    setBulkDeleteConfirmOpen(true);
                  }}
                  disabled={selected.size === 0}
                  aria-label={copy.projects.deleteSelectedAction(selected.size)}
                  title={copy.projects.deleteSelectedAction(selected.size)}
                  leadingIcon={<Trash size={12} weight="thin" />}
                >
                  {copy.common.deletePermanently}
                </Button>
              </SessionBrowserSelectBar>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Per-row single-confirm dialog. Stacks above ArchivedDialog
          while open so the user has full context of the row's title.
          Confirm awaits the delete before closing — failures keep the
          dialog up (store surfaces the toast). */}
      <ConfirmActionDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        busy={deletingOne}
        icon={null}
        title={copy.projects.permanentlyDeleteConversation}
        body={
          <>
            {copy.projects.permanentlyDeleteConversationBody(
              pendingDelete?.title ?? "",
            )}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </>
        }
        confirmLabel={copy.common.deletePermanently}
        confirmVariant="destructive"
        onConfirm={() => {
          void (async () => {
            if (!pendingDelete) return;
            setDeletingOne(true);
            try {
              await onDeletePermanently(pendingDelete.id);
              setPendingDelete(null);
            } catch {
              // Store surfaces the failure toast and keeps the row in place.
            } finally {
              setDeletingOne(false);
            }
          })();
        }}
      />

      {/* Bulk delete confirm — single-layer (count, no checkbox). */}
      <ConfirmActionDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(o) => {
          if (!o) setBulkDeleteConfirmOpen(false);
        }}
        busy={bulkDeleting}
        icon={null}
        title={copy.projects.permanentlyDeleteSelectedTitle(selectedIds.length)}
        body={
          <>
            {copy.projects.permanentlyDeleteSelectedBody}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </>
        }
        confirmLabel={copy.projects.permanentlyDeleteCount(selectedIds.length)}
        confirmVariant="destructive"
        onConfirm={() => {
          void (async () => {
            setBulkDeleting(true);
            try {
              await onDeletePermanentlyBulk(selectedIds);
              setBulkDeleteConfirmOpen(false);
              exitSelectMode();
            } catch {
              // Store surfaces the failure toast and keeps the selection.
            } finally {
              setBulkDeleting(false);
            }
          })();
        }}
      />

      {/* Empty-all double-confirm dialog. */}
      <ConfirmEmptyAllDialog
        open={emptyConfirmOpen}
        count={archived.length}
        onCancel={() => setEmptyConfirmOpen(false)}
        onConfirm={async () => {
          setEmptying(true);
          try {
            await onEmptyAll();
            setEmptyConfirmOpen(false);
          } catch {
            // Store surfaces the failure toast and keeps the archive intact.
          } finally {
            setEmptying(false);
          }
        }}
        busy={emptying}
      />
    </>
  );
}

// ---------------- Row ----------------

function ArchivedRow({
  session,
  selectMode,
  isSelected,
  onToggleSelect,
  onRestore,
  onDelete,
}: {
  session: Session;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const copy = useCopy();
  if (selectMode) {
    return (
      <li
        onClick={onToggleSelect}
        className={cn(
          "flex items-start gap-3 px-5 py-3",
          isSelected ? "bg-selected hover:bg-selected" : "hover:bg-hover",
        )}
      >
        <SelectGlyph isSelected={isSelected} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-compact font-medium text-ink">
            {session.title}
          </div>
          {session.summary && (
            <div className="mt-0.5 truncate text-ui-tertiary text-ink-muted">
              {session.summary}
            </div>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-ui-micro tabular-nums tracking-[0.02em] text-ink-muted">
          {formatSessionDate(session.updatedAt)}
        </span>
      </li>
    );
  }

  return (
    <li className="group relative flex items-start gap-3 px-5 py-3 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-compact font-medium text-ink">
          {session.title}
        </div>
        {session.summary && (
          <div className="mt-0.5 truncate text-ui-tertiary text-ink-muted">
            {session.summary}
          </div>
        )}
      </div>

      {/* Archived date as a right-aligned tabular metadata column — a
          clean ledger rail down the list (Swiss: alignment is structure).
          Yields to the row actions on hover, the same
          swap the sidebar rows use. */}
      <span className="shrink-0 pt-0.5 text-ui-micro tabular-nums tracking-[0.02em] text-ink-muted group-hover:opacity-0">
        {formatSessionDate(session.updatedAt)}
      </span>

      <div className="pointer-events-none absolute right-5 top-3 flex items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100">
        <IconButton
          onClick={onRestore}
          title={copy.common.restore}
          ariaLabel={copy.common.restore}
          className="hover:bg-elevated"
        >
          <ArrowUUpLeft size={14} weight="thin" />
        </IconButton>
        <IconButton
          onClick={onDelete}
          title={copy.common.deletePermanently}
          ariaLabel={copy.common.deletePermanently}
          variant="danger"
        >
          <Trash size={14} weight="thin" />
        </IconButton>
      </div>
    </li>
  );
}

// ---------------- Empty-all confirm ----------------

/**
 * Two-layer confirm for "Delete all". The user must check the
 * "我了解此操作无法撤销" checkbox before the destructive button
 * becomes enabled. Mirrors GitHub's "delete repository" friction
 * for batch destructive operations — deliberately NOT the shared
 * ConfirmActionDialog: the checkbox gate is this dialog's design.
 *
 * Resets the checkbox whenever the dialog opens so a previous
 * acknowledged state doesn't carry over.
 */
function ConfirmEmptyAllDialog({
  open,
  count,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
}) {
  const copy = useCopy();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setAcknowledged(false);
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="confirm-empty-all-desc"
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[460px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-error" />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {copy.projects.emptyAllTitle}
            </Dialog.Title>
          </div>
          <p
            id="confirm-empty-all-desc"
            className="mt-2 text-ui-secondary leading-secondary text-ink-soft"
          >
            {copy.projects.emptyAllBody(count)}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </p>

          <Checkbox
            checked={acknowledged}
            onCheckedChange={setAcknowledged}
            className="mt-4 flex select-none items-start gap-2 rounded-sm border border-line bg-app px-3 py-2.5 text-ui-secondary text-ink hover:border-line-strong"
          >
            <span>{copy.projects.acknowledgeCannotUndo}</span>
          </Checkbox>

          <DialogActionRow>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAcknowledged(false);
                onCancel();
              }}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!acknowledged || busy}
              onClick={() => {
                void onConfirm().then(() => setAcknowledged(false));
              }}
            >
              {copy.projects.emptyAllAction(count)}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
