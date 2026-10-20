import {
  ArrowSquareOut,
  CaretDown,
  WarningCircle,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CHATGPT_USAGE_URL } from "@/lib/chatgpt-plan";
import {
  chatGptPlanErrorView,
  type ChatGptPlanErrorMatch,
} from "@/lib/chatgpt-plan-errors";
import { useCopy } from "@/lib/i18n";
import { openExternalUrl } from "@/lib/open-external";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/**
 * A ChatGPT plan error the engine ended a turn with (PRD ruling 7,
 * SIWC ticket 04), in Galley's words with the way on: 「管理用量」 on a
 * usage limit (OpenAI's guideline makes it the primary action),
 * 「去设置登录」 when the sign-in is gone, 「去设置」 when the plan can't be
 * used here. The engine's English text, code included, stays one click
 * away under 「原始输出」 for diagnosis. The frame is the protocol-failure
 * notice's (MessageAgent), with the warning bar: the account needs
 * something, nothing broke. Inside, the Error Card's standard display
 * (onboarding-and-cards.md §6.2): 14px title, 13px muted line, the main
 * action as the apricot-outlined button, mono details behind a caret.
 */
export function ChatGptPlanErrorNotice({
  error,
}: {
  error: ChatGptPlanErrorMatch;
}) {
  const copy = useCopy();
  const view = chatGptPlanErrorView(error.kind, copy.chatgptPlan);
  const [rawOpen, setRawOpen] = useState(false);
  const act = () => {
    if (view.action === "manage_usage") {
      openExternalUrl(CHATGPT_USAGE_URL);
      return;
    }
    useUiStore.getState().requestSettings("models", {
      expandChatGpt: view.action === "sign_in_settings",
    });
  };
  return (
    <div
      data-role="chatgpt-plan-error"
      className="relative my-3 overflow-hidden rounded-md border border-line bg-app"
    >
      <div className="absolute inset-y-0 left-0 w-[3px] bg-warning/[var(--opacity-medium)]" />
      <div className="flex items-start gap-2.5 px-4 pb-3.5 pt-3.5">
        <span className="inline-flex shrink-0 pt-px">
          <WarningCircle size={16} weight="thin" className="text-warning" />
        </span>
        <div className="min-w-0 flex-1">
          {view.title && (
            <div className="text-[14px] font-medium text-ink">{view.title}</div>
          )}
          <div
            className={cn(
              "text-[13px] leading-[1.55] text-ink-muted",
              view.title && "mt-0.5",
            )}
          >
            {view.body}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button
              variant="brand-soft"
              size="sm"
              onClick={act}
              trailingIcon={
                view.action === "manage_usage" ? (
                  <ArrowSquareOut size={12} weight="thin" />
                ) : undefined
              }
            >
              {view.actionLabel}
            </Button>
            <button
              type="button"
              aria-expanded={rawOpen}
              onClick={() => setRawOpen((open) => !open)}
              className="ml-auto inline-flex items-center gap-1 rounded-sm px-1 text-[11.5px] text-ink-muted hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {copy.conversation.turnProtocolFailureRaw}
              <CaretDown
                size={11}
                weight="thin"
                className={cn(
                  "transition-transform duration-(--motion-fast)",
                  rawOpen && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>
      </div>
      {rawOpen && (
        <div className="animate-fade-in px-4 pb-4">
          <pre className="max-h-[200px] select-text overflow-y-auto whitespace-pre-wrap rounded-callout border border-line bg-app px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-ink-soft">
            {error.raw}
          </pre>
        </div>
      )}
    </div>
  );
}
