import { CheckCircle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy, useLanguage } from "@/lib/i18n";
import { formatMessageDateTime } from "@/lib/message-time";

/**
 * Owner-pairing blocks shared by the owner-locked channels (Feishu /
 * Telegram / Discord): the "bound owner" row with an unbind action, and
 * the "waiting for pairing" callout showing the active bind code. The
 * labels are shared; only the pairing instructions differ per channel,
 * so a new paired channel never invents a new grammar.
 */

function maskOwnerId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function OwnerBoundRow({
  ownerId,
  boundAt,
  busy,
  working,
  onUnbind,
}: {
  ownerId: string;
  boundAt?: string | null;
  busy: boolean;
  working: boolean;
  onUnbind: () => void;
}) {
  const imCopy = useCopy().settings.im;
  const language = useLanguage();
  // Local midnight, so the year shows once the binding is from an
  // earlier year without reading the clock during render.
  const dayStamp = useDayStamp();
  const boundAtText = boundAt
    ? formatMessageDateTime(boundAt, dayStamp, language)
    : null;
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filled: Settings' success check is always the solid one. */}
        <CheckCircle size={14} weight="fill" className="text-success" />
        <span className="text-ui-meta font-semibold text-ink">
          {imCopy.ownerBoundLabel}
        </span>
        <span className="select-text font-mono text-ui-tertiary text-ink-soft">
          {maskOwnerId(ownerId)}
        </span>
        {boundAtText ? (
          <span className="text-ui-tertiary text-ink-muted">
            {imCopy.ownerBoundAt} {boundAtText}
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={onUnbind}
        >
          {working ? imCopy.working : imCopy.ownerUnbind}
        </Button>
      </div>
    </div>
  );
}

export function BindCodeCallout({
  lead,
  code,
  afterCode,
}: {
  lead: string;
  code: string;
  afterCode: string;
}) {
  const imCopy = useCopy().settings.im;
  return (
    <div className="rounded-sm border border-brand/25 bg-brand/[var(--opacity-subtle)] px-3 py-2.5">
      <div className="text-ui-tertiary font-medium text-brand">
        {imCopy.ownerBindWaitingTitle}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-2 text-ui-secondary text-ink">
        <span>{lead}</span>
        {/* 15px: the one code meant to be read off the screen and typed
            on a phone; no chrome token sits between 13px and 18px. */}
        <code className="select-text rounded-sm border border-line bg-surface px-2 py-0.5 font-mono text-[15px] font-bold tracking-[0.2em] text-ink">
          {code}
        </code>
      </div>
      <div className="mt-1 text-ui-tertiary leading-notice text-ink-muted">
        {afterCode}
      </div>
    </div>
  );
}
