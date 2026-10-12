import { createPortal } from "react-dom";

import { findMainChat } from "@/lib/main-chat";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions";

import {
  MAIN_CHAT_LAYOUTS,
  SIDE_CHAT_NAMINGS,
  useMainChatLayoutStore,
} from "./main-chat-layout";

/**
 * TEMPORARY — the always-clickable pill for the sidebar trial
 * (ticket 07): layout A3 / B / B′, naming 旁聊 / 话题 / 其他对话, demo
 * states on / off (see `main-chat-layout.ts` for what each means;
 * removal steps in the ticket's Comments). Portalled to <body> with
 * `pointer-events-auto` above every overlay tier, so an open dialog or
 * menu (Radix sets `pointer-events: none` on the body) never blocks it.
 * Sits in the empty middle of the header strip. Only while a main chat
 * exists: the external runtime has none, and there all variants are
 * the same.
 */
export function MainChatLayoutSwitcher() {
  const layout = useMainChatLayoutStore((s) => s.layout);
  const setLayout = useMainChatLayoutStore((s) => s.setLayout);
  const naming = useMainChatLayoutStore((s) => s.naming);
  const setNaming = useMainChatLayoutStore((s) => s.setNaming);
  const demo = useMainChatLayoutStore((s) => s.demo);
  const setDemo = useMainChatLayoutStore((s) => s.setDemo);
  const hasMainChat = useSessionsStore((s) => !!findMainChat(s.sessions));
  if (!hasMainChat) return null;
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：侧栏层级、叫法与演示状态"
      className="pointer-events-auto fixed left-1/2 top-[9px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-0.5 text-[11px] text-ink-soft shadow-card"
    >
      <span className="select-none">临时 · 侧栏</span>
      {MAIN_CHAT_LAYOUTS.map((option) => (
        <PillButton
          key={option}
          pressed={layout === option}
          onClick={() => setLayout(option)}
        >
          {option}
        </PillButton>
      ))}
      <span className="select-none pl-1.5">叫法</span>
      {SIDE_CHAT_NAMINGS.map((option) => (
        <PillButton
          key={option}
          pressed={naming === option}
          onClick={() => setNaming(option)}
        >
          {option}
        </PillButton>
      ))}
      <span className="select-none pl-1.5">演示</span>
      <PillButton pressed={demo} onClick={() => setDemo(true)}>
        开
      </PillButton>
      <PillButton pressed={!demo} onClick={() => setDemo(false)}>
        关
      </PillButton>
    </div>,
    document.body,
  );
}

function PillButton({
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
        "rounded-full px-2 py-0.5 font-medium tabular-nums",
        pressed
          ? "bg-selected text-ink"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
