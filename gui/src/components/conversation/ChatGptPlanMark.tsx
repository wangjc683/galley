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
 * 11px in the menu's 「ChatGPT 订阅 · 管理用量」 (LLMPill).
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
