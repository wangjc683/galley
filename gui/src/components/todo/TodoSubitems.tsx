import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical, Plus, X } from "@phosphor-icons/react";
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
import { TooltipLabel } from "@/components/ui/tooltip";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  todoFailureText,
  todoToastTitle,
  type TodoFailure,
  type TodoSubitem,
} from "@/lib/assistant-todo";
import { caretOffsetAt } from "@/lib/caret-point";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { todoEditWrite, todoSubitemLines } from "@/lib/todo-panel";
import { cn } from "@/lib/utils";
import {
  useAssistantTodoStore,
  type PendingSubitem,
} from "@/stores/assistant-todo";

import { TodoTextEditor } from "./TodoTextEditor";
import { todoTitleClass } from "./todo-styles";

/** An item's words: 13px, as the title, wrapping, never cut. */
const ITEM_TYPE = "text-[13px] leading-5";

/** An item's ink (ticket 112, PRD ruling 158 point 2): not ticked,
 * `ink-soft`, a step under the title, so the title is the open row's one
 * line in full ink (ruling 146: one size, the inks tell the ranks);
 * ticked, a done title's strike in `ink-muted`. */
function itemInk(done: boolean): string {
  return cn(todoTitleClass(done), !done && "text-ink-soft");
}

/** A drag keeps to the list (ticket 112): up and down only, and never
 * past its first or last item (`containerNodeRect` is the dragged row's
 * parent, the list). */
const WITHIN_LIST: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect,
}) => {
  const vertical = { ...transform, x: 0 };
  if (!draggingNodeRect || !containerNodeRect) return vertical;
  const up = containerNodeRect.top - draggingNodeRect.top;
  const down = containerNodeRect.bottom - draggingNodeRect.bottom;
  return { ...vertical, y: Math.min(Math.max(vertical.y, up), down) };
};

/** A pointer drag ends on a pointerup, and the click that follows lands
 * on whatever is under it — the row's blank, which folds the row. Swallow
 * that one click; a keyboard drag has none. */
