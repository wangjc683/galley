import * as Dialog from "@radix-ui/react-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Archive, PushPin, PushPinSlash } from "@phosphor-icons/react";
import { useMemo } from "react";

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
import { Button, IconButton } from "@/components/ui/button";
import { useSessionSelectMode } from "@/hooks/useSessionSelectMode";
import { useCopy, useLanguage } from "@/lib/i18n";
import { displaySessionSummary } from "@/lib/session-summary";
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
 * surfacing hundreds of rows there made it unusable. Shell / header /
 * select-bar chrome is shared with ArchivedDialog via
 * session-browser-ui so the two read as siblings (one is "old but
 * still active", the other "explicitly retired").
 *
 * Two rendering modes:
 *
 *   - Browse (search empty): rows are grouped by year-month with
 *     locale-formatted section headers ("2026年4月" / "April 2026") —
 *     mirrors ChatGPT-style sidebar grouping so the user has temporal
 *     structure to scan against.
 *   - Filtered (search non-empty): grouping collapses to a flat
 *     hit list ordered by date desc. Grouping with 3 hits across
 *     5 months reads as noise, not structure.
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
  const copy = useCopy();
  const language = useLanguage();
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

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(language, { year: "numeric", month: "long" }),
    [language],
  );
  const groups = useMemo(
    () => groupByMonth(filtered, monthFormatter),
    [filtered, monthFormatter],
  );

  const showGroups = !isFiltered;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={SESSION_BROWSER_CONTENT_CLASS}
        >
          <SessionBrowserHeader
            title={copy.projects.earlierTitle}
            total={sorted.length}
            shown={filtered.length}
            filtered={!showGroups}
            selectMode={selectMode}
            selectedCount={selected.size}
            totalSummary={
              sorted.length > 0
                ? copy.projects.earlierCount(sorted.length)
                : copy.projects.noEarlier
            }
            onEnterSelectMode={enterSelectMode}
            onCancelSelectMode={exitSelectMode}
          />

          <SessionSearchBar query={query} onChange={setQuery} />

          <div className="min-h-0 flex-1 overflow-y-auto bg-app">
            {filtered.length === 0 ? (
              <SessionBrowserEmpty
                filtered={!showGroups}
                emptyLabel={copy.projects.noEarlierEmpty}
              />
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
                  onArchiveSessionsBulk(selectedIds);
                  exitSelectMode();
                }}
                disabled={selected.size === 0}
                aria-label={copy.projects.archiveSelected}
                title={copy.projects.archiveSelected}
                leadingIcon={<Archive size={12} weight="thin" />}
              >
                {copy.projects.archiveSelected}
              </Button>
            </SessionBrowserSelectBar>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
          <div className="sticky top-0 z-10 border-b border-line bg-app px-5 py-1.5 text-ui-kbd font-semibold uppercase tracking-[0.08em] text-ink-muted">
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
        "group relative flex items-start gap-3 px-5 py-3",
        selectMode && isSelected
          ? "bg-selected hover:bg-selected"
          : "hover:bg-hover",
      )}
    >
      {selectMode ? (
        <SelectGlyph isSelected={isSelected} />
      ) : (
        <span className="pt-0.5">
          <StatusIcon status={session.status} size={14} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-compact font-medium text-ink">
          {session.title}
        </div>
        {session.summary && (
          <div className="mt-0.5 truncate text-ui-tertiary text-ink-muted">
            {displaySessionSummary(
              session.summary,
              copy.sidebar.turnProtocolFailure,
            )}
          </div>
        )}
      </div>

      {/* Right metadata column — tabular ledger rail (date · turns ·
          pinned). In browse mode it yields to the hover actions;
          in select mode it stays put. */}
      <span
        className={cn(
          "shrink-0 pt-0.5 text-right text-ui-micro tabular-nums tracking-[0.02em] text-ink-muted",
          !selectMode && "group-hover:opacity-0",
        )}
      >
        {formatSessionDate(session.lastActivityAt)}
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
        <div className="pointer-events-none absolute right-5 top-3 flex items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100">
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
            "galley-pop-in z-[60] min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated",
          )}
        >
          {/* rounded-callout (8px) = the menu surface's rounded-md (12px)
              minus its p-1 (4px) — concentric corners (polish-checklist P1). */}
          <ContextMenu.Item
            onSelect={onTogglePin}
            className={cn(
              "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-ui-secondary text-ink-soft outline-none",
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
              "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-ui-secondary text-ink-soft outline-none",
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

/**
 * Group rows (already sorted by date desc) into contiguous year-month
 * sections. Labels come from the locale-aware formatter so the header
 * language follows the app language ("2026年4月" / "April 2026").
 */
function groupByMonth(
  rows: Session[],
  formatter: Intl.DateTimeFormat,
): { label: string; sessions: Session[] }[] {
  const out: { label: string; sessions: Session[] }[] = [];
  let lastKey = "";
  for (const s of rows) {
    const d = new Date(s.lastActivityAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      out.push({ label: formatter.format(d), sessions: [] });
      lastKey = key;
    }
    out[out.length - 1]!.sessions.push(s);
  }
  return out;
}
