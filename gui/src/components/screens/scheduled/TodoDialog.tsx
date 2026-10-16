import * as Dialog from "@radix-ui/react-dialog";
import {
  CaretRight,
  Pause,
  PencilSimple,
  Play,
  X,
} from "@phosphor-icons/react";
import { listen } from "@tauri-apps/api/event";
import {
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useEffect, useRef, useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  cancelScheduledTask,
  EMPTY_TODO,
  listAssistantTodo,
  todoActionFailure,
  todoAutostartHintVisible,
  todoBadge,
  todoCanCancel,
  todoCanEdit,
  todoCanPause,
  todoCanResume,
  legacyTodoGroups,
  todoIsEmpty,
  todoRowTarget,
  todoStateLabel,
  todoTimeLabel,
  TODO_REFRESH_EVENTS,
  type AssistantTodo,
  type TodoItem,
  type TodoTarget,
} from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  formDaysValid,
  formFromTask,
  listScheduledTasks,
  repeatFromForm,
  updateScheduledTask,
  type ScheduledTaskFormState,
} from "@/lib/scheduled-tasks";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import type { LLMOption } from "@/stores/runtime";
import type { Project } from "@/types/session";

import { TaskForm } from "./ScheduledTasksDialog";

export interface TodoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** For the form a task the user made opens in. */
  projects: Project[];
  llms: LLMOption[];
  /** Jump to the reply a reminder was set in and light it up (the
   * 查找聊天记录 jump, main chat ticket 28). */
  onOpenReply: (sessionId: string, messageId: string) => void;
  /** Open a session: a subtask (as its card's 「打开」 does), or the
   * session a scheduled run made. */
  onOpenSession: (sessionId: string) => void;
  /** 「去跟 Galley 说」: open the assistant, its composer focused. */
  onTalk: () => void;
}

/** How long the list waits after a Core event before reading again: a
 * burst (a run's turns, a fire and its delivery) reads once. */
const REFRESH_DEBOUNCE_MS = 150;

/**
 * The assistant's 待办 (main chat ticket 37, PRD ruling 86): the managed
 * runtime's second masthead icon and ⌘K open it in place of 定时
 * (`ScheduledTasksDialog`, which the external runtime keeps as it was).
 * Same shell and size as that dialog; the content is the assistant's
 * to-do list from Core (`list_assistant_todo`):
 *
 *   接下来     tasks still to come, soonest first — cancel; pause /
 *             resume a repeating one; edit one the user made in the form
 *   在办       subtasks it handed off and that have not finished
 *   最近做完   the last seven days, folded, with its count
 *
 * A row is time · words · mark · state. Clicking it goes where the thing
 * came from: the reply a reminder was set in (the 查找聊天记录 jump), the
 * subtask, the session a scheduled run made, or the form; a task another
 * agent made, or made outside a reply, goes nowhere. There is no 「新建」:
 * the user asks the assistant (main chat PRD ruling 84). Empty, a line
 * and an example, and a button to go and say it.
 */
