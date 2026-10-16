import { ListChecks } from "@phosphor-icons/react";

// TEMP variant switcher (main chat 42): comparison A, the row's form.
import { useTodoVariants } from "@/components/todo/todo-variants/todo-variants";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

/** Selected while the panel is on screen (the sidebar's selected
 * channels: fill, lift, full ink); at rest the rows' stepped-back ink
 * and the hover fill. Selected, it still answers the pointer — a click
 * closes the panel — one hover step deeper, as the new-chat row does. */
function rowFill(selected: boolean): string {
  return selected
    ? "bg-selected text-ink shadow-[var(--shadow-selected)] hover:bg-(--color-selected-hover)"
    : "text-ink-soft hover:bg-hover hover:text-ink";
}

const PRESS =
  "transition-none active:translate-y-px active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * 「待办」 under Galley's card (main chat ticket 42, PRD ruling 91 point
 * 5): on the chrome above the strong line, with the card. A click opens
 * the to-do panel beside the main chat — landing on Galley first from
 * anywhere else — and, with the panel on screen, closes it; the row is
 * selected while the panel shows. On the right only 「今天 N」, the
 * to-dos due today or overdue (Core's `todayCount`), nothing at 0: no
 * total and no badge, a badge being for what needs handling
 * (2026-07-30) and the card's own badge already counting a subtask
 * asking or failing.
 *
 * Three forms on the temporary pill (todo-variants.ts, comparison A):
 * A1 a one-line row on the list's grid, A2 small text under the card
 * from its text column, A3 a one-line row on the card's grid.
 */
export function SidebarTodoRow({
  selected,
  onToggle,
}: {
  /** The panel is on screen. */
  selected: boolean;
  onToggle: () => void;
}) {
  const copy = useCopy();
  const todayCount = useAssistantTodoStore((s) => s.todo.todayCount);
  // TEMP variant switcher (main chat 42): comparison A.
  const variant = useTodoVariants((s) => s.row);
  const today = todayCount > 0 ? copy.sidebar.todoToday(todayCount) : null;
  const label = today ? `${copy.sidebar.todo} · ${today}` : copy.sidebar.todo;
  const common = {
    type: "button" as const,
    "data-role": "sidebar-todo-row",
    "data-variant": variant,
    "aria-label": label,
    "aria-expanded": selected,
    onClick: onToggle,
  };

  if (variant === "A2") {
    // Small text tucked under the card, from its text column: the
    // card's mx-1.5 6 + px-3 12 + avatar 40 + gap-2.5 10 = 68px, less
    // this button's own px-1.5.
    return (
      <button
        {...common}
        className={cn(
          "ml-[62px] mr-1.5 flex h-6 w-[calc(100%-68px)] items-center gap-1.5 rounded-sm px-1.5 text-left text-[12px]",
          PRESS,
          rowFill(selected),
        )}
      >
        <ListChecks size={13} weight="thin" className="shrink-0" />
        <span className="min-w-0 truncate">
          {copy.sidebar.todo}
          {today && (
            <span className="tabular-nums text-ink-muted">{` · ${today}`}</span>
          )}
        </span>
      </button>
    );
  }

  if (variant === "A3") {
    // The card's grid: the icon centred in the avatar's 40px column,
    // 「待办」 on the name's 68px edge, the count on the time's right
    // edge; the card's corner radius.
    return (
      <button
        {...common}
        className={cn(
          "mx-1.5 mt-0.5 flex h-8 w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-3 text-left text-[13px]",
          PRESS,
          rowFill(selected),
        )}
      >
        <span className="flex w-10 shrink-0 justify-center">
          <ListChecks size={16} weight="thin" />
        </span>
        <span className="min-w-0 flex-1 truncate">{copy.sidebar.todo}</span>
        {today && (
          <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
            {today}
          </span>
        )}
      </button>
    );
  }

  // A1: the list's grid (layout-and-chrome.md 「侧栏网格」): the icon in a
  // 16px column centred on 26px, the text from 42px, the count's right
  // edge on the 18px line; a one-line row's 32px and corner.
  return (
    <button
      {...common}
      className={cn(
        "mx-1.5 mt-0.5 flex h-8 w-[calc(100%-12px)] items-center gap-2 rounded-sm px-3 text-left text-[13px]",
        PRESS,
        rowFill(selected),
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">
        <ListChecks size={15} weight="thin" />
      </span>
      <span className="min-w-0 flex-1 truncate">{copy.sidebar.todo}</span>
      {today && (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
          {today}
        </span>
      )}
    </button>
  );
}
