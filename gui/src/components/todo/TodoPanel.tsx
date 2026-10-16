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
// TEMP variant switcher (main chat 42): comparison C, the done fade.
import { useTodoVariants } from "@/components/todo/todo-variants/todo-variants";
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
  doneRowLine,
  routineRowLine,
  todoChecked,
  todoMetaParts,
  todoPanelEmpty,
  todoReminderCancellable,
  todoTitleTarget,
  type TodoLineTone,
} from "@/lib/todo-panel";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import { goToTodoTarget, quoteTodo } from "@/lib/todo-open";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoCheck } from "./TodoCheck";
import { todoDoneClass, todoTitleClass } from "./todo-styles";

export interface TodoPanelProps {
  /** The main chat on screen beside the panel: titles jump within it,
   * 「说说这件」 quotes into its composer. */
  mainChatId: string;
  /** Open a session: a subtask, or the session a scheduled run made. */
  onOpenSession: (sessionId: string) => void;
  /** 「去跟 Galley 说」: the main chat's composer takes the caret. */
  onTalk: () => void;
  onClose: () => void;
  /** 已完成 starts folded. */
  defaultDoneOpen?: boolean;
}

/**
 * The to-do panel beside the main chat (main chat ticket 42, PRD ruling
 * 91): Galley's notebook, where the user can tick off their own things
 * and nothing else is edited — new things, new times, other words are
 * said to Galley (ruling 91 points 3 and 6), so there is no input here.
 * In the reading panel's place (LocalFileWorkspace), its own width.
 *
 *   你的事       the user's to-dos not done, under 今天 (overdue first) /
 *               以后 / 随时: a box, the title, when it is due and its
 *               reminder
 *   Galley 在办  its subtasks and the one-off tasks it will come back
 *               to: no box, the session rows' status glyphs
 *   例行         repeating tasks: the rule and the next time
 *   已完成       the last seven days, folded, with its count
 *
 * Empty groups are not drawn. The actions are only these: tick and
 * untick the user's own (TodoCheck), cancel a to-do's reminder, and on
 * hover 「说说这件」, which quotes the title into the main chat's
 * composer and keeps the panel open. A title goes where the thing came
 * from: the reply that noted it (the 查找聊天记录 jump), a subtask, a
 * scheduled run's session. Escape closes it from anywhere but a text
 * field, as it does the reading panel.
 */
