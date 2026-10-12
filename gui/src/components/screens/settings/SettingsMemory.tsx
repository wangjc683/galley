import { CircleNotch } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { useMemoryAskTrial } from "@/components/conversation/memory-ask-trial";
import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { SettingsDisclosureCard } from "@/components/screens/settings/settings-disclosure";
import { SettingsTag } from "@/components/screens/settings/settings-badges";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Switch } from "@/components/ui/switch";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  memoryErrorId,
  memoryErrorText,
  type LedgerEntry,
  type LedgerTarget,
  type MemoryOverview,
} from "@/lib/memory";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

import { ErrorLine } from "./models/ModelPrimitives";
import { GlobalMemoryEditor } from "./memory/GlobalMemoryEditor";
import { coreMemoryActions, type MemoryActions } from "./memory/memory-actions";
import { useMemoryDemoBackend } from "./memory/memory-demo-backend";
import { MemoryChoiceDialog } from "./memory/MemoryChoiceDialog";
import {
  ActivityRow,
  EmotionRow,
  ExclusionRow,
  ForgottenRow,
  MemoryEmptyLine,
  MemoryRowList,
  RawText,
  type MemorySourceWiring,
} from "./memory/MemoryRows";
import {
  showsLedgerAreas,
  sortByLastSeen,
  switchStatus,
  type SessionLookup,
} from "./memory/memory-view";
import { useMemoryOverview } from "./memory/useMemoryOverview";

/**
 * Settings → Memory (「记忆」, main chat ticket 04b; managed runtime
 * only). What the affairs ledger has written about the user, and the
 * engine's own global memory, top to bottom:
 *
 *   1. the switch 「从对话里了解我」 with where the words come from and go
 *      (read daily, through the model provider once more, kept on this
 *      computer), and while on: where reading starts, the last run, the
 *      next one;
 *   2. 正在进行的事 — ongoing activities, newest 「最近」 first;
 *   3. 已经结束的事 — ended ones, folded;
 *   4. 情绪时刻 — emotional events, folded, with how they are used;
 *   5. 不再记的事 — the do-not-record list, folded, each 「移出」;
 *   6. 不用于了解我的对话 — the exclusion marks, each 「恢复」;
 *   7. AI 的长期记忆 — the two global memory files, editable, outside the
 *      switch.
 *
 * Areas 2–6 are left out while the ledger is not on and there is
 * nothing in them (memory-view.ts `showsLedgerAreas`). A file the parser
 * could not read shows read-only (`raw`); a remainder it did not
 * recognize follows its area as 其他内容. Deleting waits while a run is
 * going (`ledger_busy`). Core owns everything: the page reads the
 * overview on open and on `memory-changed`, and every change is a Core
 * command.
 */
export function SettingsMemory({
  onOpenSession,
}: {
  /** Open a cited Galley session (App closes Settings first). */
  onOpenSession?: (sessionId: string) => void;
}) {
  // TEMPORARY (ticket 04b trial): 演示数据 renders the eval fixture on a
  // local copy instead of asking Core.
  const { demo } = useMemoryAskTrial();
  const real = useMemoryOverview(!demo);
  const demoBackend = useMemoryDemoBackend(demo);
  const sessions = useSessionsStore((s) => s.sessions);
  const mainChatLabel = useCopy().sidebar.mainChat;

  const lookupSession = (id: string): SessionLookup | null => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      return {
        title: session.mainChat ? mainChatLabel : session.title,
        archived: session.status === "archived",
      };
    }
    const demoTitle = demo ? demoBackend.sessionTitles[id] : undefined;
    return demoTitle ? { title: demoTitle, archived: false } : null;
  };

  const actions = demo ? demoBackend.actions : coreMemoryActions(real.reload);

  return (
    <MemoryPage
      overview={demo ? demoBackend.overview : real.overview}
      loadError={demo ? null : real.error}
      actions={actions}
      lookupSession={lookupSession}
      onOpenSession={demo ? undefined : onOpenSession}
    />
  );
}

type PendingDelete = {
  id: string;
  title: string;
  kind: "activity" | "emotion";
};

/** The page from an overview (static-renderable; SettingsMemory feeds
 * it). `overview` null: still reading, or the read failed. */
