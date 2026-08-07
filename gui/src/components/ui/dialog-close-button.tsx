import * as Dialog from "@radix-ui/react-dialog";
import { X as XIcon } from "@phosphor-icons/react";

import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The one top-right close X for content dialogs. Confirm / forced-choice
 * dialogs (ConfirmActionDialog, FirstClose, YoloIntro) intentionally have
 * no X — their close semantics live in the footer buttons. See
 * docs/design/overlays-and-settings.md → Dialog 关闭按钮.
 *
 * - `inline` (default): ghost button inside the header row.
 * - `floating`: same ghost register plus a translucent blurred pad, for
 *   an X that sits on top of scrollable content or imagery (Settings,
 *   ImagePreview); the caller positions it via `className` or a
 *   positioned wrapper. The pad is a last line of legibility, not a
 *   frame — surfaces that scroll content under the X should also
 *   reserve a calm zone for it (see Settings' top safe zone + fade;
 *   2026-08-07 A/B verdict in the devlog).
 *
 * `size="md"` exists for immersive surfaces where 28px is too small a
 * target (ImagePreview). Closing is left to Radix `Dialog.Close` →
 * `onOpenChange(false)` — no onClick escape hatch, so every dialog keeps
 * a single close path.
 */
export function DialogCloseButton({
  variant = "inline",
  size = "sm",
  className,
}: {
  variant?: "inline" | "floating";
  size?: "sm" | "md";
  className?: string;
}) {
  const copy = useCopy();
  return (
    <Dialog.Close asChild>
      <IconButton
        ariaLabel={copy.common.close}
        tooltip={false}
        variant="ghost"
        size={size}
        className={cn(
          variant === "floating" && "bg-elevated/80 backdrop-blur-sm",
          className,
        )}
      >
        <XIcon size={size === "md" ? 17 : 14} weight="thin" />
      </IconButton>
    </Dialog.Close>
  );
}