export function TodoPanel({
  mainChatId,
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

  const go = (target: TodoTarget) => goToTodoTarget(target, onOpenSession);
  const talkAbout = (item: TodoItem) => quoteTodo(mainChatId, item);

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
        <AutostartHint todo={todo} />
        {loaded && todoPanelEmpty(todo) ? (
          <TodoPanelEmpty onTalk={onTalk} />
        ) : (
          <TodoPanelGroups
            todo={todo}
            mainChatId={mainChatId}
            onGo={go}
            onTalkAbout={talkAbout}
            defaultDoneOpen={defaultDoneOpen}
          />
        )}
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
  const hasYours =
    yours.today.length + yours.later.length + yours.anytime.length > 0;
  const rowProps = { mainChatId, onGo, onTalkAbout };
  const yourParts: [string, string, TodoItem[]][] = [
    ["today", copy.todo.groupToday, yours.today],
    ["later", copy.todo.groupLater, yours.later],
    ["anytime", copy.todo.groupAnytime, yours.anytime],
  ];
  return (
    <>
      {hasYours && (
        <section data-todo-group="yours">
          <GroupLabel label={copy.todo.groupYours} />
          {yourParts.map(
            ([key, label, items]) =>
              items.length > 0 && (
                <div key={key} data-todo-part={key}>
                  <PartLabel label={label} />
                  {items.map((item) => (
                    <YourRow key={item.id} item={item} {...rowProps} />
                  ))}
                </div>
              ),
          )}
        </section>
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
    </>
  );
}

/** A group's label: 11px semibold, muted — the sidebar's section
 * register without its uppercase, as one group is named 「Galley 在办」 and
 * the product name is never set in capitals (AGENTS.md, Names And
 * Terms). 已完成 folds: the whole label toggles it, its count and a caret
 * on the right. */
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
    "mt-3 flex w-full items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-left text-[11px] font-semibold text-ink-muted first:mt-0";
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

/** 今天 / 以后 / 随时 under 你的事: a step quieter than a group (regular
 * where the group is semibold). */
function PartLabel({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] text-ink-muted">
      {label}
    </div>
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
 * gives way to them as a sidebar row's does to its ⋯. A failed write
 * says why on a line under it.
 */
function RowShell({
  item,
  mainChatId,
  onGo,
  leading,
  titleClass,
  line,
  actions,
  rowClass,
  failure,
}: {
  item: TodoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  leading: ReactNode;
  titleClass?: string;
  line?: ReactNode;
  actions?: ReactNode[];
  rowClass?: string;
  failure?: string | null;
}) {
  const copy = useCopy();
  const target = todoTitleTarget(item, mainChatId);
  const text = item.text || (item.kind === "subtask" ? copy.subtask.label : "");
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
      className={cn("group/todo-row rounded-sm hover:bg-hover", rowClass)}
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

/** 你的事: the box, the title, when it is due and its reminder;
 * 「说说这件」 on the right, and 「取消提醒」 beside a reminder still to go
 * off — by the thing it removes, and not a second target beside the
 * first at the row's end (deferred.md 「session 行 hover 置顶按钮」: two
 * precise targets side by side make the row's hover loud). */
function YourRow(props: RowProps) {
  const { item, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  // TEMP variant switcher (main chat 42): comparison C.
  const fade = useTodoVariants((s) => s.done);
  const cancelReminder = useAssistantTodoStore((s) => s.cancelReminder);
  const { flip, failure, cancelling } = useTodoWrite(item.id);
  const checked = todoChecked(item, flip);
  const parts = todoMetaParts(item, checked, todayStartMs, language, copy);
  const canCancelReminder = !checked && todoReminderCancellable(item);
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
      rowClass={todoDoneClass(checked, fade)}
      line={
        <MetaLine
          parts={parts}
          after={
            canCancelReminder && (
              <IconButton
                ariaLabel={copy.todo.cancelReminder}
                size="xs"
                disabled={cancelling}
                onClick={() => cancelReminder(item.id)}
                className="-my-0.5 ml-0.5 shrink-0 opacity-0 group-focus-within/todo-row:opacity-100 group-hover/todo-row:opacity-100"
              >
                <BellSimpleSlash size={12} weight="thin" />
              </IconButton>
            )
          }
        />
      }
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
      failure={failure && todoFailureText(failure, copy)}
    />
  );
}

/** A to-do's second line: the due date (warning when overdue), the
 * reminder, and `after` it (the reminder's cancel, on hover). */
function MetaLine({
  parts,
  after,
}: {
  parts: ReturnType<typeof todoMetaParts>;
  after?: ReactNode;
}) {
  if (parts.length === 0) return null;
  return (
    <div
      data-role="todo-meta"
      className="mt-0.5 flex min-w-0 items-center text-[12px] leading-[1.4] tabular-nums text-ink-muted"
    >
      <span className="min-w-0 truncate">
        {parts.map((part, index) => (
          <span key={index}>
            {index > 0 && " · "}
            <span
              className={
                part.tone === "warning" ? "font-medium text-warning" : undefined
              }
            >
              {part.text}
            </span>
          </span>
        ))}
      </span>
      {after}
    </div>
  );
}

/** What Galley is on: the session rows' glyph, the title, the state. */
function AssistantRow(props: RowProps) {
  const { item, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const line = assistantRowLine(item, todayStartMs, language, copy);
  return (
    <RowShell
      {...props}
      leading={<AssistantGlyph item={item} />}
      titleClass="text-ink"
      line={<PlainLine text={line.text} tone={line.tone} />}
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
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
  // TEMP variant switcher (main chat 42): comparison C.
  const fade = useTodoVariants((s) => s.done);
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
        rowClass={todoDoneClass(checked, fade)}
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

function PlainLine({ text, tone }: { text: string; tone: TodoLineTone }) {
  if (!text) return null;
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

/** The line at the top (scheduled-tasks ticket 14's condition and fix,
 * as the old 待办 dialog had it): launch at login is off while something
 * is set to go off. Unknown (browser dev, plugin missing) never warns. */
function AutostartHint({ todo }: { todo: AssistantTodo }) {
  const copy = useCopy();
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
  if (!todoAutostartHintVisible(enabled, todo)) return null;
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
  return (
    <div data-role="todo-autostart-hint" className="px-2.5 pb-2">
      <p className="text-[11.5px] leading-[1.45] text-warning">
        {copy.todo.autostartHint}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mt-0.5"
        disabled={pending}
        onClick={turnOn}
      >
        {copy.scheduled.autostartEnable}
      </Button>
      {error && <p className="mt-1 text-[11.5px] text-error">{error}</p>}
    </div>
  );
}
