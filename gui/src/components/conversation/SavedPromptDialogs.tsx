import * as Dialog from "@radix-ui/react-dialog";
import { BookOpenText } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { PromptManagerDialog } from "@/components/conversation/PromptManagerDialog";
import { Button, DialogActionRow } from "@/components/ui/button";
import {
  PROMPT_PRESET_IDS,
  type PromptPreset,
  type ResolvedSavedPrompt,
} from "@/lib/saved-prompts";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SavedPromptDialogsProps {
  /** The prompt library is open. Owned by the Composer: its ＋ menu opens
   * it (ComposerAddMenu), so the library has no trigger of its own. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentText: string;
  onPrefill: (text: string) => void;
  onReturnFocus?: () => void;
  disabled?: boolean;
}

/**
 * The saved-prompt library dialog plus its "replace the current draft?"
 * confirm. Until 2026-10-03 this rendered its own bookmark button in the
 * Composer's right-hand row; the entry now lives in the ＋ menu next to
 * files and folders (design/conversation.md, 常用提示词入口).
 */
export function SavedPromptDialogs({
  open,
  onOpenChange,
  currentText,
  onPrefill,
  onReturnFocus,
  disabled = false,
}: SavedPromptDialogsProps) {
  const [pendingPrompt, setPendingPrompt] =
    useState<ResolvedSavedPrompt | null>(null);
  const [pendingPromptCloseManager, setPendingPromptCloseManager] =
    useState(false);
  const presets = usePromptPresets();

  const applyPrompt = (
    prompt: ResolvedSavedPrompt,
    options: { closeManager?: boolean } = {},
  ) => {
    if (disabled) return;
    if (currentText.trim().length > 0 && currentText !== prompt.body) {
      setPendingPrompt(prompt);
      setPendingPromptCloseManager(Boolean(options.closeManager));
      return;
    }
    onPrefill(prompt.body);
    if (options.closeManager) {
      onOpenChange(false);
      window.setTimeout(() => onReturnFocus?.(), 0);
    }
  };

  return (
    <>
      <PromptManagerDialog
        open={open}
        onOpenChange={onOpenChange}
        presets={presets}
        onUsePrompt={(prompt) => applyPrompt(prompt, { closeManager: true })}
      />

      <ReplaceDraftDialog
        open={Boolean(pendingPrompt)}
        prompt={pendingPrompt}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          setPendingPrompt(null);
          setPendingPromptCloseManager(false);
        }}
        onConfirm={() => {
          if (!pendingPrompt) return;
          onPrefill(pendingPrompt.body);
          if (pendingPromptCloseManager) {
            onOpenChange(false);
          }
          setPendingPrompt(null);
          setPendingPromptCloseManager(false);
          window.setTimeout(() => onReturnFocus?.(), 0);
        }}
      />
    </>
  );
}

function ReplaceDraftDialog({
  open,
  prompt,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  prompt: ResolvedSavedPrompt | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <Dialog.Title className="text-[16px] font-semibold text-ink">
            {promptCopy.replaceDraftTitle}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
            {promptCopy.replaceDraftBody(prompt?.title ?? "")}
          </Dialog.Description>
          <DialogActionRow>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {copy.common.cancel}
            </Button>
            <Button
              variant="primary"
              leadingIcon={<BookOpenText size={12} weight="thin" />}
              onClick={onConfirm}
            >
              {promptCopy.replaceDraftAction}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function usePromptPresets(): PromptPreset[] {
  const copy = useCopy();
  const presets = copy.composer.savedPrompts.presets;
  // Order is deliberate: the three differentiated-capability presets
  // (local files, web browser, multi-source research) sit at positions
  // 3 / 5 / 7 so they're woven through the grid rather than buried at the
  // end — the library doubles as capability discovery. See design/
  // conversation.md.
  return useMemo(
    () =>
      (
        [
          "summarizeMaterial",
          "informationCheck",
          "localFiles",
          "translatePolish",
          "webExtraction",
          "reviewDraft",
          "multiSourceResearch",
          "tableCleanup",
          "preflightChecklist",
        ] as const
      ).map((key) => ({
        id: PROMPT_PRESET_IDS[key],
        title: presets[key].title,
        description: presets[key].description,
        body: presets[key].body,
      })),
    [presets],
  );
}
