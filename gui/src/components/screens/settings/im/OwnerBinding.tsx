import { Check } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

/**
 * Owner-pairing blocks shared by the owner-locked channels (Feishu /
 * Telegram): the "bound owner" row with an unbind action, and the
 * "waiting for pairing" callout showing the active bind code. Copy is
 * passed in per channel; the visual grammar stays identical so a third
 * paired channel never invents a new one.
 */

function maskOwnerId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function OwnerBoundRow({
  ownerId,
  boundAt,
  boundLabel,
  boundAtLabel,
  unbindLabel,
  workingLabel,
  busy,
  working,
  onUnbind,
}: {
  ownerId: string;
  boundAt?: string | null;
  boundLabel: string;
  boundAtLabel: string;
  unbindLabel: string;
  workingLabel: string;
  busy: boolean;
  working: boolean;
  onUnbind: () => void;
}) {
  return (
    <div className="rounded-sm border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Check size={13} weight="bold" className="text-success" />
        <span className="text-ui-meta font-semibold text-ink">{boundLabel}</span>
        <span className="select-text font-mono text-ui-tertiary text-ink-soft">
          {maskOwnerId(ownerId)}
        </span>
        {boundAt ? (
          <span className="text-ui-tertiary text-ink-muted">
            {boundAtLabel} {new Date(boundAt).toLocaleString()}
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
          {working ? workingLabel : unbindLabel}
        </Button>
      </div>
    </div>
  );
}

export function BindCodeCallout({
  title,
  lead,
  code,
  afterCode,
}: {
  title: string;
  lead: string;
  code: string;
  afterCode: string;
}) {
  return (
    <div className="rounded-sm border border-brand/25 bg-brand/[var(--opacity-subtle)] px-3 py-2.5">
      <div className="text-ui-tertiary font-medium text-brand">{title}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-2 text-ui-secondary text-ink">
        <span>{lead}</span>
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
