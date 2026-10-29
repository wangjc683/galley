import {
  BellSimpleSlash,
  ChatTeardropText,
  Clock,
  PauseCircle,
  Plus,
  Repeat,
  X,
} from "@phosphor-icons/react";
import {
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { ReadingPanelHeader } from "@/components/conversation/reading/ReadingPanelHeader";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useDayStamp } from "@/hooks/useDayStamp";
import { revealInList, useTodoPanelFlash } from "@/hooks/useTodoPanelFlash";
import {
  todoAutostartHintVisible,
  todoFailureText,
  type AssistantTodo,
  type TodoFailure,
  type TodoItem,
  type TodoTarget,
} from "@/lib/assistant-todo";
import { caretOffsetAt } from "@/lib/caret-point";
import { useCopy, useLanguage } from "@/lib/i18n";
import { StatusIcon } from "@/lib/status-icon";
import {
  assistantRowLine,
  assistantTaskCancellable,
  doneRowLine,
  routineRowLine,
  todoChecked,
  todoEditWrite,
  todoMetaParts,
  type TodoMetaPart,
  todoNotedLine,
  todoNotesLine,
  todoPanelEmpty,
  todoPanelRows,
  todoReminderCancellable,
  todoRowsInDone,
  todoRowText,
  todoSubitemCount,
  todoSubitemsShown,
  todoTitleTarget,
  todoWithoutDeleting,
  type TodoHold,
  type TodoLineTone,
  type TodoWordsField,
  yourTodos,
} from "@/lib/todo-panel";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";
import {
  goToTodoTarget,
  quoteTodo,
  talkToGalley,
  type TodoSpot,
} from "@/lib/todo-open";
import {
  readAutostartHintClosed,
  writeAutostartHintClosed,
} from "@/lib/todo-panel-memory";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore, type TodoPanelPage } from "@/stores/ui";

import { GroupLabel } from "./GroupLabel";
import { MemoPage } from "./MemoPage";
import { TodoCheck } from "./TodoCheck";
import { TodoMetaText } from "./TodoMetaText";
import {
  TodoRowContextMenu,
  TodoRowMenuButton,
  type TodoRowMenuModel,
} from "./TodoRowMenu";
import { TodoSubitems } from "./TodoSubitems";
import { TodoTextEditor } from "./TodoTextEditor";
import { todoTitleClass } from "./todo-styles";

