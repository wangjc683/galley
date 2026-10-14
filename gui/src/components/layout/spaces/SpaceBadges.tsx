import { Circle, PauseCircle, XCircle } from "@phosphor-icons/react";
import { useState } from "react";

import type {
  AssistantBadgeKind,
  WorkbenchBadge as WorkbenchBadgeData,
} from "@/lib/spaces-trial";
import { cn } from "@/lib/utils";

/** The ground a badge sits on: the sidebar / rail chrome, or the main
 * header's app. Its ring and tint mix against it. */
export type BadgeGround = "chrome" | "app";

/**
 * TEMPORARY (ticket 16) — the assistant's badge, on the corner of its
 * avatar (甲's rail) or its segment (乙's switch), shown only while you
 * are in the workbench. It is the main chat row's status icon in its
 * attention forms (layout-and-chrome.md §4.2, Session Row): the filled
 * apricot dot of unread (a step stronger than the row's, to stand off
 * the apricot avatar), the filled amber pause circle of a question,
 * the red x circle of an error (filled here: the row's thin one is
 * illegible at badge size, and the row has a rail, a tint and words to
 * carry it). Ringed in its ground so it sits on top of what it marks.
 *
 * The header bans status dots (§4.1 禁止) because a dot reads as an
 * unread message. Here the only dot is unread, so that reading is the
 * meaning; a question and an error are the sidebar's glyphs, never a
 * dot.
 */
export function AssistantBadge({
  kind,
  visible,
  ground,
}: {
  kind: AssistantBadgeKind | null;
  visible: boolean;
  ground: BadgeGround;
}) {
  // Pops when the state becomes news — a new kind — never on mount, and
  // never because the badge comes back into view: switching spaces shows
  // what you just saw in the other one (the collapsed sidebar toggle's
  // latch).
  const [prevKind, setPrevKind] = useState(kind);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [pop, setPop] = useState(false);
  if (kind !== prevKind) {
    setPrevKind(kind);
    setPop(kind !== null);
  }
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setPop(false);
  }
  if (!visible || kind === null) return null;
  return (
    <span
      key={kind}
      data-role="assistant-badge"
      data-kind={kind}
      aria-hidden
      className={cn(
        "pointer-events-none inline-flex size-[15px] items-center justify-center rounded-full",
        ground === "chrome" ? "bg-chrome" : "bg-app",
        pop && "sidebar-state-pop",
      )}
    >
      {kind === "unread" ? (
        // brand-strong, one step off the avatar's brand disc it sits on
        // in the rail (darker in light, lighter in dark).
        <Circle size={10} weight="fill" className="text-brand-strong" />
      ) : kind === "ask" ? (
        <PauseCircle size={13} weight="fill" className="text-warning" />
      ) : (
        <XCircle size={13} weight="fill" className="text-error" />
      )}
    </span>
  );
}

/**
 * TEMPORARY (ticket 16) — the workbench's badge: how many conversations
 * are erroring or asking you, shown only while you are in the
 * assistant. The collapsed sidebar toggle's recipe
 * (header/SidebarCollapseToggle.tsx, itself the 定时 badge's): a 14px
 * pill and a number, warning-tinted, error-tinted once any has errored,
 * mixed against its ground so it covers what it sits on. A number,
 * never a status dot.
 */
export function WorkbenchBadge({
  badge,
  visible,
  ground,
}: {
  badge: WorkbenchBadgeData | null;
  visible: boolean;
  ground: BadgeGround;
}) {
  // Pops when the count rises, under the assistant badge's rules.
  const count = badge?.count ?? 0;
  const [prevCount, setPrevCount] = useState(count);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [pop, setPop] = useState(false);
  if (count !== prevCount) {
    setPrevCount(count);
    setPop(count > prevCount);
  }
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setPop(false);
  }
  if (!visible || !badge) return null;
  return (
    <span
      key={badge.count}
      data-role="workbench-badge"
      data-tone={badge.tone}
      aria-hidden
      className={cn(
        "pointer-events-none inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px]",
        "text-[9.5px] font-semibold leading-none tabular-nums",
        badge.tone === "error"
          ? ground === "chrome"
            ? "bg-[color-mix(in_oklab,var(--color-error)_15%,var(--color-chrome))] text-error"
            : "bg-[color-mix(in_oklab,var(--color-error)_15%,var(--color-app))] text-error"
          : ground === "chrome"
            ? "bg-[color-mix(in_oklab,var(--color-warning)_15%,var(--color-chrome))] text-warning"
            : "bg-[color-mix(in_oklab,var(--color-warning)_15%,var(--color-app))] text-warning",
        pop && "sidebar-state-pop",
      )}
    >
      {badge.count}
    </span>
  );
}
