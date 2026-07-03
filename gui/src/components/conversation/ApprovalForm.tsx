import {
  Check,
  CheckCircle,
  FolderSimple,
  Globe,
  Info,
  Prohibit,
  X,
} from "@phosphor-icons/react";

import { ApprovalRenderer } from "@/components/conversation/approval-renderers";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  ConversationToolEvent,
  OnApprove,
  RiskLevel,
} from "@/types/conversation";
import type { ApprovalDecision } from "@/types/ipc";

interface ApprovalFormProps {
  tool: ConversationToolEvent;
  onApprove?: OnApprove;
  /** Once a decision is recorded, lock the form into the result state. */
  approvalDecision?: string;
  /** Name of the project the active session belongs to, if any.
   * When set, the "Always allow in this Project" button shows the
   * actual project name ("Always allow in {projectName}") and the
   * always_allow_project decision becomes available. When
   * undefined, the button is hidden — at V0.1 we don't expose a
   * scoping affordance that points at nothing. */
  projectName?: string;
}

/**
 * Inline form rendered inside a `waiting_approval` ToolCallout body.
 * Per DESIGN.md §4.6 (Approval Card).
 *
 * #3 shipped the generic structure (risk pill, action sentence, args
 * fallback, four decision buttons, post-decision lock-in pill); #6
 * routes the body through ApprovalRenderer for tool-specific views
 * (file_patch split diff via PatchView, file_write path+mode +
 * disclaimer, code_run mono command + language pill,
 * start_long_term_update memory key + content preview).
 *
 * The "Always allow globally" button is disabled for high-sensitivity
 * tools that should never be globally auto-approved (per PRD §11.3:
 * `start_long_term_update`). Bridge does not enforce this; we do
 * defense-in-depth at the UI.
 */
export function ApprovalForm({
  tool,
  onApprove,
  approvalDecision,
  projectName,
}: ApprovalFormProps) {
  const copy = useCopy();
  const decided = approvalDecision !== undefined && approvalDecision !== null;
  const reason = approvalReason(tool.name, copy);
  const globalDisabled = HIGH_SENSITIVITY_TOOLS.has(tool.name);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        {tool.riskLevel && <RiskPill level={tool.riskLevel} />}
        <span className="text-[13px] text-ink-soft">
          {actionSentence(tool, copy)}
        </span>
      </div>

      {/* Two-tier tool description: GA's actual tool name in mono
          (primary weight) so power users see the precise identifier,
          paired with a plain-Chinese explanation below for first-time
          / non-technical users. Preserves precision without crowding
          the approval moment with English jargon. */}
      <div className="mb-3 flex items-start gap-1.5">
        <Info
          size={12}
          weight="thin"
          className="mt-1 shrink-0 text-ink-muted"
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] leading-[1.4] text-ink">
            {tool.name}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-[1.5] text-ink-soft">
            {reason}
          </div>
        </div>
      </div>

      {/*
       * Tool-specific renderer slot — dispatches by tool.name. See
       * components/conversation/approval-renderers.tsx for the
       * file_patch / file_write / code_run / start_long_term_update
       * branches and the generic args fallback.
       */}
      <ApprovalRenderer tool={tool} />

      {!decided ? (
        <div className="flex flex-wrap gap-2">
          <DecisionButton
            variant="primary"
            icon={<Check size={13} weight="bold" />}
            onClick={() => tool.approvalId && onApprove?.(tool.approvalId, "allow_once")}
          >
            {copy.approval.allow}
          </DecisionButton>
          <DecisionButton
            variant="danger-ghost"
            icon={<X size={13} weight="bold" />}
            onClick={() => tool.approvalId && onApprove?.(tool.approvalId, "deny")}
          >
            {copy.approval.deny}
          </DecisionButton>
          {projectName && (
            <DecisionButton
              variant="brand-ghost"
              icon={<FolderSimple size={13} weight="thin" />}
              onClick={() => tool.approvalId && onApprove?.(tool.approvalId, "always_allow_project")}
            >
              {copy.approval.allowProject(projectName)}
            </DecisionButton>
          )}
          <DecisionButton
            variant="brand-ghost"
            icon={<Globe size={13} weight="thin" />}
            onClick={() => tool.approvalId && onApprove?.(tool.approvalId, "always_allow_global")}
            disabled={globalDisabled}
            title={globalDisabled ? copy.approval.highRiskNoGlobal : undefined}
          >
            {copy.approval.allowGlobal}
          </DecisionButton>
        </div>
      ) : (
        <DecisionPill decision={approvalDecision as ApprovalDecision} />
      )}
    </div>
  );
}

// ---------- internals ----------

// Short Chinese descriptions paired with the tool's English mono
// name in the JSX above (two-tier visual hierarchy — see render
// site for the layout rationale). Keep these factual and brief;
// the long-form "审批后 GA 才会执行" boilerplate is implied by
// the dialog's presence and the Allow / Deny buttons.
const HIGH_SENSITIVITY_TOOLS = new Set(["start_long_term_update"]);

function approvalReason(
  toolName: string,
  copy: ReturnType<typeof useCopy>,
): string {
  const descriptions = copy.approval.descriptions as Record<string, string>;
  return descriptions[toolName] ?? copy.approval.genericReason;
}

function actionSentence(
  tool: ConversationToolEvent,
  copy: ReturnType<typeof useCopy>,
): string {
  // Prefer a short summary if the caller provided one.
  if (tool.summary) return tool.summary;
  switch (tool.name) {
    case "file_patch":
      return copy.approval.actionFilePatch(pathFromArgs(tool.args));
    case "file_write":
      return copy.approval.actionFileWrite(pathFromArgs(tool.args));
    case "code_run":
      return copy.approval.actionCodeRun;
    default:
      return copy.approval.actionTool(tool.name);
  }
}

function pathFromArgs(args?: Record<string, unknown>): string {
  if (args && typeof args.path === "string") return args.path;
  return "—";
}

function RiskPill({ level }: { level: RiskLevel }) {
  const copy = useCopy();
  const text = copy.approval.risk;
  const cls: Record<RiskLevel, string> = {
    low: "bg-info/[var(--opacity-soft)] text-info",
    medium: "bg-warning/[var(--opacity-soft)] text-warning",
    high: "bg-error/[var(--opacity-soft)] text-error",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-[0.02em]",
        cls[level],
      )}
    >
      {text[level]}
    </span>
  );
}

interface DecisionButtonProps {
  variant: "primary" | "danger-ghost" | "brand-ghost";
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

function DecisionButton({
  variant,
  icon,
  children,
  onClick,
  disabled,
  title,
}: DecisionButtonProps) {
  const buttonVariant = VARIANT_CLASS[variant];
  return (
    <Button
      variant={buttonVariant}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="text-[13px]"
      leadingIcon={icon}
    >
      {children}
    </Button>
  );
}

const VARIANT_CLASS: Record<DecisionButtonProps["variant"], ButtonVariant> = {
  primary: "primary",
  "danger-ghost": "destructive-soft",
  "brand-ghost": "brand-soft",
};

function DecisionPill({ decision }: { decision: ApprovalDecision }) {
  const copy = useCopy();
  const isDeny = decision === "deny";
  const Icon = isDeny ? Prohibit : CheckCircle;
  const label = copy.approval.decisions;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-callout px-3.5 py-2 text-[13px] font-medium",
        isDeny
          ? "bg-error/[var(--opacity-subtle)] text-error"
          : "bg-brand-soft text-brand-strong",
      )}
    >
      <Icon size={14} weight="thin" />
      <span>{label[decision]}</span>
    </div>
  );
}
