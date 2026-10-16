import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
 * The send time at a break (message-timestamps PRD, 2026-09-28; rules
 * and label format in lib/message-time.ts, Conversation formats it once
 * and hands down plain strings).
 *
 * A line of its own, centred between two messages: it belongs to the
 * conversation, not to the bubble under it. The assistant's
 * conversation drew it this way first (main chat ruling 67, ticket 20;
 * it was `AssistantTimeDivider` in AssistantParts); the workbench
 * follows since its ticket 01 (workbench conversation PRD ruling 3).
 * Until then the workbench put the time on a row of its own above the
 * bubble, left-aligned, sharing that row with the Supervisor icon.
 *
 * Type is the quietest step the spec allows: text-ui-micro (10.5px, the
 * spec's timestamp tier) at 70% of ink-muted, one step below every ink
 * token. Round one's 11.5px ink-muted was 「稍微有点吵」 (2026-09-28),
 * and JC picked this over 10.5px at full ink-muted. At 70% the label
 * sits at ~2.3:1 on the light canvas (~3.2:1 dark), under AA;
 * acceptable only because the time is auxiliary and its tooltip
 * carries the full date. Size class before `leading-none`:
 * tailwind-merge drops a `leading-*` that precedes a font-size class.
 * No chip behind it, the way iMessage and WeChat draw it.
 */
const MESSAGE_TIME_TEXT =
  "text-ui-micro text-ink-muted/70 select-none leading-none [font-variant-numeric:tabular-nums]";

/**
 * 16px above it, 20px under it (the message after it keeps its own
 * 20px, collapsing with this); right under a reply, whose reserved
 * action row already leaves 30px, it adds nothing above. The tooltip
 * gives the full date with the weekday.
 */
export function MessageTimeDivider({
  label,
  full,
  iso,
  afterReply = false,
}: {
  label: string;
  /** Full date + weekday for the tooltip. */
  full?: string;
  /** ISO timestamp, the `<time>`'s `dateTime`. */
  iso?: string;
  /** Right under a reply row (its action row is the gap above). */
  afterReply?: boolean;
}) {
  const time = (
    <time dateTime={iso} className={MESSAGE_TIME_TEXT}>
      {label}
    </time>
  );
  return (
    <div
      data-role="message-time-divider"
      className={cn("flex justify-center", afterReply ? "mb-4" : "my-4")}
    >
      {full ? <TooltipLabel text={full}>{time}</TooltipLabel> : time}
    </div>
  );
}
