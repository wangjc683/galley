import { useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";

import { SidebarSubtaskRows } from "@/components/layout/sidebar/SidebarSubtaskRows";
import type { TodoItem, TodoState } from "@/lib/assistant-todo";
import { sidebarSubtasks, type SidebarSubtasks } from "@/lib/sidebar-subtasks";
import { cn } from "@/lib/utils";

/*
 * TEMP variant switcher (main chat 128) — the rows under Galley's card
 * (main chat PRD ruling 176 point 6: their height, size and indent are
 * compared live in `pnpm --dir gui tauri dev`), with demo states, since
 * this machine has no subtask running now. Everything the trial needs is
 * in this file; Sidebar.tsx draws the rows through `SubtaskRowsTrial` in
 * a dev build only (`import.meta.env.DEV`). A production build has no
 * pill and draws A.
 *
 * The pill, at the window's bottom-right corner, has two buttons; a click
 * moves to the next level and the pill says the current one:
 *
 *   样式  A  as the workbench's rows (SidebarSubtaskRows as written:
 *            32px, 13px, the glyph on the 18px line);
 *         B  a size down: the title 12px (ink-soft, as A's unselected
 *            titles already are; selected keeps the full ink), the row
 *            4px shorter (28px);
 *         C  A, the whole block indented one level (24px: the glyph on
 *            the title's 42px line, as a project's children), hung under
 *            Galley.
 *   数据  真实  the store, as written;
 *         1 件  one running;
 *         3 件  one asking, two running;
 *         7 件  one asking, six running: five shown, then 「还有 1 件在办」.
 *
 * B and C are a <style> laid over A's classes (unlayered, so it beats
 * Tailwind's utilities layer), not classes in the component, so the
 * component stays as written. The demo goes through the real grouping
 * (lib/sidebar-subtasks.ts), in memory only: nothing is written, no IPC.
 * Its errands are made up. A demo row does nothing when pressed; its
 * 「还有 N 件在办」 neither. Both levels live in this component's state:
 * a reload is back on A and the store.
 *
 * Removal, after the ruling: delete this file; in Sidebar.tsx drop its
 * import and `SubtaskRows`, and draw `SidebarSubtaskRows` again. If B or
 * C wins, write it into SidebarSubtaskRows.tsx — B: the row `min-h-7
 * py-1`, the title `text-[12px]`; C: the block `pl-6` — and the
 * docs/design/layout-and-chrome.md 「子任务」 entry's 「待真机定」 line.
 */

type Look = "A" | "B" | "B2" | "C";
type Data = "real" | "one" | "three" | "seven";

const LOOKS: readonly Look[] = ["A", "B", "B2", "C"];
const DATA: readonly Data[] = ["real", "one", "three", "seven"];
const DATA_NAMES: Record<Data, string> = {
  real: "真实",
  one: "1 件",
  three: "3 件",
  seven: "7 件",
};

const LOOK_CSS: Record<Look, string> = {
  A: "",
  B: [
    '[data-role="sidebar-subtask"]{min-height:1.75rem;padding-top:0.25rem;padding-bottom:0.25rem}',
    '[data-role="sidebar-subtask-title"]{font-size:12px}',
  ].join(""),
  // B2 (11-03, JC leans to B): B, and a running row's title at medium
  // weight. Every listed row is running or needs you, so semibold says
  // nothing here; only the rows that need you keep it.
  B2: [
    '[data-role="sidebar-subtask"]{min-height:1.75rem;padding-top:0.25rem;padding-bottom:0.25rem}',
    '[data-role="sidebar-subtask-title"]{font-size:12px}',
    '[data-role="sidebar-subtask"][data-state="running"] [data-role="sidebar-subtask-title"]{font-weight:500}',
  ].join(""),
  C: '[data-role="sidebar-subtasks"]{padding-left:1.5rem}',
};

/** Made-up everyday errands, by start (minutes past nine). */
const ERRANDS: Record<
  Exclude<Data, "real">,
  { title: string; state: TodoState }[]
> = {
  one: [{ title: "整理下载文件夹里的发票", state: "running" }],
  three: [
    {
      title: "把下载文件夹里上个月的发票按月份整理好，再列一张金额汇总表",
      state: "running",
    },
    { title: "比较三款扫地机器人的价格", state: "asking" },
    { title: "把会议纪要整理成一页", state: "running" },
  ],
  seven: [
    {
      title: "把下载文件夹里上个月的发票按月份整理好，再列一张金额汇总表",
      state: "running",
    },
    { title: "把会议纪要整理成一页", state: "running" },
    { title: "给阳台的绿萝查一下多久浇一次水", state: "running" },
    { title: "比较三款扫地机器人的价格", state: "asking" },
    { title: "把这周的快递单号整理成一张表", state: "running" },
    { title: "找一个周末能去的近郊公园", state: "running" },
    { title: "核对信用卡账单里有没有重复扣款", state: "running" },
  ],
};

function demoSubtasks(data: Exclude<Data, "real">): SidebarSubtasks {
  const errands = ERRANDS[data];
  const items: TodoItem[] = errands.map((errand, i) => ({
    kind: "subtask",
    id: `trial-${i}`,
    text: errand.title,
    state: errand.state,
    createdBy: "assistant",
  }));
  const sessions = errands.map((errand, i) => ({
    id: `trial-${i}`,
    title: errand.title,
    createdAt: new Date(2026, 10, 3, 9, i + 1).toISOString(),
  }));
  return sidebarSubtasks(items, sessions);
}

const nothing = () => {};

function next<T>(levels: readonly T[], current: T): T {
  return levels[(levels.indexOf(current) + 1) % levels.length];
}

const OPTION =
  "whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * The rows under Galley's card, through the trial: the store's (as
 * Sidebar passes them) or a demo, under the look picked on the pill.
 */
export function SubtaskRowsTrial(
  props: ComponentProps<typeof SidebarSubtaskRows>,
) {
  const [look, setLook] = useState<Look>("A");
  const [data, setData] = useState<Data>("real");
  const rows =
    data === "real" ? (
      <SidebarSubtaskRows {...props} />
    ) : (
      <SidebarSubtaskRows subtasks={demoSubtasks(data)} onMore={nothing} />
    );
  // A static render (tests) has no <body> to portal to.
  if (!import.meta.env.DEV || typeof document === "undefined") return rows;
  return (
    <>
      {rows}
      {createPortal(
        <>
          {LOOK_CSS[look] && <style>{LOOK_CSS[look]}</style>}
          <div
            role="group"
            aria-label="临时切换器：子任务行"
            data-role="subtask-rows-trial-pill"
            style={{ pointerEvents: "auto" }}
            className="fixed bottom-3 right-3 z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
          >
            <span className="select-none whitespace-nowrap">
              临时 · 子任务行
            </span>
            <button
              type="button"
              data-role="subtask-rows-trial-look"
              onClick={() => setLook(next(LOOKS, look))}
              className={OPTION}
            >
              样式 {look}
            </button>
            <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
            <button
              type="button"
              data-role="subtask-rows-trial-data"
              onClick={() => setData(next(DATA, data))}
              className={cn(OPTION, data !== "real" && "bg-selected")}
            >
              数据 {DATA_NAMES[data]}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
