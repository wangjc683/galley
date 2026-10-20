import * as Dialog from "@radix-ui/react-dialog";
import { useId } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useChatGptPlanStore } from "@/stores/chatgpt-plan";

/**
 * The one-time notice after the first Sign in with ChatGPT on this
 * machine (OpenAI's SIWC guidelines; .scratch/chatgpt-siwc ticket 04).
 * App mounts it outside both surfaces that sign in, so it still shows
 * when onboarding hands over to the main screen right after the
 * sign-in. The shell is ConfirmActionDialog's, with one button: there is
 * nothing to cancel.
 */
export function ChatGptPlanNoticeDialog() {
  const copy = useCopy().chatgptPlan;
  const open = useChatGptPlanStore((s) => s.noticeOpen);
  const closeNotice = useChatGptPlanStore((s) => s.closeNotice);
  const descId = useId();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closeNotice();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          aria-describedby={descId}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold text-ink">
            {copy.noticeTitle}
          </Dialog.Title>
          <p
            id={descId}
            className="m-0 mt-2 text-ui-secondary leading-secondary text-ink-soft"
          >
            {copy.noticeBody}
          </p>
          <DialogActionRow>
            <Button variant="primary" autoFocus onClick={closeNotice}>
              {copy.noticeAction}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
