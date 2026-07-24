import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash, X as XIcon } from "@phosphor-icons/react";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useCopy, useLanguage, type AppCopy } from "@/lib/i18n";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  mintScheduledTaskId,
  updateScheduledTask,
  SCHEDULED_TASKS_CHANGED_EVENT,
  type ScheduledTask,
  type ScheduledTaskRepeat,
} from "@/lib/scheduled-tasks";
import { cn } from "@/lib/utils";
import { useMessagesStore } from "@/stores/messages";
import type { LLMOption } from "@/stores/runtime";
import type { Project, Session } from "@/types/session";

export interface ScheduledTasksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  sessions: Session[];
  /** Models of the active runtime (same list the Composer picker
   * shows). Empty when no bridge has reported yet — the form then
   * only offers "默认模型", which stays correct. */
  llms: LLMOption[];
  /** Open a session (same handler as a Sidebar row click). The dialog
   * closes itself afterwards — the "上次运行 → 会话" jump is the trust
   * loop of the whole feature. */
  onSelectSession: (id: string) => void;
}

interface FormState {
  /** Task id when editing; null = creating. */
  id: string | null;
  prompt: string;
  projectId: string;
  repeatKind: "daily" | "weekly" | "monthly";
  weekdays: number[];
  monthdays: number[];
  timeOfDay: string;
  /** Model display name; "" = runtime default. */
  llmName: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  prompt: "",
  projectId: "",
  repeatKind: "daily",
  weekdays: [],
  monthdays: [],
  timeOfDay: "09:00",
  llmName: "",
};

function repeatSummary(
  copy: AppCopy,
  repeat: ScheduledTaskRepeat,
  timeOfDay: string,
): string {
  switch (repeat.kind) {
    case "daily":
      return copy.scheduled.repeatSummaryDaily(timeOfDay);
    case "weekly":
      return copy.scheduled.repeatSummaryWeekly(
        repeat.weekdays.map((d) => copy.scheduled.weekdayLabel(d)).join("·"),
        timeOfDay,
      );
    case "monthly":
      return copy.scheduled.repeatSummaryMonthly(
        repeat.monthdays.join("·"),
        timeOfDay,
      );
  }
}

/**
 * First-touch teaching surface: three clickable examples covering
 * daily / weekly / monthly and three capability categories a desktop
 * agent excels at — information gathering, local tidying, periodic
 * maintenance. Deliberately NOT coding-agent examples (Galley is a
 * general agent workbench, not a CI timer). Clicking prefills the
 * create form — never creates directly, the user still owns the
 * confirm. Shown only while the task list is empty.
 */
const EXAMPLES: Array<{
  title: (copy: AppCopy) => string;
  prompt: (copy: AppCopy) => string;
  repeat: ScheduledTaskRepeat;
  timeOfDay: string;
}> = [
  {
    title: (c) => c.scheduled.exampleDigestTitle,
    prompt: (c) => c.scheduled.exampleDigestPrompt,
    repeat: { kind: "daily" },
    timeOfDay: "09:00",
  },
  {
    title: (c) => c.scheduled.exampleDownloadsTitle,
    prompt: (c) => c.scheduled.exampleDownloadsPrompt,
    repeat: { kind: "weekly", weekdays: [5] },
    timeOfDay: "17:00",
  },
  {
    title: (c) => c.scheduled.exampleArchiveTitle,
    prompt: (c) => c.scheduled.exampleArchivePrompt,
    repeat: { kind: "monthly", monthdays: [1] },
    timeOfDay: "09:30",
  },
];

function formFromExample(example: (typeof EXAMPLES)[number], copy: AppCopy): FormState {
  return {
    ...EMPTY_FORM,
    prompt: example.prompt(copy),
    repeatKind: example.repeat.kind,
    weekdays: example.repeat.kind === "weekly" ? example.repeat.weekdays : [],
    monthdays:
      example.repeat.kind === "monthly" ? example.repeat.monthdays : [],
    timeOfDay: example.timeOfDay,
  };
}

function repeatFromForm(form: FormState): ScheduledTaskRepeat {
  switch (form.repeatKind) {
    case "daily":
      return { kind: "daily" };
    case "weekly":
      return {
        kind: "weekly",
        weekdays: [...form.weekdays].sort((a, b) => a - b),
      };
    case "monthly":
      return {
        kind: "monthly",
        monthdays: [...form.monthdays].sort((a, b) => a - b),
      };
  }
}

function formDaysValid(form: FormState): boolean {
  if (form.repeatKind === "weekly") return form.weekdays.length > 0;
  if (form.repeatKind === "monthly") return form.monthdays.length > 0;
  return true;
}

