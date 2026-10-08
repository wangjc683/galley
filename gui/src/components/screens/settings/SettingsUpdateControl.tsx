import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Info,
  Warning,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { SettingsStatusBadge } from "@/components/screens/settings/settings-badges";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAppUpdateStore } from "@/stores/app-update";

import { ExternalTextLink } from "./external-link";
import {
  type UpdateControlAction,
  type UpdateControlCommand,
  type UpdateControlError,
  type UpdateControlNote,
  updateControlView,
} from "./update-control-view";

interface SettingsUpdateControlProps {
  hasRunningSessions: boolean;
  leading?: ReactNode;
  className?: string;
}

/**
 * Settings → About version row: the version, one control, one line of
 * words; an error gets its own block under the row. What each state
 * shows is decided in `update-control-view.ts`.
 */
export function SettingsUpdateControl({
  hasRunningSessions,
  leading,
  className,
}: SettingsUpdateControlProps) {
  const copy = useCopy();
  const status = useAppUpdateStore((s) => s.status);
  const check = useAppUpdateStore((s) => s.check);
  const download = useAppUpdateStore((s) => s.download);
  const restart = useAppUpdateStore((s) => s.restart);
  const view = updateControlView(status, hasRunningSessions, copy.updates);

  const run = (command: UpdateControlCommand) => {
    switch (command) {
      case "check":
        void check({ silent: false });
        return;
      case "download":
        void download();
        return;
      case "restart":
        void restart();
        return;
    }
  };

  return (
    <div aria-live="polite" className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {leading}
        <UpdateAction action={view.action} onRun={run} />
        {view.note && <UpdateNote note={view.note} />}
      </div>
      {view.error && (
        <UpdateErrorBlock
          error={view.error}
          manualDownloadLabel={copy.updates.manualDownload}
        />
      )}
    </div>
  );
}

// 重启并更新 takes the restart arrow, not a check: the note beside it
// already carries the filled check for "downloaded".
const COMMAND_ICON: Record<UpdateControlCommand, PhosphorIcon> = {
  check: ArrowClockwise,
  download: DownloadSimple,
  restart: ArrowClockwise,
};

function UpdateAction({
  action,
  onRun,
}: {
  action: UpdateControlAction;
  onRun: (command: UpdateControlCommand) => void;
}) {
  if (action.kind === "progress") {
    return (
      <SettingsStatusBadge
        role="status"
        tone="neutral"
        icon={CircleNotch}
        spin
        className="cursor-default select-none tabular-nums"
      >
        {action.label}
      </SettingsStatusBadge>
    );
  }

  const Icon = COMMAND_ICON[action.command];
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => onRun(action.command)}
      disabled={action.disabled}
      className="h-6 px-2 text-ui-tertiary"
      leadingIcon={<Icon size={12} weight="thin" />}
    >
      <span>{action.label}</span>
    </Button>
  );
}

const NOTE_CLASS: Record<UpdateControlNote["tone"], string> = {
  info: "text-ink-muted",
  plain: "text-ink-muted",
  success: "text-success",
  warning: "text-warning",
};

function UpdateNote({ note }: { note: UpdateControlNote }) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-ui-tertiary leading-dense",
        NOTE_CLASS[note.tone],
      )}
    >
      <UpdateNoteIcon tone={note.tone} />
      <span className="min-w-0">{note.message}</span>
    </span>
  );
}

function UpdateNoteIcon({ tone }: { tone: UpdateControlNote["tone"] }) {
  switch (tone) {
    case "plain":
      return null;
    case "info":
      return <Info size={11} weight="thin" className="shrink-0" />;
    case "success":
      // Filled: the app-wide "done" mark (settings-badges.tsx).
      return <CheckCircle size={11} weight="fill" className="shrink-0" />;
    case "warning":
      return <Warning size={11} weight="thin" className="shrink-0" />;
  }
}

/**
 * Same shape as the Channels error block (icon column, title, raw text
 * below, selectable and monospace), in the warning tone: a failed
 * update leaves the installed Galley working.
 */
function UpdateErrorBlock({
  error,
  manualDownloadLabel,
}: {
  error: UpdateControlError;
  manualDownloadLabel: string;
}) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-sm border border-warning/25 bg-warning/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice">
      <Warning
        size={14}
        weight="thin"
        className="mt-0.5 shrink-0 text-warning"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 text-warning">{error.title}</span>
          <ExternalTextLink href={error.manualDownloadUrl} className="shrink-0">
            {manualDownloadLabel}
          </ExternalTextLink>
        </div>
        <div className="mt-1 select-text whitespace-pre-wrap break-words font-mono text-ui-tertiary leading-notice text-warning/80">
          {error.detail}
        </div>
      </div>
    </div>
  );
}
