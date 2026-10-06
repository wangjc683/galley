import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  Info,
  Warning,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import {
  SettingsStatusBadge,
  type SettingsStatusTone,
} from "@/components/screens/settings/settings-badges";
import { Button } from "@/components/ui/button";
import { downloadPercent } from "@/lib/app-update";
import { useCopy, type AppCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAppUpdateStore, type AppUpdateStatus } from "@/stores/app-update";

import { ExternalTextLink } from "./external-link";

interface SettingsUpdateControlProps {
  hasRunningSessions: boolean;
  leading?: ReactNode;
  className?: string;
}

export function SettingsUpdateControl({
  hasRunningSessions,
  leading,
  className,
}: SettingsUpdateControlProps) {
  const copy = useCopy();
  const updateStatus = useAppUpdateStore((s) => s.status);
  const checkUpdate = useAppUpdateStore((s) => s.check);
  const restart = useAppUpdateStore((s) => s.restart);

  const handleUpdateAction = async () => {
    if (
      updateStatus.kind === "checking" ||
      updateStatus.kind === "downloading"
    ) {
      return;
    }
    if (updateStatus.kind === "ready") {
      if (hasRunningSessions) return;
      await restart();
      return;
    }
    await checkUpdate({ silent: false });
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div
        aria-live="polite"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {leading}
        <UpdateActionControl
          status={updateStatus}
          hasRunningSessions={hasRunningSessions}
          copy={copy}
          onClick={handleUpdateAction}
        />
        <UpdateInlineStatus
          status={updateStatus}
          hasRunningSessions={hasRunningSessions}
          copy={copy}
        />
      </div>
    </div>
  );
}

function UpdateActionControl({
  status,
  hasRunningSessions,
  copy,
  onClick,
}: {
  status: AppUpdateStatus;
  hasRunningSessions: boolean;
  copy: AppCopy;
  onClick: () => void;
}) {
  const view = updateActionView(status, hasRunningSessions, copy);
  const Icon = view.Icon;
  if (view.kind === "status") {
    return (
      <SettingsStatusBadge
        role="status"
        tone={view.tone}
        icon={Icon}
        spin={view.spin}
        className={cn(
          "cursor-default select-none",
          view.tabularNums && "tabular-nums",
        )}
      >
        {view.label}
      </SettingsStatusBadge>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={view.disabled}
      className="h-6 px-2 text-ui-tertiary"
      leadingIcon={
        <Icon size={12} weight="thin" className={cn(view.spin && "spin")} />
      }
    >
      <span>{view.label}</span>
    </Button>
  );
}

function UpdateInlineStatus({
  status,
  hasRunningSessions,
  copy,
}: {
  status: AppUpdateStatus;
  hasRunningSessions: boolean;
  copy: AppCopy;
}) {
  const view = updateInlineStatusView(status, hasRunningSessions, copy);
  const Icon = view?.Icon;
  if (!view || !Icon) return null;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-1.5 text-ui-tertiary leading-dense",
        view.className,
      )}
    >
      <Icon
        size={11}
        weight="thin"
        className={cn("shrink-0", view.spin && "spin")}
      />
      <span className="min-w-0">{view.message}</span>
      {status.kind === "error" && (
        <>
          <ExternalTextLink
            href={status.manualDownloadUrl}
            className="shrink-0"
          >
            {copy.updates.manualDownload}
          </ExternalTextLink>
          <code
            className="min-w-0 max-w-[min(34rem,100%)] truncate rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-ui-tertiary leading-tight text-ink-muted select-text"
            title={status.detail}
          >
            {copy.updates.diagnosticPrefix}
            {status.detail}
          </code>
        </>
      )}
    </span>
  );
}

function updateActionView(
  status: AppUpdateStatus,
  hasRunningSessions: boolean,
  copy: AppCopy,
):
  | {
      kind: "button";
      label: string;
      Icon: typeof ArrowClockwise;
      disabled: boolean;
      spin?: boolean;
    }
  | {
      kind: "status";
      label: string;
      Icon: typeof ArrowClockwise;
      // In-flight states (checking / preparing / installing) read
      // neutral + spinner, the same grammar as a channel starting up.
      tone: SettingsStatusTone;
      spin?: boolean;
      tabularNums?: boolean;
    } {
  switch (status.kind) {
    case "checking":
      return {
        kind: "status",
        label: copy.updates.checking,
        Icon: CircleNotch,
        tone: "neutral",
        spin: true,
      };
    case "available":
      return {
        kind: "status",
        label: hasRunningSessions
          ? copy.updates.foundAfterTasks
          : copy.updates.preparing,
        Icon: hasRunningSessions ? Warning : CircleNotch,
        tone: hasRunningSessions ? "warning" : "neutral",
        spin: !hasRunningSessions,
      };
    case "downloading": {
      // The 24px chip has no room for a second bar; a percent suffix on
      // the label carries the same real progress the TopBar bar shows.
      const percent =
        status.phase === "installing" ? null : downloadPercent(status.progress);
      const label =
        status.phase === "installing"
          ? copy.updates.installing
          : percent !== null
            ? `${copy.updates.preparing} · ${percent}%`
            : copy.updates.preparing;
      return {
        kind: "status",
        label,
        Icon: CircleNotch,
        tone: "neutral",
        spin: true,
        tabularNums: true,
      };
    }
    case "ready":
      return {
        kind: "button",
        label: copy.updates.restart,
        Icon: CheckCircle,
        disabled: hasRunningSessions,
      };
    case "upToDate":
      return {
        kind: "button",
        label: copy.updates.check,
        Icon: ArrowClockwise,
        disabled: false,
      };
    case "error":
      return {
        kind: "button",
        label: copy.updates.retry,
        Icon: ArrowClockwise,
        disabled: false,
      };
    default:
      return {
        kind: "button",
        label: copy.updates.check,
        Icon: ArrowClockwise,
        disabled: false,
      };
  }
}

function updateInlineStatusView(
  status: AppUpdateStatus,
  hasRunningSessions: boolean,
  copy: AppCopy,
): {
  message: string;
  Icon: typeof ArrowClockwise;
  className: string;
  spin?: boolean;
} | null {
  if (status.kind === "ready" && hasRunningSessions) {
    return {
      message: copy.updates.readyAfterTasks,
      Icon: Warning,
      className: "text-warning",
    };
  }

  switch (status.kind) {
    case "unconfigured":
      return {
        message: copy.updates.devNoChannel,
        Icon: Info,
        className: "text-ink-muted",
      };
    case "upToDate":
      return {
        message: copy.updates.upToDate,
        Icon: CheckCircle,
        className: "text-success",
      };
    case "error":
      return {
        message: status.message,
        Icon: Warning,
        className: "text-warning",
      };
    case "idle":
    case "checking":
    case "available":
    case "downloading":
    case "ready":
      return null;
  }
}
