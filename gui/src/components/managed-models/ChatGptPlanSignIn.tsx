import { CircleNotch } from "@phosphor-icons/react";

import chatGptLogoBlackUrl from "@/assets/chatgpt-logo-black.svg";
import chatGptLogoWhiteUrl from "@/assets/chatgpt-logo-white.svg";
import { useResolvedTheme } from "@/components/theme/ThemeContext";
import { Button, type ButtonSize } from "@/components/ui/button";
import type { ChatGptPlanLoginState } from "@/lib/chatgpt-plan";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LOGO_SIZE: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16 };

/**
 * OpenAI's "Continue with ChatGPT" (「用 ChatGPT 登录」) with the official
 * ChatGPT mark (developers.openai.com/siwc/website, both colours kept
 * as published under `assets/`). It is Galley's primary button, so the
 * mark takes the button's text colour: white on the charcoal light-theme
 * button, black on the pale dark-theme one.
 */
export function ContinueWithChatGptButton({
  size = "sm",
  busy = false,
  disabled = false,
  onClick,
  className,
}: {
  size?: ButtonSize;
  /** The sign-in is being opened: a spinner stands in for the mark. */
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const copy = useCopy().chatgptPlan;
  const theme = useResolvedTheme();
  const logoSize = LOGO_SIZE[size];
  return (
    <Button
      variant="primary"
      size={size}
      disabled={disabled || busy}
      onClick={onClick}
      className={className}
      leadingIcon={
        busy ? (
          <span className="spin inline-flex">
            <CircleNotch size={logoSize - 2} weight="thin" />
          </span>
        ) : (
          <img
            src={theme === "dark" ? chatGptLogoBlackUrl : chatGptLogoWhiteUrl}
            alt=""
            aria-hidden
            width={logoSize}
            height={logoSize}
            draggable={false}
            className="shrink-0 select-none"
          />
        )
      }
    >
      {copy.continueWithChatGPT}
    </Button>
  );
}

/**
 * The sign-in's own controls: the button, or — while Core waits for the
 * browser's callback — a line saying so with a way out. What went wrong
 * is drawn by the surface, in its own error grammar.
 */
export function ChatGptPlanSignInControls({
  state,
  onSignIn,
  onCancel,
  size = "sm",
  disabled = false,
  className,
}: {
  state: ChatGptPlanLoginState;
  onSignIn: () => void;
  onCancel: () => void;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}) {
  const appCopy = useCopy();
  if (state.phase === "waiting") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2.5 gap-y-2",
          className,
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
          <span className="spin inline-flex">
            <CircleNotch size={12} weight="thin" />
          </span>
          {appCopy.chatgptPlan.waiting}
        </span>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {appCopy.common.cancel}
        </Button>
        {/* A stale saved registration makes the authorize page show an
            error instead of redirecting; cancelling drops it in Core, so
            the next attempt registers afresh (ticket 02). */}
        <span className="basis-full text-[12px] text-ink-muted">
          {appCopy.chatgptPlan.waitingHint}
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ContinueWithChatGptButton
        size={size}
        busy={state.phase === "starting"}
        disabled={disabled}
        onClick={onSignIn}
      />
    </div>
  );
}