function swallowTheClickAfter(event: DragEndEvent["activatorEvent"]): void {
  if (typeof KeyboardEvent !== "undefined" && event instanceof KeyboardEvent) {
    return;
  }
  const swallow = (click: MouseEvent) => {
    click.stopPropagation();
    click.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => {
    window.removeEventListener("click", swallow, { capture: true });
  }, 0);
}

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
 * one on Enter and opens the next (`SubitemAdd`): the new one is drawn
 * at once, under the others, while Core writes it (`subitemAdds`), and a
 * refused one comes back into the box, opened again if it had closed.
 * `editable` off (the to-do ticked and holding its place) draws them and
 * does nothing.
 *
 * Since ticket 112 (PRD ruling 158) they are dragged into order: a handle
 * on hover or focus in the column under the to-do's box (`SubitemRow`),
 * Model settings' way (`ConfiguredModelsPanel`): 4px of travel before a
 * pointer drag starts, Space and the arrows from the keyboard, Esc to
 * give up; up and down only, inside the list (`WITHIN_LIST`), the others
 * sliding aside (none under reduced motion). Dropped, the new order is
 * drawn at once and sent (`moveSubitem`); back where it was, nothing.
 * A refused move puts them back, the reason under the list. No handle
 * with one item, on the ones still on their way to Core, or on one whose
 * words are being changed. The items' ink is `ink-soft` (`itemInk`), and
 * 「添加一项」 carries a plus in the box column.
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
  const pending =
    useAssistantTodoStore((s) => s.subitemAdds[todoId]) ?? NO_PENDING;
  const refused = useAssistantTodoStore(
    (s) => s.subitemAddFailures[todoId] !== undefined,
  );
  const moveFailure = useAssistantTodoStore(
    (s) => s.subitemMoveFailures[todoId] ?? null,
  );
  const moveSubitem = useAssistantTodoStore((s) => s.moveSubitem);
  const reduced = usePrefersReducedMotion();
  const [adding, setAdding] = useState(false);
  // An add Core refused: the box opens again to take its words back.
  if (editable && refused && !adding) setAdding(true);
  // Pointer drags need a few px of travel so a click on the handle is
  // never a drag; the keyboard gives the focused handle Space + arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [dragging, setDragging] = useState(false);
  // While a drag is on, Esc is the drag's to give up: the panel takes Esc
  // to fold the row, and must not fold it from under the drag.
  useEffect(() => {
    if (!dragging) return;
    const claim = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [dragging]);
  const ids = items.map((item) => item.id);
  const canDrag = editable && items.length > 1;
  const dropped = ({ active, over, activatorEvent }: DragEndEvent) => {
    setDragging(false);
    swallowTheClickAfter(activatorEvent);
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    moveSubitem(todoId, String(active.id), arrayMove(ids, from, to));
  };
  return (
    <div data-role="todo-items" className="-mt-1 pl-9 pr-2.5">
      {items.length + pending.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[WITHIN_LIST]}
          onDragStart={() => setDragging(true)}
          onDragEnd={dropped}
          onDragCancel={({ activatorEvent }) => {
            setDragging(false);
            swallowTheClickAfter(activatorEvent);
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul>
              {items.map((item) => (
                <SubitemRow
                  key={item.id}
                  todoId={todoId}
                  item={item}
                  editable={editable}
                  canDrag={canDrag}
                  slide={!reduced}
                />
              ))}
              {pending.map((each) => (
                <PendingRow key={each.key} item={each} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {moveFailure && <SubitemFailure kind={moveFailure} />}
      {editable &&
        (adding ? (
          <SubitemAdd todoId={todoId} onClose={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            data-role="todo-add-item"
            onClick={() => setAdding(true)}
            className={cn(
              "flex w-full items-start gap-2 rounded-sm py-0.5 text-left text-[12px] leading-5 text-ink-muted outline-none",
              "hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/30",
            )}
          >
            {/* The plus in the box column, the words where an item's
                start: the list's last line, not the notes' first. */}
            <span
              aria-hidden
              className="flex h-5 w-3.5 shrink-0 items-center justify-center"
            >
              <Plus size={12} weight="regular" />
            </span>
            <span className="min-w-0">{copy.todo.addItem}</span>
          </button>
        ))}
    </div>
  );
}

const NO_PENDING: readonly PendingSubitem[] = [];

/** An item added here and on its way to Core: drawn as it will stand, an
 * empty box and its words, nothing to click until Core has it. */
function PendingRow({ item }: { item: PendingSubitem }) {
  return (
    <li
      data-todo-subitem-pending={item.key}
      className="flex items-start gap-2 py-0.5 pr-6"
    >
      <EmptyBox />
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-soft",
          ITEM_TYPE,
        )}
      >
        {item.text}
      </span>
    </li>
  );
}

/** The box an item will have: empty, not one to click. */
function EmptyBox() {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 rounded-sm border border-line-strong bg-elevated",
        BOX_ON_LINE,
      )}
    />
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
 * under them why its last tick, change or delete failed. Since ticket 112
 * the handle that drags it, on hover or focus, in the column under the
 * to-do's box (its centre under that box's: the row's 10px and half the
 * box's 16px; 8px from the item's box), the items where they were;
 * dragged, the row is lifted (`bg-elevated`, over the others). */
function SubitemRow({
  todoId,
  item,
  editable,
  canDrag,
  slide,
}: {
  todoId: string;
  item: TodoSubitem;
  editable: boolean;
  /** More than one item, the to-do not holding a tick. */
  canDrag: boolean;
  /** The others slide aside (off under reduced motion: they swap). */
  slide: boolean;
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
  // Not while its words are being changed.
  const draggable = canDrag && edit === null;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !draggable,
    ...(slide ? {} : { transition: null }),
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-todo-subitem={item.id}
      data-done={item.done ? "" : undefined}
      className={cn(
        "group/subitem relative flex items-start gap-2 py-0.5 pr-6",
        isDragging && "z-10 rounded-sm bg-elevated",
      )}
    >
      {draggable && (
        // 28px from the row's 8px to the item's box, so the pointer on
        // its way from the words to the handle never leaves the row.
        <span className="absolute -left-7 top-0.5 flex h-5 w-7 items-center">
          <TooltipLabel text={copy.todo.dragItem(todoToastTitle(item.text))}>
            <button
              ref={setActivatorNodeRef}
              type="button"
              data-role="todo-item-handle"
              aria-label={copy.todo.dragItem(item.text)}
              className={cn(
                "flex size-5 shrink-0 touch-none items-center justify-center rounded-sm outline-none",
                "text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30",
                isDragging
                  ? "cursor-grabbing opacity-100"
                  : "cursor-grab opacity-0 focus-visible:opacity-100 group-focus-within/subitem:opacity-100 group-hover/subitem:opacity-100",
              )}
              {...attributes}
              {...listeners}
            >
              <DotsSixVertical size={13} weight="bold" />
            </button>
          </TooltipLabel>
        </span>
      )}
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
            className={cn(ITEM_TYPE, "text-ink-soft")}
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
              itemInk(item.done),
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
 * in, where an item's words go. Enter adds it and clears the line for the
 * next: the item is drawn at once and Core writes it behind, each to-do's
 * adds in the order typed, so nothing typed meanwhile is lost; Enter on
 * nothing, Esc, or a click elsewhere closes it (a click elsewhere with
 * words adds them first). A block of lines pasted is one item a line,
 * blank ones skipped (`todoSubitemLines`). No confirm; nothing empty is
 * sent. Refused, the item leaves the list and its words come back into
 * the line, in front of anything typed since, with the reason under it
 * (`subitemAddFailures`, taken once by its nonce).
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
  const takeFailure = useAssistantTodoStore((s) => s.takeSubitemAddFailure);
  const refused = useAssistantTodoStore((s) => s.subitemAddFailures[todoId]);
  const [draft, setDraft] = useState(() => refused?.texts.join(" ") ?? "");
  const [reason, setReason] = useState<TodoFailure | null>(
    refused?.kind ?? null,
  );
  const [taken, setTaken] = useState<number | null>(refused?.nonce ?? null);
  if (refused && refused.nonce !== taken) {
    setTaken(refused.nonce);
    setDraft([refused.texts.join(" "), draft.trim()].filter(Boolean).join(" "));
    setReason(refused.kind);
  }
  // Taken: off the store's record, so it comes back only once.
  useEffect(() => {
    if (taken !== null) takeFailure(todoId, taken);
  }, [taken, takeFailure, todoId]);
  const box = useRef<HTMLTextAreaElement>(null);
  // Closed by Esc or an empty Enter: the blur as the box goes is not a
  // save.
  const closed = useRef(false);
  const close = () => {
    closed.current = true;
    onClose();
  };

  useLayoutEffect(() => {
    // Opened again for a refused add while another box has the caret:
    // that one keeps it.
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement
    ) {
      return;
    }
    box.current?.focus();
  }, []);
  // As tall as its words, as a title's box.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const add = (texts: readonly string[]) => {
    setReason(null);
    void addSubitems(todoId, texts);
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/\r?\n/.test(pasted)) return;
    event.preventDefault();
    const el = event.currentTarget;
    const lines = todoSubitemLines(
      draft.slice(0, el.selectionStart) + pasted + draft.slice(el.selectionEnd),
    );
    setDraft("");
    if (lines.length > 0) add(lines);
  };

  return (
    <div data-role="todo-item-add" className="flex items-start gap-2 py-0.5">
      <EmptyBox />
      <div className="min-w-0 flex-1">
        <textarea
          ref={box}
          rows={1}
          value={draft}
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
              const words = draft.trim();
              if (!words) {
                close();
                return;
              }
              setDraft("");
              add([words]);
            }
          }}
          onBlur={() => {
            if (closed.current) return;
            const words = draft.trim();
            if (words) add([words]);
            close();
          }}
          className={cn(
            "block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0",
            "text-ink-soft outline-none ring-2 ring-brand/30",
            ITEM_TYPE,
          )}
        />
        {reason && <SubitemFailure kind={reason} />}
      </div>
    </div>
  );
}

/** Why an item's write failed, under it — or a move, under the list
 * (ticket 112): the tick's two words (「没能完成，再试一次。」,
 * 「这件事已经不在了。」). */
function SubitemFailure({ kind }: { kind: TodoFailure }) {
  const copy = useCopy();
  return (
    <p role="alert" className="mt-0.5 text-[11.5px] leading-[1.45] text-error">
      {todoFailureText(kind, copy)}
    </p>
  );
}
