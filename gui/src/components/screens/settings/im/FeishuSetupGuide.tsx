import { ChatCircleText, ClipboardText } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import { ExternalLinkIcon } from "../external-link";
import { INLINE_CODE_CLASS } from "../inline-code";
import type { FeishuSetupStep, FeishuSetupStepPart, ImCopy } from "./types";

/**
 * The six-section Feishu setup guide. The card decides where it sits
 * (open in onboarding and first run, folded once set up) and which
 * controls it carries: the App ID / App Secret form in section 2, the
 * start button in section 3. Without them it is the read-only reference.
 */
export function FeishuSetupGuide({
  imCopy,
  credentialsForm,
  saveAction,
  startAction,
  openDisabled,
  onOpenConsole,
}: {
  imCopy: ImCopy;
  credentialsForm?: ReactNode;
  saveAction?: ReactNode;
  startAction?: ReactNode;
  openDisabled: boolean;
  onOpenConsole: () => void;
}) {
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
        COPY_FEEDBACK_MS,
      );
    } catch (error) {
      console.warn("[FeishuSetupGuide] copy permissions failed", error);
    }
  };

  return (
    <div className="max-w-[76ch] divide-y divide-line/70">
      {imCopy.feishuSetupSections.map((section, index) => (
        <FeishuSetupSection
          key={section.title}
          index={index + 1}
          title={section.title}
          steps={section.steps}
          afterStep={
            index === 0
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
          {index === 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={openDisabled}
              leadingIcon={<ChatCircleText size={13} weight="thin" />}
              trailingIcon={<ExternalLinkIcon />}
              onClick={onOpenConsole}
            >
              {imCopy.openFeishuConsole}
            </Button>
          ) : null}
          {index === 1 && (credentialsForm || saveAction) ? (
            <div className="space-y-3">
              {credentialsForm}
              {saveAction}
            </div>
          ) : null}
          {index === 2 ? startAction : null}
        </FeishuSetupSection>
      ))}
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
        <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-ui-label font-medium tabular-nums text-ink-soft">
          {index}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h4 className="text-ui-meta font-semibold leading-dense text-ink">
            {title}
          </h4>
          <ul className="space-y-1 text-ui-secondary leading-notice text-ink-soft">
            {steps.map((step, stepIndex) => (
              <li key={stepIndex} className="flex min-w-0 gap-2">
                <span className="mt-[0.65em] size-1 shrink-0 rounded-full bg-ink-muted/60" />
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="block min-w-0 break-words">
                    <FeishuSetupStepText step={step} />
                  </span>
                  {afterStep?.stepIndex === stepIndex
                    ? afterStep.content
                    : null}
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
    return <code className={INLINE_CODE_CLASS}>{part.text}</code>;
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
      {/* Same control as Browser Control's address copy: a ghost button
          whose label flips to 已复制 for COPY_FEEDBACK_MS. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1"
        leadingIcon={<ClipboardText size={13} weight="thin" />}
        onClick={onCopy}
      >
        {copied ? copiedLabel : copyLabel}
      </Button>
      <ul className="space-y-1.5 sm:pr-24">
        {items.map((item) => (
          <li
            key={item.name}
            className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-baseline sm:gap-3"
          >
            <code
              className={cn(
                INLINE_CODE_CLASS,
                "min-w-0 break-all leading-notice sm:break-normal",
              )}
            >
              {item.name}
            </code>
            <span className="min-w-0 text-ui-meta leading-notice text-ink-muted">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
