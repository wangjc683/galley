import { ListChecks } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * 「待办」 in the top bar (main chat ticket 45, PRD ruling 93): the first
 * of the tool cluster, before Changes, in every conversation's top bar
 * while there is a main chat (ticket 46, ruling 95; Galley's own until
 * then; MainHeaderHost). It opens the to-do panel beside the
 * conversation on screen and closes it again — the Changes
 * button's grammar (ChangesToggleButton): a pressed toggle, `bg-selected`
 * while its panel is open, a different material from the hover around
 * it.
 *
 * The list icon the sidebar row had (ticket 42), 16px thin as the
 * cluster's. Beside it N, the to-dos due today or overdue (Core's
 * `todayCount`), as plain text in the button's own ink: not a badge — a
 * badge is for what needs handling (2026-07-30), and colour in the top
 * bar is for warnings, errors and invitations — and nothing at 0. The
 * tooltip and the accessible name say what N counts.
 *
 * The icon and N only, no word: JC picked this form (D1) over the icon,
 * 「待办」 and N (D2) on the real app, 2026-10-17 (ruling 93 point 6).
 */

export function TodoToggleButton({
  open,
  onToggle,
}: {
  /** The panel is on screen. */
  open: boolean;
  onToggle: () => void;
}) {
  const copy = useCopy().topbar;
  const todayCount = useAssistantTodoStore((s) => s.todo.todayCount);
  const count = todayCount > 0 ? todayCount : null;
  const label = count ? copy.todoWithToday(count) : copy.todo;
  return (
    <TooltipLabel text={label}>
      <TopBarIconButton
        data-role="topbar-todo"
        aria-label={label}
        aria-pressed={open}
        className={cn(
          // A count widens the 28px square from its left edge: the icon
          // stays where the square has it.
          count && "w-auto gap-1 px-[5px]",
          // "Panel is open" is a selected state, not a hover (the
          // Changes button's channels, 2026-08-21).
          "aria-pressed:border-line aria-pressed:bg-selected aria-pressed:text-ink",
        )}
        onClick={onToggle}
      >
        <ListChecks size={16} weight="thin" className="shrink-0" />
        {count && (
          <span className="text-[12px] leading-none tabular-nums">{count}</span>
        )}
      </TopBarIconButton>
    </TooltipLabel>
  );
}
