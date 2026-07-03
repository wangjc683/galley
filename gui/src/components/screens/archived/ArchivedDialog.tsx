import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUUpLeft,
  CheckSquare,
  Square,
  Trash,
  WarningCircle,
  X as XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { SessionSearchBar } from "@/components/screens/SessionSearchBar";
import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
 *     AlertDialog confirm. Lower stakes (one row), no checkbox.
 *
 *   - Bulk Delete (select mode → action bar): single-layer confirm
 *     showing the count. The user picked the rows explicitly, so
 *     no GitHub-style checkbox friction.
 *
 *   - Delete all (header ghost action): two-layer confirm. The entry
 *     stays visible but low-priority; clicking it opens an AlertDialog
 *     that REQUIRES checking an acknowledgement checkbox to enable the
 *     final destructive button. Mirrors the GitHub "delete repository"
 *     pattern for undifferentiated batch destruction.
 *
 * Restore is non-destructive — no confirm in any mode, just executes
 * and the row drops out of the archived list immediately.
 *
 * Select mode (Gmail-style): header `Select` button toggles in. In
 * select mode, rows show leading checkboxes, click toggles
 * selection (single-row inline Restore/Delete buttons hide), and a
 * sticky action bar with Restore / Delete actions appears at the
 * bottom. Same UX as EarlierDialog.
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
            className={cn(
              "fixed left-1/2 top-1/2 z-50 flex h-[520px] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col",
              "overflow-hidden rounded-lg border border-line bg-app shadow-elevated",
              "max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)]",
            )}
          >
            <Header
              total={archived.length}
              shown={filtered.length}
              filtered={isFiltered}
              selectMode={selectMode}
              selectedCount={selected.size}
              onEnterSelectMode={enterSelectMode}
              onCancelSelectMode={exitSelectMode}
              onClose={() => onOpenChange(false)}
              onEmptyAll={() => setEmptyConfirmOpen(true)}
            />

            <SessionSearchBar query={query} onChange={setQuery} />

            <div className="min-h-0 flex-1 overflow-y-auto bg-app">
              {filtered.length === 0 ? (
                <EmptyState filtered={isFiltered} />
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
              <SelectActionBar
                selectedCount={selected.size}
                allVisibleSelected={allVisibleSelected}
                onToggleSelectAllVisible={toggleSelectAllVisible}
                onRestore={() => {
                  if (selectedIds.length === 0) return;
                  onRestoreBulk(selectedIds);
                  exitSelectMode();
                }}
                onDelete={() => {
                  if (selectedIds.length === 0) return;
                  setBulkDeleteConfirmOpen(true);
                }}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Per-row single-confirm dialog. Stacks above ArchivedDialog
          while open so the user has full context of the row's title. */}
      <ConfirmDeleteOneDialog
        session={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
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
        }}
        busy={deletingOne}
      />

      {/* Bulk delete confirm — single-layer (count, no checkbox). */}
      <ConfirmDeleteManyDialog
        open={bulkDeleteConfirmOpen}
        count={selectedIds.length}
        onCancel={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={async () => {
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
        }}
        busy={bulkDeleting}
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

// ---------------- Header ----------------

function Header({
  total,
  shown,
  filtered,
  selectMode,
  selectedCount,
  onEnterSelectMode,
  onCancelSelectMode,
  onClose,
  onEmptyAll,
}: {
  total: number;
  shown: number;
  filtered: boolean;
  selectMode: boolean;
  selectedCount: number;
  onEnterSelectMode: () => void;
  onCancelSelectMode: () => void;
  onClose: () => void;
  onEmptyAll: () => void;
}) {
  const copy = useCopy();
  const summary = selectMode
    ? copy.projects.selected(selectedCount)
    : filtered
      ? shown === 0
        ? copy.projects.noMatches
        : copy.projects.hits(shown, total)
      : total > 0
        ? copy.projects.archivedCountLabel(total)
        : copy.projects.noArchived;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-app px-5 py-3.5">
      <Dialog.Title className="text-[16px] font-semibold text-ink">
        {copy.projects.archivedTitle}
      </Dialog.Title>
      <span className="text-[12.5px] tabular-nums tracking-[0.01em] text-ink-muted">
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
            {total > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEmptyAll}
                title={copy.projects.deleteAllArchived}
                className="px-1.5 font-normal text-ink-muted hover:bg-error/[var(--opacity-soft)] hover:text-error active:bg-error/[var(--opacity-medium)]"
              >
                {copy.projects.emptyArchive(total)}
              </Button>
            )}
          </>
        )}
        <Dialog.Close asChild onClick={onClose}>
          <IconButton ariaLabel={copy.common.close} tooltip={false}>
            <XIcon size={14} weight="thin" />
          </IconButton>
        </Dialog.Close>
      </div>
    </div>
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
          "flex cursor-pointer items-start gap-3 px-5 py-3 transition-colors",
          isSelected ? "bg-selected hover:bg-selected" : "hover:bg-hover",
        )}
      >
        <span className="pt-0.5 text-ink-soft">
          {isSelected ? (
            <CheckSquare
              size={14}
              weight="fill"
              className="text-brand-strong"
            />
          ) : (
            <Square size={14} weight="thin" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">
            {session.title}
          </div>
          {session.summary && (
            <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
              {session.summary}
            </div>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[10.5px] tabular-nums tracking-[0.02em] text-ink-muted">
          {formatDate(session.updatedAt)}
        </span>
      </li>
    );
  }

  return (
    <li className="group relative flex items-start gap-3 px-5 py-3 transition-colors hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">
          {session.title}
        </div>
        {session.summary && (
          <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
            {session.summary}
          </div>
        )}
      </div>

      {/* Archived date as a right-aligned tabular metadata column — a
          clean ledger rail down the list (Swiss: alignment is structure).
          Yields to the row actions on hover, the same
          swap the sidebar rows use. */}
      <span className="shrink-0 pt-0.5 text-[10.5px] tabular-nums tracking-[0.02em] text-ink-muted transition-opacity duration-100 group-hover:opacity-0">
        {formatDate(session.updatedAt)}
      </span>

      <div className="pointer-events-none absolute right-5 top-3 flex items-center gap-1 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100">
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

// ---------------- Select action bar ----------------

function SelectActionBar({
  selectedCount,
  allVisibleSelected,
  onToggleSelectAllVisible,
  onRestore,
  onDelete,
}: {
  selectedCount: number;
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const copy = useCopy();
  const disabled = selectedCount === 0;
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
      <span className="text-[12px] tabular-nums tracking-[0.01em] text-ink-muted">
        {copy.projects.selected(selectedCount)}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRestore}
          disabled={disabled}
          aria-label={copy.projects.restoreSelectedAction(selectedCount)}
          title={copy.projects.restoreSelectedAction(selectedCount)}
          leadingIcon={<ArrowUUpLeft size={12} weight="thin" />}
        >
          {copy.common.restore}
        </Button>
        <Button
          variant="destructive-soft"
          size="sm"
          onClick={onDelete}
          disabled={disabled}
          aria-label={copy.projects.deleteSelectedAction(selectedCount)}
          title={copy.projects.deleteSelectedAction(selectedCount)}
          leadingIcon={<Trash size={12} weight="thin" />}
        >
          {copy.common.deletePermanently}
        </Button>
      </div>
    </div>
  );
}

// ---------------- Empty ----------------

function EmptyState({ filtered }: { filtered: boolean }) {
  const copy = useCopy();
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[13.5px] italic text-ink-muted">
        {filtered
          ? copy.projects.noMatchingConversations
          : copy.projects.noArchivedConversations}
      </p>
    </div>
  );
}

// ---------------- Confirm dialogs ----------------

/**
 * Single-layer confirm for per-row delete. Standard
 * destructive-action pattern: cancel button on the left (escape
 * also dismisses via Radix), destructive button on the right.
 */
function ConfirmDeleteOneDialog({
  session,
  onCancel,
  onConfirm,
  busy,
}: {
  session: Session | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
}) {
  const copy = useCopy();
  return (
    <Dialog.Root
      open={!!session}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          // role="alertdialog" instructs assistive tech to interrupt
          // and require explicit dismissal — appropriate for a
          // destructive confirmation.
          role="alertdialog"
          aria-describedby="confirm-delete-one-desc"
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold text-ink">
            {copy.projects.permanentlyDeleteConversation}
          </Dialog.Title>
          <p
            id="confirm-delete-one-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.projects.permanentlyDeleteConversationBody(
              session?.title ?? "",
            )}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </p>

          <DialogActionRow>
            <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
              {copy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void onConfirm();
              }}
            >
              {copy.common.deletePermanently}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Single-layer confirm for "Delete N selected". Mirrors the per-row
 * confirm — the user already deliberated by checking the rows, so
 * the empty-all checkbox-acknowledge friction would be redundant.
 */
function ConfirmDeleteManyDialog({
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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="confirm-delete-many-desc"
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[440px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold text-ink">
            {copy.projects.permanentlyDeleteSelectedTitle(count)}
          </Dialog.Title>
          <p
            id="confirm-delete-many-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.projects.permanentlyDeleteSelectedBody}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </p>

          <DialogActionRow>
            <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
              {copy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void onConfirm();
              }}
            >
              {copy.projects.permanentlyDeleteCount(count)}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Two-layer confirm for "Delete all". The user must check the
 * "我了解此操作无法撤销" checkbox before the destructive button
 * becomes enabled. Mirrors GitHub's "delete repository" friction
 * for batch destructive operations.
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
            "fixed left-1/2 top-1/2 z-[60] w-[460px] -translate-x-1/2 -translate-y-1/2",
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
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.projects.emptyAllBody(count)}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </p>

          <Checkbox
            checked={acknowledged}
            onCheckedChange={setAcknowledged}
            className="mt-4 flex cursor-pointer select-none items-start gap-2 rounded-sm border border-line bg-app px-3 py-2.5 text-[12.5px] text-ink transition-colors hover:border-line-strong"
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

// ---------------- helpers ----------------

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  } catch {
    return iso;
  }
}
