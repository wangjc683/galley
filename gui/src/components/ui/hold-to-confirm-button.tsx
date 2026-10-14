import { CircleNotch } from "@phosphor-icons/react";
import { useEffect, useSyncExternalStore, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import {
  HOLD_TO_CONFIRM_MS,
  holdPointerHandlers,
  type HoldToConfirm,
} from "@/lib/hold-to-confirm";
import { cn } from "@/lib/utils";

/**
 * The confirm button of a confirm that cannot be taken back (main chat
 * ticket 15; docs/design/overlays-and-settings.md 「确认弹窗」): hold it
 * down and it fills from left to right in the error colour, linearly,
 * over {@link HOLD_TO_CONFIRM_MS}; full means confirmed. Letting go,
 * leaving the button or the window losing focus stops it and the fill
 * runs back; letting go early also says 「要按住不放」 under it. Esc is
 * the dialog's to route ({@link HoldToConfirm.cancel}).
 *
 * Pointer events only — no click handler, no key handler — so Enter and
 * Space do nothing, and no pointer capture, so leaving the button lets
 * go. The fill is the hold's state, not decoration: it shows under
 * `prefers-reduced-motion` too (only the run back is instant there).
 * While the confirmed action runs (`busy`) the fill stays full beside
 * the busy label.
 */
export function HoldToConfirmButton({
  hold,
  label,
  busyLabel,
  hint,
  busy = false,
  disabled = false,
}: {
  hold: HoldToConfirm;
  label: string;
  busyLabel: string;
  /** Under the button after a release that came too early. */
  hint: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { holding, tooShort } = useSyncExternalStore(
    hold.subscribe,
    hold.getSnapshot,
    hold.getSnapshot,
  );
  const inactive = busy || disabled;

  useEffect(() => {
    hold.setEnabled(!inactive);
  }, [hold, inactive]);

  useEffect(() => {
    // Switching away mid-hold lets go: the release would land elsewhere.
    const onBlur = () => hold.cancel();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [hold]);

  const full = busy || (holding && !disabled);
  // The run back is the class's transition; the fill (and the stay at
  // full while busy) are inline, so reduced motion cannot drop them.
  const fill: CSSProperties = full
    ? {
        transform: "scaleX(1)",
        transition: busy ? "none" : `transform ${HOLD_TO_CONFIRM_MS}ms linear`,
      }
    : { transform: "scaleX(0)" };

  return (
    <span className="relative inline-flex">
      <Button
        variant="destructive-soft"
        disabled={inactive}
        className="relative overflow-hidden"
        data-holding={holding || undefined}
        {...holdPointerHandlers(hold)}
      >
        <span
          aria-hidden
          data-hold-fill
          style={fill}
          className={cn(
            "pointer-events-none absolute inset-0 origin-left bg-error/[var(--opacity-medium)]",
            "transition-transform duration-(--motion-base) ease-firm motion-reduce:transition-none",
          )}
        />
        {/* After the fill, positioned, so the label paints over it. */}
        <span className="relative inline-flex items-center gap-1.5">
          {busy && <CircleNotch size={13} className="spin" />}
          {busy ? busyLabel : label}
        </span>
      </Button>
      {tooShort && !inactive && (
        <span
          role="status"
          className="pointer-events-none absolute right-0 top-full mt-1 whitespace-nowrap text-ui-tertiary leading-notice text-ink-muted"
        >
          {hint}
        </span>
      )}
    </span>
  );
}
