import { ListChecks } from "@phosphor-icons/react";

// TEMP variant switcher (main-chat 45): the button's form, D1 or D2.
import { useTodoButtonVariant } from "@/components/todo/todo-button-variant/todo-button-variant";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * Galley's 「待办」 in its own top bar (main chat ticket 45, PRD ruling
 * 93): the first of the tool cluster, before Changes, there only while
 * the main chat itself is on screen (MainHeaderHost). It opens the to-do
 * panel beside the conversation and closes it again — the Changes
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
 * Two forms on the temporary pill (todo-button-variant.ts): D1 the icon
 * and N; D2 the icon, 「待办」 and N. D2's word gives way first on a
 * narrow header (`WORD_DISPLAY`), and the button falls back to D1; the
 * icon and N never do.
 */

/**
 * TEMP variant switcher (main-chat 45): where D2's word shows, as
 * container-query classes against the `@container/main-header` that
 * MainHeader sets while this button is there. The query reads the
 * header's content box: the main area's width less the header's pr-3
 * on macOS (Windows / Linux have none; their window controls are
 * inside it). Threshold = what the content box needs with the word in
 * the busiest common state, so that while the word shows Galley's
 * identity is never cut for it: 浏览器控制 · 待解锁 and an update badge
 * in the status cluster, Changes in the tool cluster, a two-digit N,
 * and the identity's longest second line (子任务在问你 / A subtask is
 * asking you). Measured in Chrome with the app's fonts:
 *   left   pl 10 + sidebar toggle 28 + gap 6 + identity (6 + 102 zh /
 *          159.7 en + 8) + pr 12          = 172 zh / 229.7 en
 *   right  status + divider + tools, D2   = 462.6 zh / 514.9 en
 *   mac    left + right                   = 634.6 -> 640 / 744.6 -> 750
 *   other  + window controls 138          = 772.6 -> 780 / 882.6 -> 890
 * (a main area of 652 / 762px on macOS). Below it the word goes and the
 * button is D1's, 40–48px with N; the icon and N never go. With no room
 * left after that, the identity's second line fades out, then its name
 * — as it gave way without this button, only the button's width
 * sooner. With the default 20%
 * sidebar the main area is 767px on the narrowest window (960) and
 * 1183px on the default one (1480).
 */
const WORD_DISPLAY = isMac
  ? {
      zh: "hidden @min-[640px]/main-header:inline",
      en: "hidden @min-[750px]/main-header:inline",
    }
  : {
      zh: "hidden @min-[780px]/main-header:inline",
      en: "hidden @min-[890px]/main-header:inline",
    };
export function TodoToggleButton({
  open,
  onToggle,
}: {
  /** The panel is on screen. */
  open: boolean;
  onToggle: () => void;
}) {
  const copy = useCopy().topbar;
  const language = useLanguage();
  const todayCount = useAssistantTodoStore((s) => s.todo.todayCount);
  // TEMP variant switcher (main-chat 45): D1 or D2.
  const variant = useTodoButtonVariant((s) => s.variant);
  const word = variant === "D2";
  const count = todayCount > 0 ? todayCount : null;
  const label = count ? copy.todoWithToday(count) : copy.todo;
  return (
    <TooltipLabel text={label}>
      <TopBarIconButton
        data-role="topbar-todo"
        data-variant={variant}
        aria-label={label}
        aria-pressed={open}
        className={cn(
          // A word or a count widens the 28px square from its left edge:
          // the icon stays where the square has it.
          (word || count) && "w-auto gap-1 px-[5px]",
          // "Panel is open" is a selected state, not a hover (the
          // Changes button's channels, 2026-08-21).
          "aria-pressed:border-line aria-pressed:bg-selected aria-pressed:text-ink",
        )}
        onClick={onToggle}
      >
        <ListChecks size={16} weight="thin" className="shrink-0" />
        {word && (
          <span
            className={cn(
              "text-[12px] leading-none",
              WORD_DISPLAY[language === "zh-CN" ? "zh" : "en"],
            )}
          >
            {copy.todo}
          </span>
        )}
        {count && (
          <span className="text-[12px] leading-none tabular-nums">{count}</span>
        )}
      </TopBarIconButton>
    </TooltipLabel>
  );
}
