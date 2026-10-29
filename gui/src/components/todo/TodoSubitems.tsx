import { X } from "@phosphor-icons/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  todoFailureText,
  type TodoFailure,
  type TodoSubitem,
} from "@/lib/assistant-todo";
import { caretOffsetAt } from "@/lib/caret-point";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { todoEditWrite, todoSubitemLines } from "@/lib/todo-panel";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoTextEditor } from "./TodoTextEditor";
import { todoTitleClass } from "./todo-styles";

/** An item's words: 13px, as the title, wrapping, never cut. */
const ITEM_TYPE = "text-[13px] leading-5";

/** The box on an item's first line: `ui/checkbox.tsx`'s `sm` (14px), 3px
 * down to sit on the 20px line. */
const BOX_ON_LINE = "mt-[3px]";

/**
 * The items under one of your to-dos, open (main chat ticket 111, PRD
 * ruling 157): between its time line and its notes, a box and the words
 * a line, from the title's start (36px), 「添加一项」 at the foot. The
 * panel says no noun for them (point 5). In the order they were added,
 * the user's and Galley's in one list (point 7); a ticked one stays where
 * it is, its box quiet (`checkedTone="quiet"`, ruling 129 point 1: done
 * asks for nothing, brand is Galley at work) and its words struck in
 * `ink-muted`, as a done to-do's title.
 *
 * Every action is the panel's own, as none needs judging (rulings 91,
 * 153): the box ticks or unticks at once and goes straight to Core, no
 * hold (an item has no reminder a misclick would cancel; a second click
 * takes it back); a click on the words changes them in place, as a
 * title (`TodoTextEditor`); the × on hover or focus deletes it with the
 * five-second undo (`deleteSubitem`); 「添加一项」 opens a box that adds
 * one on Enter and opens the next (`SubitemAdd`). `editable` off (the
 * to-do ticked and holding its place) draws them and does nothing.
 */
export function TodoSubitems({
  todoId,
  items,
  editable,
}: {
  todoId: string;
  /** As the row draws them: deletions waiting left out, ticks on their
   * way in (`todoSubitemsShown`). */
  items: readonly TodoSubitem[];
  editable: boolean;
}) {
  const copy = useCopy();
  const [adding, setAdding] = useState(false);
  return (
    <div data-role="todo-items" className="-mt-1 pb-1.5 pl-9 pr-2.5">
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <SubitemRow
              key={item.id}
              todoId={todoId}
              item={item}
              editable={editable}
            />
          ))}
        </ul>
      )}
      {editable &&
        (adding ? (
          <SubitemAdd todoId={todoId} onClose={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            data-role="todo-add-item"
            onClick={() => setAdding(true)}
            className={cn(
              "block rounded-sm py-0.5 text-left text-[12px] leading-5 text-ink-muted outline-none",
              "hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/30",
            )}
          >
            {copy.todo.addItem}
          </button>
        ))}
    </div>
  );
}

/** An item's words being changed in place. */
interface SubitemEdit {
  /** What the box opened with: nothing is written while it holds it. */
  start: string;
  draft: string;
  caret: number | null;
  phase: "editing" | "saving";
  failure: TodoFailure | null;
  keyboard: boolean;
}

/** One item: its box, its words, the × at the end on hover or focus, and
 * under them why its last tick, change or delete failed. */
function SubitemRow({
  todoId,
  item,
  editable,
}: {
  todoId: string;
  item: TodoSubitem;
  editable: boolean;
}) {
  const copy = useCopy();
  const toggle = useAssistantTodoStore((s) => s.toggleSubitem);
  const deleteSubitem = useAssistantTodoStore((s) => s.deleteSubitem);
  const editSubitem = useAssistantTodoStore((s) => s.editSubitem);
  const failure = useAssistantTodoStore(
    (s) => s.subitemFailures[item.id] ?? null,
  );
  const [edit, setEdit] = useState<SubitemEdit | null>(null);
  if (!editable && edit?.phase === "editing" && !edit.failure) setEdit(null);
  const wordsButton = useRef<HTMLButtonElement>(null);
  // A box closed from the keyboard hands the focus back to the words.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    wordsButton.current?.focus();
  });

  const startEdit = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!editable) return;
    const caret =
      event.detail > 0
        ? caretOffsetAt(event.currentTarget, event.clientX, event.clientY)
        : null;
    setEdit({
      start: item.text,
      draft: item.text,
      caret,
      phase: "editing",
      failure: null,
      keyboard: event.detail === 0,
    });
  };
  const save = (keyboard: boolean) => {
    if (!edit || edit.phase !== "editing") return;
    if (keyboard) refocus.current = true;
    // An item's words are a title's: one line, never empty (emptied, the
    // change is given up; × is for not wanting it).
    const write = todoEditWrite("title", edit.start, edit.draft);
    if (write === null) {
      setEdit(null);
      return;
    }
    setEdit({ ...edit, draft: write, phase: "saving", failure: null });
    void editSubitem(todoId, item.id, write).then((failed) =>
      setEdit((now) => {
        if (now?.phase !== "saving") return now;
        return failed
          ? { ...now, phase: "editing", failure: failed, caret: null }
          : null;
      }),
    );
  };
  // Esc: back to the words, the focus on them.
  const cancel = () => {
    refocus.current = true;
    setEdit(null);
  };

  const editing = editable && edit?.phase === "editing" ? edit : null;
  const words = edit?.phase === "saving" ? edit.draft : item.text;
  const reason = editing?.failure ?? failure;
  return (
    <li
      data-todo-subitem={item.id}
      data-done={item.done ? "" : undefined}
      className="group/subitem relative flex items-start gap-2 py-0.5 pr-6"
    >
      <Checkbox
        size="sm"
        checked={item.done}
        checkedTone="quiet"
        disabled={!editable}
        aria-label={item.text}
        boxClassName={BOX_ON_LINE}
        onCheckedChange={() => toggle(todoId, item)}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <TodoTextEditor
            value={editing.draft}
            onChange={(draft) => setEdit({ ...editing, draft })}
            onSave={save}
            onCancel={cancel}
            multiline={false}
            caret={editing.caret}
            autoFocus={!editing.failure || editing.keyboard}
            ariaLabel={copy.todo.editItem}
            className={cn(ITEM_TYPE, "text-ink")}
          />
        ) : (
          <button
            ref={wordsButton}
            type="button"
            data-role="todo-item-text"
            disabled={!editable}
            onClick={startEdit}
            className={cn(
              "block w-full whitespace-pre-wrap break-words rounded-sm text-left outline-none",
              "focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-default",
              editable && "cursor-text",
              ITEM_TYPE,
              todoTitleClass(item.done),
            )}
          >
            {words}
          </button>
        )}
        {reason && <SubitemFailure kind={reason} />}
      </div>
      {editable && (
        <IconButton
          size="xs"
          ariaLabel={copy.todo.deleteItem}
          onClick={() => deleteSubitem(todoId, item)}
          className={cn(
            "absolute right-0 top-0.5 text-ink-muted opacity-0",
            "group-focus-within/subitem:opacity-100 group-hover/subitem:opacity-100",
          )}
        >
          <X size={12} weight="thin" />
        </IconButton>
      )}
    </li>
  );
}

