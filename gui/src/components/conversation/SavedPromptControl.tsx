import * as Dialog from "@radix-ui/react-dialog";
import { BookmarkSimple } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { PromptManagerDialog } from "@/components/conversation/PromptManagerDialog";
import { Button, DialogActionRow } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  PROMPT_PRESET_IDS,
  type PromptPreset,
  type ResolvedSavedPrompt,
} from "@/lib/saved-prompts";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SavedPromptControlProps {
  currentText: string;
  onPrefill: (text: string) => void;
  onReturnFocus?: () => void;
  disabled?: boolean;
  className?: string;
}

const SAVED_PROMPT_TRIGGER_BUTTON = cn(
  "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted",
  "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
  "hover:-translate-y-px active:translate-y-[2px] active:scale-[0.97]",
  "hover:bg-hover hover:text-ink outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:scale-100 disabled:hover:bg-transparent disabled:hover:text-ink-muted",
);

export function SavedPromptControl({
  currentText,
  onPrefill,
  onReturnFocus,
  disabled = false,
  className,
}: SavedPromptControlProps) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  const [managerOpen, setManagerOpen] = useState(false);
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
      setManagerOpen(false);
      window.setTimeout(() => onReturnFocus?.(), 0);
    }
  };

  return (
    <>
      <TooltipLabel text={promptCopy.trigger} side="top">
        <button
          type="button"
          aria-label={promptCopy.trigger}
          disabled={disabled}
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.currentTarget.blur();
            setManagerOpen(true);
          }}
          className={cn(SAVED_PROMPT_TRIGGER_BUTTON, className)}
        >
          <BookmarkSimple size={17} weight="thin" />
        </button>
      </TooltipLabel>

      <PromptManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        presets={presets}
        onUsePrompt={(prompt) => applyPrompt(prompt, { closeManager: true })}
      />

      <ReplaceDraftDialog
        open={Boolean(pendingPrompt)}
        prompt={pendingPrompt}
        onOpenChange={(open) => {
          if (open) return;
          setPendingPrompt(null);
          setPendingPromptCloseManager(false);
        }}
        onConfirm={() => {
          if (!pendingPrompt) return;
          onPrefill(pendingPrompt.body);
          if (pendingPromptCloseManager) {
            setManagerOpen(false);
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
            "fixed left-1/2 top-1/2 z-50 w-[380px] -translate-x-1/2 -translate-y-1/2",
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
              leadingIcon={<BookmarkSimple size={12} weight="thin" />}
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
