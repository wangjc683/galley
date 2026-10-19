import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { useAssistantFaceStore } from "@/stores/assistant-face";

import { FACE_DEMO_ITEMS } from "./face-demo";
import {
  CARD_LAYOUT_TIERS,
  type CardLayoutTier,
  FACE_MOTION_TIERS,
  type FaceMotionTier,
  useFaceTrialStore,
} from "./face-trial";

/*
 * TEMPORARY — 票 65 临时切换器，定档后由拆除票删掉 (see face-trial.ts).
 */

const MOTION_LABELS: Record<FaceMotionTier, string> = { B: "乙", C: "丙" };
const MOTION_TITLES: Record<FaceMotionTier, string> = {
  B: "乙：脸跟着它在做的事动，没事时完全静止",
  C: "丙：乙，再加没事时的生命感（随机眨眼、左右看、打盹）",
};
const LAYOUT_LABELS: Record<CardLayoutTier, string> = {
  row64: "行 64",
  stage72: "舞台 72",
};
const LAYOUT_TITLES: Record<CardLayoutTier, string> = {
  row64: "大头像行：IM 列表的一行，头像 64px",
  stage72: "居中舞台：头像 72px 居中，名字与最后一句在下面",
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

const Divider = () => <span aria-hidden className="mx-0.5 h-3 w-px bg-line" />;

/**
 * The trial's pill (rulings 117, 118): 动效 乙 / 丙, 版式 行 64 / 舞台
 * 72, and the demo — on, all states in turn or one pinned from the list,
 * with what plays now written after it. Portalled to <body> with
 * `pointer-events: auto` above every overlay tier. Top centre, under
 * the main header (top 50px): the earlier pills sat at the header's
 * right end and covered the to-do panel's title bar when it was open
 * (ticket 62); the middle of the window is the conversation's top, where
 * nothing is pinned. App renders it only in a dev build, in the managed
 * runtime with a main chat.
 */
export function AssistantFaceTrialSwitcher() {
  const motion = useFaceTrialStore((s) => s.motion);
  const layout = useFaceTrialStore((s) => s.layout);
  const demo = useFaceTrialStore((s) => s.demo);
  const pinned = useFaceTrialStore((s) => s.pinned);
  const setMotion = useFaceTrialStore((s) => s.setMotion);
  const setLayout = useFaceTrialStore((s) => s.setLayout);
  const setDemo = useFaceTrialStore((s) => s.setDemo);
  const setPinned = useFaceTrialStore((s) => s.setPinned);
  const playing = useAssistantFaceStore((s) => s.demoLabel);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：Galley 的脸与卡片"
      data-role="face-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[50px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 动效</span>
      {FACE_MOTION_TIERS.map((value) => (
        <Option
          key={value}
          pressed={motion === value}
          title={MOTION_TITLES[value]}
          onClick={() => setMotion(value)}
        >
          {MOTION_LABELS[value]}
        </Option>
      ))}
      <Divider />
      <span className="select-none whitespace-nowrap">版式</span>
      {CARD_LAYOUT_TIERS.map((value) => (
        <Option
          key={value}
          pressed={layout === value}
          title={LAYOUT_TITLES[value]}
          onClick={() => setLayout(value)}
        >
          {LAYOUT_LABELS[value]}
        </Option>
      ))}
      <Divider />
      <Option
        pressed={demo}
        title={
          demo
            ? "再点一次停止演示，回到真实状态"
            : "演示：各状态轮流播（每个约 3 秒），或在右边钉住一个；只换显示"
        }
        onClick={() => setDemo(!demo)}
      >
        演示
      </Option>
      <select
        aria-label="演示：轮播或钉住一个状态"
        value={pinned ?? ""}
        onChange={(e) => {
          setPinned(e.target.value || null);
          if (!demo) setDemo(true);
        }}
        className="max-w-36 rounded-full bg-transparent px-1 py-0.5 text-ui-label text-ink-soft outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <option value="">轮播全部</option>
        {FACE_DEMO_ITEMS.map((item) => (
          <option key={item.id} value={item.id}>
            钉住：{item.label}
          </option>
        ))}
      </select>
      {demo && playing && (
        <span
          data-role="face-trial-playing"
          className="select-none whitespace-nowrap pr-1.5 text-ink"
        >
          在演：{playing}
        </span>
      )}
    </div>,
    document.body,
  );
}
