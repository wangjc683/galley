import { ListChecks } from "@phosphor-icons/react";
import { useRef, useState } from "react";

// TEMP variant switcher (main chat 104): the look, the demo, 丁's launch read.
import {
  todoButtonDemo,
  todoButtonShape,
  useTodoButtonVariants,
} from "@/components/todo/todo-button-variants/todo-button-variants";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isMac } from "@/lib/platform";
import { todoCapsule, todoFirstRow } from "@/lib/todo-button";
import { todoWithoutDeleting } from "@/lib/todo-panel";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * 「待办」 in the top bar (main chat ticket 45, PRD ruling 93): in every
 * conversation's top bar while there is a main chat (ticket 46, ruling
 * 95; Galley's own until then; MainHeaderHost), the right side's first,
 * a group of its own (ticket 104, ruling 149 point 2; MainHeader). It
 * opens the to-do panel beside the conversation on screen and closes it
 * again — the Changes button's grammar (ChangesToggleButton): a pressed
 * toggle, `bg-selected` while its panel is open, a different material
 * from the hover around it.
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
 * What else it shows is on the trial's pill (ruling 150,
 * todo-button-variants.ts): the icon and N alone (`icon`, 甲); 「待办」
 * after the icon, 13px regular in the button's ink, N after it (`word`,
 * 丁 before the panel is met, 戊 / 戊2 with nothing to write; it gives
 * way first on a narrow header, `WORD`); or the capsule (`capsule`, 戊 /
 * 戊2) — the first row of your things, 「时间 · 标题」 and 「+N」 for
 * today's others (lib/todo-button.ts), in a hairline pill 28px high,
 * 220px at most, its title cut past that; on a narrow header the title
 * is cut further, then the capsule folds to the icon and N (`CAPSULE`).
 * The list it reads is the panel's: without the to-dos deleted there
 * and waiting on their undo (ticket 88).
 */

/**
 * Where the word shows (丁, and 戊 / 戊2 with nothing to write), as
 * container-query classes against the `@container/main-header` that
 * MainHeader sets while the look can show more than the icon (ticket
 * 103's way): from lib/todo-button.ts `todoButtonFit`'s `word` up —
 * what the header's content box needs with the word and a two-digit N
 * in the busiest common state, so that while the word shows Galley's
 * identity is never cut for it (620 / 731 on macOS, 766 / 877 on
 * Windows / Linux; a main area of 632 / 743px on macOS). Below it the
 * word goes and the button is 甲's, 28px, 40–48px with N. With no room
 * left after that, the identity's second line fades out, then its name,
 * as before.
 */
const WORD = isMac
  ? {
      zh: {
        word: "hidden @min-[620px]/main-header:inline",
        pad: "@min-[620px]/main-header:pr-[7px]",
      },
      en: {
        word: "hidden @min-[731px]/main-header:inline",
        pad: "@min-[731px]/main-header:pr-[7px]",
      },
    }
  : {
      zh: {
        word: "hidden @min-[766px]/main-header:inline",
        pad: "@min-[766px]/main-header:pr-[7px]",
      },
      en: {
        word: "hidden @min-[877px]/main-header:inline",
        pad: "@min-[877px]/main-header:pr-[7px]",
      },
    };

/**
 * The capsule (ticket 104, ruling 150 points 5 and 6) and where it gives
 * way, against the same container (lib/todo-button.ts `todoButtonFit`).
 * From `fold` up (726 / 851 on macOS, 872 / 997 on Windows / Linux) it
 * is a capsule: a hairline `border-line`, `rounded-full`, the icon where
 * the 28px square has it (1px border + 5px: centred in the round end, 6
 * + 8 = 14, its radius) and 9px on the right (10 with the border; the
 * round end curves in about 1.2px over the text's height, so the text's
 * ink sits about 8.8px from the edge — the left's 6px plus the thin
 * glyph's ~2px inside its box), at most `min(220px, 100cqw - rest)` wide
 * (541 / 640, 687 / 786): as the header narrows its title is cut
 * further, and under `fold`, with under four characters of it left, the
 * body goes and the button is 甲's, the icon and N. It grows and shrinks
 * from its left edge: the right group is pinned to the header's right,
 * the capsule first in it.
 */
const CAPSULE = isMac
  ? {
      zh: {
        shell:
          "@min-[726px]/main-header:w-auto @min-[726px]/main-header:max-w-[min(220px,calc(100cqw_-_541px))] @min-[726px]/main-header:justify-start @min-[726px]/main-header:gap-1 @min-[726px]/main-header:rounded-full @min-[726px]/main-header:border-line @min-[726px]/main-header:pl-[5px] @min-[726px]/main-header:pr-[9px]",
        body: "hidden @min-[726px]/main-header:flex",
        folded: "@min-[726px]/main-header:hidden",
      },
      en: {
        shell:
          "@min-[851px]/main-header:w-auto @min-[851px]/main-header:max-w-[min(220px,calc(100cqw_-_640px))] @min-[851px]/main-header:justify-start @min-[851px]/main-header:gap-1 @min-[851px]/main-header:rounded-full @min-[851px]/main-header:border-line @min-[851px]/main-header:pl-[5px] @min-[851px]/main-header:pr-[9px]",
        body: "hidden @min-[851px]/main-header:flex",
        folded: "@min-[851px]/main-header:hidden",
      },
    }
  : {
      zh: {
        shell:
          "@min-[872px]/main-header:w-auto @min-[872px]/main-header:max-w-[min(220px,calc(100cqw_-_687px))] @min-[872px]/main-header:justify-start @min-[872px]/main-header:gap-1 @min-[872px]/main-header:rounded-full @min-[872px]/main-header:border-line @min-[872px]/main-header:pl-[5px] @min-[872px]/main-header:pr-[9px]",
        body: "hidden @min-[872px]/main-header:flex",
        folded: "@min-[872px]/main-header:hidden",
      },
      en: {
        shell:
          "@min-[997px]/main-header:w-auto @min-[997px]/main-header:max-w-[min(220px,calc(100cqw_-_786px))] @min-[997px]/main-header:justify-start @min-[997px]/main-header:gap-1 @min-[997px]/main-header:rounded-full @min-[997px]/main-header:border-line @min-[997px]/main-header:pl-[5px] @min-[997px]/main-header:pr-[9px]",
        body: "hidden @min-[997px]/main-header:flex",
        folded: "@min-[997px]/main-header:hidden",
      },
    };

