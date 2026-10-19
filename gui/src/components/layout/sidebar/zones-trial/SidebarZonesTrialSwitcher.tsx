import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import {
  type ZonesTier,
  ZONES_TIERS,
  useSidebarZonesTrialStore,
} from "./zones-trial";

/*
 * TEMPORARY — 票 62 临时切换器，定档后由拆除票删掉 (see zones-trial.ts).
 */

const TIER_LABELS: Record<ZonesTier, string> = {
  now: "现状",
  A: "A",
  B: "B",
  C: "C",
};

const TIER_TITLES: Record<ZonesTier, string> = {
  now: "现状：今天的侧栏",
  A: "A：只给工作台区名；工作台铺到底，「已归档」钉在它脚上",
  B: "B：两区都有区名（「助理」「工作台」）",
  C: "C：A 加助理区上下留白",
};

const OPTION =
  "min-w-5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

function Option({
  pressed,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  title: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
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

/**
 * The trial's pill (ruling 114): 「现状 A B C」 picks the tier, 「新用户」
 * shows the list a new install's would, in any tier — one click each,
 * stored (zones-trial.ts). Portalled to <body> with `pointer-events:
 * auto` above every overlay tier, so an open menu or dialog never blocks
 * it; under the main header's right end, where the earlier trial pills
 * sat (tickets 17, 19, 55), off the sidebar it is there to compare, the
 * header and the composer. App renders it only in a dev build, in the
 * managed runtime with a main chat.
 */
export function SidebarZonesTrialSwitcher() {
  const tier = useSidebarZonesTrialStore((s) => s.tier);
  const newUser = useSidebarZonesTrialStore((s) => s.newUser);
  const setTier = useSidebarZonesTrialStore((s) => s.setTier);
  const setNewUser = useSidebarZonesTrialStore((s) => s.setNewUser);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：侧栏两个区"
      data-role="zones-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 两区</span>
      {ZONES_TIERS.map((value) => (
        <Option
          key={value}
          pressed={tier === value}
          title={TIER_TITLES[value]}
          onClick={() => setTier(value)}
        >
          {TIER_LABELS[value]}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      <Option
        pressed={newUser}
        title={
          newUser
            ? "再点一次回到真实列表"
            : "新用户：只换显示，工作台里没有人开的对话、没有项目、没有归档；助理卡片照真实数据"
        }
        onClick={() => setNewUser(!newUser)}
      >
        新用户
      </Option>
    </div>,
    document.body,
  );
}
