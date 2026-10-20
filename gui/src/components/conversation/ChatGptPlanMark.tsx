import chatGptLogoUrl from "@/assets/chatgpt-logo-black.svg";
import { cn } from "@/lib/utils";

/**
 * The ChatGPT mark in a single ink: the official logo (assets/, as
 * published) used as a mask over `currentColor`, so it takes whatever
 * text colour it is given and follows the theme with it — the Feishu /
 * Telegram glyphs' technique (settings/im/Glyphs.tsx). Size it with
 * `size-*`.
 *
 * It marks a model that spends the ChatGPT plan (Sign in with ChatGPT,
 * .scratch/chatgpt-siwc decisions 13, 14): 13px in ink-muted before the
 * name in the model pill and in its menu rows, and at the action rows'
 * 11px in the menu's 「ChatGPT 订阅 · 管理用量」 (LLMPill). Wherever such a
 * model is named it goes too (decision 18): 14px in a 16px box in the
 * Cube's place in ⌘K → 切换模型 (CommandPalette), 13px before the name
 * in Settings → 我的模型 (ConfiguredModelsPanel). It follows the model,
 * never the provider: no provider card, add menu or onboarding tile
 * carries it.
 */
export function ChatGptMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-role="chatgpt-mark"
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        WebkitMaskImage: `url(${chatGptLogoUrl})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskImage: `url(${chatGptLogoUrl})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
      }}
    />
  );
}