export interface TodoPanelProps {
  /** The main chat, wherever the panel is (ticket 46): titles jump into
   * it, 「说说这件」 quotes into its composer. */
  mainChatId: string;
  /** Where the panel is open: beside Galley itself, or elsewhere — from
   * where a jump to Galley opens it first — in which conversation, and
   * whether the main area is narrow, where it is a look (ticket 87,
   * lib/todo-open.ts). */
  spot: TodoSpot;
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
 * notebook, where the user can tick off their own things and, since
 * ticket 107, change the words of one opened — new things and new times
 * are said to Galley (ruling 91 points 3 and 6, ruling 153 point 5), so
 * there is no box for a new one here. In the reading
 * panel's place (LocalFileWorkspace), its own width, beside whichever
 * conversation is open (ticket 46, ruling 95): looking is for anywhere,
 * noting and changing stay with Galley.
 *
 *   (no label)  the user's to-dos not done, one part at the top in
 *               Core's order — overdue, today, later by day, no time
 *               (ticket 86, ruling 130): a box, the title, when it is
 *               due and its reminder, its notes (ticket 80)
 *   Galley 在办  its subtasks and the one-off tasks it will come back
 *               to: no box, the session rows' status glyphs
 *   例行         repeating tasks: the rule and the next time
 *   已完成       the last seven days, folded, with its count: ticked
 *               to-dos (their box in neutral grey), reminders that went
 *               off, subtasks back
 *
 * Empty groups are not drawn; with nothing in any, the empty state is
 * (`todoPanelEmpty`). The daily review is in none of them: the store
 * keeps the list without it (`withoutDailyReview`, PRD ruling 145). The
 * actions are only these: tick and untick the user's own (TodoCheck),
 * cancel a to-do's reminder or one of Galley's own one-off reminders
 * (ticket 80), delete one of the user's own not done (ticket 88, its
 * row's ⋯ and right-click menu, TodoRowMenu) — where the panel is — and
 * on hover 「说说这件」, which quotes the title into the main chat's
 * composer and keeps the panel open. A deleted to-do leaves at once and
 * Core hears of it when its undo toast goes (stores/assistant-todo.ts);
 * meanwhile the panel draws the list without it (`todoWithoutDeleting`).
 * A title goes where the thing came from: the reply that noted it
 * (the 查找聊天记录 jump), a subtask, a scheduled run's session — but
 * on your to-dos not done, which open (below). A jump out of the panel
 * takes the panel along (lib/todo-open.ts). Escape closes it from
 * anywhere but a text field, as it does the reading panel; with a row
 * open it folds the row first.
 *
 * One of your to-dos not done opens in place on a click (main chat
 * ticket 107, PRD ruling 153 points 2–4; `YourRow`): one at a time, its
 * title and notes in full and changed in place, its time a way to
 * Galley, its foot the day it was noted and 「在对话里查看」 — the jump
 * its title made before. Which one is open is this panel's own state
 * (`openId`), not remembered: closed and opened again, or turned to 备忘
 * and back, none is. It folds on Esc (out of a text box), on a click in
 * the panel outside it that is not on a control, on a click on its own
 * blank, and when it leaves your to-dos (ticked, held by Galley's tick,
 * deleted). A to-do card's title opens its row (`todoRowRequest.open`).
 *
 * Since main chat ticket 111 (PRD ruling 157) one of your to-dos may have
 * items under it: folded, its time line ends with their count
 * (「2/5 项」); open, they are drawn between the time line and the notes,
 * each ticked, changed or deleted in place, 「添加一项」 at their foot
 * (TodoSubitems). Nothing else in the panel names or counts them.
 *
 * Rows light up (ticket 87, PRD ruling 131 points 3–5,
 * useTodoPanelFlash): what Galley moves while the panel is on screen,
 * and the row a card's title points at. A to-do Galley ticks off holds
 * where it stood, ticked, before it goes to 已完成.
 *
 * Two pages since ticket 97 (PRD ruling 142 point 5, 甲), in the
 * header's title's place: 「待办」 and 「备忘」 (MemoPage: what Galley
 * noted about you), on a SegmentedControl since ticket 99 (ruling 144
 * point 3, `PanelPages`), the same place and the same ways in and out, no new
 * container — to-dos are actions, memos information, and the two
 * sections the main chat reads at each segment's start are these two
 * pages. 「+」 and × stay, on both. Every opening lands on 待办 but a
 * memo card's words, which ask for 备忘 (`todoPageRequest`); ⌘K's
 * 「待办」 asks for 待办, so it also turns the page back. The page is
 * this panel's own state: closed and opened again, it is 待办 —
 * nothing remembers it, neither this machine nor Core.
 */
export function TodoPanel({
  mainChatId,
  spot,
  onOpenSession,
  onTalk,
  onClose,
  defaultDoneOpen = false,
}: TodoPanelProps) {
  const copy = useCopy();
  const pageRequest = useUiStore((s) => s.todoPageRequest);
  const [page, setPage] = useState<TodoPanelPage>(pageRequest?.page ?? "todo");
  // The row open (ticket 107): one of your to-dos not done, or none.
  const [openId, setOpenId] = useState<string | null>(null);
  const turnPage = (next: TodoPanelPage) => {
    setPage(next);
    setOpenId(null);
  };
  const [pageAsked, setPageAsked] = useState(pageRequest);
  if (pageRequest !== pageAsked) {
    setPageAsked(pageRequest);
    if (pageRequest) turnPage(pageRequest.page);
  }
  useEffect(() => {
    if (pageRequest) {
      useUiStore.getState().clearTodoPageRequest(pageRequest.nonce);
    }
  }, [pageRequest]);
  const pageId = useId();
  const listed = useAssistantTodoStore((s) => s.todo);
  const deleting = useAssistantTodoStore((s) => s.deleting);
  // The rows deleted here wait off the panel for their undo (ticket 88).
  const todo = todoWithoutDeleting(listed, deleting);
  const loaded = useAssistantTodoStore((s) => s.loaded);
  const list = useRef<HTMLDivElement>(null);
  const { held, request } = useTodoPanelFlash(list);
  // A row a request lights only under 已完成: it unfolds first.
  const revealDone =
    request && todoRowsInDone(todo, request.ids) ? request.nonce : null;
  // A card's title opens its row too, when it is one of yours not done
  // (ticket 107): taken once per request, as the page request is.
  const yours = yourTodos(todo);
  const [openAsked, setOpenAsked] = useState<number | null>(null);
  let opening: string | null = null;
  if (request?.open && request.nonce !== openAsked) {
    setOpenAsked(request.nonce);
    const id = request.ids[0];
    if (id !== undefined && yours.some((item) => item.id === id)) {
      opening = id;
      setOpenId(id);
    }
  }
  // Ticked off and gone to 已完成 (yours after its hold, Galley's at
  // once: held where it stood, it is no longer yours), deleted, gone:
  // the row folds, and does not open again if it comes back.
  const asked = opening ?? openId;
  const shownOpen =
    asked !== null && yours.some((item) => item.id === asked) ? asked : null;
  if (opening === null && shownOpen !== openId) setOpenId(null);

  // Esc folds the open row first, then closes the panel; never from a
  // text box (the row's own box takes it to give up first).
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
      if (shownOpen !== null) setOpenId(null);
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, shownOpen]);

  // An opened row out of view scrolls just into it, a frame after it is
  // drawn open.
  useEffect(() => {
    if (shownOpen === null) return;
    const frame = requestAnimationFrame(() => {
      const scroller = list.current;
      const row = Array.from(
        scroller?.querySelectorAll<HTMLElement>("[data-todo-row]") ?? [],
      ).find((each) => each.dataset.todoRow === shownOpen);
      if (scroller && row) revealInList(scroller, row);
    });
    return () => cancelAnimationFrame(frame);
  }, [shownOpen]);

  // A click in the panel outside the open row folds it, but on a control
  // (which does its own thing) or another of your rows (which opens
  // itself). A menu's portal is not in the panel.
  const onPanelClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (shownOpen === null) return;
    const target = event.target as Element;
    if (!event.currentTarget.contains(target)) return;
    const row = target.closest<HTMLElement>("[data-todo-row]");
    if (row?.dataset.todoRow === shownOpen) return;
    if (row?.hasAttribute("data-todo-openable")) return;
    if (target.closest(ROW_CONTROLS)) return;
    setOpenId(null);
  };

  const go = (target: TodoTarget) =>
    goToTodoTarget(target, spot, mainChatId, onOpenSession);
  const talkAbout = (item: TodoItem) =>
    quoteTodo(item, spot, mainChatId, todoRowText(item, copy));
  const talk = () => talkToGalley(spot, mainChatId, onTalk);

  return (
    <div
      role="region"
      aria-label={copy.todo.title}
      data-role="todo-panel"
      className="flex h-full min-h-0 min-w-0 flex-col bg-app"
      onClick={onPanelClick}
    >
      <ReadingPanelHeader
        title={<PanelPages page={page} onPage={turnPage} pageId={pageId} />}
        // The way to a new one (main chat ticket 89, PRD ruling 133 point
        // 3): new to-dos are still said, not typed — the panel has no
        // input box, as a new one needs judging (when, whether to remind,
        // a to-do or Galley's own reminder, the same as one already
        // there) — but only the empty state had 「跟 Galley 说」, so beside
        // a workbench conversation with things on the list there was no
        // way to Galley from here. An icon in the header's action group,
        // as the file preview's: in sight however long the list, taking
        // none of it. A row at the list's foot read as one more item
        // (JC's dogfood, 10-22). A plus, the common sign for a new one:
        // a talk bubble here sat right under the top bar's Channels lamp
        // (`ChatCircleText`) and read as the same thing. Its name says
        // where it leads, and it puts the caret in Galley's composer
        // (`talkToGalley`), nothing prefilled.
        // Both centred on the pages' control (ticket 99): its track is
        // taller than they are, its segments as tall.
        actions={
          <IconButton
            ariaLabel={copy.todo.emptyTalk}
            className="self-center"
            onClick={talk}
          >
            <Plus size={16} weight="thin" />
          </IconButton>
        }
        close={
          <IconButton
            ariaLabel={copy.common.close}
            tooltip={false}
            className="self-center"
            onClick={onClose}
          >
            <X size={14} weight="thin" />
          </IconButton>
        }
      />
      {/* Keyed by its page: each page starts at its top. */}
      <div
        key={page}
        ref={list}
        id={pageId}
        data-todo-page={page}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4 pt-2"
      >
        {page === "memo" ? (
          <MemoPage mainChatId={mainChatId} onGo={go} />
        ) : (
          <>
            {loaded && todoPanelEmpty(todo) && <TodoPanelEmpty onTalk={talk} />}
            {/* Empty, or before the first read, this draws no group. */}
            <TodoPanelGroups
              todo={todo}
              mainChatId={mainChatId}
              onGo={go}
              onTalkAbout={talkAbout}
              defaultDoneOpen={defaultDoneOpen}
              held={held}
              revealDone={revealDone}
              openId={shownOpen}
              onOpen={setOpenId}
            />
            <AutostartHint todo={todo} />
          </>
        )}
      </div>
    </div>
  );
}

