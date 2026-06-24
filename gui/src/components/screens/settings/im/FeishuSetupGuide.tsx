import { CaretDown, CaretRight, ChatCircleText, Check, Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import type {
  FeishuSetupStep,
  FeishuSetupStepPart,
  ImCopy,
} from "./types";

export function FeishuSetupGuide({
  imCopy,
  status,
  credentialsForm,
  saveAction,
  startAction,
  openDisabled,
  onOpenConsole,
  startSectionIndex = 0,
  statusPlacement = "bottom",
  afterStatus,
  collapsible = false,
}: {
  imCopy: ImCopy;
  status: string;
  credentialsForm?: ReactNode;
  saveAction?: ReactNode;
  startAction?: ReactNode;
  openDisabled: boolean;
  onOpenConsole: () => void;
  startSectionIndex?: number;
  statusPlacement?: "top" | "bottom";
  afterStatus?: ReactNode;
  /** When true, wrap the setup sections in a collapsed-by-default
   * disclosure. Used for the running state, where the steps are a
   * reference fallback rather than the primary content — keeps the
   * "service running" view focused on status, not onboarding. */
  collapsible?: boolean;
}) {
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [permissionsCopied, setPermissionsCopied] = useState(false);
  const permissionsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (permissionsTimerRef.current !== null) {
        window.clearTimeout(permissionsTimerRef.current);
      }
    };
  }, []);

  const copyPermissions = async () => {
    try {
      await copyTextToClipboard(imCopy.feishuPermissions);
      setPermissionsCopied(true);
      if (permissionsTimerRef.current !== null) {
        window.clearTimeout(permissionsTimerRef.current);
      }
      permissionsTimerRef.current = window.setTimeout(
        () => setPermissionsCopied(false),
        1400,
      );
    } catch (error) {
      console.warn("[FeishuSetupGuide] copy permissions failed", error);
    }
  };

  const sectionsInner = imCopy.feishuSetupSections
    .slice(startSectionIndex)
    .map((section, index) => {
      const originalIndex = startSectionIndex + index;
      return (
        <FeishuSetupSection
          key={section.title}
          index={originalIndex + 1}
          title={section.title}
          steps={section.steps}
          afterStep={
            originalIndex === 0
              ? {
                  stepIndex: 2,
                  content: (
                    <FeishuPermissionsList
                      items={imCopy.feishuPermissionItems}
                      copied={permissionsCopied}
                      copyLabel={imCopy.copyFeishuPermissions}
                      copiedLabel={imCopy.feishuPermissionsCopied}
                      onCopy={() => void copyPermissions()}
                    />
                  ),
                }
              : null
          }
        >
          {originalIndex === 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={openDisabled}
              leadingIcon={<ChatCircleText size={13} />}
              onClick={onOpenConsole}
            >
              {imCopy.openFeishuConsole}
            </Button>
          ) : null}
          {originalIndex === 1 && (credentialsForm || saveAction) ? (
            <div className="space-y-3">
              {credentialsForm}
              {saveAction}
            </div>
          ) : null}
          {originalIndex === 2 ? startAction : null}
        </FeishuSetupSection>
      );
    });

  return (
    <div className="max-w-[76ch] space-y-3">
      {statusPlacement === "top" ? (
        <p className="pl-7 text-[12px] leading-[1.45] text-ink-muted">
          {status}
        </p>
      ) : null}
      {afterStatus}
      {collapsible ? (
        <div>
          <button
            type="button"
            onClick={() => setStepsExpanded((v) => !v)}
            aria-expanded={stepsExpanded}
            className="group/disclosure flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[12px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
          >
            {stepsExpanded ? (
              <CaretDown size={11} weight="bold" />
            ) : (
              <CaretRight size={11} weight="bold" />
            )}
            <span>{imCopy.feishuSetupCollapsed}</span>
          </button>
          {stepsExpanded ? (
            <div className="mt-2 divide-y divide-line/70">{sectionsInner}</div>
          ) : null}
        </div>
      ) : (
        <div className="divide-y divide-line/70">{sectionsInner}</div>
      )}
      {statusPlacement === "bottom" ? (
        <p className="pl-7 text-[12px] leading-[1.45] text-ink-muted">
          {status}
        </p>
      ) : null}
    </div>
  );
}

function FeishuSetupSection({
  index,
  title,
  steps,
  children,
  afterStep,
}: {
  index: number;
  title: string;
  steps: FeishuSetupStep[];
  children?: ReactNode;
  afterStep?: { stepIndex: number; content: ReactNode } | null;
}) {
  return (
    <section className="py-3 first:pt-0 last:pb-0">
      <div className="flex gap-2.5">
        <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-[11px] font-medium tabular-nums text-ink-soft">
          {index}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h4 className="text-[12px] font-semibold leading-[1.45] text-ink">
            {title}
          </h4>
          <ul className="space-y-1 text-[12.5px] leading-[1.5] text-ink-soft">
            {steps.map((step, stepIndex) => (
              <li key={stepIndex} className="flex min-w-0 gap-2">
                <span className="mt-[0.65em] size-1 shrink-0 rounded-full bg-ink-muted/60" />
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="block min-w-0 break-words">
                    <FeishuSetupStepText step={step} />
                  </span>
                  {afterStep?.stepIndex === stepIndex ? afterStep.content : null}
                </div>
              </li>
            ))}
          </ul>
          {children ? <div className="pt-1">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

function FeishuSetupStepText({ step }: { step: FeishuSetupStep }) {
  return (
    <>
      {step.parts.map((part, index) => (
        <FeishuSetupStepPart key={index} part={part} />
      ))}
    </>
  );
}

function FeishuSetupStepPart({ part }: { part: FeishuSetupStepPart }) {
  if ("code" in part && part.code) {
    return (
      <code className="rounded-sm border border-line/80 bg-app px-1 py-[1px] font-mono text-[11.5px] text-ink">
        {part.text}
      </code>
    );
  }

  if ("emphasis" in part && part.emphasis) {
    return <strong className="font-semibold text-ink">{part.text}</strong>;
  }

  return <>{part.text}</>;
}

function FeishuPermissionsList({
  items,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  items: ImCopy["feishuPermissionItems"];
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="relative min-w-0 rounded-sm bg-hover/35 px-2.5 py-2">
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          "absolute right-2 top-2 inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium",
          "transition-[background-color,border-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-px active:duration-[70ms]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          copied
            ? "border-success/30 bg-success/[var(--opacity-subtle)] text-success"
            : "border-line bg-surface text-ink-muted hover:border-line-strong hover:bg-hover hover:text-ink",
        )}
      >
        {copied ? (
          <Check size={11} weight="bold" />
        ) : (
          <Copy size={11} weight="thin" />
        )}
        {copied ? copiedLabel : copyLabel}
      </button>
      <ul className="space-y-1.5 sm:pr-20">
        {items.map((item) => (
          <li
            key={item.name}
            className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-baseline sm:gap-3"
          >
            <code className="min-w-0 break-all rounded-sm border border-line/70 bg-surface px-1.5 py-[1px] font-mono text-[11.5px] leading-[1.5] text-ink sm:break-normal">
              {item.name}
            </code>
            <span className="min-w-0 text-[12px] leading-[1.5] text-ink-muted">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
