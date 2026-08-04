import * as Dialog from "@radix-ui/react-dialog";
import { Lightning } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface YoloIntroDialogProps {
  /** Whether the modal is currently open. Driven by `!yoloIntroSeen`
   * from the store. The component itself doesn't manage open state —
   * dismissal goes through `onAcknowledge` which persists the prefs
   * flag so the modal never reappears on this device. */
  open: boolean;
  /** Called when the user clicks either CTA. `revertToApproval` is
   * true for the "改回审批模式" button, false for "知道了". */
  onAcknowledge: (revertToApproval: boolean) => void;
}

/**
 * First-launch YOLO disclosure modal.
 *
 * Surfaces ONCE per device on the first post-onboarding MainView
 * entry. Discloses that Galley defaults to YOLO mode (every tool
 * runs without approval) and offers a one-click revert.
 *
 * Why blocking instead of a banner:
 *   - YOLO is a safety-related state. Passive banners get skimmed
 *     and ignored — user starts firing tools without realizing
 *     approval is off.
 *   - This is a one-time interruption (`yolo_intro_seen` pref flips
 *     after either CTA), so the cost is bounded.
 *   - Escape / overlay click / close-X all intentionally blocked.
 *     The user must explicitly pick "知道了" or "改回审批模式" —
 *     that explicit acknowledgment is the whole point.
 *
 * Visual register: warning-tinted (Lightning icon + warning accent
 * border on icon), matching the TopBar YOLO indicator so the user
 * who later spots the persistent badge recognizes "right, that's
 * what the modal told me about".
 */
export function YoloIntroDialog({ open, onAcknowledge }: YoloIntroDialogProps) {
  const copy = useCopy();
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-6 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-full border border-warning/30 bg-warning/[var(--opacity-subtle)] text-warning">
              <Lightning size={16} weight="thin" />
            </span>
            <Dialog.Title className="text-[17px] font-semibold text-ink">
              {copy.yoloIntro.title}
            </Dialog.Title>
          </div>

          <p className="mb-6 mt-3 text-[13.5px] leading-[1.65] text-ink-soft">
            {copy.yoloIntro.body}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onAcknowledge(true)}>
              {copy.yoloIntro.revert}
            </Button>
            <Button autoFocus onClick={() => onAcknowledge(false)}>
              {copy.yoloIntro.acknowledge}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