const PAGES: readonly TodoPanelPage[] = ["todo", "memo"];

/**
 * The header's two pages (ticket 99, PRD ruling 144 point 3): the shared
 * SegmentedControl, md, as the app's small set of exclusive choices is
 * drawn everywhere (docs/design/foundations.md) — a track, the page shown
 * raised on it. Ticket 97 had set two words in the title's type; JC: not
 * enough like buttons. The control's own roles stand (a radio group, a
 * radio each), and the arrow keys ticket 97's tabs had are kept here:
 * either one turns the page and takes the focus along. Hugging its
 * segments (`self-start`), not stretched across the title's column.
 */
function PanelPages({
  page,
  onPage,
  pageId,
}: {
  page: TodoPanelPage;
  onPage: (page: TodoPanelPage) => void;
  pageId: string;
}) {
  const copy = useCopy();
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = page === "todo" ? "memo" : "todo";
    onPage(next);
    event.currentTarget
      .querySelectorAll<HTMLElement>('[role="radio"]')
      [PAGES.indexOf(next)]?.focus();
  };
  return (
    <SegmentedControl<TodoPanelPage>
      size="md"
      ariaLabel={copy.memo.tabsLabel}
      value={page}
      options={PAGES.map((of) => ({
        value: of,
        label: of === "todo" ? copy.todo.title : copy.memo.tab,
      }))}
      onValueChange={onPage}
      onKeyDown={onKeyDown}
      aria-controls={pageId}
      data-role="todo-panel-pages"
      className="self-start"
    />
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

const NO_HOLDS: readonly TodoHold[] = [];

/** The groups, empty ones not drawn. */
export function TodoPanelGroups({
  todo,
  mainChatId,
  onGo,
  onTalkAbout,
  defaultDoneOpen = false,
  held = NO_HOLDS,
  revealDone = null,
  openId = null,
  onOpen = () => {},
}: {
  todo: AssistantTodo;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  onTalkAbout: (item: TodoItem) => void;
  defaultDoneOpen?: boolean;
  /** To-dos Galley ticked off, held where they stood a moment (ticket
   * 87). */
  held?: readonly TodoHold[];
  /** A request's nonce when a row it lights is under 已完成: unfold it
   * (ticket 87). */
  revealDone?: number | null;
  /** The one of your to-dos open (ticket 107), and opening or folding
   * one (`null`). */
  openId?: string | null;
  onOpen?: (id: string | null) => void;
}) {
  const copy = useCopy();
  const [doneOpen, setDoneOpen] = useState(
    defaultDoneOpen || revealDone !== null,
  );
  const [revealed, setRevealed] = useState(revealDone);
  if (revealDone !== revealed) {
    setRevealed(revealDone);
    if (revealDone !== null) setDoneOpen(true);
  }
  const rowProps = { mainChatId, onGo, onTalkAbout };
  // The user's to-dos are the list's own: one part at the top with no
  // label (main chat PRD ruling 98: a list kept for you doesn't tag
  // yours as yours; only Galley's are set apart), and since ticket 86
  // (ruling 130) not split by time either — beside Apple's Reminders
  // the rows were as tall, and the room went to labels. Core's three
  // lists end to end, not sorted again: overdue (soonest due first),
  // today (by time, a day without one after), later by day, no time in
  // the order noted. Each row says its day, 「今天 18:00」 too. A to-do
  // Galley ticked off holds its place among them a moment (ticket 87).
  const rows = todoPanelRows(todo, held);
  const yours = rows.yours;
  // 12px between groups, none over the first (main chat ticket 83,
  // ruling 128 point 9): a gap between the sections, whichever are
  // drawn.
  return (
    <div data-role="todo-groups" className="space-y-3">
      {yours.length > 0 && (
        <section data-todo-group="yours">
          {yours.map((item) => (
            <YourRow
              key={item.id}
              item={item}
              held={rows.holding.has(item.id)}
              open={item.id === openId}
              onOpenChange={(open) => onOpen(open ? item.id : null)}
              {...rowProps}
            />
          ))}
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
      {rows.done.length > 0 && (
        <section data-todo-group="done">
          <GroupLabel
            label={copy.todo.groupDone}
            count={rows.done.length + todo.doneOmitted}
            open={doneOpen}
            onToggle={() => setDoneOpen((open) => !open)}
          />
          {doneOpen && (
            <>
              {rows.done.map((item) => (
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

interface RowProps {
  item: TodoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  onTalkAbout: (item: TodoItem) => void;
}

/** What in the panel does its own thing on a click: a row's box (its
 * label and input), its buttons, a text box, a link, a menu's row. A
 * click there neither opens nor folds a row (ticket 107). */
const ROW_CONTROLS = 'button, input, textarea, label, a, [role="menuitem"]';

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
 *
 * With a `menu` (your to-dos, ticket 88) the actions end with its ⋯
 * and a right-click on the row opens the same menu; while either is
 * open the row stays as the hover left it — its actions in sight, the
 * title still giving way, the hover ground — as a sidebar row does while
 * its ⋯ is open. `menuOff` (a row ticked and holding its place) takes
 * the ⋯ away and opens nothing on a right-click, with the row's tree as
 * it was: a tick does not mount the row afresh.
 *
 * Your to-dos not done open (ticket 107, `YourRow`): they bring their
 * own `title`, a click on the row (`onRowClick`), and, `open`, the
 * selected ground (`bg-selected`, the sidebar's selected row's, no
 * border or shadow) and the actions in sight at the end of the title's
 * first line, the title giving way to them all the way down; `foot`
 * goes under the notes.
 */
function RowShell({
  item,
  mainChatId,
  onGo,
  leading,
  titleClass,
  title: ownTitle,
  line,
  notes,
  foot,
  actions,
  menu,
  menuOff = false,
  failure,
  open = false,
  onRowClick,
}: {
  item: TodoItem;
  mainChatId: string;
  onGo: (target: TodoTarget) => void;
  leading: ReactNode;
  titleClass?: string;
  /** The row's own title in place of the jump button (ticket 107). */
  title?: ReactNode;
  line?: ReactNode;
  notes?: ReactNode;
  foot?: ReactNode;
  actions?: ReactNode[];
  menu?: TodoRowMenuModel;
  menuOff?: boolean;
  failure?: string | null;
  open?: boolean;
  onRowClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const copy = useCopy();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuShown = menu !== undefined && !menuOff;
  // A menu taken away while open (Galley ticked the row off meanwhile)
  // is not open when it comes back.
  if (!menuShown && (dropdownOpen || contextOpen)) {
    setDropdownOpen(false);
    setContextOpen(false);
  }
  const menuOpen = menuShown && (dropdownOpen || contextOpen);
  const target = todoTitleTarget(item, mainChatId);
  const text = todoRowText(item, copy);
  const shown = [
    ...(actions ?? []).filter(Boolean),
    ...(menu && menuShown
      ? [
          <TodoRowMenuButton
            key="menu"
            model={menu}
            open={dropdownOpen}
            onOpenChange={setDropdownOpen}
          />,
        ]
      : []),
  ];
  const title = ownTitle ? (
    ownTitle
  ) : target ? (
    <button
      type="button"
      onClick={() => onGo(target)}
      onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, text)}
      className={cn(
        "block max-w-full truncate rounded-sm text-left outline-none",
        "underline-offset-2 hover:underline hover:decoration-ink-muted/60 focus-visible:ring-2 focus-visible:ring-brand/30",
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
  const row: ReactElement = (
    <div
      data-todo-row={item.id}
      data-todo-kind={item.kind}
      data-todo-state={item.state}
      data-todo-openable={onRowClick ? "" : undefined}
      data-todo-open={open ? "" : undefined}
      onClick={onRowClick}
      className={cn(
        "group/todo-row rounded-sm",
        open ? "bg-selected" : "hover:bg-hover",
        menuOpen && !open && "bg-hover",
      )}
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
            (menuOpen || open) && (shown.length > 1 ? "pr-[60px]" : "pr-8"),
          )}
        >
          <div className="text-[13px] leading-5">{title}</div>
          {line}
        </div>
        {shown.length > 0 && (
          <div
            className={cn(
              // Open, the title may run to several lines: the actions
              // stay by its first (28px buttons on its 20px line).
              "absolute right-1.5 flex items-center gap-0.5",
              open
                ? "top-0.5 opacity-100"
                : "inset-y-0 opacity-0 group-focus-within/todo-row:opacity-100 group-hover/todo-row:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            {shown}
          </div>
        )}
      </div>
      {notes}
      {foot}
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
  if (!menu) return row;
  return (
    <TodoRowContextMenu
      model={menu}
      disabled={!menuShown}
      onOpenChange={setContextOpen}
    >
      {row}
    </TodoRowContextMenu>
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
 * precise targets side by side make the row's hover loud). Since ticket
 * 88 (PRD ruling 132 point 3) the ⋯ after 「说说这件」 is that second
 * target, ruling 85's way in to 删除: its menu, and the row's
 * right-click, hold 说说这件, 在对话里查看 (ticket 107), 取消提醒 and 删除.
 * Not on a row ticked and holding its place (yours, or Galley's tick,
 * ticket 87): that one is on its way to 已完成, where no row has it.
 *
 * Since ticket 107 (PRD ruling 153 points 2–4) a click anywhere on it
 * but its box and its buttons opens it — its title is no longer the
 * jump; still a button, Enter or Space opens it (`aria-expanded`) — and
 * a click on its blank folds it; a row ticked and holding does not open.
 * Open, folded the same otherwise:
 *
 *   the box and the title     the title whole, wrapped; a click changes
 *                             it in place
 *   when it is due            a button: 「说说这件」 (「改时间跟 Galley
 *                             说」), the time is said, not set here
 *   the notes                 whole, their own lines kept; a click
 *                             changes them; none: 「添加备注」
 *   「10月28日记下 · 在对话里查看」 the day it was noted, and the jump
 *
 * A title or the notes in their box (`TodoTextEditor`): saved straight
 * to Core (`editTodo`), no confirm; nothing written when the words are
 * as they opened (`todoEditWrite`), an emptied title given up. Failed,
 * the box is back with the words and the reason under it, Esc giving up
 * back to what Core has; folded meanwhile, the reason is under the row
 * and the box is back on opening. A box open with nothing failed goes
 * when the row folds. */
function YourRow({
  held = false,
  open = false,
  onOpenChange = () => {},
  ...props
}: RowProps & {
  /** Galley ticked it off: held where it stood a moment, ticked as a
   * tick of yours holds, the box still (ticket 87). */
  held?: boolean;
  /** Open (ticket 107): one row of yours at a time. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { item, mainChatId, onGo, onTalkAbout } = props;
  const copy = useCopy();
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const cancelReminder = useAssistantTodoStore((s) => s.cancelReminder);
  const deleteTodo = useAssistantTodoStore((s) => s.deleteTodo);
  const editTodo = useAssistantTodoStore((s) => s.editTodo);
  const { flip, failure, cancelling } = useTodoWrite(item.id);
  const subitemTicks = useAssistantTodoStore((s) => s.subitemTicks);
  const subitemDeleting = useAssistantTodoStore((s) => s.subitemDeleting);
  const checked = held || todoChecked(item, flip);
  const parts = todoMetaParts(item, checked, todayStartMs, language, copy);
  // The items under it (ticket 111): as drawn, their count on the time
  // line folded or open.
  const subitems = todoSubitemsShown(item, subitemTicks, subitemDeleting);
  const count = todoSubitemCount(subitems, copy);
  const canCancelReminder = !checked && todoReminderCancellable(item);
  const notes = todoNotesLine(item);
  const target = todoTitleTarget(item, mainChatId);
  const editable = open && !checked;

  const [edit, setEdit] = useState<TodoEdit | null>(null);
  // Folded, or ticked, with a box open and nothing failed in it: the box
  // goes (a failed one waits for the row to open again).
  if (!editable && edit?.phase === "editing" && !edit.failure) setEdit(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const notesButton = useRef<HTMLButtonElement>(null);
  // A box closed from the keyboard hands the focus back to its words.
  const refocus = useRef<TodoWordsField | null>(null);
  useEffect(() => {
    const field = refocus.current;
    if (!field) return;
    // Once: a row that stopped being editable meanwhile has no words to
    // take it, and must not take it later.
    refocus.current = null;
    (field === "title" ? titleButton.current : notesButton.current)?.focus();
  });

  const startEdit = (
    field: TodoWordsField,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    if (!editable) return;
    const start = field === "title" ? item.text : (notes?.full ?? "");
    // The caret where the click was; from the keyboard (no pointer), at
    // the end.
    const caret =
      event.detail > 0
        ? caretOffsetAt(event.currentTarget, event.clientX, event.clientY)
        : null;
    setEdit({
      field,
      start,
      draft: start,
      caret,
      phase: "editing",
      failure: null,
      keyboard: event.detail === 0,
    });
  };
  const save = (keyboard: boolean) => {
    if (!edit || edit.phase !== "editing") return;
    const field = edit.field;
    if (keyboard) refocus.current = field;
    const write = todoEditWrite(field, edit.start, edit.draft);
    if (write === null) {
      setEdit(null);
      return;
    }
    setEdit({
      ...edit,
      draft: write,
      phase: "saving",
      failure: null,
      keyboard,
    });
    void editTodo(
      item.id,
      field === "title" ? { title: write } : { notes: write },
    ).then((failed) =>
      setEdit((now) => {
        if (now?.field !== field || now.phase !== "saving") return now;
        return failed
          ? { ...now, phase: "editing", failure: failed, caret: null }
          : null;
      }),
    );
  };
  const cancel = () => {
    if (edit) refocus.current = edit.field;
    setEdit(null);
  };
  const editing = (field: TodoWordsField): TodoEdit | null =>
    editable && edit?.field === field && edit.phase === "editing" ? edit : null;
  const shownWords = (field: TodoWordsField, words: string): string =>
    edit?.field === field && edit.phase === "saving" ? edit.draft : words;

  const titleEdit = editing("title");
  const title = titleEdit ? (
    <>
      <TodoTextEditor
        value={titleEdit.draft}
        onChange={(draft) => setEdit({ ...titleEdit, draft })}
        onSave={save}
        onCancel={cancel}
        multiline={false}
        caret={titleEdit.caret}
        autoFocus={!titleEdit.failure || titleEdit.keyboard}
        ariaLabel={copy.todo.editTitle}
        className={todoTitleClass(false)}
      />
      {titleEdit.failure && <EditFailure kind={titleEdit.failure} />}
    </>
  ) : (
    <button
      ref={titleButton}
      type="button"
      aria-expanded={open}
      onClick={(event) => {
        if (open) startEdit("title", event);
        else if (!checked) onOpenChange(true);
      }}
      onPointerEnter={(e) =>
        syncTruncatedTitle(e.currentTarget, todoRowText(item, copy))
      }
      className={cn(
        "block max-w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        open ? "break-words" : "truncate",
        editable && "cursor-text",
        todoTitleClass(checked),
      )}
    >
      {shownWords("title", todoRowText(item, copy))}
    </button>
  );

  const notesEdit = editing("notes");
  const notesWords = shownWords("notes", notes?.full ?? "");
  let notesBlock: ReactNode = null;
  if (!open) {
    notesBlock = notes && <NotesLine text={notes.text} full={notes.full} />;
  } else if (notesEdit) {
    notesBlock = (
      <OpenNotes>
        <TodoTextEditor
          value={notesEdit.draft}
          onChange={(draft) => setEdit({ ...notesEdit, draft })}
          onSave={save}
          onCancel={cancel}
          multiline
          caret={notesEdit.caret}
          autoFocus={!notesEdit.failure || notesEdit.keyboard}
          ariaLabel={copy.todo.editNotes}
          className={NOTES_TYPE}
        />
        {notesEdit.failure && <EditFailure kind={notesEdit.failure} />}
      </OpenNotes>
    );
  } else if (editable) {
    notesBlock = (
      <OpenNotes>
        <button
          ref={notesButton}
          type="button"
          data-role={notesWords ? "todo-notes" : "todo-add-notes"}
          onClick={(event) => startEdit("notes", event)}
          className={cn(
            "block w-full cursor-text whitespace-pre-wrap break-words rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            NOTES_TYPE,
          )}
        >
          {notesWords || copy.todo.addNotes}
        </button>
      </OpenNotes>
    );
  } else if (notesWords) {
    notesBlock = (
      <OpenNotes>
        <p
          data-role="todo-notes"
          className={cn("whitespace-pre-wrap break-words", NOTES_TYPE)}
        >
          {notesWords}
        </p>
      </OpenNotes>
    );
  }

  // Open, the items go between the time line and the notes (ticket 111):
  // there whether it has any or not, 「添加一项」 at their foot.
  if (open) {
    notesBlock = (
      <>
        <TodoSubitems todoId={item.id} items={subitems} editable={editable} />
        {notesBlock}
      </>
    );
  }

  const noted = open ? todoNotedLine(item, todayStartMs, language, copy) : null;
  const foot =
    open && (noted || target) ? (
      <div
        data-role="todo-noted"
        className="pb-1.5 pl-9 pr-2.5 text-[12px] leading-[1.4] text-ink-muted"
      >
        {noted}
        {noted && target && " · "}
        {target && (
          <button
            type="button"
            onClick={() => onGo(target)}
            className={cn(
              "rounded-sm text-ink-soft underline decoration-ink-muted/60 underline-offset-2 outline-none",
              "hover:text-ink hover:decoration-ink focus-visible:ring-2 focus-visible:ring-brand/30",
            )}
          >
            {copy.todo.viewInChat}
          </button>
        )}
      </div>
    ) : null;

  const menu: TodoRowMenuModel = {
    canCancelReminder,
    onTalkAbout: () => onTalkAbout(item),
    onViewInChat: target ? () => onGo(target) : undefined,
    onCancelReminder: () => cancelReminder(item.id),
    onDelete: () => deleteTodo(item),
  };
  // Open, a failed save says why under its box; folded, under the row.
  const editFailure = !open && edit?.failure ? edit.failure : null;
  const rowFailure = editFailure ?? failure;
  return (
    <RowShell
      {...props}
      leading={
        <TodoCheck
          item={item}
          checked={checked}
          saving={held || flip?.phase === "saving"}
        />
      }
      titleClass={todoTitleClass(checked)}
      title={title}
      line={
        <MetaLine
          parts={parts}
          checked={checked}
          count={count}
          onTalk={open ? () => onTalkAbout(item) : undefined}
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
      notes={notesBlock}
      foot={foot}
      actions={[<TalkAbout key="talk" item={item} onTalkAbout={onTalkAbout} />]}
      menu={menu}
      menuOff={checked}
      failure={rowFailure && todoFailureText(rowFailure, copy)}
      open={open}
      onRowClick={(event) => {
        const hit = event.target as Element;
        // A menu's row (its portal) is not on the row; a control does
        // its own thing.
        if (!event.currentTarget.contains(hit)) return;
        if (hit.closest(ROW_CONTROLS)) return;
        if (open) onOpenChange(false);
        else if (!checked) onOpenChange(true);
      }}
    />
  );
}

/** A title or the notes of an open to-do being changed in place
 * (ticket 107). */
interface TodoEdit {
  field: TodoWordsField;
  /** What the box opened with: nothing is written while it holds it. */
  start: string;
  /** What is in the box. */
  draft: string;
  /** Where the caret lands as the box appears; null at the end. */
  caret: number | null;
  /** `saving`: on its way to Core, its words drawn as they will stand. */
  phase: "editing" | "saving";
  /** Why the last save failed: the box back, the words in it. */
  failure: TodoFailure | null;
  /** From the keyboard: a box back after a failure takes the focus (one
   * left by a click elsewhere does not take it back from there). */
  keyboard: boolean;
}

/** The notes' type: 12px `ink-muted` (ruling 146), folded or open. */
const NOTES_TYPE = "text-[12px] leading-[1.4] text-ink-muted";

/** An open to-do's notes, or 「添加备注」, where the folded line sits: at
 * the title's start, 2px under the line above. */
function OpenNotes({ children }: { children: ReactNode }) {
  return <div className="-mt-1 pb-1 pl-9 pr-2.5">{children}</div>;
}

/** Why a title or notes did not save, under their box: the tick's two
 * words (「没能完成，再试一次。」, 「这件事已经不在了。」). */
function EditFailure({ kind }: { kind: TodoFailure }) {
  const copy = useCopy();
  return (
    <p role="alert" className="mt-1 text-[11.5px] leading-[1.45] text-error">
      {todoFailureText(kind, copy)}
    </p>
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
 * A to-do's notes folded (ticket 80, ruling 128 point 5): 12px
 * `ink-muted`, one line, cut, its breaks and runs of space one space;
 * cut, the hover gives them in full, as a title's does — open, they are
 * whole (ticket 107, `OpenNotes`). Under the second line, or the
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
        className={cn("truncate", NOTES_TYPE)}
        onPointerEnter={(e) => syncTruncatedTitle(e.currentTarget, full)}
      >
        {text}
      </p>
    </div>
  );
}

/** A to-do's second line: when it is due (warning when overdue) and the
 * reminder, a bell and its time (ruling 97: the day it was noted is not
 * on it), and `after` it the reminder's cancel, on hover — outside what
 * the line cuts, so a narrow row cuts the words, never the button.
 * `ink-soft`, a step over the notes' `ink-muted` (main chat PRD ruling
 * 146): the title, when, then what to bring, in the three inks; ticked
 * and holding its place it goes `ink-muted` with the struck title. With
 * `onTalk` (an open row, ticket 107, PRD ruling 153 point 5) the words
 * are a button, 「改时间跟 Galley 说」 on hover, that does 「说说这件」:
 * the time is said to Galley, not set here. None drawn without a time.
 *
 * `count` (main chat ticket 111, PRD ruling 157 point 6): how many of the
 * items under it are ticked, 「2/5 项」, at the line's end before `after`,
 * 8px from the time as the bell's part is set apart, no 「·」; the line's
 * own ink, never warning (that is overdue's), the digits tabular. Outside
 * the open row's time button: it is not a time to say to Galley. With no
 * time it is the line alone, the notes under it as ever. */
function MetaLine({
  parts,
  checked,
  count = null,
  after,
  onTalk,
}: {
  parts: readonly TodoMetaPart[];
  checked: boolean;
  count?: string | null;
  after?: ReactNode;
  onTalk?: () => void;
}) {
  const copy = useCopy();
  if (parts.length === 0 && !count) return null;
  return (
    <div
      data-role="todo-meta"
      className={cn(
        "mt-0.5 flex min-w-0 items-center text-[12px] leading-[1.4] tabular-nums",
        checked ? "text-ink-muted" : "text-ink-soft",
      )}
    >
      {parts.length === 0 ? null : onTalk ? (
        <TooltipLabel text={copy.todo.timeTalkHint}>
          <button
            type="button"
            data-role="todo-meta-talk"
            onClick={onTalk}
            className="min-w-0 truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <TodoMetaText parts={parts} />
          </button>
        </TooltipLabel>
      ) : (
        <span className="min-w-0 truncate">
          <TodoMetaText parts={parts} />
        </span>
      )}
      {count && (
        <span
          data-role="todo-item-count"
          className={cn(
            "shrink-0 whitespace-nowrap",
            parts.length > 0 && "ml-2",
          )}
        >
          {count}
        </span>
      )}
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

/**
 * 已完成: what Core lists there since ticket 82 — the user's ticked
 * to-dos, Galley's one-off reminders that went off, subtasks that came
 * back (a routine's fires stay out). A to-do keeps its box, ticked in
 * neutral grey, not brand (unticking it brings it back); a subtask and
 * a reminder their kind's glyph, the title in `ink-muted` as a ticked
 * to-do's (main chat ticket 84, ruling 129 point 2: B).
 */
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
            // Only done to-dos are listed here: the box quiet once ticked.
            checkedTone="quiet"
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
        ) : (
          <Clock size={14} weight="thin" className="text-ink-muted" />
        )
      }
      titleClass="text-ink-muted"
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
