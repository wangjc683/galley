import { CaretDown } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  IM_ALL_CURRENT,
  IM_ALL_RECOMMENDED,
  IM_BUBBLES,
  IM_DEMOS,
  IM_PROCESSES,
  IM_SCROLLS,
  IM_TIMES,
  type ImDemo,
  type ImTrialSettings,
  sameImSettings,
  useImTrialStore,
} from "./im-trial";

const LABELS: Record<string, string> = {
  current: "现状",
  b: "B",
  c: "C",
  line: "一行",
  centered: "居中",
  bottom: "贴底",
};

const DEMO_LABELS: Record<ImDemo, string> = {
  off: "关",
  still: "静止",
  running: "在跑",
  asking: "在问你",
};

const OPTION =
  "whitespace-nowrap rounded-full px-2 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

function Option({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        OPTION,
        pressed
          ? "bg-selected text-ink"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-9 shrink-0 select-none text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

/** The collapsed pill's summary: 「全部现状」, 「全部推荐」, or the four
 * choices; then the demo when it is on. */
function summary(settings: ImTrialSettings, demo: ImDemo): string {
  const pieces = sameImSettings(settings, IM_ALL_CURRENT)
    ? "全部现状"
    : sameImSettings(settings, IM_ALL_RECOMMENDED)
      ? "全部推荐"
      : [
          `气泡 ${LABELS[settings.bubble]}`,
          `过程 ${LABELS[settings.process]}`,
          `时间 ${LABELS[settings.time]}`,
          `滚动 ${LABELS[settings.scroll]}`,
        ].join(" · ");
  return demo === "off" ? pieces : `${pieces} · 演示${DEMO_LABELS[demo]}`;
}

/**
 * TEMPORARY — the always-clickable pill of the IM rendering trial
 * (ticket 19; see im-trial.ts). Collapsed it reads 「临时 · IM 画法」 and
 * what is on; a click opens a small panel under it: 气泡 现状｜B｜C,
 * 过程 现状｜一行, 时间 现状｜居中, 滚动 现状｜贴底, the two shortcuts
 * 「全部现状」 「全部推荐」, and 演示 关｜静止｜在跑｜在问你. The panel stays
 * open while JC flips choices (only the pill closes it). Portalled to
 * <body> with `pointer-events: auto` above every overlay tier, so an
 * open menu or dialog never blocks it. It hangs under the main header's
 * right end — clear of the header buttons, the composer and the
 * 「回到底部」 button. App renders it only while the main chat is open in
 * the main area (the managed runtime).
 */
export function ImTrialSwitcher() {
  const store = useImTrialStore();
  const settings: ImTrialSettings = {
    bubble: store.bubble,
    process: store.process,
    time: store.time,
    scroll: store.scroll,
  };
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：IM 画法"
      data-role="im-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex flex-col items-end gap-1 text-[11px]"
    >
      <button
        type="button"
        aria-expanded={store.panelOpen}
        onClick={() => store.setPanelOpen(!store.panelOpen)}
        className="flex max-w-[60vw] items-center gap-1.5 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-2 text-ink-soft shadow-card outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <span className="shrink-0 select-none">临时 · IM 画法</span>
        <span className="min-w-0 truncate font-medium text-ink">
          {summary(settings, store.demo)}
        </span>
        <CaretDown
          size={10}
          weight="bold"
          className={cn(
            "shrink-0 transition-transform",
            store.panelOpen && "rotate-180",
          )}
        />
      </button>
      {store.panelOpen && (
        <div className="flex flex-col gap-1 rounded-lg border border-dashed border-warning/70 bg-elevated p-2 shadow-card">
          <Row label="气泡">
            {IM_BUBBLES.map((v) => (
              <Option
                key={v}
                pressed={store.bubble === v}
                onClick={() => store.setBubble(v)}
              >
                {LABELS[v]}
              </Option>
            ))}
          </Row>
          <Row label="过程">
            {IM_PROCESSES.map((v) => (
              <Option
                key={v}
                pressed={store.process === v}
                onClick={() => store.setProcess(v)}
              >
                {LABELS[v]}
              </Option>
            ))}
          </Row>
          <Row label="时间">
            {IM_TIMES.map((v) => (
              <Option
                key={v}
                pressed={store.time === v}
                onClick={() => store.setTime(v)}
              >
                {LABELS[v]}
              </Option>
            ))}
          </Row>
          <Row label="滚动">
            {IM_SCROLLS.map((v) => (
              <Option
                key={v}
                pressed={store.scroll === v}
                onClick={() => store.setScroll(v)}
              >
                {LABELS[v]}
              </Option>
            ))}
          </Row>
          <div className="my-0.5 h-px bg-line" aria-hidden />
          <Row label="快捷">
            <Option
              pressed={sameImSettings(settings, IM_ALL_CURRENT)}
              onClick={() => store.setAll(IM_ALL_CURRENT)}
            >
              全部现状
            </Option>
            <Option
              pressed={sameImSettings(settings, IM_ALL_RECOMMENDED)}
              onClick={() => store.setAll(IM_ALL_RECOMMENDED)}
            >
              全部推荐
            </Option>
          </Row>
          <Row label="演示">
            {IM_DEMOS.map((v) => (
              <Option
                key={v}
                pressed={store.demo === v}
                onClick={() => store.setDemo(v)}
              >
                {DEMO_LABELS[v]}
              </Option>
            ))}
          </Row>
        </div>
      )}
    </div>,
    document.body,
  );
}
