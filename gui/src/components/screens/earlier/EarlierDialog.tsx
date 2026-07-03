import * as Dialog from "@radix-ui/react-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Archive,
  CheckSquare,
  PushPin,
  PushPinSlash,
  Square,
  X as XIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { SessionSearchBar } from "@/components/screens/SessionSearchBar";
import { Button, IconButton } from "@/components/ui/button";
import { useSessionSelectMode } from "@/hooks/useSessionSelectMode";
import { useCopy } from "@/lib/i18n";
import { StatusIcon } from "@/lib/status-icon";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

export interface EarlierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sessions in the `earlier` bucket — caller groups; we just
   * render whatever it passes, sorted by lastActivityAt desc. */
  sessions: Session[];
  /** Open a session (same handler as Sidebar row click). The dialog
   * closes itself afterwards. */
  onSelectSession: (id: string) => void;
  /** Right-click → Archive, mirroring the Sidebar context menu so
   * the user can prune as they browse old sessions. */
  onArchiveSession: (id: string) => void;
  /** Right-click → Pin / Unpin. Pinning here lifts a session out
   * of the earlier bucket and back into the Sidebar's Pinned bucket. */
  onTogglePinSession: (id: string) => void;
  /** Bulk archive — drains the user's checkbox selection into a
   * single store action so 50 rows don't trigger 50 re-renders.
   * Pin doesn't have a bulk counterpart here: the dialog's reason
   * for existing is cleanup, so the action bar stays focused on
   * Archive. The rare "I want to promote this old session back to
   * Pinned" workflow is still served by the per-row right-click
   * menu's Pin item. */
  onArchiveSessionsBulk: (ids: string[]) => void;
}

/**
 * Browser for the `earlier` bucket (sessions older than 7 days).
 *
 * Replaces the sidebar's old infinite "Earlier" list once that bucket
 * grows past a handful of rows — the sidebar is for current work, and
 * surfacing hundreds of rows there made it unusable. Visual style
 * follows ArchivedDialog so the two read as siblings (one is "old but
 * still active", the other "explicitly retired").
 *
 * Two rendering modes:
 *
 *   - Browse (search empty): rows are grouped by year-month with
 *     section headers ("April 2026") — mirrors ChatGPT-style sidebar
 *     grouping so the user has temporal structure to scan against.
 *   - Filtered (search non-empty): grouping collapses to a flat
 *     hit list ordered by date desc. Grouping with 3 hits across
 *     5 months reads as noise, not structure.
 *
 * Select mode (Gmail-style):
 *   - User clicks header "Select" → rows show leading checkboxes,
 *     row click toggles selection instead of opening, context menu
 *     suppressed, sticky action bar appears at bottom with Pin /
 *     Archive / 全选 actions. Cancel or dialog close exits the mode.
 *   - Selection is by session ID, so filtering/clearing the search
 *     while in select mode doesn't lose what you've already picked.
 *
 * Differences from ArchivedDialog:
 *   - Click row → open session (not Restore). These rows aren't
 *     archived, they're just stale.
 *   - No Delete / Empty-all destructive actions. Pruning happens via
 *     Archive (right-click or bulk action bar) — soft removal.
 */
