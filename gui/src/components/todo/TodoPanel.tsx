import {
  BellSimpleSlash,
  CaretRight,
  ChatTeardropText,
  Clock,
  PauseCircle,
  Repeat,
  X,
} from "@phosphor-icons/react";
import {
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useEffect, useState, type ReactNode } from "react";

import { ReadingPanelHeader } from "@/components/conversation/reading/ReadingPanelHeader";
import { Button, IconButton } from "@/components/ui/button";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  todoAutostartHintVisible,
  todoFailureText,
  type AssistantTodo,
  type TodoItem,
  type TodoTarget,
} from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import { StatusIcon } from "@/lib/status-icon";
import {
  assistantRowLine,
  assistantTaskCancellable,
  doneRowLine,
  routineRowLine,
  todoChecked,
  todoMetaParts,
  type TodoMetaPart,
  todoNotesLine,
  todoPanelEmpty,
  todoReminderCancellable,
  todoRowText,
  todoTitleTarget,
  type TodoLineTone,
} from "@/lib/todo-panel";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { goToTodoTarget, quoteTodo, talkToGalley } from "@/lib/todo-open";
import {
  readAutostartHintClosed,
  writeAutostartHintClosed,
  type TodoPlace,
} from "@/lib/todo-panel-memory";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoCheck } from "./TodoCheck";
import { TodoMetaText } from "./TodoMetaText";
import { todoTitleClass } from "./todo-styles";

export interface TodoPanelProps {
  /** The main chat, wherever the panel is (ticket 46): titles jump into
   * it, 「说说这件」 quotes into its composer. */
  mainChatId: string;
  /** Where the panel is open: beside Galley itself, or elsewhere — from
   * where a jump to Galley opens it first (lib/todo-open.ts). */
  here: TodoPlace;
  /** Open a session: a subtask, or the session a scheduled run made. */
  onOpenSession: (sessionId: string) => void;
  /** 「跟 Galley 说」 beside Galley: its composer takes the caret. */
  onTalk: () => void;
  onClose: () => void;
  /** 已完成 starts folded. */
  defaultDoneOpen?: boolean;
}

/**
 * The to-do panel (main chat ticket 42, PRD ruling 91): Galley's
 * notebook, where the user can tick off their own things and nothing
 * else is edited — new things, new times, other words are said to Galley
 * (ruling 91 points 3 and 6), so there is no input here. In the reading
 * panel's place (LocalFileWorkspace), its own width, beside whichever
 * conversation is open (ticket 46, ruling 95): looking is for anywhere,
 * noting and changing stay with Galley.
 *
 *   今天 / 以后 / 随时
 *               the user's to-dos not done (overdue first under 今天),
 *               with no label over them (ruling 98): a box, the title,
 *               when it is due and its reminder, its notes (ticket 80)
 *   Galley 在办  its subtasks and the one-off tasks it will come back
 *               to: no box, the session rows' status glyphs
 *   例行         repeating tasks: the rule and the next time
 *   已完成       the last seven days, folded, with its count
 *
 * Empty groups are not drawn; with nothing but the daily review, the
 * empty state is, and 例行 under it (ticket 80, `todoPanelEmpty`). The
 * actions are only these: tick and untick the user's own (TodoCheck),
 * cancel a to-do's reminder or one of Galley's own one-off reminders
 * (ticket 80) — where the panel is — and on hover 「说说这件」, which
 * quotes the title into the main chat's composer and keeps the panel
 * open. A title goes where the thing came from: the reply that noted it
 * (the 查找聊天记录 jump), a subtask, a scheduled run's session. A jump
 * out of the panel takes the panel along (lib/todo-open.ts). Escape
 * closes it from anywhere but a text field, as it does the reading
 * panel.
 */
