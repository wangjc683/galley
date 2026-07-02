import {
  ArrowSquareOut,
  CaretDown,
  Cube,
  FileCode,
  FolderOpen,
  Info,
  Target,
  Warning,
  X as XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { useCopy, type AppCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  AppError,
  AppErrorHint,
  AppErrorSeverity,
} from "@/types/app-error";

export interface ErrorCardActions {
  /** Retry the original request. Shown when error.retryable is true. */
  onRetry?: () => void;
  /** Switch LLM (used by quota_exceeded hint). */
  onSwitchLLM?: () => void;
  /** Open mykey.py path in editor / Finder (check_llm_config hint). */
  onOpenMyKey?: () => void;
  /** Open the GA install / config docs (check_llm_config hint). */
  onOpenGADocs?: () => void;
  /** Open a project scope from a positive feedback toast. */
  onViewProject?: (projectId: string) => void;
  /** Open a Goal's master session from a completion / failure toast. */
  onViewGoal?: (goalId: string) => void;
  /** Restart enabled Channels from an actionable toast. */
  onRestartChannels?: () => void;
  /** Restart Galley after an app update has been prepared. */
  onRestartAppUpdate?: () => void;
}

interface ErrorCardProps extends ErrorCardActions {
  error: AppError;
  /**
   * "Toast"   — standalone with chrome + close button (top-level toast).
   * "Inline"  — same chrome but no close (conversation history).
   * "Card"    — embedded standalone with chrome (e.g. health check).
   */
  variant?: "toast" | "inline" | "card";
  onDismiss?: () => void;
}

/**
 * The Error Card visual. DESIGN.md §6.2.
 *
 * Same chrome regardless of where it lands (toast / inline / card),
 * with three severity skins and an optional hint variant that wraps
 * the message in actionable guidance ("LLM 配置可能有问题" + buttons,
 * not "401 Unauthorized" + nothing).
 *
 * The expandable "Details" panel surfaces the raw traceback / source —
 * power-user audit trail; default users never see it.
 */
export function ErrorCard({
  error,
  variant = "card",
  onDismiss,
  onRetry,
  onSwitchLLM,
  onOpenMyKey,
  onOpenGADocs,
  onViewProject,
  onViewGoal,
  onRestartChannels,
  onRestartAppUpdate,
}: ErrorCardProps) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const isInline = variant === "inline";
  const sev = SEVERITY_CONFIG[error.severity];
  const hintCfg = error.hint ? hintConfig(copy)[error.hint] : null;

  // Title resolution order:
  //   1. error.title — explicit override (positive-feedback toasts
  //      set this so "已 Archive" doesn't render as "操作未能完成").
  //   2. hintCfg.title — tailored copy for known error hints
  //      (check_llm_config / network / quota_exceeded).
  //   3. defaultTitle(error) — category-flavored fallback.
  const title = error.title ?? hintCfg?.title ?? defaultTitle(error, copy);
  const brief = hintCfg?.brief ?? error.message;
  const hasDetails = hasDiagnosticDetails(error);
  const isCompactInfoToast = variant === "toast" && error.severity === "info";
  const actions = (hintCfg?.actions ?? defaultActions(error, copy)).filter(
    (action) =>
      isActionAvailable(action, error, {
        onRetry,
        onSwitchLLM,
        onOpenMyKey,
        onOpenGADocs,
        onViewProject,
        onViewGoal,
        onRestartChannels,
        onRestartAppUpdate,
      }),
  );

  if (isCompactInfoToast) {
    return (
      <div
        className={cn(
          "rounded-md border bg-elevated px-3 py-2.5 shadow-card",
          sev.borderClass,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex shrink-0">
            <SeverityIcon severity={error.severity} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-ink">
              {title}
            </div>
            {brief && (
              <div className="mt-0.5 select-text text-[12px] leading-5 text-ink-soft">
                {brief}
              </div>
            )}
          </div>
          {onDismiss && (
            <IconButton
              onClick={onDismiss}
              ariaLabel={copy.common.close}
              size="xs"
              className="-mr-1 -mt-0.5"
            >
              <XIcon size={11} weight="thin" />
            </IconButton>
          )}
        </div>

        {actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <ActionButton
                key={a.id}
                action={a}
                error={error}
                onRetry={onRetry}
                onSwitchLLM={onSwitchLLM}
                onOpenMyKey={onOpenMyKey}
                onOpenGADocs={onOpenGADocs}
                onViewProject={onViewProject}
                onViewGoal={onViewGoal}
                onRestartChannels={onRestartChannels}
                onRestartAppUpdate={onRestartAppUpdate}
                onToggleDetails={() => setOpen((v) => !v)}
                detailsOpen={open}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-elevated p-4 shadow-card",
        sev.borderClass,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex shrink-0">
          <SeverityIcon severity={error.severity} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{title}</div>
          <div className="mt-1 select-text text-[13px] text-ink-soft">
            {brief}
          </div>
        </div>
        {!isInline && onDismiss && (
          <IconButton
            onClick={onDismiss}
            ariaLabel={copy.common.close}
            className="-m-1 size-6"
          >
            <XIcon size={12} weight="thin" />
          </IconButton>
        )}
      </div>

      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <ActionButton
              key={a.id}
              action={a}
              error={error}
              onRetry={onRetry}
              onSwitchLLM={onSwitchLLM}
              onOpenMyKey={onOpenMyKey}
              onOpenGADocs={onOpenGADocs}
              onViewProject={onViewProject}
              onViewGoal={onViewGoal}
              onRestartChannels={onRestartChannels}
              onRestartAppUpdate={onRestartAppUpdate}
              onToggleDetails={() => setOpen((v) => !v)}
              detailsOpen={open}
            />
          ))}
        </div>
      )}

      {open && hasDetails && (
        <div className="mt-3 rounded-sm border border-line bg-app p-2.5">
          {error.context && (
            <div className="select-text font-mono text-[11px] text-ink-muted">
              context: {error.context}
            </div>
          )}
          {error.traceback && (
            <pre className="mt-1.5 max-h-[200px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-[1.55] text-ink-soft">
              {error.traceback}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- internals ----------------

interface ActionDef {
  id: string;
  label: string;
  /** "primary" = brand-soft button, "ghost" = no border. */
  kind: "primary" | "ghost";
  handler:
    | "onRetry"
    | "onSwitchLLM"
    | "onOpenMyKey"
    | "onOpenGADocs"
    | "onViewProject"
    | "onViewGoal"
    | "onRestartChannels"
    | "onRestartAppUpdate"
    | "copyDetails"
    | "toggleDetails";
}

interface SeverityConfig {
  icon: typeof Warning;
  borderClass: string;
  iconClass: string;
}

const SEVERITY_CONFIG: Record<AppErrorSeverity, SeverityConfig> = {
  error: {
    icon: XIcon,
    borderClass: "border-error/30",
    iconClass: "text-error",
  },
  warning: {
    icon: Warning,
    borderClass: "border-warning/30",
    iconClass: "text-warning",
  },
  info: {
    icon: Info,
    borderClass: "border-line",
    iconClass: "text-info",
  },
};

function SeverityIcon({
  severity,
  size = 16,
}: {
  severity: AppErrorSeverity;
  size?: number;
}) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return <Icon size={size} weight="thin" className={cfg.iconClass} />;
}

interface HintConfig {
  title: string;
  brief: string;
  actions: ActionDef[];
}

function hintConfig(copy: AppCopy): Record<AppErrorHint, HintConfig> {
  return {
  check_llm_config: {
    title: copy.errors.llmConfig.title,
    brief: copy.errors.llmConfig.brief,
    actions: [
      {
        id: "open-mykey",
        label: copy.errors.llmConfig.checkMyKey,
        kind: "primary",
        handler: "onOpenMyKey",
      },
      {
        id: "open-docs",
        label: copy.errors.llmConfig.docs,
        kind: "ghost",
        handler: "onOpenGADocs",
      },
      {
        id: "copy-details",
        label: copy.errors.copyDetails,
        kind: "ghost",
        handler: "copyDetails",
      },
    ],
  },
  network: {
    title: copy.errors.network.title,
    brief: copy.errors.network.brief,
    actions: [
      { id: "retry", label: copy.common.retry, kind: "primary", handler: "onRetry" },
      {
        id: "copy-details",
        label: copy.errors.copyDetails,
        kind: "ghost",
        handler: "copyDetails",
      },
    ],
  },
  quota_exceeded: {
    title: copy.errors.quota.title,
    brief: copy.errors.quota.brief,
    actions: [
      {
        id: "switch-llm",
        label: copy.errors.switchLLM,
        kind: "primary",
        handler: "onSwitchLLM",
      },
      {
        id: "copy-details",
        label: copy.errors.copyDetails,
        kind: "ghost",
        handler: "copyDetails",
      },
    ],
  },
  };
}

function defaultTitle(error: AppError, copy: AppCopy): string {
  switch (error.category) {
    case "runtime":
      return copy.errors.runtimeTitle;
    case "bridge":
      return copy.errors.bridgeTitle;
    case "business":
      return copy.errors.businessTitle;
  }
}

function defaultActions(error: AppError, copy: AppCopy): ActionDef[] {
  const actions: ActionDef[] = [];
  if (error.action?.kind === "view_project") {
    actions.push({
      id: "view-project",
      label: error.action.label,
      kind: "ghost",
      handler: "onViewProject",
    });
  }
  if (error.action?.kind === "view_goal") {
    actions.push({
      id: "view-goal",
      label: error.action.label,
      kind: "ghost",
      handler: "onViewGoal",
    });
  }
  if (error.action?.kind === "restart_channels") {
    actions.push({
      id: "restart-channels",
      label: error.action.label,
      kind: "primary",
      handler: "onRestartChannels",
    });
  }
  if (error.action?.kind === "restart_app_update") {
    actions.push({
      id: "restart-app-update",
      label: error.action.label,
      kind: "primary",
      handler: "onRestartAppUpdate",
    });
  }
  if (error.retryable) {
    actions.push({
      id: "retry",
      label: copy.common.retry,
      kind: "primary",
      handler: "onRetry",
    });
  }
  if (hasDiagnosticDetails(error)) {
    actions.push({
      id: "copy-details",
      label: copy.errors.copyDetails,
      kind: "ghost",
      handler: "copyDetails",
    });
  }
  return actions;
}

function isActionAvailable(
  action: ActionDef,
  error: AppError,
  handlers: Pick<
    ErrorCardActions,
    | "onRetry"
    | "onSwitchLLM"
    | "onOpenMyKey"
    | "onOpenGADocs"
    | "onViewProject"
    | "onViewGoal"
    | "onRestartChannels"
    | "onRestartAppUpdate"
  >,
): boolean {
  switch (action.handler) {
    case "onRetry":
      return Boolean(handlers.onRetry);
    case "onSwitchLLM":
      return Boolean(handlers.onSwitchLLM);
    case "onOpenMyKey":
      return Boolean(handlers.onOpenMyKey);
    case "onOpenGADocs":
      return Boolean(handlers.onOpenGADocs);
    case "onViewProject":
      return (
        error.action?.kind === "view_project" && Boolean(handlers.onViewProject)
      );
    case "onViewGoal":
      return error.action?.kind === "view_goal" && Boolean(handlers.onViewGoal);
    case "onRestartChannels":
      return (
        error.action?.kind === "restart_channels" &&
        Boolean(handlers.onRestartChannels)
      );
    case "onRestartAppUpdate":
      return (
        error.action?.kind === "restart_app_update" &&
        Boolean(handlers.onRestartAppUpdate)
      );
    case "copyDetails":
      return hasDiagnosticDetails(error);
    case "toggleDetails":
      return hasDiagnosticDetails(error);
  }
}

function hasDiagnosticDetails(error: AppError): boolean {
  return (
    error.severity !== "info" && Boolean(error.context || error.traceback)
  );
}

function ActionButton({
  action,
  error,
  onRetry,
  onSwitchLLM,
  onOpenMyKey,
  onOpenGADocs,
  onViewProject,
  onViewGoal,
  onRestartChannels,
  onRestartAppUpdate,
  onToggleDetails,
  detailsOpen,
}: {
  action: ActionDef;
  error: AppError;
  onRetry?: () => void;
  onSwitchLLM?: () => void;
  onOpenMyKey?: () => void;
  onOpenGADocs?: () => void;
  onViewProject?: (projectId: string) => void;
  onViewGoal?: (goalId: string) => void;
  onRestartChannels?: () => void;
  onRestartAppUpdate?: () => void;
  onToggleDetails: () => void;
  detailsOpen: boolean;
}) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const handler = (() => {
    switch (action.handler) {
      case "onRetry":
        return onRetry;
      case "onSwitchLLM":
        return onSwitchLLM;
      case "onOpenMyKey":
        return onOpenMyKey;
      case "onOpenGADocs":
        return onOpenGADocs;
      case "onViewProject":
        if (error.action?.kind !== "view_project" || !onViewProject) {
          return undefined;
        }
        {
          const { projectId } = error.action;
          return () => onViewProject(projectId);
        }
      case "onViewGoal":
        if (error.action?.kind !== "view_goal" || !onViewGoal) {
          return undefined;
        }
        {
          const { goalId } = error.action;
          return () => onViewGoal(goalId);
        }
      case "onRestartChannels":
        if (error.action?.kind !== "restart_channels") {
          return undefined;
        }
        return onRestartChannels;
      case "onRestartAppUpdate":
        if (error.action?.kind !== "restart_app_update") {
          return undefined;
        }
        return onRestartAppUpdate;
      case "copyDetails":
        return () => {
          void copyTextToClipboard(formatErrorDetails(error)).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        };
      case "toggleDetails":
        return onToggleDetails;
    }
  })();
  const disabled = !handler;
  const Icon = ACTION_ICONS[action.handler];

  return (
    <Button
      onClick={handler}
      disabled={disabled}
      variant={action.kind === "primary" ? "brand-soft" : "ghost"}
      size="sm"
      leadingIcon={
        Icon ? (
          <Icon
            size={12}
            weight="thin"
            className={cn(
              action.handler === "toggleDetails" &&
                "transition-transform duration-150",
              action.handler === "toggleDetails" && detailsOpen && "rotate-180",
            )}
          />
        ) : undefined
      }
    >
      {copied && action.handler === "copyDetails"
        ? copy.errors.copiedDetails
        : action.label}
    </Button>
  );
}

const ACTION_ICONS: Partial<Record<ActionDef["handler"], typeof Cube>> = {
  onSwitchLLM: Cube,
  onOpenMyKey: FileCode,
  onOpenGADocs: ArrowSquareOut,
  onViewProject: FolderOpen,
  onViewGoal: Target,
  copyDetails: FileCode,
  toggleDetails: CaretDown,
};

function formatErrorDetails(error: AppError): string {
  const rows = [
    `category: ${error.category}`,
    `severity: ${error.severity}`,
    `message: ${error.message}`,
    error.context ? `context: ${error.context}` : null,
    `timestamp: ${error.timestamp}`,
    error.traceback ? `traceback:\n${error.traceback}` : null,
  ];
  return rows.filter(Boolean).join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
