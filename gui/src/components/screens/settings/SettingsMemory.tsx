import { CircleNotch } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import {
  SettingsDisclosureCard,
  SettingsDisclosureRow,
} from "@/components/screens/settings/settings-disclosure";
import { SettingsTag } from "@/components/screens/settings/settings-badges";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Switch } from "@/components/ui/switch";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  memoryErrorId,
  memoryErrorText,
  type EntryEmotion,
  type LedgerEntry,
  type MemoryOverview,
  type SetLedgerSwitchArgs,
} from "@/lib/memory";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

import { ErrorLine } from "./models/ModelPrimitives";
import { GlobalMemoryEditor } from "./memory/GlobalMemoryEditor";
import { coreMemoryActions, type MemoryActions } from "./memory/memory-actions";
import { MemoryChoiceDialog } from "./memory/MemoryChoiceDialog";
import {
  ActivityRow,
  MemoryEmptyLine,
  MemoryRowList,
  RawText,
  type MemorySourceWiring,
} from "./memory/MemoryRows";
import {
  showsLedgerArea,
  sortByLastSeen,
  switchToggle,
  switchStatus,
  type SessionLookup,
} from "./memory/memory-view";
import { useMemoryOverview } from "./memory/useMemoryOverview";

/**
 * Settings → Memory (「记忆」, main chat tickets 04b and 04d; managed
 * runtime only). What the affairs ledger has written about the user, and
 * the engine's own global memory — three areas, top to bottom (PRD
 * ruling 48):
 *
 *   1. the switch 「从对话里了解我」 with where the words come from and go
 *      (read daily, earlier conversations included, through the model
 *      provider once more, kept on this computer), and while on: where
 *      reading starts, the last run, the next one. One allow switch
 *      (ticket 04c, PRD ruling 47): turning it on asks nothing and reads
 *      earlier conversations too; turning it off asks 「保留 / 清空」
 *      about what was already noted;
 *   2. 记下的事 — ongoing affairs, newest 「最近」 first, then one last row
 *      「已经结束的 N 件」 that unfolds the ended ones. An affair opens to
 *      its words, its emotions (each deletable, with how they are used
 *      said once above them) and its sources;
 *   3. AI 的长期记忆 — the two global memory files, editable, outside the
 *      switch.
 *
 * Area 2 is left out while the ledger is not on and there is no ledger
 * file (memory-view.ts `showsLedgerArea`). A file the parser could not
 * read shows read-only (`raw`); a remainder it did not recognize follows
 * as 其他内容. Deleting waits while a run is going (`ledger_busy`), and is
 * only a delete: said again later, a thing may be noted again. Core owns
 * everything: the page reads the overview on open and on
 * `memory-changed`, and every change is a Core command.
 */
export function SettingsMemory({
  onOpenSession,
}: {
  /** Open a cited Galley session (App closes Settings first). */
  onOpenSession?: (sessionId: string) => void;
}) {
  const { overview, error, reload } = useMemoryOverview(true);
  const sessions = useSessionsStore((s) => s.sessions);
  const mainChatLabel = useCopy().sidebar.mainChat;

  const lookupSession = (id: string): SessionLookup | null => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return null;
    return {
      title: session.mainChat ? mainChatLabel : session.title,
      archived: session.status === "archived",
    };
  };

  return (
    <MemoryPage
      overview={overview}
      loadError={error}
      actions={coreMemoryActions(reload)}
      lookupSession={lookupSession}
      onOpenSession={onOpenSession}
    />
  );
}

type PendingDelete =
  | { kind: "entry"; entry: LedgerEntry }
  | { kind: "emotion"; entry: LedgerEntry; emotion: EntryEmotion };

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
  const [endedOpen, setEndedOpen] = useState(false);

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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const target = pendingDelete;
    try {
      if (target.kind === "emotion") {
        await actions.deleteEmotion(target.entry.id, target.emotion.line);
      } else {
        await actions.deleteEntry(target.entry.id);
      }
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
        target.kind === "emotion"
          ? "delete_ledger_emotion"
          : "delete_ledger_entry",
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
  const activities = ledger.activities;
  const ongoing = activities.kind === "parsed" ? activities.ongoing : [];
  const ended = activities.kind === "parsed" ? activities.ended : [];

  const activityRow = (entry: LedgerEntry) => (
    <ActivityRow
      key={entry.id}
      entry={entry}
      busy={busy}
      wiring={wiring}
      onDelete={(target) => setPendingDelete({ kind: "entry", entry: target })}
      onDeleteEmotion={(target, emotion) =>
        setPendingDelete({ kind: "emotion", entry: target, emotion })
      }
    />
  );

  const deleteBody = (target: PendingDelete): string => {
    if (target.kind === "emotion") {
      return copy.deleteEmotionBody(target.entry.title);
    }
    const body = copy.deleteBody(target.entry.title);
    return target.entry.emotions.length > 0
      ? `${body}${copy.deleteBodyEmotions}`
      : body;
  };

  return (
    <div className="space-y-7">
      <SettingsPanelHeader
        title={appCopy.settings.tabs.memory.title}
        subtitle={copy.subtitle}
      />

      <MemorySwitchArea overview={overview} actions={actions} />

      {/* 2. What it noted: ongoing first, the ended ones behind one last
          row. A file the parser could not read at all shows read-only
          under the same title. */}
      {showsLedgerArea(overview) && (
        <MemoryArea title={copy.notedTitle}>
          {activities.kind === "raw" ? (
            <MemoryRowList className="px-3 py-2.5">
              <p className="m-0 mb-2 text-ui-tertiary text-ink-muted">
                {copy.rawNote}
              </p>
              <RawText text={activities.text} />
            </MemoryRowList>
          ) : (
            <MemoryRowList>
              {ongoing.length === 0 && ended.length === 0 && (
                <MemoryEmptyLine>{copy.emptyNoted}</MemoryEmptyLine>
              )}
              {sortByLastSeen(ongoing).map(activityRow)}
              {ended.length > 0 && (
                <SettingsDisclosureRow
                  title={copy.endedFold(ended.length)}
                  open={endedOpen}
                  onToggle={() => setEndedOpen((open) => !open)}
                >
                  {/* Flat inside the row's body (no list in a list):
                      the ended affairs sit indented under their row. */}
                  <MemoryRowList flat>
                    {sortByLastSeen(ended).map(activityRow)}
                  </MemoryRowList>
                </SettingsDisclosureRow>
              )}
            </MemoryRowList>
          )}
          {activities.kind === "parsed" && activities.other?.trim() && (
            <div className="mt-2">
              <OtherText text={activities.other} />
            </div>
          )}
        </MemoryArea>
      )}

      {/* 3. The engine's global memory: not under the switch. */}
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
        body={pendingDelete ? deleteBody(pendingDelete) : ""}
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
  const [disableOpen, setDisableOpen] = useState(false);
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

  // `key` names what is in flight: "enable" (the switch itself) or the
  // off dialog's choice.
  const apply = async (key: string, args: SetLedgerSwitchArgs) => {
    setBusyKey(key);
    try {
      await actions.setSwitch(args);
      setDisableOpen(false);
    } catch (e) {
      setDisableOpen(false);
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
          onCheckedChange={(next) => {
            const toggle = switchToggle(next);
            if (toggle.kind === "apply") void apply("enable", toggle.args);
            else setDisableOpen(true);
          }}
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
        open={disableOpen}
        onOpenChange={(open) => !open && setDisableOpen(false)}
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
        busyKey={busyKey}
        onChoose={(key) =>
          void apply(key, { action: "disable", clear: key === "clear" })
        }
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