/**
 * 「添加一项」 open: an empty box (not one to click) and a line to type
 * in, where an item's words go. Enter adds it and opens the next, empty;
 * Enter on nothing, Esc, or a click elsewhere closes it (a click
 * elsewhere with words adds them first). A block of lines pasted is one
 * item a line, blank ones skipped (`todoSubitemLines`). Straight to Core,
 * no confirm; nothing empty is sent. Failed, the words stay in the box
 * and the reason is under it.
 */
function SubitemAdd({
  todoId,
  onClose,
}: {
  todoId: string;
  onClose: () => void;
}) {
  const copy = useCopy();
  const addSubitems = useAssistantTodoStore((s) => s.addSubitems);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<TodoFailure | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Closed by Esc or an empty Enter: the blur as the box goes is not a
  // save.
  const closed = useRef(false);
  const close = () => {
    closed.current = true;
    onClose();
  };

  useLayoutEffect(() => {
    box.current?.focus();
  }, []);
  // As tall as its words, as a title's box.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const add = async (texts: readonly string[], then: "next" | "close") => {
    setSaving(true);
    setFailure(null);
    const failed = await addSubitems(todoId, texts);
    setSaving(false);
    if (failed) {
      setFailure(failed);
      return;
    }
    if (then === "close") {
      close();
      return;
    }
    setDraft("");
    box.current?.focus();
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/\r?\n/.test(pasted)) return;
    event.preventDefault();
    if (saving) return;
    const el = event.currentTarget;
    const lines = todoSubitemLines(
      draft.slice(0, el.selectionStart) + pasted + draft.slice(el.selectionEnd),
    );
    if (lines.length === 0) {
      setDraft("");
      return;
    }
    void add(lines, "next");
  };

  return (
    <div data-role="todo-item-add" className="flex items-start gap-2 py-0.5">
      {/* The box an item will have: empty, not one to click. */}
      <span
        aria-hidden
        className={cn(
          "inline-flex size-3.5 shrink-0 rounded-sm border border-line-strong bg-elevated",
          BOX_ON_LINE,
        )}
      />
      <div className="min-w-0 flex-1">
        <textarea
          ref={box}
          rows={1}
          value={draft}
          readOnly={saving}
          aria-label={copy.todo.newItem}
          spellCheck={false}
          onChange={(event) =>
            setDraft(event.target.value.replace(/\r?\n/g, " "))
          }
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (isImeCompositionKeydown(event)) return;
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (saving) return;
              const words = draft.trim();
              if (!words) close();
              else void add([words], "next");
            }
          }}
          onBlur={() => {
            if (saving || closed.current) return;
            const words = draft.trim();
            if (!words) close();
            else void add([words], "close");
          }}
          className={cn(
            "block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0",
            "text-ink outline-none ring-2 ring-brand/30",
            ITEM_TYPE,
          )}
        />
        {failure && <SubitemFailure kind={failure} />}
      </div>
    </div>
  );
}

/** Why an item's write failed, under it: the tick's two words
 * (「没能完成，再试一次。」, 「这件事已经不在了。」). */
function SubitemFailure({ kind }: { kind: TodoFailure }) {
  const copy = useCopy();
  return (
    <p role="alert" className="mt-0.5 text-[11.5px] leading-[1.45] text-error">
      {todoFailureText(kind, copy)}
    </p>
  );
}
