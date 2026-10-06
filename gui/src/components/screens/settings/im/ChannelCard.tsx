import type { ReactNode } from "react";

import { SettingsDisclosureCard } from "@/components/screens/settings/settings-disclosure";

/**
 * Shared shell for a channel row in Settings → Channels: the Settings
 * disclosure card (rotating caret, glyph + title + status badge, optional
 * actions menu) with its grid-rows animated expand/collapse body. The
 * channel cards own the `expanded` state and supply the header slots + body.
 *
 * Collapsed body content is marked `inert` so it stays non-focusable and hidden
 * from assistive tech while still mounted (the grid-rows animation needs it in
 * the DOM in both states).
 */
export function ChannelCard({
  expanded,
  onToggle,
  glyph,
  title,
  badge,
  actions,
  busy = false,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  glyph: ReactNode;
  title: string;
  badge: ReactNode;
  actions?: ReactNode;
  /** Keep the actions menu pinned visible (not hover-only) while an action runs. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <SettingsDisclosureCard
      open={expanded}
      onToggle={onToggle}
      animateBody
      header={
        <>
          {glyph}
          <span
            className="min-w-0 truncate text-ui-compact font-medium text-ink"
            title={title}
          >
            {title}
          </span>
          {badge}
        </>
      }
      actions={actions}
      actionsPinned={busy}
    >
      {children}
    </SettingsDisclosureCard>
  );
}
