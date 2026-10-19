import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { useAssistantFaceStore } from "@/stores/assistant-face";

import { FACE_DEMO_ITEMS } from "./face-demo";
import {
  FACE_AMPLITUDES,
  type FaceAmplitude,
  useFaceTrialStore,
} from "./face-trial";

/*
 * TEMPORARY — 票 66 临时切换器，定档后由拆除票删掉 (see face-trial.ts).
 */

const AMPLITUDE_LABELS: Record<FaceAmplitude, string> = {
  1: "1×",
  1.5: "1.5×",
  2: "2×",
};
const AMPLITUDE_TITLES: Record<FaceAmplitude, string> = {
  1: "幅度 1 倍：票 66 的目标（头挪 6–8px、歪 12–20°、跳 10–12px）",
  1.5: "幅度 1.5 倍：位移、角度、缩放都放大一半，时长不变",
  2: "幅度 2 倍：位移、角度、缩放都加倍，时长不变",
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
 * The trial's pill (ruling 119): 幅度 1× / 1.5× / 2×, and the demo — on,
 * all states in turn or one pinned from the list, with what plays now
 * written after it. Portalled to <body> with `pointer-events: auto`
 * above every overlay tier, top centre under the main header (top 50px),
 * where ticket 65 put it (the to-do panel's title bar stays clear). App
 * renders it only in a dev build, in the managed runtime with a main
 * chat.
 */
export function AssistantFaceTrialSwitcher() {
  const amplitude = useFaceTrialStore((s) => s.amplitude);
  const demo = useFaceTrialStore((s) => s.demo);
  const pinned = useFaceTrialStore((s) => s.pinned);
  const setAmplitude = useFaceTrialStore((s) => s.setAmplitude);
  const setDemo = useFaceTrialStore((s) => s.setDemo);
  const setPinned = useFaceTrialStore((s) => s.setPinned);
  const playing = useAssistantFaceStore((s) => s.demoLabel);
  return createPortal(
    <div
      role="group"
      aria-label="临时切换器：Galley 的脸"
      data-role="face-trial-pill"
      style={{ pointerEvents: "auto" }}
      className="fixed left-1/2 top-[50px] z-[1000] flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-elevated py-0.5 pl-2.5 pr-1 text-ui-label text-ink-soft shadow-card"
    >
      <span className="select-none whitespace-nowrap">临时 · 幅度</span>
      {FACE_AMPLITUDES.map((value) => (
        <Option
          key={value}
          pressed={amplitude === value}
          title={AMPLITUDE_TITLES[value]}
          onClick={() => setAmplitude(value)}
        >
          {AMPLITUDE_LABELS[value]}
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
