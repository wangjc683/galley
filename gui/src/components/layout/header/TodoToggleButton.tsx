import { ListChecks } from "@phosphor-icons/react";

// TEMP variant switcher (main chat 103): the button's look and demo count.
import {
  todoButtonCount,
  todoButtonWord,
  useTodoButtonVariants,
  type TodoButtonLook,
} from "@/components/todo/todo-button-variants/todo-button-variants";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * 「待办」 in the top bar (main chat ticket 45, PRD ruling 93): in every
 * conversation's top bar while there is a main chat (ticket 46, ruling
 * 95; Galley's own until then; MainHeaderHost). It opens the to-do panel
 * beside the conversation on screen and closes it again — the Changes
 * button's grammar (ChangesToggleButton): a pressed toggle, `bg-selected`
 * while its panel is open, a different material from the hover around
 * it.
 *
 * The list icon the sidebar row had (ticket 42), 16px thin as the
 * cluster's. Beside it N, the to-dos due today or overdue (Core's
 * `todayCount`), as plain text in the button's own ink: not a badge — a
 * badge is for what needs handling (2026-07-30), and colour in the top
 * bar is for warnings, errors and invitations — and nothing at 0. The
 * tooltip and the accessible name say what it opens — 「待办与备忘」, the
 * panel's two pages (ticket 103, ruling 148 point 4, as the panel's own
 * page control is named) — and what N counts.
 *
 * The icon and N only, no word, since JC picked D1 over D2 on
 * 2026-10-17 (ruling 93 point 6); ruling 148 compares again on the
 * trial's pill (todo-button-variants.ts): 乙 and 丙 write 「待办」 after
 * the icon, 13px regular in the button's ink, the count after it; 丙
 * adds a hairline at rest. The word gives way first on a narrow header
 * (`WORD`); the icon and N never do.
 */

/**
 * Where 乙's and 丙's word shows (TEMP variant switcher, main chat 103),
 * as container-query classes against the `@container/main-header` that
 * MainHeader sets while the word can show. The query reads the header's
 * content box: the main area less the header's `pr-3` on macOS
 * (Windows / Linux have none; their window controls are inside it).
 * The threshold is what the content box needs with the word in the
 * busiest common state, so that while the word shows Galley's identity
 * is never cut for it (ticket 45's way, with today's header): 浏览器控制 ·
 * 待解锁, the Channels lamp and the 新版本 badge in the status cluster,
 * Changes in the tools, a two-digit N, the collapsed sidebar's toggle and
 * the identity's longest second line (子任务在问你 / A subtask is asking
 * you). Text measured in Chrome with the app's fonts (Inter, PingFang
 * SC), the rest from the classes:
 *   left    pl 10 + toggle 28 + gap 6 + identity (6 + avatar 28 + gap 8
 *           + line 66 zh / 123.7 en + 8) + pr 12 = 172 zh / 229.7 en
 *   right   待办 (2 + 5 + 16 + 4 + word 26 / 36.9 + 4 + 15.6 + 7)
 *           + divider (8 + 1 + 8) + status (128.1 / 164.7 + 4 + 28 + 4
 *           + 78 / 83.6) + divider 17 + tools (28 + 4 + 28 + 4 + 28)
 *           = 447.6 zh / 490.8 en
 *   macOS   left + right = 619.6 -> 620 / 720.5 -> 721
 *   other   + gap 8 + window controls 138 = 765.6 -> 766 / 866.5 -> 867
 * (a main area of 632 / 733px on macOS). Below it the word goes and the
 * button is 甲's, 28px, 40–48px with N. With no room left after that,
 * the identity's second line fades out, then its name, as before. The
 * narrowest window (960, the sidebar 296) has a 664px main area: the
 * word shows on macOS in Chinese, not in English, nor on Windows.
 */
const WORD = isMac
  ? {
      zh: {
        word: "hidden @min-[620px]/main-header:inline",
        pad: "@min-[620px]/main-header:pr-[7px]",
      },
      en: {
        word: "hidden @min-[721px]/main-header:inline",
        pad: "@min-[721px]/main-header:pr-[7px]",
      },
    }
  : {
      zh: {
        word: "hidden @min-[766px]/main-header:inline",
        pad: "@min-[766px]/main-header:pr-[7px]",
      },
      en: {
        word: "hidden @min-[867px]/main-header:inline",
        pad: "@min-[867px]/main-header:pr-[7px]",
      },
    };

export function TodoToggleButton({
  open,
  onToggle,
  look = "now",
}: {
  /** The panel is on screen. */
  open: boolean;
  onToggle: () => void;
  /** TEMP variant switcher (main chat 103): the look on the pill;
   * MainHeader passes it, the tool cluster's button is 现状's. */
  look?: TodoButtonLook;
}) {
  const copy = useCopy().topbar;
  const language = useLanguage();
  const todayCount = useAssistantTodoStore((s) => s.todo.todayCount);
  // TEMP variant switcher (main chat 103): the demo's count, or the real.
  const demo = useTodoButtonVariants((s) => s.demo);
  const shown = todoButtonCount(demo, todayCount);
  const count = shown > 0 ? shown : null;
  const label = count ? copy.todoWithToday(count) : copy.todoLabel;
  const word = todoButtonWord(look);
  const at = WORD[language === "zh-CN" ? "zh" : "en"];
  return (
    <TooltipLabel text={label}>
      <TopBarIconButton
        data-role="topbar-todo"
        data-look={look}
        aria-label={label}
        aria-pressed={open}
        className={cn(
          // A count widens the 28px square from its left edge: the icon
          // stays where the square has it (1px border + 5px).
          count && "w-auto gap-1 px-[5px]",
          // 乙, 丙: the same, the word 4px after the icon and the count
          // 4px after it; the icon alone is the square again (1 + 5 + 16
          // + 5 + 1). With the word, 7px on the right (8 with the
          // border): the thin glyph sits about 2px inside its 16px box,
          // so 6px + 2px on the left reads as 8px, and the text's ink
          // runs nearly to its edge.
          word && cn("w-auto gap-1 px-[5px]", at.pad),
          // 丙: a hairline at rest, the button's radius.
          look === "C" && "border-line",
          // "Panel is open" is a selected state, not a hover (the
          // Changes button's channels, 2026-08-21).
          "aria-pressed:border-line aria-pressed:bg-selected aria-pressed:text-ink",
        )}
        onClick={onToggle}
      >
        <ListChecks size={16} weight="thin" className="shrink-0" />
        {word && (
          <span className={cn("text-[13px] leading-none", at.word)}>
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
