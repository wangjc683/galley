import { CaretRight, Trash } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { IconButton } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy, useLanguage } from "@/lib/i18n";
import type { EntryEmotion, LedgerEntry, LedgerQuote } from "@/lib/memory";
import { cn } from "@/lib/utils";

import {
  emotionMeta,
  entrySources,
  formatLedgerDay,
  formatLedgerMinute,
  resolveSource,
  type SessionLookup,
} from "./memory-view";

/** How rows find and open the Galley sessions they cite. */
export interface MemorySourceWiring {
  lookupSession: (id: string) => SessionLookup | null;
  /** Open a cited session (restoring it first when archived). Absent:
   * sources are plain text (static renders in tests). */
  onOpenSession?: (id: string) => void;
  todayStartMs: number;
}

const CARET_MOTION =
  "transition-[color,transform] duration-(--motion-fast) ease-firm motion-reduce:transition-none";

/** A hairline-divided list for memory rows: bordered on the page (the
 * General tab's list surface), flat inside a folded area. */
export function MemoryRowList({
  flat = false,
  className,
  children,
}: {
  /** Inside a disclosure card's body: rows only, no border or fill of
   * its own (no card in a card). */
  flat?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-line",
        !flat && "overflow-hidden rounded-sm border border-line bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A muted line in an empty list. */
export function MemoryEmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-2.5 text-ui-meta leading-dense text-ink-muted">
      {children}
    </div>
  );
}

/**
 * One expandable row: caret + text block toggles, actions sit outside
 * the toggle on the right (the disclosure card's header grammar, flat
 * inside a list — no card in a card). The body opens in place, indented
 * under the text, borderless.
 */
function ExpandableRow({
  title,
  lines,
  actions,
  children,
}: {
  title: string;
  lines: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-start gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2 rounded-sm px-1.5 py-1 text-left",
            "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "mt-px inline-flex size-4 shrink-0 items-center justify-center",
              CARET_MOTION,
              open ? "rotate-90 text-ink" : "rotate-0 text-ink-soft",
            )}
          >
            <CaretRight size={11} weight="bold" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-ui-compact font-medium text-ink">
              {title}
            </span>
            {lines}
          </span>
        </button>
        {actions && (
          <div className="flex shrink-0 items-center pt-0.5">{actions}</div>
        )}
      </div>
      {open && <div className="space-y-3 pb-3 pl-[38px] pr-4">{children}</div>}
    </div>
  );
}

function DeleteButton({
  ariaLabel,
  busy,
  small = false,
  onDelete,
}: {
  ariaLabel: string;
  /** A run is going: deleting waits (ledger_busy). */
  busy: boolean;
  /** An emotion line's: a step below its entry's. */
  small?: boolean;
  onDelete: () => void;
}) {
  const copy = useCopy().settings.memory;
  const size = small ? "xs" : "sm";
  const icon = <Trash size={small ? 12 : 14} weight="thin" />;
  if (busy) {
    return (
      <TooltipLabel text={copy.deleteBusy}>
        {/* The wrapper carries the tooltip: a disabled button gets no
            pointer events. */}
        <span className="inline-flex">
          <IconButton
            ariaLabel={ariaLabel}
            size={size}
            tooltip={false}
            disabled
          >
            {icon}
          </IconButton>
        </span>
      </TooltipLabel>
    );
  }
  return (
    <IconButton
      ariaLabel={ariaLabel}
      size={size}
      tooltip={copy.deleteConfirm}
      onClick={onDelete}
    >
      {icon}
    </IconButton>
  );
}

function SourceChips({
  ids,
  wiring,
}: {
  ids: readonly string[];
  wiring: MemorySourceWiring;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.memory;
  const language = useLanguage();
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-ui-tertiary text-ink-muted">{copy.sources}</span>
      {ids.map((id) => (
        <SourceChip
          key={id}
          id={id}
          wiring={wiring}
          imLabel={(channel, day) =>
            copy.imSource(
              channel
                ? {
                    wechat: appCopy.settings.im.wechatTitle,
                    feishu: appCopy.settings.im.feishuTitle,
                    telegram: appCopy.settings.im.telegramTitle,
                    discord: appCopy.settings.im.discordTitle,
                  }[channel]
                : copy.imUnknown,
              formatLedgerDay(day, wiring.todayStartMs, language),
            )
          }
        />
      ))}
    </div>
  );
}

const CHIP =
  "inline-flex max-w-[260px] items-center rounded-sm px-1.5 py-px text-ui-tertiary leading-4";

