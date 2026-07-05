import { useCopy } from "@/lib/i18n";

/**
 * Error callout shared by the channel cards. The heading is a plain
 * field-tier label (no uppercase eyebrow — page-level grammar stays
 * out of nested card content).
 */
export function ChannelErrorBlock({ error }: { error: string | null }) {
  const imCopy = useCopy().settings.im;
  if (!error) return null;
  return (
    <div className="rounded-sm border border-error/20 bg-error/[var(--opacity-subtle)] px-3 py-2">
      <div className="mb-1 text-ui-tertiary font-medium text-error/80">
        {imCopy.lastError}
      </div>
      <div className="select-text break-words font-mono text-ui-tertiary leading-dense text-error">
        {error}
      </div>
    </div>
  );
}
