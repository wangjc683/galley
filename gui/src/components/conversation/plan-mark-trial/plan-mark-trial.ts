/**
 * TEMPORARY — SIWC 票 04 临时切换器，定档后拆掉 (.scratch/chatgpt-siwc
 * ticket 04, item 5; 04b). OpenAI asks for a "using your ChatGPT plan"
 * mark near the composer or the model picker. JC picked "in the
 * composer" (B) on 10-20 but not its look — a faint word after
 * 「模型 · 强度」 read as the phrase's third item, too close to the effort
 * pill — so three looks are compared live in tauri dev with a pill
 * (PlanMarkTrialSwitcher), the most restrained first. Each shows only
 * while the conversation's current model is on the plan:
 *
 *   1  「标志」: a 13px ChatGPT mark in ink-muted inside the model pill,
 *      before the name; the pill's tooltip gains 「使用 ChatGPT 订阅」 under
 *      「切换模型」; the model menu keeps the header row over the plan's
 *      models, 「ChatGPT 订阅 · 管理用量」 (OpenAI's words and the
 *      Manage-usage link stay in the model selector).
 *   2  「右端」: [12px mark] 「ChatGPT 订阅」 in ink-muted at the right end
 *      of the composer's toolbar row, just left of send; a link to the
 *      usage page.
 *   3  「徽标」: a tag 「ChatGPT 订阅」 on the apricot tint after the
 *      phrase, a normal gap away; a link to the usage page.
 *
 * 2 and 3 drop the menu header: the composer already says it. The marks
 * are in ../ChatGptPlanMark.tsx.
 *
 * Every branch point carries 「SIWC 票 04 临时切换器」
 * (`grep -rn "SIWC 票 04" gui/src`). Removal: delete this folder and the
 * pill's mount in App.tsx; in Composer.tsx keep the winning step's
 * branch and drop this hook; drop the losing marks from
 * ChatGptPlanMark.tsx and, unless 1 wins, LLMPill's `planLogo`.
 */
import { create } from "zustand";

export type PlanMarkVariant = "1" | "2" | "3";

export const PLAN_MARK_VARIANTS: readonly PlanMarkVariant[] = ["1", "2", "3"];

// A new key: the A / B trial's stored choice means nothing here.
const VARIANT_KEY = "galley.tmp.siwcPlanMark.step";

/** A stored choice, a per-machine convenience (HMR and reloads keep
 * it); production never reads it, and unreadable storage is 1. */
function readVariant(): PlanMarkVariant {
  if (!import.meta.env.DEV || typeof window === "undefined") return "1";
  try {
    const stored = window.localStorage.getItem(VARIANT_KEY);
    return PLAN_MARK_VARIANTS.find((variant) => variant === stored) ?? "1";
  } catch {
    return "1";
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

/** The step in force: the pill's in a dev build; 1 (the most restrained)
 * in production, whatever is stored. */
export function usePlanMarkVariant(): PlanMarkVariant {
  const variant = usePlanMarkTrialStore((s) => s.variant);
  return import.meta.env.DEV ? variant : "1";
}
