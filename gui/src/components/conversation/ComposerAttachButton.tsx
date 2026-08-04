import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileText, Image, Paperclip } from "@phosphor-icons/react";

import { COMPOSER_TERTIARY_ICON_BUTTON } from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

/**
 * The 📎 button. On image-capable runtimes it opens a two-item menu —
 * "attach image" (the hidden file input next to its ref in the container)
 * and "reference files…" (native path picker → placeholder insertion).
 * On runtimes without image support only the reference action exists, so
 * the button skips the menu and triggers it directly.
 *
 * Files picked through "reference files…" always become path references,
 * even image files — the two menu items make the intent explicit, unlike
 * a drop, where the image / file split is by extension (PRD 定案 1).
 */
export function ComposerAttachButton({
  disabled,
  imagesEnabled,
  onPickImages,
  onReferenceFiles,
}: {
  disabled: boolean;
  imagesEnabled: boolean;
  onPickImages: () => void;
  onReferenceFiles: () => void;
}) {
  const copy = useCopy();
  const label = imagesEnabled
    ? copy.composer.attachTooltip
    : copy.composer.referenceFiles;

  /* aria-disabled + click no-op instead of `disabled`: a disabled
     element swallows pointer events, so its explanatory tooltip could
     never open (same pattern as the Stop button in ComposerActionSlot). */
  const trigger = (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={
        imagesEnabled
          ? undefined // menu trigger handles the click
          : () => {
              if (!disabled) onReferenceFiles();
            }
      }
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={cn(
        COMPOSER_TERTIARY_ICON_BUTTON,
        "data-[state=open]:bg-hover data-[state=open]:text-ink",
        disabled &&
          "cursor-not-allowed opacity-50 hover:translate-y-0 hover:bg-transparent hover:text-ink-muted active:translate-y-0 active:scale-100",
      )}
    >
      <Paperclip size={17} weight="thin" />
    </button>
  );

  if (!imagesEnabled) {
    return <TooltipLabel text={label}>{trigger}</TooltipLabel>;
  }

  return (
    <DropdownMenu.Root>
      <TooltipLabel text={label}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          {trigger}
        </DropdownMenu.Trigger>
      </TooltipLabel>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={6}
          className={cn(
            "galley-pop-in z-[70] min-w-[168px] rounded-md border border-line bg-elevated p-1",
            "text-[13px] text-ink shadow-elevated",
          )}
        >
          <DropdownMenu.Item
            onSelect={onPickImages}
            className="flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
          >
            <Image size={14} weight="thin" className="shrink-0" />
            {copy.composer.attachImage}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onReferenceFiles}
            className="flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none data-[highlighted]:bg-hover"
          >
            <FileText size={14} weight="thin" className="shrink-0" />
            {copy.composer.referenceFiles}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
