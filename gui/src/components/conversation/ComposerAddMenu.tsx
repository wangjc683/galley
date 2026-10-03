import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookOpenText,
  FolderSimple,
  Paperclip,
  Plus,
} from "@phosphor-icons/react";
import { useRef } from "react";

import { COMPOSER_TERTIARY_ICON_BUTTON } from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

const MENU_ITEM = cn(
  "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
  "data-[highlighted]:bg-hover",
);

/**
 * The ＋ at the left of the Composer's button row: everything that puts
 * something into the message — files or images, folders, a saved prompt.
 * It replaced two unlabeled icons on the right (bookmark + paperclip,
 * 2026-10-03): one familiar entry with worded rows instead of two
 * metaphors to decode, and people who open it for a file pass the prompt
 * library on the way (design/conversation.md, 常用提示词入口).
 *
 * The file row follows the drop's split — images attach, everything else
 * becomes a path reference — so the user never chooses between "image"
 * and "file" (PRD 定案 1). Folders get their own row because the native
 * picker can't mix files and folders in one panel.
 */
export function ComposerAddMenu({
  disabled,
  imagesEnabled,
  onPickFiles,
  onPickFolders,
  onOpenPrompts,
  onReturnFocus,
}: {
  disabled: boolean;
  imagesEnabled: boolean;
  onPickFiles: () => void;
  onPickFolders: () => void;
  onOpenPrompts: () => void;
  /** Focus back to the textarea when the menu closes, so a picked file
   * lands at the caret (or replaces a selected prompt slot) instead of
   * being appended at the end. */
  onReturnFocus: () => void;
}) {
  const copy = useCopy();
  const label = copy.composer.addMenuTooltip;
  // The prompt library is a modal dialog with its own focus handling;
  // pulling focus to the textarea under it would only bounce off the
  // dialog's trap (same flag as SessionTitleMenu's rename).
  const promptsRequestedRef = useRef(false);

  return (
    <DropdownMenu.Root>
      <TooltipLabel text={label}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          {/* aria-disabled + Radix's own disabled gate instead of the
              native `disabled`: a disabled element swallows pointer
              events, so its tooltip could never open. */}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            aria-disabled={disabled || undefined}
            aria-label={label}
            className={cn(
              COMPOSER_TERTIARY_ICON_BUTTON,
              "data-[state=open]:bg-hover data-[state=open]:text-ink",
              disabled &&
                "cursor-not-allowed opacity-50 hover:translate-y-0 hover:bg-transparent hover:text-ink-muted active:translate-y-0 active:scale-100",
            )}
          >
            <Plus size={17} weight="thin" />
          </button>
        </DropdownMenu.Trigger>
      </TooltipLabel>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (promptsRequestedRef.current) {
              promptsRequestedRef.current = false;
              return;
            }
            onReturnFocus();
          }}
          className={cn(
            "galley-pop-in z-[70] min-w-[168px] rounded-md border border-line bg-elevated p-1",
            "text-[13px] text-ink shadow-elevated",
          )}
        >
          <DropdownMenu.Item onSelect={onPickFiles} className={MENU_ITEM}>
            <Paperclip size={14} weight="thin" className="shrink-0" />
            {imagesEnabled
              ? copy.composer.addFilesOrImages
              : copy.composer.addFiles}
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={onPickFolders} className={MENU_ITEM}>
            <FolderSimple size={14} weight="thin" className="shrink-0" />
            {copy.composer.addFolders}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={() => {
              promptsRequestedRef.current = true;
              onOpenPrompts();
            }}
            className={MENU_ITEM}
          >
            <BookOpenText size={14} weight="thin" className="shrink-0" />
            {copy.composer.savedPrompts.menuItem}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
