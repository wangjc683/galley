/**
 * TEMPORARY — SIWC 票 04 临时切换器，定档后拆掉 (.scratch/chatgpt-siwc
 * ticket 04, item 5). OpenAI asks for a "using your ChatGPT plan" mark
 * near the composer or the model picker; two places are compared live in
 * tauri dev with a pill (PlanMarkTrialSwitcher):
 *
 *   A  only in the model menu (LLMPill's popover): a header row over the
 *      ChatGPT plan's models, 「ChatGPT 套餐 · 管理用量」, the second half
 *      a link to chatgpt.com/settings/usage.
 *   B  in the composer: when the conversation's model is on the plan, a
 *      faint 「ChatGPT 套餐」 after the 「模型 · 强度」 phrase (a link to
 *      the same page).
 *
 * Every branch point carries 「SIWC 票 04 临时切换器」
 * (`grep -rn "SIWC 票 04" gui/src`). Removal: delete this folder and the
 * pill's mount in App.tsx; in Composer.tsx keep the winning variant's
 * branch and drop this hook.
 */
import { create } from "zustand";

export type PlanMarkVariant = "A" | "B";

export const PLAN_MARK_VARIANTS: readonly PlanMarkVariant[] = ["A", "B"];

const VARIANT_KEY = "galley.tmp.siwcPlanMark.variant";

/** A stored choice, a per-machine convenience (HMR and reloads keep
 * it); production never reads it, and unreadable storage is A. */
function readVariant(): PlanMarkVariant {
  if (!import.meta.env.DEV || typeof window === "undefined") return "A";
  try {
    const stored = window.localStorage.getItem(VARIANT_KEY);
    return PLAN_MARK_VARIANTS.find((variant) => variant === stored) ?? "A";
  } catch {
    return "A";
  }
}

interface PlanMarkTrialState {
  variant: PlanMarkVariant;
  setVariant: (variant: PlanMarkVariant) => void;
}

export const usePlanMarkTrialStore = create<PlanMarkTrialState>((set) => ({
  variant: readVariant(),
  setVariant: (variant) => {
    try {
      window.localStorage.setItem(VARIANT_KEY, variant);
    } catch {
      // Not stored: the pill still switches for this page.
    }
    set({ variant });
  },
}));

/** The variant in force: the pill's in a dev build; A (the quieter one,
 * only seen with the menu open) in production, whatever is stored. */
export function usePlanMarkVariant(): PlanMarkVariant {
  const variant = usePlanMarkTrialStore((s) => s.variant);
  return import.meta.env.DEV ? variant : "A";
}
