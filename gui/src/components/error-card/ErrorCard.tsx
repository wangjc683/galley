import {
  FileCode,
  FolderOpen,
  Info,
  Warning,
  X as XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useCopy, type AppCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  AppError,
  AppErrorHint,
  AppErrorSeverity,
} from "@/types/app-error";

export interface ErrorCardActions {
  /** Open a project scope from a positive feedback toast. */
  onViewProject?: (projectId: string) => void;
  /** Restart enabled Channels from an actionable toast. */
  onRestartChannels?: () => void;
  /** Run the Browser Control demo from the auto-verify success toast. */
  onTryBrowserControl?: () => void;
}

interface ErrorCardProps extends ErrorCardActions {
  error: AppError;
  onDismiss?: () => void;
}

/**
 * The Error Card visual, rendered only as a toast (ToastHost).
 * DESIGN.md §6.2.
 *
 * Three severity skins; an info toast is the compact one. A known
 * `hint` swaps the raw message for tailored guidance ("模型配置可能有
 * 问题", not "401 Unauthorized"). The raw context / traceback is not
 * shown; 复制详情 copies it.
 */
export function ErrorCard({
  error,
  onDismiss,
  onViewProject,
  onRestartChannels,
  onTryBrowserControl,
}: ErrorCardProps) {
  const copy = useCopy();
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
  const actions = defaultActions(error, copy).filter((action) =>
    isActionAvailable(action, error, {
      onViewProject,
      onRestartChannels,
      onTryBrowserControl,
    }),
  );

  if (error.severity === "info") {
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
                onViewProject={onViewProject}
                onRestartChannels={onRestartChannels}
                onTryBrowserControl={onTryBrowserControl}
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
        {onDismiss && (
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
              onViewProject={onViewProject}
              onRestartChannels={onRestartChannels}
              onTryBrowserControl={onTryBrowserControl}
            />
          ))}
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
    | "onViewProject"
    | "onRestartChannels"
    | "onTryBrowserControl"
    | "undo"
    | "copyDetails";
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
}

function hintConfig(copy: AppCopy): Record<AppErrorHint, HintConfig> {
  return {
    check_llm_config: {
      title: copy.errors.llmConfig.title,
      brief: copy.errors.llmConfig.brief,
    },
    network: {
      title: copy.errors.network.title,
      brief: copy.errors.network.brief,
    },
    quota_exceeded: {
      title: copy.errors.quota.title,
      brief: copy.errors.quota.brief,
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

/** A toast's buttons: its own action, then 复制详情 when there is
 * something to copy. A hinted error gets the same: only `fromIPCError`
 * sets a hint, and it sets no action. */
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
  if (error.action?.kind === "restart_channels") {
    actions.push({
      id: "restart-channels",
      label: error.action.label,
      kind: "primary",
      handler: "onRestartChannels",
    });
  }
  if (error.action?.kind === "try_browser_control") {
    actions.push({
      id: "try-browser-control",
      label: error.action.label,
      kind: "primary",
      handler: "onTryBrowserControl",
    });
  }
  if (error.action?.kind === "undo") {
    actions.push({
      id: "undo",
      label: error.action.label,
      kind: "primary",
      handler: "undo",
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
  handlers: ErrorCardActions,
): boolean {
  switch (action.handler) {
    case "onViewProject":
      return (
        error.action?.kind === "view_project" && Boolean(handlers.onViewProject)
      );
    case "onRestartChannels":
      return (
        error.action?.kind === "restart_channels" &&
        Boolean(handlers.onRestartChannels)
      );
    case "onTryBrowserControl":
      return (
        error.action?.kind === "try_browser_control" &&
        Boolean(handlers.onTryBrowserControl)
      );
    case "undo":
      return error.action?.kind === "undo";
    case "copyDetails":
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
  onViewProject,
  onRestartChannels,
  onTryBrowserControl,
}: {
  action: ActionDef;
  error: AppError;
  onViewProject?: (projectId: string) => void;
  onRestartChannels?: () => void;
  onTryBrowserControl?: () => void;
}) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const handler = (() => {
    switch (action.handler) {
      case "onViewProject":
        if (error.action?.kind !== "view_project" || !onViewProject) {
          return undefined;
        }
        {
          const { projectId } = error.action;
          return () => onViewProject(projectId);
        }
      case "onRestartChannels":
        if (error.action?.kind !== "restart_channels") {
          return undefined;
        }
        return onRestartChannels;
      case "onTryBrowserControl":
        if (error.action?.kind !== "try_browser_control") {
          return undefined;
        }
        return onTryBrowserControl;
      case "undo":
        // The action's own: it takes the toast away itself.
        return error.action?.kind === "undo" ? error.action.run : undefined;
      case "copyDetails":
        return () => {
          void copyTextToClipboard(formatErrorDetails(error)).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        };
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
      leadingIcon={Icon ? <Icon size={12} weight="thin" /> : undefined}
    >
      {copied && action.handler === "copyDetails"
        ? copy.errors.copiedDetails
        : action.label}
    </Button>
  );
}

const ACTION_ICONS: Partial<Record<ActionDef["handler"], typeof FileCode>> = {
  onViewProject: FolderOpen,
  copyDetails: FileCode,
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