export function EarlierDialog({
  open,
  onOpenChange,
  sessions,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onArchiveSessionsBulk,
}: EarlierDialogProps) {
  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt),
      ),
    [sessions],
  );

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
  } = useSessionSelectMode(open, sorted);

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);

  const showGroups = !isFiltered;

  return (
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
            total={sorted.length}
            shown={filtered.length}
            filtered={!showGroups}
            selectMode={selectMode}
            selectedCount={selected.size}
            onEnterSelectMode={enterSelectMode}
            onCancelSelectMode={exitSelectMode}
            onClose={() => onOpenChange(false)}
          />

          <SessionSearchBar query={query} onChange={setQuery} />

          <div className="min-h-0 flex-1 overflow-y-auto bg-app">
            {filtered.length === 0 ? (
              <EmptyState filtered={!showGroups} />
            ) : showGroups ? (
              <GroupedList
                groups={groups}
                selectMode={selectMode}
                selected={selected}
                onSelectSession={(id) => {
                  onSelectSession(id);
                  onOpenChange(false);
                }}
                onToggleSelect={toggleSelect}
                onArchiveSession={onArchiveSession}
                onTogglePinSession={onTogglePinSession}
              />
            ) : (
              <FlatList
                rows={filtered}
                selectMode={selectMode}
                selected={selected}
                onSelectSession={(id) => {
                  onSelectSession(id);
                  onOpenChange(false);
                }}
                onToggleSelect={toggleSelect}
                onArchiveSession={onArchiveSession}
                onTogglePinSession={onTogglePinSession}
              />
            )}
          </div>

          {selectMode && (
            <SelectActionBar
              selectedCount={selected.size}
              allVisibleSelected={allVisibleSelected}
              onToggleSelectAllVisible={toggleSelectAllVisible}
              onArchive={() => {
                if (selectedIds.length === 0) return;
                onArchiveSessionsBulk(selectedIds);
                exitSelectMode();
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Header({
  total,
  shown,
  filtered,
  selectMode,
  selectedCount,
  onEnterSelectMode,
  onCancelSelectMode,
  onClose,
}: {
  total: number;
  shown: number;
  filtered: boolean;
  selectMode: boolean;
  selectedCount: number;
  onEnterSelectMode: () => void;
  onCancelSelectMode: () => void;
  onClose: () => void;
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
      : total > 0
        ? copy.projects.earlierCount(total)
        : copy.projects.noEarlier;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-app px-5 py-3.5">
      <Dialog.Title className="text-[16px] font-semibold text-ink">
        {copy.projects.earlierTitle}
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
          total > 0 && (
            <Button variant="secondary" size="sm" onClick={onEnterSelectMode}>
              {copy.projects.select}
            </Button>
          )
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


function GroupedList({
  groups,
  selectMode,
  selected,
  onSelectSession,
  onToggleSelect,
  onArchiveSession,
  onTogglePinSession,
}: {
  groups: { label: string; sessions: Session[] }[];
  selectMode: boolean;
  selected: Set<string>;
  onSelectSession: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
}) {
  return (
    <div>
      {groups.map((g) => (
        <section key={g.label}>
          <div className="sticky top-0 z-10 border-b border-line bg-app px-5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {g.label}
            <span className="ml-1.5 tabular-nums text-ink-soft normal-case tracking-normal">
              · {g.sessions.length}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {g.sessions.map((s) => (
              <EarlierRow
                key={s.id}
                session={s}
                selectMode={selectMode}
                isSelected={selected.has(s.id)}
                onSelect={() => onSelectSession(s.id)}
                onToggleSelect={() => onToggleSelect(s.id)}
                onArchive={() => onArchiveSession(s.id)}
                onTogglePin={() => onTogglePinSession(s.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FlatList({
  rows,
  selectMode,
  selected,
  onSelectSession,
  onToggleSelect,
  onArchiveSession,
  onTogglePinSession,
}: {
  rows: Session[];
  selectMode: boolean;
  selected: Set<string>;
  onSelectSession: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onTogglePinSession: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <EarlierRow
          key={s.id}
          session={s}
          selectMode={selectMode}
          isSelected={selected.has(s.id)}
          onSelect={() => onSelectSession(s.id)}
          onToggleSelect={() => onToggleSelect(s.id)}
          onArchive={() => onArchiveSession(s.id)}
          onTogglePin={() => onTogglePinSession(s.id)}
        />
      ))}
    </ul>
  );
}

function EarlierRow({
  session,
  selectMode,
  isSelected,
  onSelect,
  onToggleSelect,
  onArchive,
  onTogglePin,
}: {
  session: Session;
  selectMode: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleSelect: () => void;
  onArchive: () => void;
  onTogglePin: () => void;
}) {
  const copy = useCopy();
  const handleClick = selectMode ? onToggleSelect : onSelect;

  const row = (
    <li
      data-galley-context-menu-trigger={!selectMode ? "" : undefined}
      onClick={handleClick}
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 px-5 py-3 transition-colors",
        selectMode && isSelected
          ? "bg-selected hover:bg-selected"
          : "hover:bg-hover",
      )}
    >
      {selectMode ? (
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
      ) : (
        <span className="pt-0.5">
          <StatusIcon status={session.status} size={14} />
        </span>
      )}
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

      {/* Right metadata column — tabular ledger rail (date · turns ·
          pinned). In browse mode it yields to the hover actions;
          in select mode it stays put. */}
      <span
        className={cn(
          "shrink-0 pt-0.5 text-right text-[10.5px] tabular-nums tracking-[0.02em] text-ink-muted",
          !selectMode &&
            "transition-opacity duration-100 group-hover:opacity-0",
        )}
      >
        {formatDate(session.lastActivityAt)}
        {session.turnCount !== undefined && session.turnCount > 0 && (
          <> · {copy.projects.turns(session.turnCount)}</>
        )}
        {session.pinned && (
          <span className="ml-1.5 text-brand-strong">
            · {copy.projects.pinned}
          </span>
        )}
      </span>

      {!selectMode && (
        <div className="pointer-events-none absolute right-5 top-3 flex items-center gap-1 opacity-0 transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={session.pinned ? copy.sidebar.unpin : copy.sidebar.pin}
            ariaLabel={session.pinned ? copy.sidebar.unpin : copy.sidebar.pin}
            className="hover:bg-elevated"
          >
            {session.pinned ? (
              <PushPinSlash size={14} weight="thin" />
            ) : (
              <PushPin size={14} weight="thin" />
            )}
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            title={copy.sidebar.archive}
            ariaLabel={copy.sidebar.archive}
            className="hover:bg-elevated"
          >
            <Archive size={14} weight="thin" />
          </IconButton>
        </div>
      )}
    </li>
  );

  // Context menu disabled in select mode — right-click in select
  // mode would conflict with the bulk-action mental model, and the
  // sticky action bar already covers Pin / Archive for the chosen
  // set.
  if (selectMode) return row;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            "z-[60] min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated",
          )}
        >
          <ContextMenu.Item
            onSelect={onTogglePin}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none transition-colors",
              "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
            )}
          >
            {session.pinned ? (
              <>
                <PushPinSlash size={13} weight="thin" />
                {copy.sidebar.unpin}
              </>
            ) : (
              <>
                <PushPin size={13} weight="thin" />
                {copy.sidebar.pin}
              </>
            )}
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={onArchive}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none transition-colors",
              "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
            )}
          >
            <Archive size={13} weight="thin" />
            {copy.sidebar.archive}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SelectActionBar({
  selectedCount,
  allVisibleSelected,
  onToggleSelectAllVisible,
  onArchive,
}: {
  selectedCount: number;
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
  onArchive: () => void;
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
          onClick={onArchive}
          disabled={disabled}
          aria-label={copy.projects.archiveSelected}
          title={copy.projects.archiveSelected}
          leadingIcon={<Archive size={12} weight="thin" />}
        >
          {copy.projects.archiveSelected}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  const copy = useCopy();
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[13.5px] italic text-ink-muted">
        {filtered
          ? copy.projects.noMatchingConversations
          : copy.projects.noEarlierEmpty}
      </p>
    </div>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function groupByMonth(
  rows: Session[],
): { label: string; sessions: Session[] }[] {
  const out: { label: string; sessions: Session[] }[] = [];
  let lastKey = "";
  for (const s of rows) {
    const d = new Date(s.lastActivityAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      out.push({
        label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        sessions: [],
      });
      lastKey = key;
    }
    out[out.length - 1]!.sessions.push(s);
  }
  return out;
}

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
