import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  PLAN_MARK_VARIANTS,
  type PlanMarkVariant,
  usePlanMarkTrialStore,
} from "./plan-mark-trial";

/*
 * TEMPORARY — SIWC 票 04 临时切换器，定档后拆掉 (see plan-mark-trial.ts).
 */

const VARIANT_LABELS: Record<PlanMarkVariant, string> = {
  "1": "1 标志",
  "2": "2 右端",
  "3": "3 徽标",
};

const VARIANT_TITLES: Record<PlanMarkVariant, string> = {
  "1": "1 标志：模型名前一个 ChatGPT 标志，悬停提示加一行「使用 ChatGPT 订阅」，模型菜单里保留「ChatGPT 订阅 · 管理用量」",
  "2": "2 右端：发送键左边写「ChatGPT 订阅」，点开管理用量",
  "3": "3 徽标：模型短语后面一个杏色底的「ChatGPT 订阅」标签，点开管理用量",
};

/**
 * The trial's pill: 「订阅标识 1 2 3」 picks how the ChatGPT plan mark
 * looks, one click, stored (plan-mark-trial.ts). Portalled to <body> with
 * `pointer-events: auto` above every overlay tier, so an open menu or
 * dialog never blocks it; under the main header's right end, where the
 * earlier trial pills sat. App renders it only in a dev build, in the
 * managed runtime.
 */
export function PlanMarkTrialSwitcher() {
  const variant = usePlanMarkTrialStore((s) => s.variant);
  const setVariant = usePlanMarkTrialStore((s) => s.setVariant);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：ChatGPT 订阅标识"
      data-role="plan-mark-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 订阅标识</span>
      {PLAN_MARK_VARIANTS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={variant === value}
          title={VARIANT_TITLES[value]}
          onClick={() => setVariant(value)}
          className={cn(
            "min-w-5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            variant === value
              ? "bg-selected text-ink"
              : "text-ink-muted hover:bg-hover hover:text-ink",
          )}
        >
          {VARIANT_LABELS[value]}
        </button>
      ))}
    </div>,
    document.body,
  );
}