export function TodoPanel({
  mainChatId,
  here,
  onOpenSession,
  onTalk,
  onClose,
  defaultDoneOpen = false,
}: TodoPanelProps) {
  const copy = useCopy();
  const todo = useAssistantTodoStore((s) => s.todo);
  const loaded = useAssistantTodoStore((s) => s.loaded);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const go = (target: TodoTarget) =>
    goToTodoTarget(target, here, mainChatId, onOpenSession);
  const talkAbout = (item: TodoItem) =>
    quoteTodo(item, here, mainChatId, todoRowText(item, copy));
  const talk = () => talkToGalley(here, onTalk);

  return (
    <div
      role="region"
      aria-label={copy.todo.title}
      data-role="todo-panel"
      className="flex h-full min-h-0 min-w-0 flex-col bg-app"
    >
      <ReadingPanelHeader
        title={copy.todo.title}
        close={
          <IconButton
            ariaLabel={copy.common.close}
            tooltip={false}
            onClick={onClose}
          >
            <X size={14} weight="thin" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 pt-2">
        {loaded && todoPanelEmpty(todo) && <TodoPanelEmpty onTalk={talk} />}
        {/* Empty, this draws 例行 alone, when the daily review is there
            (ticket 80); before the first read, nothing. */}
        <TodoPanelGroups
          todo={todo}
          mainChatId={mainChatId}
          onGo={go}
          onTalkAbout={talkAbout}
          defaultDoneOpen={defaultDoneOpen}
        />
        <AutostartHint todo={todo} />
      </div>
    </div>
  );
}

function TodoPanelEmpty({ onTalk }: { onTalk: () => void }) {
  const copy = useCopy();
  return (
    <div data-role="todo-empty" className="px-4 py-8 text-center">
      <p className="text-[13px] text-ink-soft">{copy.todo.empty}</p>
      <p className="mt-1.5 text-[12px] text-ink-muted">
        {copy.todo.emptyExample}
      </p>
      <div className="mt-4">
        <Button variant="secondary" onClick={onTalk}>
          {copy.todo.emptyTalk}
        </Button>
      </div>
    </div>
  );
}

/** The groups, empty ones not drawn. */
export function TodoPanelGroups({
  todo,
  mainChatId,
  onGo,
  onTalkAbout,
  defaultDoneOpen = false,
}: {
  todo: AssistantTodo;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  onTalkAbout: (item: TodoItem) => void;
  defaultDoneOpen?: boolean;
}) {
  const copy = useCopy();
  const [doneOpen, setDoneOpen] = useState(defaultDoneOpen);
  const yours = todo.yours;
  const rowProps = { mainChatId, onGo, onTalkAbout };
  // The user's to-dos are the list's own: by time, each its own group,
  // with no label over them (main chat PRD ruling 98: a list kept for
  // you doesn't tag yours as yours; only Galley's are set apart).
  const yourParts: [string, string, TodoItem[]][] = [
    ["today", copy.todo.groupToday, yours.today],
    ["later", copy.todo.groupLater, yours.later],
    ["anytime", copy.todo.groupAnytime, yours.anytime],
  ];
  // 12px between groups, none over the first — under the empty state
  // too, where 例行 is the first (main chat ticket 83, ruling 128 point
  // 9): a gap between the sections, whichever are drawn.
  return (
    <div data-role="todo-groups" className="space-y-3">
      {yourParts.map(
        ([key, label, items]) =>
          items.length > 0 && (
            <section key={key} data-todo-group="yours" data-todo-part={key}>
              <GroupLabel label={label} />
              {items.map((item) => (
                <YourRow
                  key={item.id}
                  item={item}
                  inToday={key === "today"}
                  {...rowProps}
                />
              ))}
            </section>
          ),
      )}
      {todo.assistant.length > 0 && (
        <section data-todo-group="assistant">
          <GroupLabel label={copy.todo.groupAssistant} />
          {todo.assistant.map((item) => (
            <AssistantRow key={item.id} item={item} {...rowProps} />
          ))}
        </section>
      )}
      {todo.routine.length > 0 && (
        <section data-todo-group="routine">
          <GroupLabel label={copy.todo.groupRoutine} />
          {todo.routine.map((item) => (
            <RoutineRow key={item.id} item={item} {...rowProps} />
          ))}
        </section>
      )}
      {todo.done.length > 0 && (
        <section data-todo-group="done">
          <GroupLabel
            label={copy.todo.groupDone}
            count={todo.done.length + todo.doneOmitted}
            open={doneOpen}
            onToggle={() => setDoneOpen((open) => !open)}
          />
          {doneOpen && (
            <>
              {todo.done.map((item) => (
                <DoneRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  {...rowProps}
                />
              ))}
              {todo.doneOmitted > 0 && (
                <p className="px-2.5 py-2 text-[12px] text-ink-muted">
                  {copy.todo.doneOmitted(todo.doneOmitted)}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** A group's label: 11px semibold, muted — the sidebar's section
 * register without its uppercase, as one group is named 「Galley 在办」 and
 * the product name is never set in capitals (AGENTS.md, Names And
 * Terms). 已完成 folds: the whole label toggles it, its count and a caret
 * on the right. The space over it is the groups' gap
 * (TodoPanelGroups); its own top margin, never in force as the first
 * child of its section, went with ticket 83. */
function GroupLabel({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const register =
    "flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-left text-[11px] font-semibold text-ink-muted";
  if (!onToggle) {
    return (
      <div className={register}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        register,
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "outline-none hover:bg-hover hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5 tabular-nums">
        {count}
        <CaretRight
          size={9}
          weight="thin"
          className={cn(
            "opacity-70 transition-transform duration-(--motion-fast) motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </span>
    </button>
  );
}

interface RowProps {
  item: TodoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  onTalkAbout: (item: TodoItem) => void;
}

const LINE_TONES: Record<TodoLineTone, string> = {
  muted: "text-ink-muted",
  warning: "font-medium text-warning",
  error: "font-medium text-error",
  brand: "text-brand-strong/85",
};

/**
 * One row: the leading column (a box or a glyph, on the title's line),
 * the title (one line, cut; a button when it leads somewhere), a second
 * line, and the hover actions over the row's right end — the title
 * gives way to them as a sidebar row's does to its ⋯. A to-do's notes
 * (ticket 80) go on a line under those, outside the box the actions
 * centre in, so a row with notes holds them where a row without does:
 * between the title and the second line, or on a lone title. A failed
 * write says why on a line under it all.
 */
function RowShell({
  item,
  mainChatId,
  onGo,
  leading,
  titleClass,
  line,
  notes,
  actions,
  failure,
}: {
  item: TodoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  leading: ReactNode;
  titleClass?: string;
  line?: ReactNode;
  notes?: ReactNode;
  actions?: ReactNode[];
  failure?: string | null;
}) {
  const copy = useCopy();
  const target = todoTitleTarget(item, mainChatId);
  const text = todoRowText(item, copy);
  const shown = (actions ?? []).filter(Boolean);
  const title = target ? (
    <button
      type="button"
      onClick={() => onGo(target)}
      onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, text)}
      className={cn(
        "block max-w-full truncate rounded-sm text-left outline-none",
        "decoration-ink-muted/60 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-brand/30",
        titleClass,
      )}
    >
      {text}
    </button>
  ) : (
    <span
      className={cn("block truncate", titleClass)}
      onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, text)}
    >
      {text}
    </span>
  );
  return (
    <div
      data-todo-row={item.id}
      data-todo-kind={item.kind}
      data-todo-state={item.state}
      className="group/todo-row rounded-sm hover:bg-hover"
    >
      <div className="relative flex gap-2.5 px-2.5 py-1.5">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          {leading}
        </span>
        <div
          className={cn(
            "min-w-0 flex-1",
            shown.length > 0 &&
              (shown.length > 1
                ? "group-focus-within/todo-row:pr-[60px] group-hover/todo-row:pr-[60px]"
                : "group-focus-within/todo-row:pr-8 group-hover/todo-row:pr-8"),
          )}
        >
          <div className="text-[13px] leading-5">{title}</div>
          {line}
        </div>
        {shown.length > 0 && (
          <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5 opacity-0 group-focus-within/todo-row:opacity-100 group-hover/todo-row:opacity-100">
            {shown}
          </div>
        )}
      </div>
      {notes}
      {failure && (
        <p
          role="alert"
          className="pb-1.5 pl-9 pr-3 text-[11.5px] leading-[1.45] text-error"
        >
          {failure}
        </p>
      )}
    </div>
  );
}

function TalkAbout({
  item,
  onTalkAbout,
}: Pick<RowProps, "item" | "onTalkAbout">) {
  const copy = useCopy();
  return (
    <IconButton
      ariaLabel={copy.todo.talkAbout}
      onClick={() => onTalkAbout(item)}
    >
      <ChatTeardropText size={14} weight="thin" />
    </IconButton>
  );
}

/** The flip and failure the store holds for a to-do. */
function useTodoWrite(id: string) {
  const flip = useAssistantTodoStore((s) => s.flips[id]);
  const failure = useAssistantTodoStore((s) => s.failures[id] ?? null);
  const cancelling = useAssistantTodoStore((s) => s.cancelling[id] === true);
  return { flip, failure, cancelling };
}

/** One of the user's to-dos: the box, the title, when it is due and
 * its reminder (ruling 97), its notes under them (ticket 80);
 * 「说说这件」 on the right, and 「取消提醒」 beside a reminder still to go
 * off — by the thing it removes, and not a second target beside the
 * first at the row's end (deferred.md 「session 行 hover 置顶按钮」: two
 * precise targets side by side make the row's hover loud). */
function YourRow({
  inToday = false,
  ...props
}: RowProps & { inToday?: boolean }) {
  const { item, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const cancelReminder = useAssistantTodoStore((s) => s.cancelReminder);
  const { flip, failure, cancelling } = useTodoWrite(item.id);
  const checked = todoChecked(item, flip);
  const parts = todoMetaParts(item, checked, todayStartMs, language, copy, {
    inToday,
  });
  const canCancelReminder = !checked && todoReminderCancellable(item);
  const notes = todoNotesLine(item);
  return (
    <RowShell
      {...props}
      leading={
        <TodoCheck
          item={item}
          checked={checked}
          saving={flip?.phase === "saving"}
        />
      }
      titleClass={todoTitleClass(checked)}
      line={
        <MetaLine
          parts={parts}
          after={
            canCancelReminder && (
              <CancelReminder
                disabled={cancelling}
                onClick={() => cancelReminder(item.id)}
              />
            )
          }
        />
      }
      notes={notes && <NotesLine text={notes.text} full={notes.full} />}
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
      failure={failure && todoFailureText(failure, copy)}
    />
  );
}

/** 「取消提醒」, on hover at the end of a row's second line, outside what
 * the line cuts: a to-do's reminder, and since ticket 80 one of Galley's
 * own one-off reminders — the same button in both. */
function CancelReminder({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const copy = useCopy();
  return (
    <IconButton
      ariaLabel={copy.todo.cancelReminder}
      size="xs"
      disabled={disabled}
      onClick={onClick}
      className="-my-0.5 ml-0.5 shrink-0 opacity-0 group-focus-within/todo-row:opacity-100 group-hover/todo-row:opacity-100"
    >
      <BellSimpleSlash size={12} weight="thin" />
    </IconButton>
  );
}

/**
 * A to-do's notes (ticket 80, ruling 128 point 5): 12px `ink-muted`, one
 * line, cut, its breaks and runs of space one space; cut, the hover
 * gives them in full, as a title's does. Under the second line, or the
 * title when there is none, at the title's start (the leading column
 * and its gap: 36px). Its own block under the row's box, pulled up 4px
 * into the box's 6px foot so it sits 2px under the line above, as the
 * second line sits under the title, and with the row's 6px foot below.
 */
function NotesLine({ text, full }: { text: string; full: string }) {
  return (
    <div className="-mt-1 pb-1.5 pl-9 pr-2.5">
      <p
        data-role="todo-notes"
        className="truncate text-[12px] leading-[1.4] text-ink-muted"
        onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
      >
        {text}
      </p>
    </div>
  );
}

/** A to-do's second line: the due date (warning when overdue), the
 * reminder, the day it was noted, and `after` it (the reminder's cancel,
 * on hover: on the reminder's line, after the day when there is one —
 * the line cuts the day first when narrow, never the button). */
function MetaLine({
  parts,
  after,
}: {
  parts: readonly TodoMetaPart[];
  after?: ReactNode;
}) {
  if (parts.length === 0) return null;
  return (
    <div
      data-role="todo-meta"
      className="mt-0.5 flex min-w-0 items-center text-[12px] leading-[1.4] tabular-nums text-ink-muted"
    >
      <span className="min-w-0 truncate">
        <TodoMetaText parts={parts} />
      </span>
      {after}
    </div>
  );
}

/** What Galley is on: the session rows' glyph, the title, the state;
 * on one of its own one-off reminders still to go off, 「取消提醒」 at
 * the end of that line on hover, as on a to-do's reminder (ticket 80,
 * ruling 128 point 7). Straight to Core as the reminder card's 「取消」;
 * the row leaves with the fresh list. */
function AssistantRow(props: RowProps) {
  const { item, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const cancelTask = useAssistantTodoStore((s) => s.cancelTask);
  const { failure, cancelling } = useTodoWrite(item.id);
  const line = assistantRowLine(item, todayStartMs, language, copy);
  const canCancel = assistantTaskCancellable(item);
  return (
    <RowShell
      {...props}
      leading={<AssistantGlyph item={item} />}
      titleClass="text-ink"
      line={
        <PlainLine
          text={line.text}
          tone={line.tone}
          after={
            canCancel && (
              <CancelReminder
                disabled={cancelling}
                onClick={() => cancelTask(item.id)}
              />
            )
          }
        />
      }
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
      failure={canCancel && failure ? todoFailureText(failure, copy) : null}
    />
  );
}

/** The session rows' set (lib/status-icon.tsx, the subtask card's
 * asking glyph); a task waiting for its time gets the clock. */
function AssistantGlyph({ item }: { item: TodoItem }) {
  switch (item.state) {
    case "running":
      return <StatusIcon status="running" size={14} />;
    case "asking":
      return <PauseCircle size={14} weight="fill" className="text-warning" />;
    case "failed":
      return <StatusIcon status="error" size={14} />;
    case "step_limit":
    case "stopped":
      return <StatusIcon status="idle" size={14} incomplete />;
    case "done":
      return <StatusIcon status="completed" size={14} />;
    default:
      return <Clock size={14} weight="thin" className="text-ink-muted" />;
  }
}

/** 例行: the repeat glyph, the title, the rule and the next time. */
function RoutineRow(props: RowProps) {
  const { item, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  return (
    <RowShell
      {...props}
      leading={<Repeat size={14} weight="thin" className="text-ink-muted" />}
      titleClass={item.state === "paused" ? "text-ink-soft" : "text-ink"}
      line={
        <PlainLine
          text={routineRowLine(item, todayStartMs, language, copy)}
          tone="muted"
        />
      }
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
    />
  );
}

/** 已完成: a to-do keeps its box (unticking it brings it back); the
 * rest their kind's glyph, all a step quieter. */
function DoneRow(props: RowProps) {
  const { item } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const { flip, failure } = useTodoWrite(item.id);
  const line = (
    <PlainLine
      text={doneRowLine(item, todayStartMs, language, copy)}
      tone="muted"
    />
  );
  if (item.kind === "todo") {
    const checked = todoChecked(item, flip);
    return (
      <RowShell
        {...props}
        leading={
          <TodoCheck
            item={item}
            checked={checked}
            saving={flip?.phase === "saving"}
          />
        }
        titleClass={todoTitleClass(checked)}
        line={line}
        failure={failure && todoFailureText(failure, copy)}
      />
    );
  }
  return (
    <RowShell
      {...props}
      leading={
        item.kind === "subtask" ? (
          <StatusIcon status="completed" size={14} />
        ) : item.repeat && item.repeat.kind !== "once" ? (
          <Repeat size={14} weight="thin" className="text-ink-muted" />
        ) : (
          <Clock size={14} weight="thin" className="text-ink-muted" />
        )
      }
      titleClass="text-ink-soft"
      line={line}
    />
  );
}

/** A second line in one tone; `after` it, outside what the line cuts,
 * a button on hover (MetaLine's way). */
function PlainLine({
  text,
  tone,
  after,
}: {
  text: string;
  tone: TodoLineTone;
  after?: ReactNode;
}) {
  if (!text) return null;
  if (after) {
    return (
      <div
        className={cn(
          "mt-0.5 flex min-w-0 items-center text-[12px] leading-[1.4] tabular-nums",
          LINE_TONES[tone],
        )}
      >
        <span className="min-w-0 truncate">{text}</span>
        {after}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "mt-0.5 truncate text-[12px] leading-[1.4] tabular-nums",
        LINE_TONES[tone],
      )}
    >
      {text}
    </div>
  );
}

/** The line at the foot of the list (scheduled-tasks ticket 14's
 * condition and fix; main chat PRD ruling 96): launch at login is off
 * while something is set to go off. A condition, not a to-do, so it
 * sits below them in muted type — the warning colour is overdue's — and
 * its × closes it for good on this machine. What it costs is lateness,
 * not loss: a missed one-off reminder goes off when Galley next runs
 * (ticket 33). Unknown (browser dev, plugin missing) never warns. */
function AutostartHint({ todo }: { todo: AssistantTodo }) {
  const copy = useCopy();
  const [closed, setClosed] = useState(readAutostartHintClosed);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    isAutostartEnabled()
      .then((v) => {
        if (!cancelled) setEnabled(v);
      })
      .catch((e: unknown) => {
        console.warn("[todo] autostart isEnabled failed.", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!todoAutostartHintVisible(enabled, todo, closed)) return null;
  const turnOn = () => {
    if (pending) return;
    setPending(true);
    setError(null);
    enableAutostart()
      .then(() => isAutostartEnabled())
      .then(setEnabled)
      .catch((e: unknown) => {
        // Same wording as the Settings toggle — it is the same action.
        setError(
          copy.settings.general.launchAtLoginError(
            e instanceof Error ? e.message : String(e),
          ),
        );
      })
      .finally(() => setPending(false));
  };
  const close = () => {
    writeAutostartHintClosed();
    setClosed(true);
  };
  return (
    <div
      data-role="todo-autostart-hint"
      className="mt-5 flex items-start gap-1 pl-2.5"
    >
      <div className="min-w-0 flex-1 pt-px text-[12px] leading-[1.5] text-ink-muted">
        <p>{copy.todo.autostartHint}</p>
        {/* Its own line in both languages: inline, it wraps by width
            and lands indented. */}
        <button
          type="button"
          disabled={pending}
          onClick={turnOn}
          className={cn(
            "mt-0.5 block rounded-sm text-left text-ink-soft underline decoration-ink-muted/60 underline-offset-2 outline-none",
            "hover:text-ink hover:decoration-ink focus-visible:ring-2 focus-visible:ring-brand/30",
            "disabled:opacity-60",
          )}
        >
          {copy.scheduled.autostartEnable}
        </button>
        {error && <p className="mt-1 text-error">{error}</p>}
      </div>
      <IconButton
        size="xs"
        ariaLabel={copy.todo.autostartHintClose}
        onClick={close}
      >
        <X size={12} weight="thin" />
      </IconButton>
    </div>
  );
}
