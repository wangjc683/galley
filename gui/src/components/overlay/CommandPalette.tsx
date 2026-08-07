import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowsClockwise,
  ChatCircleText,
  Check,
  Cube,
  FolderOpen,
  FrameCorners,
  Gear,
  MagnifyingGlass,
  Plus,
  User,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { searchMessages, type MessageSearchHit } from "@/lib/db";
import { useCopy } from "@/lib/i18n";
import { cleanSessionSummary } from "@/lib/session-summary";
import { resetWindowLayout } from "@/lib/layout-reset";
import { formatShortcut, formatShortcutReadable } from "@/lib/shortcuts";
import { StatusIcon } from "@/lib/status-icon";
import { cn } from "@/lib/utils";
import type { RuntimeKind, Session } from "@/types/session";

import "./command-palette.css";

export interface LLMOption {
  index: number;
  key?: string;
  name?: string;
  displayName: string;
  isCurrent: boolean;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  sessions: Session[];
  runtimeKind: RuntimeKind;
  llms?: LLMOption[];

  onNewChat?: () => void;
  onNewProject?: () => void;
  onOpenSession?: (id: string) => void;
  onSwitchLLM?: (index: number) => void;
  onReRunHealthCheck?: () => void;
  onOpenSettings?: () => void;
  onAttachGAFolder?: () => void;

  /** Called when the user presses Enter on an empty/no-match palette
   * (DESIGN.md §8 "Empty state") — typically: open new chat with this
   * text as the first message. */
  onSubmitFreeText?: (text: string) => void;
}

/**
 * ⌘K command palette. DESIGN.md §8.
 *
 * Centered overlay (not pinned-top), 920px wide, max-height 680px,
 * surface-elevated bg + shadow-elevated + 14px radius. Backdrop is
 * surface-overlay rgba(31,27,23,0.4) — no blur (Notion-style flat
 * scrim, not magazine-feel blur).
 *
 * Built on cmdk. We use cmdk directly rather than going through
 * shadcn/command — shadcn's command is just cmdk + Tailwind classes,
 * and we already have our own design tokens. Avoids the shadcn init
 * step touching globals.css.
 *
 * V0.1 contents (intentionally narrow):
 *
 *   - "New chat" (always first)
 *   - Recent sessions (≤8, fuzzy on title)
 *   - Actions: Switch LLM (nested submenu) / Re-run health check /
 *     Open settings / Attach GA folder
 *
 * Deliberately excluded: cross-session full-text search, theme
 * switcher, quick prompt insertion, destructive actions. See
 * DESIGN.md §8 "故意排除".
 */
