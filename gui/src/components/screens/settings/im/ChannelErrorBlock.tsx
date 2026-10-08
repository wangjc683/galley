import { Warning } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import type {
  ImSupervisorPlatform,
  ImSupervisorState,
} from "@/lib/im-supervisor";

import { channelErrorBlockTitle } from "./channel-error";

/**
 * Error block shared by the channel cards, right under the status line.
 * The title says the cause in words (`channel-error.ts`); the raw text
 * stays below it, selectable and monospace, for a bug report. Same shape
 * as the Browser Control error card: icon column, title, detail.
 */
export function ChannelErrorBlock({
  platform,
  state,
  error,
}: {
  platform: ImSupervisorPlatform;
  state: ImSupervisorState;
  error: string | null;
}) {
  const imCopy = useCopy().settings.im;
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2 text-ui-meta leading-notice">
      <Warning size={14} weight="thin" className="mt-0.5 shrink-0 text-error" />
      <div className="min-w-0 flex-1">
        <div className="text-error">
          {channelErrorBlockTitle(platform, state, error, imCopy)}
        </div>
        <div className="mt-1 select-text whitespace-pre-wrap break-words font-mono text-ui-tertiary leading-notice text-error/80">
          {error}
        </div>
      </div>
    </div>
  );
}
