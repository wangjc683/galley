import { PuzzlePiece } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";

/**
 * The 待解锁 invitation at the top of the main area while Browser Control
 * was never set up (managed runtime only). Brand tone, not warning: the
 * capability is not broken, it is waiting to be unlocked, and the copy
 * says what the user gains. It stays until setup completes — not
 * dismissable, no motion, no modal (rules kept from 2026-05-27).
 */
export function BrowserControlAttentionBanner({
  onOpen,
}: {
  onOpen?: () => void;
}) {
  const copy = useCopy().browserControlAttention;
  return (
    // The same material as the topbar 待解锁 badge (`brand` tone:
    // border-brand/30 on bg-brand-soft), so badge and banner read as one
    // voice; a brand alpha band went pink against the cream badge.
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-4 border-b border-brand/30 bg-brand-soft px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-brand/30 bg-elevated text-brand-strong">
          <PuzzlePiece size={15} weight="thin" />
        </span>
        <p className="min-w-0 truncate text-ui-secondary font-medium text-ink">
          {copy.message}
        </p>
      </div>
      <Button
        variant="brand-soft"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        onClick={onOpen}
        leadingIcon={<PuzzlePiece size={13} weight="thin" />}
      >
        {copy.action}
      </Button>
    </div>
  );
}

export function BrowserControlAttentionSurface({
  show,
  onOpen,
  children,
}: {
  show: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {show && <BrowserControlAttentionBanner onOpen={onOpen} />}
      {children}
    </div>
  );
}