export function MemoryPage({
  overview,
  loadError,
  actions,
  lookupSession,
  onOpenSession,
}: {
  overview: MemoryOverview | null;
  loadError: string | null;
  actions: MemoryActions;
  lookupSession: (id: string) => SessionLookup | null;
  onOpenSession?: (sessionId: string) => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.memory;
  const todayStartMs = useDayStamp();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // Rows whose 移出 / 恢复 is in flight.
  const [pendingRows, setPendingRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const wiring: MemorySourceWiring = {
    lookupSession,
    onOpenSession,
    todayStartMs,
  };

  const toastError = (title: string, error: unknown, context: string) => {
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "error",
        title,
        message: memoryErrorText(error),
        hint: null,
        retryable: false,
        context,
        traceback: null,
      }),
    );
  };

  const withPendingRow = async (key: string, run: () => Promise<void>) => {
    setPendingRows((current) => new Set(current).add(key));
    try {
      await run();
    } catch (e) {
      toastError(copy.actionFailed, e, "memory");
    } finally {
      setPendingRows((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await actions.deleteEntry(pendingDelete.id);
      setPendingDelete(null);
    } catch (e) {
      setPendingDelete(null);
      const id = memoryErrorId(e);
      toastError(
        copy.deleteFailed,
        id === "ledger_busy"
          ? copy.deleteFailedBusy
          : id === "not_found"
            ? copy.deleteFailedGone
            : e,
        "delete_ledger_entry",
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!overview) {
    return (
      <div className="space-y-7">
        <SettingsPanelHeader
          title={appCopy.settings.tabs.memory.title}
          subtitle={copy.subtitle}
        />
        {loadError && (
          <div className="space-y-2">
            <ErrorLine message={copy.loadFailed(loadError)} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={actions.reload}
            >
              {copy.retry}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const { ledger } = overview;
  const busy = ledger.running;
  const activityTitles = new Map<string, string>();
  if (ledger.activities.kind === "parsed") {
    for (const entry of [
      ...ledger.activities.ongoing,
      ...ledger.activities.ended,
    ]) {
      activityTitles.set(entry.id, entry.title);
    }
  }
  const requestDelete = (entry: PendingDelete) => setPendingDelete(entry);

  const activityRows = (entries: readonly LedgerEntry[], empty: string) =>
    entries.length === 0 ? (
      <MemoryEmptyLine>{empty}</MemoryEmptyLine>
    ) : (
      sortByLastSeen(entries).map((entry) => (
        <ActivityRow
          key={entry.id}
          entry={entry}
          busy={busy}
          wiring={wiring}
          onDelete={requestDelete}
        />
      ))
    );

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={appCopy.settings.tabs.memory.title}
        subtitle={copy.subtitle}
      />

      <MemorySwitchArea overview={overview} actions={actions} />

      {showsLedgerAreas(overview) && (
        <>
          {/* 2–3. Activities. A file the parser could not read at all
              cannot be split into ongoing / ended: one read-only area. */}
          {ledger.activities.kind === "raw" ? (
            <MemoryArea title={copy.activitiesRawTitle}>
              <MemoryRowList className="px-3 py-2.5">
                <p className="m-0 mb-2 text-ui-tertiary text-ink-muted">
                  {copy.rawNote}
                </p>
                <RawText text={ledger.activities.text} />
              </MemoryRowList>
            </MemoryArea>
          ) : (
            <>
              <MemoryArea title={copy.ongoingTitle}>
                <MemoryRowList>
                  {activityRows(
                    ledger.activities.kind === "parsed"
                      ? ledger.activities.ongoing
                      : [],
                    copy.emptyOngoing,
                  )}
                </MemoryRowList>
              </MemoryArea>
              <FoldedArea
                title={copy.endedTitle}
                count={
                  ledger.activities.kind === "parsed"
                    ? ledger.activities.ended.length
                    : 0
                }
              >
                <MemoryRowList flat>
                  {activityRows(
                    ledger.activities.kind === "parsed"
                      ? ledger.activities.ended
                      : [],
                    copy.emptyEnded,
                  )}
                </MemoryRowList>
              </FoldedArea>
              {ledger.activities.kind === "parsed" &&
                ledger.activities.other?.trim() && (
                  <OtherText text={ledger.activities.other} />
                )}
            </>
          )}

          {/* 4. Emotional events: folded, with how they are used. */}
          <FoldedArea
            title={copy.emotionsTitle}
            note={copy.emotionsUsage}
            count={
              ledger.emotions.kind === "parsed"
                ? ledger.emotions.entries.length
                : null
            }
          >
            {ledger.emotions.kind === "raw" ? (
              <MemoryRowList flat className="px-3 py-2.5">
                <p className="m-0 mb-2 text-ui-tertiary text-ink-muted">
                  {copy.rawNote}
                </p>
                <RawText text={ledger.emotions.text} />
              </MemoryRowList>
            ) : (
              <MemoryRowList flat>
                {ledger.emotions.kind === "parsed" &&
                ledger.emotions.entries.length > 0 ? (
                  ledger.emotions.entries.map((entry) => (
                    <EmotionRow
                      key={entry.id}
                      entry={entry}
                      relatedTitle={
                        entry.related
                          ? (activityTitles.get(entry.related) ?? null)
                          : null
                      }
                      busy={busy}
                      wiring={wiring}
                      onDelete={requestDelete}
                    />
                  ))
                ) : (
                  <MemoryEmptyLine>{copy.emptyEmotions}</MemoryEmptyLine>
                )}
              </MemoryRowList>
            )}
            {ledger.emotions.kind === "parsed" &&
              ledger.emotions.other?.trim() && (
                <div className="border-t border-line px-3 py-2.5">
                  <p className="m-0 mb-2 text-ui-tertiary text-ink-muted">
                    {copy.otherTitle} · {copy.otherNote}
                  </p>
                  <RawText text={ledger.emotions.other} />
                </div>
              )}
          </FoldedArea>

          {/* 5. The do-not-record list. */}
          <FoldedArea
            title={copy.forgottenTitle}
            note={copy.forgottenNote}
            count={ledger.forgotten.length}
          >
            <MemoryRowList flat>
              {ledger.forgotten.length === 0 ? (
                <MemoryEmptyLine>{copy.emptyForgotten}</MemoryEmptyLine>
              ) : (
                ledger.forgotten.map((entry) => (
                  <ForgottenRow
                    key={entry.id}
                    entry={entry}
                    todayStartMs={todayStartMs}
                    pending={pendingRows.has(`forgotten:${entry.id}`)}
                    onUnforget={() =>
                      void withPendingRow(`forgotten:${entry.id}`, () =>
                        actions.unforget(entry.id),
                      )
                    }
                  />
                ))
              )}
            </MemoryRowList>
          </FoldedArea>

          {/* 6. Sessions and projects marked "not used to understand me". */}
          <MemoryArea title={copy.exclusionsTitle} note={copy.exclusionsNote}>
            <MemoryRowList>
              {ledger.exclusions.length === 0 ? (
                <MemoryEmptyLine>{copy.emptyExclusions}</MemoryEmptyLine>
              ) : (
                ledger.exclusions.map((row) => {
                  const key = `exclusion:${row.target.kind}:${row.target.id}`;
                  const target: LedgerTarget = row.target;
                  return (
                    <ExclusionRow
                      key={key}
                      row={row}
                      pending={pendingRows.has(key)}
                      onRestore={() =>
                        void withPendingRow(key, () =>
                          actions.restoreExclusion(target),
                        )
                      }
                    />
                  );
                })
              )}
            </MemoryRowList>
          </MemoryArea>
        </>
      )}

      {/* 7. The engine's global memory: not under the switch. */}
      <MemoryArea title={copy.globalTitle} note={copy.globalNote}>
        <div className="space-y-2">
          {overview.globalMemory.map((file) => (
            <GlobalMemoryEditor key={file.name} file={file} actions={actions} />
          ))}
        </div>
      </MemoryArea>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        busy={deleting}
        icon={null}
        title={
          pendingDelete?.kind === "emotion"
            ? copy.deleteEmotionTitle
            : copy.deleteTitle
        }
        body={pendingDelete ? copy.deleteBody(pendingDelete.title) : ""}
        confirmLabel={copy.deleteConfirm}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

/** Area 1: the switch row, and while on the status line under it. */
function MemorySwitchArea({
  overview,
  actions,
}: {
  overview: MemoryOverview;
  actions: MemoryActions;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.memory;
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const [dialog, setDialog] = useState<"enable" | "disable" | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { ledger } = overview;
  const on = ledger.switch.state === "on";
  const status = switchStatus({
    ledgerSwitch: ledger.switch,
    running: ledger.running,
    lastRun: ledger.lastRun,
    nextRunAt: ledger.nextRunAt,
    todayStartMs,
    language,
    copy,
  });

  const choose = async (key: string) => {
    setBusyKey(key);
    try {
      await actions.setSwitch(
        key === "from-now"
          ? { action: "enable", lookBack: false }
          : key === "look-back"
            ? { action: "enable", lookBack: true }
            : { action: "disable", clear: key === "clear" },
      );
      setDialog(null);
    } catch (e) {
      setDialog(null);
      useUiStore.getState().pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: copy.actionFailed,
          message: memoryErrorText(e),
          hint: null,
          retryable: false,
          context: "set_ledger_switch",
          traceback: null,
        }),
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="divide-y divide-line rounded-sm border border-line bg-surface">
      <div className="flex items-center justify-between gap-4 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-ui-compact font-medium text-ink">
            {copy.switchTitle}
          </div>
          <div className="mt-0.5 max-w-[600px] text-ui-meta leading-snug text-ink-muted">
            {copy.switchDescription}
          </div>
        </div>
        <Switch
          checked={on}
          ariaLabel={copy.switchTitle}
          disabled={busyKey !== null}
          onCheckedChange={(next) => setDialog(next ? "enable" : "disable")}
        />
      </div>
      {status && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-ui-meta tabular-nums text-ink-soft">
            {status.running && (
              <CircleNotch
                size={12}
                weight="thin"
                className="spin shrink-0 text-ink-muted"
              />
            )}
            <span>{status.parts.join(" · ")}</span>
          </div>
          {status.failureDetail && (
            <div className="mt-0.5 select-text break-words text-ui-tertiary leading-notice text-warning">
              {status.failureDetail}
            </div>
          )}
        </div>
      )}

      <MemoryChoiceDialog
        open={dialog === "enable"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={copy.enableTitle}
        body={copy.enableBody}
        choices={[
          {
            key: "from-now",
            label: copy.enableFromNow,
            detail: copy.enableFromNowDetail,
          },
          {
            key: "look-back",
            label: copy.enableLookBack,
            detail: copy.enableLookBackDetail,
          },
        ]}
        busyKey={dialog === "enable" ? busyKey : null}
        onChoose={(key) => void choose(key)}
      />
      <MemoryChoiceDialog
        open={dialog === "disable"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={copy.disableTitle}
        body={copy.disableBody}
        choices={[
          {
            key: "keep",
            label: copy.disableKeep,
            detail: copy.disableKeepDetail,
          },
          {
            key: "clear",
            label: copy.disableClear,
            detail: copy.disableClearDetail,
            destructive: true,
          },
        ]}
        busyKey={dialog === "disable" ? busyKey : null}
        onChoose={(key) => void choose(key)}
      />
    </div>
  );
}

/** An always-open area: section label, optional note, content. */
function MemoryArea({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <SettingsSectionLabel>{title}</SettingsSectionLabel>
      {note && (
        <p className="m-0 mt-1 text-ui-meta leading-dense text-ink-muted">
          {note}
        </p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** A folded-by-default area: a disclosure card whose header carries the
 * title, the count and the note (the note stays visible while folded). */
function FoldedArea({
  title,
  note,
  count,
  bodyClassName = "p-0",
  children,
}: {
  title: string;
  note?: string;
  /** null: unknown (the file could not be read). */
  count: number | null;
  /** The body's padding; rows run edge to edge by default. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsDisclosureCard
      open={open}
      onToggle={() => setOpen((value) => !value)}
      bodyClassName={bodyClassName}
      header={
        <span className="flex min-w-0 flex-col py-0.5">
          <span className="flex items-center gap-2">
            <span className="text-ui-compact font-medium text-ink">
              {title}
            </span>
            {count !== null && count > 0 && (
              <SettingsTag className="tabular-nums">{count}</SettingsTag>
            )}
          </span>
          {note && (
            <span className="mt-0.5 text-ui-meta leading-dense text-ink-muted">
              {note}
            </span>
          )}
        </span>
      }
    >
      {children}
    </SettingsDisclosureCard>
  );
}

/** A file's unrecognized remainder, read-only, folded. */
function OtherText({ text }: { text: string }) {
  const copy = useCopy().settings.memory;
  return (
    <FoldedArea
      title={copy.otherTitle}
      note={copy.otherNote}
      count={null}
      bodyClassName="px-3 py-2.5"
    >
      <RawText text={text} />
    </FoldedArea>
  );
}