export function TodoDialog({
  open,
  onOpenChange,
  projects,
  llms,
  onOpenReply,
  onOpenSession,
  onTalk,
}: TodoDialogProps) {
  const copy = useCopy();
  const [form, setForm] = useState<ScheduledTaskFormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Closing to talk to the assistant: its composer takes the caret, not
  // the masthead icon Radix would hand focus back to.
  const talking = useRef(false);

  useEffect(() => {
    if (!open) return;
    // Deferred reset (react-hooks/set-state-in-effect convention).
    const t = setTimeout(() => {
      setForm(null);
      setSubmitting(false);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const handleSubmit = async () => {
    if (!form || form.id === null || submitting) return;
    const prompt = form.prompt.trim();
    if (!prompt || !formDaysValid(form)) return;
    setSubmitting(true);
    try {
      await updateScheduledTask(form.id, {
        projectId: form.projectId || null,
        prompt,
        repeat: repeatFromForm(form),
        timeOfDay: form.timeOfDay,
        llmName: form.llmName || null,
      });
      setForm(null);
    } catch (e) {
      console.warn("[todo] save failed.", e);
    } finally {
      setSubmitting(false);
    }
  };

  const go = (target: TodoTarget) => {
    switch (target.kind) {
      case "edit":
        openForm(target.taskId, setForm);
        return;
      case "reply":
        onOpenChange(false);
        onOpenReply(target.sessionId, target.messageId);
        return;
      case "subtask":
      case "session":
        onOpenChange(false);
        onOpenSession(target.sessionId);
        return;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            if (!talking.current) return;
            talking.current = false;
            e.preventDefault();
          }}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 flex w-[920px] -translate-x-1/2 -translate-y-1/2 flex-col",
            "overflow-hidden rounded-lg border border-line bg-elevated shadow-elevated",
            "max-h-[min(680px,calc(100vh-64px))] max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center justify-between px-5 pb-3 pt-4">
            <Dialog.Title className="text-[16px] font-semibold text-ink">
              {form ? copy.scheduled.editTask : copy.todo.title}
            </Dialog.Title>
            <DialogCloseButton />
          </div>
          {form ? (
            <TaskForm
              form={form}
              projects={projects}
              llms={llms}
              submitting={submitting}
              onChange={setForm}
              onCancel={() => setForm(null)}
              onSubmit={() => void handleSubmit()}
            />
          ) : (
            <TodoBody
              onGo={go}
              onTalk={() => {
                talking.current = true;
                onOpenChange(false);
                onTalk();
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Open the form for a task the user made: the list carries no form
 * fields, so read the task. */
function openForm(
  taskId: string,
  setForm: (form: ScheduledTaskFormState) => void,
): void {
  listScheduledTasks()
    .then((tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      const form = task ? formFromTask(task) : null;
      if (form) setForm(form);
    })
    .catch((e) => console.warn("[todo] read for edit failed.", e));
}

/** The list, read while it is on screen (it mounts with the dialog's
 * content and goes with it): once, then again on the events that change
 * it, debounced. */
function useAssistantTodo(): { todo: AssistantTodo; loaded: boolean } {
  const [todo, setTodo] = useState<AssistantTodo>(EMPTY_TODO);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisteners: (() => void)[] = [];
    const load = () => {
      listAssistantTodo()
        .then((next) => {
          if (cancelled) return;
          setTodo(next);
          setLoaded(true);
        })
        .catch((e) => console.warn("[todo] list failed.", e));
    };
    const soon = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, REFRESH_DEBOUNCE_MS);
    };
    load();
    for (const event of TODO_REFRESH_EVENTS) {
      void listen(event, soon).then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    }
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      for (const fn of unlisteners) fn();
    };
  }, []);
  return { todo, loaded };
}

function TodoBody({
  onGo,
  onTalk,
}: {
  onGo: (target: TodoTarget) => void;
  onTalk: () => void;
}) {
  const { todo, loaded } = useAssistantTodo();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <AutostartHint todo={todo} />
      <TodoGroups todo={todo} loaded={loaded} onGo={onGo} onTalk={onTalk} />
    </div>
  );
}

/** The three groups, or the empty state once the list has been read.
 * Core's four groups come in (ticket 39); this dialog draws its three
 * from them and no to-dos (`legacyTodoGroups`) until ticket 42. */
export function TodoGroups({
  todo,
  loaded,
  onGo,
  onTalk,
  defaultRecentOpen = false,
}: {
  todo: AssistantTodo;
  loaded: boolean;
  onGo: (target: TodoTarget) => void;
  onTalk: () => void;
  /** 最近做完 starts folded. */
  defaultRecentOpen?: boolean;
}) {
  const copy = useCopy();
  const groups = legacyTodoGroups(todo);
  const [recentOpen, setRecentOpen] = useState(defaultRecentOpen);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, true>>({});

  const act = (item: TodoItem, run: () => Promise<unknown>) => {
    if (busy[item.id]) return;
    setBusy((b) => ({ ...b, [item.id]: true }));
    setErrors(({ [item.id]: _dropped, ...rest }) => rest);
    // The row updates itself on Core's `scheduled-tasks:changed`.
    run()
      .catch((e: unknown) =>
        setErrors((errs) => ({
          ...errs,
          [item.id]: todoActionFailure(e, copy),
        })),
      )
      .finally(() => setBusy(({ [item.id]: _done, ...rest }) => rest));
  };
  const rowProps = {
    errors,
    busy,
    onGo,
    onCancel: (item: TodoItem) => act(item, () => cancelScheduledTask(item.id)),
    onSetEnabled: (item: TodoItem, enabled: boolean) =>
      act(item, () => updateScheduledTask(item.id, { enabled })),
  };

  return (
    <>
      {loaded && todoIsEmpty(groups) ? (
        <div className="px-3 py-8 text-center">
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
      ) : (
        <>
          {groups.upcoming.length > 0 && (
            <section data-todo-group="upcoming">
              <GroupLabel
                label={copy.todo.groupUpcoming}
                count={groups.upcoming.length}
              />
              {groups.upcoming.map((item) => (
                <TodoRow key={`u:${item.id}`} item={item} {...rowProps} />
              ))}
            </section>
          )}
          {groups.active.length > 0 && (
            <section data-todo-group="active">
              <GroupLabel
                label={copy.todo.groupActive}
                count={groups.active.length}
              />
              {groups.active.map((item) => (
                <TodoRow key={`a:${item.id}`} item={item} {...rowProps} />
              ))}
            </section>
          )}
          {groups.recent.length > 0 && (
            <section data-todo-group="recent">
              <GroupLabel
                label={copy.todo.groupRecent}
                count={groups.recent.length + groups.recentOmitted}
                open={recentOpen}
                onToggle={() => setRecentOpen((o) => !o)}
              />
              {recentOpen && (
                <>
                  {groups.recent.map((item) => (
                    <TodoRow key={`r:${item.id}`} item={item} {...rowProps} />
                  ))}
                  {groups.recentOmitted > 0 && (
                    <p className="px-3 py-2 text-[12px] text-ink-muted">
                      {copy.todo.recentOmitted(groups.recentOmitted)}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

/** The line at the top (scheduled-tasks ticket 14's condition and fix):
 * launch at login is off while something is set to go off. Unknown
 * (browser dev, plugin missing) never warns. */
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
    <div data-role="todo-autostart-hint" className="px-3 pb-1">
      <div className="flex items-center gap-2">
        <p className="text-[11.5px] text-warning">{copy.todo.autostartHint}</p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={pending}
          onClick={turnOn}
        >
          {copy.scheduled.autostartEnable}
        </Button>
      </div>
      {error && <p className="mt-1 text-[11.5px] text-error">{error}</p>}
    </div>
  );
}

/** A group's label: the sidebar's section register (10px, uppercase in
 * English, muted), its count on the right. 最近做完 folds: the whole
 * label toggles it, a caret past the count. */
function GroupLabel({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const register =
    "flex w-full items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted";
  if (!onToggle) {
    return (
      <div className={cn(register, "mt-2")}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 tabular-nums normal-case tracking-normal">
          {count}
        </span>
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
        "mt-2",
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "outline-none hover:bg-hover hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5 tabular-nums normal-case tracking-normal">
        {count}
        <CaretRight
          size={9}
          weight="thin"
          className={cn(
            "opacity-70 transition-transform duration-(--motion-fast)",
            open && "rotate-90",
          )}
        />
      </span>
    </button>
  );
}

/** The state's tone: what needs the user (asking) in warning, a failure
 * in error, work in progress in brand, the rest muted — the subtask
 * card's line tones. */
const STATE_TONES: Partial<Record<TodoItem["state"], string>> = {
  asking: "font-medium text-warning",
  failed: "font-medium text-error",
  running: "text-brand-strong/85",
};

function TodoRow({
  item,
  errors,
  busy,
  onGo,
  onCancel,
  onSetEnabled,
}: {
  item: TodoItem;
  errors: Record<string, string>;
  busy: Record<string, true>;
  onGo: (target: TodoTarget) => void;
  onCancel: (item: TodoItem) => void;
  onSetEnabled: (item: TodoItem, enabled: boolean) => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const target = todoRowTarget(item);
  const badge = todoBadge(item, copy);
  const text = item.text || (item.kind === "subtask" ? copy.subtask.label : "");
  const settled = item.state === "fired" || item.state === "done";
  const pending = busy[item.id] === true;

  const content = (
    <>
      <span
        className={cn(
          "w-[136px] shrink-0 truncate text-[12.5px] tabular-nums",
          settled ? "text-ink-muted" : "text-ink-soft",
        )}
      >
        {todoTimeLabel(item, todayStartMs, language, copy)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          settled ? "text-ink-soft" : "text-ink",
        )}
        onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, text)}
      >
        {text}
      </span>
      {badge && (
        <span
          title={badge.title}
          className="shrink-0 rounded-sm border border-line px-1.5 text-[10.5px] leading-4 text-ink-muted"
        >
          {badge.label}
        </span>
      )}
      <span
        className={cn(
          "w-[96px] shrink-0 truncate text-right text-[12px]",
          STATE_TONES[item.state] ?? "text-ink-muted",
        )}
      >
        {todoStateLabel(item, copy)}
      </span>
    </>
  );

  const actions = [
    todoCanEdit(item) && (
      <IconButton
        key="edit"
        ariaLabel={copy.todo.edit}
        onClick={() => onGo({ kind: "edit", taskId: item.id })}
      >
        <PencilSimple size={13} weight="thin" />
      </IconButton>
    ),
    todoCanPause(item) && (
      <IconButton
        key="pause"
        ariaLabel={copy.todo.pause}
        disabled={pending}
        onClick={() => onSetEnabled(item, false)}
      >
        <Pause size={13} weight="thin" />
      </IconButton>
    ),
    todoCanResume(item) && (
      <IconButton
        key="resume"
        ariaLabel={copy.todo.resume}
        disabled={pending}
        onClick={() => onSetEnabled(item, true)}
      >
        <Play size={13} weight="thin" />
      </IconButton>
    ),
    todoCanCancel(item) && (
      <IconButton
        key="cancel"
        ariaLabel={copy.todo.cancel}
        disabled={pending}
        onClick={() => onCancel(item)}
      >
        <X size={13} weight="thin" />
      </IconButton>
    ),
  ].filter(Boolean);

  return (
    <div data-todo-row={item.id} data-todo-state={item.state}>
      <div className="group flex items-center gap-1 rounded-sm px-1 hover:bg-hover">
        {target ? (
          <button
            type="button"
            onClick={() => onGo(target)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-sm px-2 py-2 text-left outline-none",
              "focus-visible:ring-2 focus-visible:ring-brand/30",
            )}
          >
            {content}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">
            {content}
          </div>
        )}
        {/* Quiet until the row is hovered or a button is focused, as
            the 定时 rows' run-now and delete. Every row keeps the slot
            of three, so the states line up in one column across the
            groups. */}
        <div className="flex w-[84px] shrink-0 items-center justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      </div>
      {errors[item.id] && (
        <p
          role="alert"
          className="px-3 pb-1.5 text-[11.5px] leading-[1.45] text-error"
        >
          {errors[item.id]}
        </p>
      )}
    </div>
  );
}
