import { CaretRight, ChatCircle, Folder, Trash } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy, useLanguage } from "@/lib/i18n";
import type {
  ForgottenEntry,
  LedgerEmotion,
  LedgerEntry,
  LedgerExclusionWithTitle,
  LedgerQuote,
} from "@/lib/memory";
import { formatMessageDateTime } from "@/lib/message-time";
import { cn } from "@/lib/utils";

import {
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
  title,
  busy,
  onDelete,
}: {
  title: string;
  /** A run is going: deleting waits (ledger_busy). */
  busy: boolean;
  onDelete: () => void;
}) {
  const copy = useCopy().settings.memory;
  if (busy) {
    return (
      <TooltipLabel text={copy.deleteBusy}>
        {/* The wrapper carries the tooltip: a disabled button gets no
            pointer events. */}
        <span className="inline-flex">
          <IconButton
            ariaLabel={copy.deleteAria(title)}
            tooltip={false}
            disabled
          >
            <Trash size={14} weight="thin" />
          </IconButton>
        </span>
      </TooltipLabel>
    );
  }
  return (
    <IconButton
      ariaLabel={copy.deleteAria(title)}
      tooltip={copy.deleteConfirm}
      onClick={onDelete}
    >
      <Trash size={14} weight="thin" />
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

export function ActivityRow({
  entry,
  busy,
  wiring,
  onDelete,
}: {
  entry: LedgerEntry;
  busy: boolean;
  wiring: MemorySourceWiring;
  onDelete: (entry: { id: string; title: string; kind: "activity" }) => void;
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
          title={entry.title}
          busy={busy}
          onDelete={() =>
            onDelete({ id: entry.id, title: entry.title, kind: "activity" })
          }
        />
      }
    >
      <Quotes quotes={entry.quotes} wiring={wiring} />
      <ExtraLines lines={entry.extra} />
      <SourceChips ids={sources} wiring={wiring} />
    </ExpandableRow>
  );
}

export function EmotionRow({
  entry,
  relatedTitle,
  busy,
  wiring,
  onDelete,
}: {
  entry: LedgerEmotion;
  /** The related activity's title, when the page knows it. */
  relatedTitle: string | null;
  busy: boolean;
  wiring: MemorySourceWiring;
  onDelete: (entry: { id: string; title: string; kind: "emotion" }) => void;
}) {
  const copy = useCopy().settings.memory;
  const language = useLanguage();
  const meta: string[] = [];
  if (entry.at) {
    meta.push(formatLedgerMinute(entry.at, wiring.todayStartMs, language));
  }
  if (entry.tags.length > 0) {
    meta.push(entry.tags.join(language === "zh-CN" ? "、" : ", "));
  }
  return (
    <ExpandableRow
      title={entry.title}
      lines={
        meta.length > 0 && (
          <span className="mt-0.5 block text-ui-tertiary tabular-nums text-ink-muted">
            {meta.join(" · ")}
          </span>
        )
      }
      actions={
        <DeleteButton
          title={entry.title}
          busy={busy}
          onDelete={() =>
            onDelete({ id: entry.id, title: entry.title, kind: "emotion" })
          }
        />
      }
    >
      <Quotes quotes={entry.quotes} wiring={wiring} />
      {entry.related && (
        <p className="m-0 text-ui-meta leading-dense text-ink-muted">
          {copy.related(relatedTitle ?? entry.related)}
        </p>
      )}
      <ExtraLines lines={entry.extra} />
      <SourceChips ids={entrySources(entry)} wiring={wiring} />
    </ExpandableRow>
  );
}

/** A plain row: text on the left, one control on the right. */
function PlainRow({
  icon,
  title,
  detail,
  children,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        {icon}
        <div className="min-w-0">
          <div className="truncate text-ui-compact font-medium text-ink">
            {title}
          </div>
          {detail && (
            <div className="mt-0.5 text-ui-tertiary tabular-nums text-ink-muted">
              {detail}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function ForgottenRow({
  entry,
  todayStartMs,
  pending,
  onUnforget,
}: {
  entry: ForgottenEntry;
  todayStartMs: number;
  pending: boolean;
  onUnforget: () => void;
}) {
  const copy = useCopy().settings.memory;
  const language = useLanguage();
  const deletedAt = formatMessageDateTime(
    entry.deletedAt,
    todayStartMs,
    language,
  );
  return (
    <PlainRow
      title={entry.title}
      detail={deletedAt ? copy.deletedAt(deletedAt) : undefined}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={onUnforget}
      >
        {copy.unforget}
      </Button>
    </PlainRow>
  );
}

export function ExclusionRow({
  row,
  pending,
  onRestore,
}: {
  row: LedgerExclusionWithTitle;
  pending: boolean;
  onRestore: () => void;
}) {
  const copy = useCopy().settings.memory;
  const Icon = row.target.kind === "project" ? Folder : ChatCircle;
  return (
    <PlainRow
      icon={
        <Icon
          size={14}
          weight="thin"
          className="mt-[3px] shrink-0 text-ink-soft"
        />
      }
      title={row.title?.trim() || copy.untitled}
      detail={
        row.target.kind === "project"
          ? copy.exclusionProject
          : copy.exclusionSession
      }
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={onRestore}
      >
        {copy.restore}
      </Button>
    </PlainRow>
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
