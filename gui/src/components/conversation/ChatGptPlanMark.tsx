import chatGptLogoUrl from "@/assets/chatgpt-logo-black.svg";
import { TooltipLabel } from "@/components/ui/tooltip";
import { CHATGPT_USAGE_URL } from "@/lib/chatgpt-plan";
import { useCopy } from "@/lib/i18n";
import { openExternalUrl } from "@/lib/open-external";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * The ChatGPT mark in a single ink: the official logo (assets/, as
 * published) used as a mask over `currentColor`, so it takes whatever
 * text colour it is given and follows the theme with it — the Feishu /
 * Telegram glyphs' technique (settings/im/Glyphs.tsx). Size it with
 * `size-*`.
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

/*
 * The composer's "using your ChatGPT plan" marks, compared live by the
 * SIWC 票 04 临时切换器 (plan-mark-trial/): the losing one goes with the
 * trial. Both are links to the plan's usage page, 「管理用量」 on hover.
 */

/** Step 2 「右端」: at the right end of the toolbar row, just left of
 * send — [12px mark] 「ChatGPT 订阅」 in ink-muted at the row's 12.5px.
 * The wrapper is the row's 32px, so the one-line composer's bottom
 * alignment and the card's centring both land it on the send button's
 * middle. */
export function ChatGptPlanEndMark() {
  const copy = useCopy().chatgptPlan;
  return (
    <div className="flex h-8 shrink-0 items-center">
      <TooltipLabel text={copy.manageUsage}>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}
          className="flex h-7 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-[12.5px] text-ink-muted outline-none hover:bg-hover hover:text-ink-soft"
        >
          <ChatGptMark className="size-3" />
          {copy.planLabel}
        </button>
      </TooltipLabel>
    </div>
  );
}

/** Step 3 「徽标」: after the 「模型 · 强度」 phrase, a normal gap away
 * (no 「·」: it is not a third word of the phrase), a tag on the apricot
 * tint at the row's own 12.5px (one size per row) and 24px tall, under
 * the pills' 28px hover boxes. */
export function ChatGptPlanTag() {
  const copy = useCopy().chatgptPlan;
  return (
    <TooltipLabel text={copy.manageUsage}>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={preventMouseFocus}
        onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}
        className="ml-1.5 inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm bg-brand-tint px-1.5 text-[12.5px] leading-none text-ink-soft outline-none hover:text-ink"
      >
        {copy.planLabel}
      </button>
    </TooltipLabel>
  );
}
