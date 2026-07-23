import { Paperclip } from "@phosphor-icons/react";

import { COMPOSER_TERTIARY_ICON_BUTTON } from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * The 📎 button that opens the hidden file input (which stays in the
 * container next to its ref). The container renders this only when
 * imagesEnabled.
 */
export function ComposerAttachButton({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: () => void;
}) {
  const copy = useCopy();
  return (
    <TooltipLabel text={copy.composer.attachImage}>
      {/* aria-disabled + click no-op instead of `disabled`:
          a disabled element swallows pointer events, so its
          explanatory tooltip could never open (same pattern
          as the Stop button in ComposerActionSlot). */}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={preventMouseFocus}
        onClick={() => {
          if (disabled) return;
          onPick();
        }}
        aria-disabled={disabled || undefined}
        aria-label={copy.composer.attachImage}
        className={cn(
          COMPOSER_TERTIARY_ICON_BUTTON,
          disabled &&
            "cursor-not-allowed opacity-50 hover:translate-y-0 hover:bg-transparent hover:text-ink-muted active:translate-y-0 active:scale-100",
        )}
      >
        <Paperclip size={17} weight="thin" />
      </button>
    </TooltipLabel>
  );
}