function SourceChip({
  id,
  wiring,
  imLabel,
}: {
  id: string;
  wiring: MemorySourceWiring;
  imLabel: (
    channel: "wechat" | "feishu" | "telegram" | "discord" | null,
    day: string,
  ) => string;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.memory;
  const source = resolveSource(id, wiring.lookupSession);
  if (source.kind === "im") {
    return (
      <span className={cn(CHIP, "bg-hover text-ink-muted")}>
        <span className="truncate">{imLabel(source.channel, source.day)}</span>
      </span>
    );
  }
  if (!source.session) {
    return (
      <span className={cn(CHIP, "bg-hover text-ink-muted")} title={id}>
        <span className="truncate">{copy.deletedSession}</span>
      </span>
    );
  }
  const label = source.session.archived
    ? `${source.session.title}${copy.archivedSuffix}`
    : source.session.title;
  const onOpen = wiring.onOpenSession;
  if (!onOpen) {
    return (
      <span className={cn(CHIP, "bg-hover text-ink-soft")}>
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <TooltipLabel
      text={
        source.session.archived ? copy.openArchivedSession : copy.openSession
      }
    >
      <button
        type="button"
        onClick={() => onOpen(id)}
        className={cn(
          CHIP,
          "bg-hover text-ink-soft outline-none hover:bg-selected hover:text-ink",
          "focus-visible:ring-2 focus-visible:ring-brand/30",
          "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        )}
      >
        <span className="truncate">{label}</span>
      </button>
    </TooltipLabel>
  );
}

function Quotes({
  quotes,
  wiring,
}: {
  quotes: readonly LedgerQuote[];
  wiring: MemorySourceWiring;
}) {
  const language = useLanguage();
  if (quotes.length === 0) return null;
  return (
    <div className="space-y-2">
      {quotes.map((quote, index) => (
        <div key={`${quote.session ?? ""}-${quote.at ?? ""}-${index}`}>
          <p className="m-0 select-text border-l-2 border-line pl-2.5 text-ui-secondary leading-secondary text-ink-soft">
            {quote.text}
          </p>
          {quote.at && (
            <div className="mt-0.5 pl-3 text-ui-tertiary tabular-nums text-ink-muted">
              {formatLedgerMinute(quote.at, wiring.todayStartMs, language)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExtraLines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="select-text space-y-0.5 text-ui-meta leading-dense text-ink-muted">
      {lines.map((line, index) => (
        <p key={index} className="m-0">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The emotions recorded under an entry (ticket 04d): one line each —
 * time, tags, the user's words — each with its own delete. How they are
 * used is said once, above them, wherever an entry's emotions show.
 */
export function EmotionLines({
  emotions,
  entryTitle,
  busy,
  wiring,
  onDelete,
}: {
  emotions: readonly EntryEmotion[];
  entryTitle: string;
  busy: boolean;
  wiring: MemorySourceWiring;
  onDelete: (emotion: EntryEmotion) => void;
}) {
  const copy = useCopy().settings.memory;
  const language = useLanguage();
  if (emotions.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="m-0 text-ui-tertiary text-ink-muted">
        {copy.emotionsLabel} · {copy.emotionsUsage}
      </p>
      {emotions.map((emotion, index) => {
        const meta = emotionMeta(emotion, wiring.todayStartMs, language);
        return (
          <div
            key={`${index}-${emotion.line}`}
            className="flex items-start justify-between gap-2"
          >
            <p className="m-0 min-w-0 select-text text-ui-secondary leading-secondary text-ink-soft">
              {meta && (
                <span className="mr-2 text-ui-tertiary tabular-nums text-ink-muted">
                  {meta}
                </span>
              )}
              {emotion.text && <span>{copy.emotionWords(emotion.text)}</span>}
            </p>
            <div className="shrink-0">
              <DeleteButton
                ariaLabel={copy.deleteEmotionAria(
                  entryTitle,
                  meta || emotion.text || emotion.line,
                )}
                busy={busy}
                small
                onDelete={() => onDelete(emotion)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ActivityRow({
  entry,
  busy,
  wiring,
  onDelete,
  onDeleteEmotion,
}: {
  entry: LedgerEntry;
  busy: boolean;
  wiring: MemorySourceWiring;
  onDelete: (entry: LedgerEntry) => void;
  onDeleteEmotion: (entry: LedgerEntry, emotion: EntryEmotion) => void;
}) {
  const copy = useCopy().settings.memory;
  const language = useLanguage();
  const sources = entrySources(entry);
  const meta: string[] = [];
  if (entry.lastSeen) {
    meta.push(
      copy.lastMentioned(
        formatLedgerDay(entry.lastSeen, wiring.todayStartMs, language),
      ),
    );
  }
  if (entry.sessions.length > 0) {
    meta.push(copy.conversationCount(new Set(entry.sessions).size));
  }
  return (
    <ExpandableRow
      title={entry.title}
      lines={
        <>
          {entry.status && (
            <span className="mt-0.5 block text-ui-meta leading-dense text-ink-soft">
              {entry.status}
            </span>
          )}
          {meta.length > 0 && (
            <span className="mt-0.5 block text-ui-tertiary tabular-nums text-ink-muted">
              {meta.join(" · ")}
            </span>
          )}
        </>
      }
      actions={
        <DeleteButton
          ariaLabel={copy.deleteAria(entry.title)}
          busy={busy}
          onDelete={() => onDelete(entry)}
        />
      }
    >
      <Quotes quotes={entry.quotes} wiring={wiring} />
      <EmotionLines
        emotions={entry.emotions}
        entryTitle={entry.title}
        busy={busy}
        wiring={wiring}
        onDelete={(emotion) => onDeleteEmotion(entry, emotion)}
      />
      <ExtraLines lines={entry.extra} />
      <SourceChips ids={sources} wiring={wiring} />
    </ExpandableRow>
  );
}

/** Read-only original text: a `raw` file, or an `other` remainder. */
export function RawText({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-[320px] select-text overflow-auto whitespace-pre-wrap break-words font-sans text-ui-meta leading-secondary text-ink-soft">
      {text}
    </pre>
  );
}