const INPUT_CLASS = cn(
  "w-full rounded-sm border border-line bg-app px-3 text-[13px] text-ink",
  "placeholder:text-ink-muted focus:border-line-strong focus:outline-none",
);

/**
 * Scheduled-tasks manager (.scratch/scheduled-tasks issues 03/04).
 * One overlay, two views: the list (rows, not cards — a task is one
 * line of information) and an inline create/edit form. Opened from the
 * sidebar quick-action row; sessions the tasks produce live in the
 * normal timeline, so this surface is management-only and low-frequency.
 */
export function ScheduledTasksDialog({
  open,
  onOpenChange,
  projects,
  sessions,
  llms,
  onSelectSession,
}: ScheduledTasksDialogProps) {
  const copy = useCopy();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    listScheduledTasks()
      .then(setTasks)
      .catch((e) => console.warn("[scheduled] list failed.", e));
  }, []);

  useEffect(() => {
    if (!open) return;
    // Deferred reset (react-hooks/set-state-in-effect convention).
    const t = setTimeout(() => {
      setForm(null);
      setDeleting(null);
      setSubmitting(false);
      reload();
    }, 0);
    // Core emits on every change, including scheduler fires — keep the
    // open dialog live without polling; the DB stays authoritative.
    const unlisten = listen(SCHEDULED_TASKS_CHANGED_EVENT, reload);
    return () => {
      clearTimeout(t);
      void unlisten.then((fn) => fn());
    };
  }, [open, reload]);

  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  const handleSubmit = async () => {
    if (!form || submitting) return;
    const prompt = form.prompt.trim();
    if (!prompt) return;
    if (!formDaysValid(form)) return;
    const repeat = repeatFromForm(form);
    setSubmitting(true);
    try {
      if (form.id === null) {
        await createScheduledTask({
          id: mintScheduledTaskId(),
          projectId: form.projectId || undefined,
          prompt,
          repeat,
          timeOfDay: form.timeOfDay,
          llmName: form.llmName || undefined,
          enabled: true,
        });
      } else {
        await updateScheduledTask(form.id, {
          projectId: form.projectId || null,
          prompt,
          repeat,
          timeOfDay: form.timeOfDay,
          llmName: form.llmName || null,
        });
      }
      setForm(null);
      reload();
    } catch (e) {
      console.warn("[scheduled] save failed.", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col",
            "overflow-hidden rounded-lg border border-line bg-elevated shadow-elevated",
            "max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center justify-between px-5 pb-3 pt-4">
            <div className="flex items-baseline gap-2">
              <Dialog.Title className="text-[16px] font-semibold text-ink">
                {form
                  ? form.id === null
                    ? copy.scheduled.newTask
                    : copy.scheduled.editTask
                  : copy.scheduled.title}
              </Dialog.Title>
              {!form && tasks.length > 0 && (
                <span className="text-[11.5px] text-ink-muted">
                  {copy.scheduled.count(tasks.length)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!form && (
                <IconButton
                  ariaLabel={copy.scheduled.newTask}
                  onClick={() => setForm(EMPTY_FORM)}
                >
                  <Plus size={14} weight="regular" />
                </IconButton>
              )}
              <Dialog.Close asChild>
                <IconButton ariaLabel={copy.common.close} tooltip={false}>
                  <XIcon size={14} weight="thin" />
                </IconButton>
              </Dialog.Close>
            </div>
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
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {tasks.length === 0 ? (
                  <div className="px-3 py-6">
                    <p className="text-center text-[13px] text-ink-soft">
                      {copy.scheduled.empty}
                    </p>
                    <p className="mt-1.5 text-center text-[12px] text-ink-muted">
                      {copy.scheduled.emptyHint}
                    </p>
                    <div className="mt-5 space-y-2">
                      {EXAMPLES.map((example) => (
                        <button
                          key={example.title(copy)}
                          type="button"
                          onClick={() => setForm(formFromExample(example, copy))}
                          className={cn(
                            "w-full rounded-md border border-line px-4 py-3 text-left outline-none",
                            "hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-medium text-ink">
                              {example.title(copy)}
                            </span>
                            <span className="shrink-0 text-[11.5px] text-ink-muted">
                              {repeatSummary(
                                copy,
                                example.repeat,
                                example.timeOfDay,
                              )}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                            {example.prompt(copy)}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 text-center">
                      <Button
                        variant="secondary"
                        leadingIcon={<Plus size={13} weight="regular" />}
                        onClick={() => setForm(EMPTY_FORM)}
                      >
                        {copy.scheduled.newTask}
                      </Button>
                    </div>
                  </div>
                ) : (
                  tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      session={
                        task.lastRunSessionId
                          ? sessionsById.get(task.lastRunSessionId)
                          : undefined
                      }
                      onToggle={(enabled) => {
                        void updateScheduledTask(task.id, { enabled })
                          .then(reload)
                          .catch((e) =>
                            console.warn("[scheduled] toggle failed.", e),
                          );
                      }}
                      onEdit={() =>
                        setForm({
                          id: task.id,
                          prompt: task.prompt,
                          projectId: task.projectId ?? "",
                          repeatKind: task.repeat.kind,
                          weekdays:
                            task.repeat.kind === "weekly"
                              ? task.repeat.weekdays
                              : [],
                          monthdays:
                            task.repeat.kind === "monthly"
                              ? task.repeat.monthdays
                              : [],
                          timeOfDay: task.timeOfDay,
                          llmName: task.llmName ?? "",
                        })
                      }
                      onDelete={() => setDeleting(task)}
                      onOpenSession={(id) => {
                        onSelectSession(id);
                        onOpenChange(false);
                      }}
                    />
                  ))
                )}
              </div>
              <p className="border-t border-line/70 px-5 py-2.5 text-[11.5px] text-ink-muted">
                {copy.scheduled.runsOnlyWhileRunning}
              </p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>

      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        icon={null}
        title={copy.scheduled.deleteTitle}
        body={copy.scheduled.deleteBody}
        confirmLabel={copy.scheduled.delete}
        confirmIcon={<Trash size={13} weight="thin" />}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          void deleteScheduledTask(target.id)
            .then(reload)
            .catch((e) => console.warn("[scheduled] delete failed.", e));
        }}
      />
    </Dialog.Root>
  );
}

function TaskRow({
  task,
  session,
  onToggle,
  onEdit,
  onDelete,
  onOpenSession,
}: {
  task: ScheduledTask;
  session: Session | undefined;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: (id: string) => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const summary = repeatSummary(copy, task.repeat, task.timeOfDay);
  return (
    <div className="group flex items-center gap-3 rounded-sm px-3 py-2.5 hover:bg-hover">
      <Switch
        size="sm"
        checked={task.enabled}
        ariaLabel={copy.scheduled.enableAria(task.prompt)}
        onCheckedChange={onToggle}
      />
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "min-w-0 flex-1 text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-brand/30",
          !task.enabled && "opacity-55",
        )}
        title={copy.scheduled.edit}
      >
        <div className="truncate text-[13px] text-ink">{task.prompt}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
          {summary}
          {task.llmName && <>{" · "}{task.llmName}</>}
          {task.enabled && task.nextFireAt && (
            <>
              {" · "}
              {copy.scheduled.nextFire(formatFireTime(task.nextFireAt, language))}
            </>
          )}
        </div>
      </button>
      <LastRunCell task={task} session={session} onOpenSession={onOpenSession} />
      <IconButton
        ariaLabel={copy.scheduled.delete}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDelete}
      >
        <Trash size={13} weight="thin" />
      </IconButton>
    </div>
  );
}

/** Last-run status column — the trust loop. Fired-with-session links
 * into the session; fired-without-session reads as a failed fire;
 * a dangling session id (deleted) degrades to plain text. */
function LastRunCell({
  task,
  session,
  onOpenSession,
}: {
  task: ScheduledTask;
  session: Session | undefined;
  onOpenSession: (id: string) => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const waitingApproval = useMessagesStore((state) =>
    session
      ? (state.byId[session.id]?.pendingApprovals.length ?? 0) > 0
      : false,
  );

  if (!task.lastFiredAt) {
    return (
      <span className="shrink-0 text-[11.5px] text-ink-muted">
        {copy.scheduled.lastRunNone}
      </span>
    );
  }
  if (!task.lastRunSessionId) {
    return (
      <span className="shrink-0 text-[11.5px] text-warning">
        {copy.scheduled.lastRunFailed}
      </span>
    );
  }
  const label = waitingApproval
    ? copy.scheduled.lastRunWaitingApproval
    : copy.scheduled.lastRun(formatFireTime(task.lastFiredAt, language));
  if (!session) {
    return (
      <span className="shrink-0 text-[11.5px] text-ink-muted">{label}</span>
    );
  }
  const sessionId = session.id;
  return (
    <button
      type="button"
      onClick={() => onOpenSession(sessionId)}
      title={copy.scheduled.openLastRun}
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 text-[11.5px] outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand/30",
        waitingApproval
          ? "text-warning hover:bg-warning/10"
          : "text-ink-soft hover:bg-selected/60 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function TaskForm({
  form,
  projects,
  llms,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: FormState;
  projects: Project[];
  llms: LLMOption[];
  submitting: boolean;
  onChange: (form: FormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const copy = useCopy();
  const daysInvalid = !formDaysValid(form);
  const canSubmit = form.prompt.trim().length > 0 && !daysInvalid && !submitting;
  const dayChipClass = (active: boolean) =>
    cn(
      "size-7 rounded-sm border text-[12px] outline-none",
      "focus-visible:ring-2 focus-visible:ring-brand/30",
      active
        ? "border-brand/40 bg-brand/15 text-brand-strong"
        : "border-line text-ink-soft hover:bg-hover",
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4 px-5 pb-5"
    >
      <Field label={copy.scheduled.promptLabel} required>
        <textarea
          autoFocus
          value={form.prompt}
          onChange={(e) => onChange({ ...form, prompt: e.target.value })}
          placeholder={copy.scheduled.promptPlaceholder}
          rows={3}
          className={cn(INPUT_CLASS, "resize-none py-2 leading-relaxed")}
        />
      </Field>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Field label={copy.scheduled.repeatLabel}>
          <div className="space-y-2">
            <SegmentedControl
              size="sm"
              ariaLabel={copy.scheduled.repeatLabel}
              value={form.repeatKind}
              options={[
                { value: "daily", label: copy.scheduled.repeatDaily },
                { value: "weekly", label: copy.scheduled.repeatWeekly },
                { value: "monthly", label: copy.scheduled.repeatMonthly },
              ]}
              onValueChange={(repeatKind) => onChange({ ...form, repeatKind })}
            />
            {form.repeatKind === "weekly" && (
              <div
                className="flex gap-1"
                role="group"
                aria-label={copy.scheduled.repeatWeekly}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const active = form.weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onChange({
                          ...form,
                          weekdays: active
                            ? form.weekdays.filter((d) => d !== day)
                            : [...form.weekdays, day],
                        })
                      }
                      className={dayChipClass(active)}
                    >
                      {copy.scheduled.weekdayLabel(day)}
                    </button>
                  );
                })}
              </div>
            )}
            {form.repeatKind === "monthly" && (
              <div
                className="grid w-fit grid-cols-7 gap-1"
                role="group"
                aria-label={copy.scheduled.repeatMonthly}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                  const active = form.monthdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        onChange({
                          ...form,
                          monthdays: active
                            ? form.monthdays.filter((d) => d !== day)
                            : [...form.monthdays, day],
                        })
                      }
                      className={dayChipClass(active)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            )}
            {daysInvalid && (
              <p className="text-[11.5px] text-ink-muted">
                {form.repeatKind === "weekly"
                  ? copy.scheduled.weekdaysRequired
                  : copy.scheduled.monthdaysRequired}
              </p>
            )}
            {form.repeatKind === "monthly" &&
              form.monthdays.some((d) => d >= 29) && (
                <p className="text-[11.5px] text-ink-muted">
                  {copy.scheduled.monthlyClampHint}
                </p>
              )}
          </div>
        </Field>

        <Field label={copy.scheduled.timeLabel}>
          <input
            type="time"
            required
            value={form.timeOfDay}
            onChange={(e) =>
              onChange({ ...form, timeOfDay: e.target.value || form.timeOfDay })
            }
            className={cn(INPUT_CLASS, "h-9 w-[110px]")}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Field label={copy.scheduled.projectLabel}>
          <select
            value={form.projectId}
            onChange={(e) => onChange({ ...form, projectId: e.target.value })}
            className={cn(INPUT_CLASS, "h-9 w-[200px] appearance-none pr-8")}
          >
            <option value="">{copy.scheduled.noProject}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={copy.scheduled.modelLabel}>
          <select
            value={form.llmName}
            onChange={(e) => onChange({ ...form, llmName: e.target.value })}
            className={cn(INPUT_CLASS, "h-9 w-[200px] appearance-none pr-8")}
          >
            <option value="">{copy.scheduled.defaultModel}</option>
            {/* A pinned model missing from the current list (deleted /
             * runtime switched) stays visible as its own option so the
             * form doesn't silently rewrite the pin; Core degrades to
             * the default at fire time anyway. */}
            {form.llmName &&
              !llms.some((m) => m.displayName === form.llmName) && (
                <option value={form.llmName}>{form.llmName}</option>
              )}
            {llms.map((m) => (
              <option key={m.key ?? m.displayName} value={m.displayName}>
                {m.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <DialogActionRow className="mt-0 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          {copy.common.cancel}
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {form.id === null ? copy.scheduled.create : copy.common.save}
        </Button>
      </DialogActionRow>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function formatFireTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