export function CommandPalette(props: CommandPaletteProps) {
  const copy = useCopy();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<"root" | "switch-llm">("root");
  const [messageHits, setMessageHits] = useState<MessageSearchHit[]>([]);

  // Reset internal state every time the palette opens — feels less
  // surprising than persisting across opens (DESIGN.md §8: no recent-
  // searches persistence at V0.1). Schedule on a tick so the
  // react-hooks/set-state-in-effect rule stays happy.
  useEffect(() => {
    if (!props.open) return;
    const t = setTimeout(() => {
      setSearch("");
      setPage("root");
      setMessageHits([]);
    }, 0);
    return () => clearTimeout(t);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const t = setTimeout(() => setMessageHits([]), 0);
    return () => clearTimeout(t);
  }, [props.open, props.runtimeKind]);

  // Debounced full-text content search via SQLite FTS5. Fires only
  // on the root page so the LLM-switcher subpage isn't burning DB
  // queries. The query.length < 2 guard mirrors `searchMessages`
  // itself, but doing it here avoids touching the DB at all for
  // tiny inputs.
  useEffect(() => {
    if (!props.open || page !== "root") return;
    const q = search.trim();
    if (q.length < 2) {
      // Defer clearing so this effect doesn't setState synchronously
      // (react-hooks/set-state-in-effect). Same pattern as the
      // open-reset effect above.
      const clear = setTimeout(() => setMessageHits([]), 0);
      return () => clearTimeout(clear);
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void searchMessages(q, 8, props.runtimeKind)
        .then((hits) => {
          if (!cancelled) setMessageHits(hits);
        })
        .catch((e) => {
          console.debug("[palette] message search failed.", e);
          if (!cancelled) setMessageHits([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [search, props.open, page, props.runtimeKind]);

  const close = () => props.onOpenChange(false);

  return (
    <Command.Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      label={copy.command.label}
      shouldFilter={page === "root"}
    >
      <div className="relative shrink-0">
        <MagnifyingGlass
          size={16}
          weight="thin"
          className="pointer-events-none absolute left-4 top-4 text-ink-muted"
        />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder={
            page === "switch-llm" ? copy.command.searchLLM : copy.command.search
          }
          autoFocus
        />
        <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-sm border border-line bg-app px-1.5 py-px font-mono text-[10px] text-ink-muted">
          Esc
        </kbd>
      </div>

      <Command.List>
        {page === "root" ? (
          <RootPage
            search={search}
            sessions={props.sessions}
            messageHits={messageHits}
            onNewChat={() => {
              props.onNewChat?.();
              close();
            }}
            onNewProject={() => {
              props.onNewProject?.();
              close();
            }}
            onOpenSession={(id) => {
              props.onOpenSession?.(id);
              close();
            }}
            onEnterSwitchLLM={() => setPage("switch-llm")}
            llmCount={props.llms?.length ?? 0}
            currentLLM={props.llms?.find((l) => l.isCurrent)?.displayName}
            onReRunHealthCheck={() => {
              props.onReRunHealthCheck?.();
              close();
            }}
            onResetLayout={() => {
              // Self-contained module action (lib/layout-reset.ts), so
              // no prop from App — unlike its sibling handlers.
              void resetWindowLayout();
              close();
            }}
            onOpenSettings={() => {
              props.onOpenSettings?.();
              close();
            }}
            onAttachGAFolder={() => {
              props.onAttachGAFolder?.();
              close();
            }}
            onSubmitFreeText={(text) => {
              props.onSubmitFreeText?.(text);
              close();
            }}
          />
        ) : (
          <SwitchLLMPage
            llms={props.llms ?? []}
            onPick={(index) => {
              props.onSwitchLLM?.(index);
              close();
            }}
            onBack={() => setPage("root")}
          />
        )}
      </Command.List>
    </Command.Dialog>
  );
}

// ---------------- Root page ----------------

function RootPage({
  search,
  sessions,
  messageHits,
  onNewChat,
  onNewProject,
  onOpenSession,
  onEnterSwitchLLM,
  llmCount,
  currentLLM,
  onReRunHealthCheck,
  onResetLayout,
  onOpenSettings,
  onAttachGAFolder,
  onSubmitFreeText,
}: {
  search: string;
  sessions: Session[];
  messageHits: MessageSearchHit[];
  onNewChat: () => void;
  onNewProject: () => void;
  onOpenSession: (id: string) => void;
  onEnterSwitchLLM: () => void;
  llmCount: number;
  currentLLM?: string;
  onReRunHealthCheck: () => void;
  onResetLayout: () => void;
  onOpenSettings: () => void;
  onAttachGAFolder: () => void;
  onSubmitFreeText: (text: string) => void;
}) {
  const copy = useCopy();
  // Show only the most recent 8 sessions when there's no search; cmdk
  // handles fuzzy filtering when the user starts typing.
  const recentSessions = sessions.slice(0, 8);

  return (
    <>
      <Command.Empty>
        <EmptyHint search={search} onSubmit={() => onSubmitFreeText(search)} />
      </Command.Empty>

      {/* Always-first: New chat. Plain Item, no group header. */}
      <Command.Item
        value="new-chat new chat 新对话 新建对话"
        onSelect={onNewChat}
      >
        <PaletteRow
          Icon={Plus}
          label={copy.command.newConversation}
          shortcut={formatShortcut("Mod+N")}
        />
      </Command.Item>
      <Command.Item
        value="new-project new project 新建项目"
        onSelect={onNewProject}
      >
        <PaletteRow Icon={FolderOpen} label={copy.command.newProject} />
      </Command.Item>

      {/* Sessions. Summary rides inline after the title (muted,
          truncating) — the right-aligned `sub` slot is for short
          annotations on action rows and would crush the title when
          fed an 80-char recap. */}
      {recentSessions.map((s) => {
        const preview = s.summary ? cleanSessionSummary(s.summary) : undefined;
        return (
          <Command.Item
            key={s.id}
            value={`session ${s.title} ${preview ?? ""}`}
            onSelect={() => onOpenSession(s.id)}
          >
            <PaletteRow
              iconNode={<StatusIcon status={s.status} size={14} />}
              label={s.title}
              preview={preview}
            />
          </Command.Item>
        );
      })}

      {/* Matches in conversations — populated only when query >= 2
          chars. forceMount keeps cmdk's fuzzy filter from hiding
          these (our SQL match is already authoritative). Group
          header renders only when there's content. */}
      {messageHits.length > 0 && (
        <>
          <div className="mx-1.5 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {copy.command.inConversationContent}
          </div>
          {messageHits.map((h) => (
            <Command.Item
              key={h.messageId}
              className="cmdk-message-hit"
              forceMount
              value={`msg-hit ${h.messageId} ${search}`}
              onSelect={() => onOpenSession(h.sessionId)}
            >
              <MessageHitRow hit={h} />
            </Command.Item>
          ))}
        </>
      )}

      {/* Actions */}
      <Command.Item
        value="switch llm 切换"
        onSelect={onEnterSwitchLLM}
        disabled={llmCount === 0}
      >
        <PaletteRow
          Icon={Cube}
          label={copy.command.switchLLM}
          sub={currentLLM ? copy.command.current(currentLLM) : undefined}
          shortcut="→"
        />
      </Command.Item>
      <Command.Item
        value="rerun health check 体检 健康检查"
        onSelect={onReRunHealthCheck}
      >
        <PaletteRow
          Icon={ArrowsClockwise}
          label={copy.command.runHealthCheck}
        />
      </Command.Item>
      <Command.Item
        value="reset default layout window 恢复默认布局 窗口"
        onSelect={onResetLayout}
      >
        <PaletteRow Icon={FrameCorners} label={copy.command.resetLayout} />
      </Command.Item>
      <Command.Item value="open settings 设置" onSelect={onOpenSettings}>
        <PaletteRow
          Icon={Gear}
          label={copy.command.openSettings}
          shortcut={formatShortcutReadable("Mod+,")}
        />
      </Command.Item>
      <Command.Item
        value="attach ga folder 切换 GA 路径"
        onSelect={onAttachGAFolder}
      >
        <PaletteRow Icon={FolderOpen} label={copy.command.changeGAFolder} />
      </Command.Item>
    </>
  );
}

function EmptyHint({
  search,
  onSubmit,
}: {
  search: string;
  onSubmit: () => void;
}) {
  const copy = useCopy();
  if (search.trim() === "") {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] italic text-ink-muted">
        {copy.command.noMatch}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
      <div className="text-[12.5px] italic text-ink-muted">
        {copy.command.notFound}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-brand-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {copy.command.askDirectly}
        <span className="rounded-sm border border-line bg-app px-1.5 py-px font-mono text-[10px] text-ink-muted">
          ↵
        </span>
      </button>
    </div>
  );
}

// ---------------- Switch LLM page ----------------

function SwitchLLMPage({
  llms,
  onPick,
  onBack,
}: {
  llms: LLMOption[];
  onPick: (index: number) => void;
  onBack: () => void;
}) {
  const copy = useCopy();
  return (
    <>
      <Command.Item value="back" onSelect={onBack}>
        <PaletteRow
          Icon={ArrowLeft}
          label={copy.command.back}
          sub={copy.command.mainMenu}
        />
      </Command.Item>
      {llms.map((llm) => (
        <Command.Item
          key={llm.index}
          value={`llm ${llm.displayName}`}
          onSelect={() => onPick(llm.index)}
        >
          <PaletteRow
            Icon={Cube}
            label={llm.displayName}
            checked={llm.isCurrent}
          />
        </Command.Item>
      ))}
      {llms.length === 0 && (
        <Command.Empty>
          <div className="px-4 py-6 text-center text-[12.5px] italic text-ink-muted">
            {copy.command.noLLMs}
          </div>
        </Command.Empty>
      )}
    </>
  );
}

// ---------------- Message hit row ----------------

function MessageHitRow({ hit }: { hit: MessageSearchHit }) {
  const copy = useCopy();
  return (
    <div className="flex min-w-0 w-full items-start gap-2.5">
      <span
        className="inline-flex shrink-0 pt-0.5 text-ink-soft"
        title={
          hit.role === "user"
            ? copy.command.yourMessage
            : copy.command.agentReply
        }
      >
        {hit.role === "user" ? (
          <User size={14} weight="thin" />
        ) : (
          <ChatCircleText size={14} weight="thin" />
        )}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-[12.5px] text-ink-soft">
          {hit.sessionTitle}
        </div>
        <div className="mt-0.5 line-clamp-2 break-words text-[12px] leading-[1.45] text-ink">
          <HighlightedSnippet raw={hit.snippet} />
        </div>
      </div>
    </div>
  );
}

/**
 * FTS5's `snippet()` returns text with `«` / `»` delimiters around
 * the matched fragments. Split on them and wrap matches in <mark>
 * with a brand tint. Odd-indexed parts are hits, even-indexed are
 * surrounding context.
 */
function HighlightedSnippet({ raw }: { raw: string }) {
  const parts = raw.split(/«([^»]*)»/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="box-decoration-clone rounded-sm bg-brand/[var(--opacity-soft)] px-0.5 text-ink"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

// ---------------- Row primitive ----------------

function PaletteRow({
  Icon,
  iconNode,
  label,
  preview,
  sub,
  shortcut,
  checked,
}: {
  Icon?: PhosphorIcon;
  iconNode?: React.ReactNode;
  label: string;
  /** Muted one-liner flowing inline after the label (session recap).
   * Unlike `sub` it truncates freely; the label keeps ≥35% width. */
  preview?: string;
  /** Short right-aligned annotation ("当前: x"). Never truncates, so
   * only feed it bounded strings — long text belongs in `preview`. */
  sub?: string;
  shortcut?: string;
  checked?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <span className="inline-flex shrink-0 text-ink-soft">
        {iconNode ?? (Icon && <Icon size={16} weight="thin" />)}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[13px] text-ink",
          preview ? "max-w-[65%] flex-none" : "flex-1",
        )}
      >
        {label}
      </span>
      {preview && (
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
          {preview}
        </span>
      )}
      {sub && (
        <span className="shrink-0 text-[11.5px] text-ink-muted">{sub}</span>
      )}
      {checked && (
        <Check size={12} weight="bold" className="shrink-0 text-brand-strong" />
      )}
      {shortcut && (
        <span
          className={cn(
            "shrink-0 rounded-sm border border-line bg-app px-1.5 py-px font-mono text-[10px] text-ink-muted",
            !sub && !checked && "ml-auto",
          )}
        >
          {shortcut}
        </span>
      )}
    </div>
  );
}
