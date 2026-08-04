import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleNotch,
  FolderOpen,
  Warning,
  X,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import type { TutorialId } from "@/lib/onboarding-tutorials";
import { useCopy } from "@/lib/i18n";
import { EXAMPLE_GA_PATH } from "@/lib/platform";
import { cn } from "@/lib/utils";

export type PathValidation =
  | { kind: "ok"; foundAgentmain: boolean; rawPath: string }
  | { kind: "missing-agentmain"; rawPath: string }
  | { kind: "not-found"; rawPath: string }
  | { kind: "checking" }
  | null;

interface StepAttachProps {
  path: string;
  validation: PathValidation;
  onPathChange: (path: string) => void;
  onPickFolder: () => void;
  onBack: () => void;
  onContinue: () => void;
  /**
   * Open a tutorial modal — surfaced under the ValidationLine when
   * the path check fails with a known fix-it path. Onboarding wires
   * this to its activeTutorial state.
   */
  onShowTutorial?: (id: TutorialId) => void;
}

/**
 * Onboarding Step 1 — Attach existing GA. DESIGN.md §5 Step 1.
 *
 * Path input + folder picker button + real-time validation feedback +
 * continue CTA (disabled until validation === "ok"). The validation
 * itself happens in the parent — bridge or Tauri shell can answer
 * "does this path exist? does it contain agentmain.py?" without
 * blocking the UI.
 *
 * The "还没装 GenericAgent？" link is a quiet escape hatch for new
 * users; opens in the system browser.
 */
export function StepAttach({
  path,
  validation,
  onPathChange,
  onPickFolder,
  onBack,
  onContinue,
  onShowTutorial,
}: StepAttachProps) {
  const copy = useCopy();
  const onboardingCopy = copy.onboarding;
  const ready = validation?.kind === "ok";
  const tutorialForFailure: TutorialId | null =
    validation?.kind === "not-found"
      ? "download-ga"
      : validation?.kind === "missing-agentmain"
        ? "wrong-directory"
        : null;
  const tutorialLabel =
    tutorialForFailure === "download-ga"
      ? onboardingCopy.downloadGuide
      : tutorialForFailure === "wrong-directory"
        ? onboardingCopy.folderGuide
        : null;

  return (
    <div className="max-w-[580px]">
      <h1 className="m-0 text-[32px] font-semibold leading-tight tracking-[0.005em] text-ink [@media(max-height:719px)]:text-[26px]">
        {onboardingCopy.attachTitle}
      </h1>
      <p className="mb-7 mt-2.5 text-[15.5px] italic leading-[1.55] text-ink-soft">
        {onboardingCopy.attachSubtitle}
      </p>

      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {onboardingCopy.gaPathLabel}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={EXAMPLE_GA_PATH}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-sm border border-line bg-elevated px-3 py-2 font-mono text-[13px] text-ink outline-none transition-colors duration-(--motion-fast) ease-firm placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20"
        />
        <Button
          variant="accent-secondary"
          onClick={onPickFolder}
          className="shrink-0 px-3 py-2 text-[12.5px]"
          leadingIcon={<FolderOpen size={13} weight="thin" />}
        >
          {copy.common.choose}
        </Button>
      </div>

      <div className="min-h-[20px]">
        <ValidationLine validation={validation} />
      </div>

      {tutorialForFailure && tutorialLabel && onShowTutorial && (
        <Button
          variant="brand-soft"
          size="sm"
          onClick={() => onShowTutorial(tutorialForFailure)}
          className="mt-1"
          leadingIcon={<BookOpen size={11} weight="thin" />}
        >
          {tutorialLabel}
        </Button>
      )}

      <div className="mt-9 flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={onBack}
          className="text-[13px]"
          leadingIcon={<ArrowLeft size={13} weight="thin" />}
        >
          {copy.common.back}
        </Button>
        <Button
          onClick={onContinue}
          disabled={!ready}
          size="lg"
          className="ml-auto"
          trailingIcon={<ArrowRight size={13} weight="bold" />}
        >
          {copy.common.continue}
        </Button>
      </div>
    </div>
  );
}

function ValidationLine({ validation }: { validation: PathValidation }) {
  const copy = useCopy().onboarding;
  if (!validation) return null;
  const cls = "mt-2 flex items-center gap-1.5 text-[12.5px]";
  switch (validation.kind) {
    case "ok":
      return (
        <div className={cn(cls, "text-success")}>
          <Check size={12} weight="thin" />
          {copy.foundGA}{" "}
          {validation.foundAgentmain && (
            <span className="text-ink-muted">· {copy.agentmainVisible}</span>
          )}
        </div>
      );
    case "missing-agentmain":
      return (
        <div className={cn(cls, "text-warning")}>
          <Warning size={12} weight="thin" />
          {copy.pathMissingAgentmain}
        </div>
      );
    case "not-found":
      return (
        <div className={cn(cls, "text-error")}>
          <X size={12} weight="thin" />
          {copy.pathNotFound}
        </div>
      );
    case "checking":
      return (
        <div className={cn(cls, "text-ink-muted")}>
          <span className="spin">
            <CircleNotch size={12} weight="thin" />
          </span>
          {copy.checking}
        </div>
      );
  }
}
