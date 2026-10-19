import { useEffect } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMessagesStore } from "@/stores/messages";

import {
  type TypingDemoId,
  type TypingTier,
  useTypingTrialStore,
} from "./typing-trial";
import { startTypingDemo, stopTypingDemo } from "./typing-trial-demo";

/*
 * TEMPORARY — 票 55 临时切换器，定档后由拆除票删掉 (see typing-trial.ts).
 */

const TIERS: readonly TypingTier[] = [1, 2];
const DEMOS: readonly TypingDemoId[] = [1, 2, 3];
const DEMO_TITLES: Record<TypingDemoId, string> = {
  1: "演示 1：你发起的一轮（两步工具，流出回复，约 20 秒）",
  2: "演示 2：叫醒的一轮（一步工具，流出回复，约 10 秒）",
  3: "演示 3：不出声的一轮（一步工具，<no-reply/>，约 10 秒）",
};

const OPTION =
  "min-w-5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-default disabled:opacity-40";

function Option({
  pressed,
  disabled,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        OPTION,
        pressed
          ? "bg-selected text-ink"
          : "text-ink-muted enabled:hover:bg-hover enabled:hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The trial's pill (ruling 107): 「进度 1 | 2」 picks the tier — one
 * click, stored (typing-trial.ts) — and 「演示 1 2 3」 plays a demo in the
 * main chat (typing-trial-demo.ts); the playing one is pressed, and a
 * second click on it ends it. Demos wait while the main chat itself is
 * busy (running, asking, being read back). Portalled to <body> with
 * `pointer-events: auto` above every overlay tier, so an open menu or
 * dialog never blocks it; under the main header's right end, where the
 * earlier trial pills sat (tickets 17, 19, telegram-details 10), clear of
 * the header and the composer. App renders it only in a dev build while
 * the main chat is open in the main area; leaving it ends a demo.
 */
export function TypingTrialSwitcher({ mainChatId }: { mainChatId: string }) {
  const language = useLanguage();
  const tier = useTypingTrialStore((s) => s.tier);
  const setTier = useTypingTrialStore((s) => s.setTier);
  const demo = useTypingTrialStore((s) => s.demo);
  const busy = useMessagesStore((s) => {
    const m = s.byId[mainChatId];
    return !!m && (m.agentRunning || m.pendingAskUser !== null || m.restoring);
  });
  useEffect(() => () => stopTypingDemo(), [mainChatId]);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：在跑时的分工"
      data-role="typing-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed right-3 top-[50px] z-[1000] flex items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 进度</span>
      {TIERS.map((value) => (
        <Option
          key={value}
          pressed={tier === value}
          title={value === 1 ? "第 1 档：现状（那一行）" : "第 2 档：三点气泡"}
          onClick={() => setTier(value)}
        >
          {String(value)}
        </Option>
      ))}
      <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />
      <span className="select-none">演示</span>
      {DEMOS.map((value) => (
        <Option
          key={value}
          pressed={demo === value}
          disabled={demo === null ? busy : demo !== value}
          title={
            demo === value
              ? "再点一次收掉演示"
              : busy && demo === null
                ? "主对话在忙，等它停下再演示"
                : DEMO_TITLES[value]
          }
          onClick={() =>
            demo === value
              ? stopTypingDemo()
              : startTypingDemo(mainChatId, value, language)
          }
        >
          {String(value)}
        </Option>
      ))}
    </div>,
    document.body,
  );
}