export function TodoToggleButton({
  open,
  onToggle,
}: {
  /** The panel is on screen. */
  open: boolean;
  onToggle: () => void;
}) {
  const allCopy = useCopy();
  const copy = allCopy.topbar;
  const language = useLanguage();
  const todayStartMs = useDayStamp();
  const listed = useAssistantTodoStore((s) => s.todo);
  const deleting = useAssistantTodoStore((s) => s.deleting);
  // TEMP variant switcher (main chat 104): the look, the demo in place of
  // the list, and whether the panel was met at launch (丁).
  const look = useTodoButtonVariants((s) => s.look);
  const demo = useTodoButtonVariants((s) => s.demo);
  const introduced = useTodoButtonVariants(
    (s) => s.introducedAtLaunch && !s.pretendNew,
  );
  const { yours, todayCount } =
    todoButtonDemo(demo, todayStartMs) ?? todoWithoutDeleting(listed, deleting);
  const shape = todoButtonShape(
    look,
    todoFirstRow(yours)?.group ?? null,
    introduced,
  );
  const capsule =
    shape === "capsule"
      ? todoCapsule(yours, todayCount, todayStartMs, language, allCopy)
      : null;
  // The capsule's title cut: the tooltip writes the row in full. Read as
  // the pointer or the focus arrives, before the tooltip opens.
  const title = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const readCut = () => {
    const el = title.current;
    setCut(!!el && el.scrollWidth > el.clientWidth);
  };

  const count = todayCount > 0 ? todayCount : null;
  const label = count ? copy.todoWithToday(count) : copy.todoLabel;
  const full = capsule ? copy.todoWithFirst(capsule.when, capsule.title) : null;
  const lang = language === "zh-CN" ? "zh" : "en";
  const word = WORD[lang];
  const fit = CAPSULE[lang];
  return (
    <TooltipLabel text={full && cut ? full : label}>
      <TopBarIconButton
        data-role="topbar-todo"
        data-shape={shape}
        aria-label={full ?? label}
        aria-pressed={open}
        onPointerEnter={capsule ? readCut : undefined}
        onFocus={capsule ? readCut : undefined}
        className={cn(
          // A count widens the 28px square from its left edge: the icon
          // stays where the square has it (1px border + 5px).
          count && "w-auto gap-1 px-[5px]",
          // The word 4px after the icon and the count 4px after it; the
          // icon alone is the square again (1 + 5 + 16 + 5 + 1). With
          // the word, 7px on the right (8 with the border): the thin
          // glyph sits about 2px inside its 16px box, so 6px + 2px on
          // the left reads as 8px, and the text's ink runs nearly to its
          // edge.
          shape === "word" && cn("w-auto gap-1 px-[5px]", word.pad),
          capsule && cn("overflow-hidden", fit.shell),
          // "Panel is open" is a selected state, not a hover (the
          // Changes button's channels, 2026-08-21).
          "aria-pressed:border-line aria-pressed:bg-selected aria-pressed:text-ink",
        )}
        onClick={onToggle}
      >
        <ListChecks size={16} weight="thin" className="shrink-0" />
        {shape === "word" && (
          <span className={cn("text-[13px] leading-none", word.word)}>
            {copy.todo}
          </span>
        )}
        {count && (
          <span
            className={cn(
              "text-[12px] leading-none tabular-nums",
              capsule && fit.folded,
            )}
          >
            {count}
          </span>
        )}
        {capsule && (
          // Time and 「 · 」 in `ink-muted` (overdue in warning, as the
          // panel's row), the title `ink-soft` and cut, 「+N」 tabular.
          <span
            data-capsule-body=""
            className={cn(
              "min-w-0 items-baseline text-[12px] leading-none",
              fit.body,
            )}
          >
            <span
              className={cn(
                "shrink-0 whitespace-nowrap tabular-nums",
                capsule.tone === "warning"
                  ? "font-medium text-warning"
                  : "text-ink-muted",
              )}
            >
              {capsule.when}
            </span>
            <span
              aria-hidden
              className="shrink-0 whitespace-pre text-ink-muted"
            >
              {" · "}
            </span>
            <span ref={title} className="min-w-0 truncate text-ink-soft">
              {capsule.title}
            </span>
            {capsule.more > 0 && (
              <span className="ml-1 shrink-0 tabular-nums text-ink-muted">
                +{capsule.more}
              </span>
            )}
          </span>
        )}
      </TopBarIconButton>
    </TooltipLabel>
  );
}
