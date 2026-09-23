import { CaretRight } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { cn } from "@/lib/utils";

/** Tools that change files on disk — they lead the scent (see the
 * truncation policy below). */
const FILE_TOOLS = new Set(["file_write", "file_patch"]);

/**
 * Fold header for a settled run — the one-line stand-in for the run's
 * whole process section (conversation-run-fold PRD 定案 3/4).
 *
 * TurnMarker's Swiss family on purpose: same size var (for the
 * structure segment), same thin vertical rule between segments — the
 * fold row is a structural sibling of "第 N 步", not a new visual
 * species. Its ink is NOT TurnMarker's: the row has rested one rung
 * lower, at ink-muted, since 2026-08-06 (dogfood round 3; see Ink
 * altitude below). Two segments:
 *
 *   structure  — "10 步 · 用时 2 分 14 秒", tabular figures, digit
 *                runs one ink rung up (2026-09-23). Always shown.
 *   scent      — tool mix ("修改文件 ×2"), ask_user count, denied
 *                badge. Muted, one size step down (the tool-label
 *                size, 2026-09-23), truncates first (min-w-0). Answers
 *                "what parts of the world did this run touch" without
 *                expanding. Tool names go through `copy.tools` — the
 *                same localized labels the InlineToolPill leads with;
 *                the wire-level mono name stays one expand away in the
 *                pill's right zone (2026-08-06 dogfood: raw GA names
 *                here read as untranslated codes, not information).
 *
 * Long-run truncation policy (2026-08-06): the scent's job is
 * composition, not chronology — so tools render in count-desc order
 * (stable sort; first-appearance breaks ties), and what the ellipsis
 * eats is always the low-frequency tail, never the run's main
 * activity. One exception since 2026-09-23: the file-changing tools
 * (`file_write` / `file_patch`) lead the scent. A run that changed
 * files on disk is the scent's one item about the user's own stuff,
 * and it is rare (about 11% of multi-step runs) and usually
 * low-count, so count-desc parked it at the tail, the first thing
 * the ellipsis ate. The rest keep count-desc (and file tools among
 * themselves too), so the ellipsis still eats only the low-frequency
 * generic tail. RunStats.toolCounts itself stays first-appearance —
 * ordering is a render concern. The ask_user count sits OUTSIDE the
 * truncating span, beside the denied badge: both are 留疤-class
 * signals ("a human was pulled in mid-run") that must survive any
 * squeeze — though ask_user keeps the row's muted ink; denied stays
 * the only colored element. When the scent does overflow, a tooltip
 * on hover serves the full list (mounted only while overflowing, so
 * the common short-scent row keeps a lean DOM and no tooltip noise).
 *
 * The denied badge is the row's only colored element — a fold keeps
 * its scar visible (折叠但留疤): a run that contains a user denial
 * must stay discoverable without expanding.
 *
 * Affordance (2026-08-06 dogfood): a LEADING disclosure triangle
 * (▸ rotating to ▾) plus a hover background. The first cut mirrored
 * TurnMarker's trailing chevron and inherited its "this is a label"
 * read — but TurnMarker's expansion is auxiliary detail while this
 * row's expansion is the feature, so the two intentionally diverge:
 * the triangle up front is the universally-learned disclosure grammar.
 * `-mx-2 px-2` lets the hover pill extend into the gutter while the
 * text column stays aligned with the markers above and below.
 *
 * Ink altitude (dogfood round 3, 2026-08-06): the row rests at
 * ink-muted — one rung BELOW TurnMarker's ink-soft, on the scale's own
 * logic: a marker titles structure the reader can see; this row is
 * metadata about structure that is hidden. Affordance survives the
 * demotion because it lives in shape (leading triangle) and hover
 * response (background + ink lift), not in resting weight. The one
 * lift since: the structure segment's digit runs sit at ink-soft
 * (2026-09-23; see the note at that span). The denied badge keeps its
 * warning color — the one scar an all-grey row must show.
 *
 * Duration lives HERE, after the step count, not in the answer
 * footer: steps × duration are the two axes of the run's lived size
 * (logical length, wall-clock length), while the footer carries the
 * machine invoice (tokens, context). Order is fixed — the disclosure
 * word names the hidden content ("10 步"), duration is its trailing
 * attribute, rhyming with the live row's "思考中 · 32 秒" and the
 * CI-style suffix convention. See PRD 折叠头 vs Footer 领土划分.
 */
export function RunFoldHeader({
  stats,
  open,
  onToggle,
  live = false,
}: {
  stats: RunStats;
  open: boolean;
  onToggle: () => void;
  /**
   * Live variant (live-run-window PRD, 2026-09-16): the same row
   * standing in for the completed steps of a run that is still
   * going. Two differences only — the structure segment reads
   * "已完成 N 步", and there is no duration: the thinking row already
   * ticks a tenth-second step clock and the RunElapsedHud a
   * one-second run clock, and a third moving counter on the same
   * screen is the instrument-panel feel §2.7 exists to avoid. The
   * duration arrives when the run settles and the row becomes the
   * settled header in place.
   */
  live?: boolean;
}) {
  const copy = useCopy();

  const duration = live ? null : formatDuration(stats.elapsedMs, copy);
  const steps = live
    ? copy.conversation.foldStepsLive(stats.stepCount)
    : copy.conversation.foldSteps(stats.stepCount);
  const structureText = duration ? `${steps} · ${duration}` : steps;
  const toolLabels = copy.tools as Record<string, string>;
  // File tools first, then count-desc; the sort is stable, so
  // first-appearance still breaks ties (truncation policy above).
  const scentText = [...stats.toolCounts]
    .sort(
      (a, b) =>
        Number(FILE_TOOLS.has(b.name)) - Number(FILE_TOOLS.has(a.name)) ||
        b.count - a.count,
    )
    .map((t) => {
      const label = toolLabels[t.name] ?? t.name;
      return t.count === 1 ? label : `${label} ×${t.count}`;
    })
    .join(" · ");

  // Overflow detection for the tooltip fallback. Layout-time (not
  // hover-time) measurement so the Radix trigger is already mounted
  // when the pointer arrives; the observer tracks window / column
  // resizes. `scentText` in the deps re-measures when the run's tool
  // mix changes (a live group settling, locale switch).
  const scentRef = useRef<HTMLSpanElement | null>(null);
  const [scentOverflows, setScentOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = scentRef.current;
    if (!el) return;
    const measure = () => {
      setScentOverflows(el.scrollWidth > el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scentText]);

  const scentSpan = scentText !== "" && (
    <span
      ref={scentRef}
      className="min-w-0 truncate tabular-nums [font-size:var(--conversation-tool-label-size)]"
    >
      {scentText}
    </span>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={open ? copy.conversation.foldCollapse : copy.conversation.foldExpand}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      data-role="run-fold"
      className={cn(
        "group/fold -mx-2 mb-2.5 mt-6 flex min-w-0 cursor-default items-baseline gap-2 rounded-sm px-2 py-1 [font-size:var(--conversation-step-size)] text-ink-muted outline-none",
        "hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink",
        // The live header's first appearance (the first step folding
        // into it) eases in while that row sweeps up — the row is
        // absorbed into a header taking shape, not one that popped.
        // Same element through to settled, so it plays once.
        live && "animate-fade-in",
      )}
    >
      <CaretRight
        size={11}
        weight="thin"
        className={cn(
          // Rotation duration matches the RunFoldSection sweep
          // (--motion-slow) so the triangle and the panel read as one
          // gesture, not a fast flick beside a slow unfurl.
          "shrink-0 self-center transition-transform duration-(--motion-slow)",
          open && "rotate-90",
        )}
      />
      {/* Structure-segment ink, two live A/Bs. 2026-09-16 rejected
          darkening the whole segment (ink-soft + medium, offered
          against the reference trace component's hierarchy — a
          handle that out-inks its list); the quiet-eyebrow call of
          2026-08-06 held. 2026-09-23 picked inking only the digit
          runs: the words stay ink-muted regular and no weight
          changes, so the row stays a quiet eyebrow while the eye has
          a landing point on the numbers. JC's stated use: read the
          duration, glance at the step count, and normally skip the
          tool mix. */}
      <span className="shrink-0 tabular-nums tracking-[0.01em]">
        {inkDigitRuns(structureText)}
      </span>
      {/* The scent drops to the tool-label size (the register of the
          pill labels it summarizes) and the rule gets 12px each side
          (mx-1 + the row's gap-2), so the row reads as two groups,
          structure | scent, instead of one run-on line. The row's
          baseline alignment keeps the 12px and 11px text (default
          size) on one baseline; caret and rule re-centre themselves. */}
      {(scentText !== "" ||
        stats.askUserCount > 0 ||
        stats.deniedCount > 0) && (
        <span
          className="mx-1 h-2.5 w-px shrink-0 self-center bg-line"
          aria-hidden
        />
      )}
      {scentOverflows && scentSpan ? (
        <TooltipLabel
          text={scentText}
          sideOffset={4}
          contentClassName="max-w-[360px] whitespace-normal text-[11.5px] leading-normal"
        >
          {scentSpan}
        </TooltipLabel>
      ) : (
        scentSpan
      )}
      {stats.askUserCount > 0 && (
        <span className="shrink-0 [font-size:var(--conversation-tool-label-size)]">
          {copy.conversation.foldAskUser(stats.askUserCount)}
        </span>
      )}
      {stats.deniedCount > 0 && (
        <span className="shrink-0 text-warning [font-size:var(--conversation-tool-label-size)]">
          {copy.conversation.foldDenied(stats.deniedCount)}
        </span>
      )}
    </div>
  );
}

function formatDuration(
  elapsedMs: number | null,
  copy: ReturnType<typeof useCopy>,
): string | null {
  if (elapsedMs == null || elapsedMs <= 0) return null;
  const sec = Math.round(elapsedMs / 1000);
  if (sec < 1) return null;
  if (sec < 60) return copy.conversation.foldDurationSeconds(sec);
  return copy.conversation.foldDurationMinutes(
    Math.floor(sec / 60),
    sec % 60,
  );
}

/** Split the formatted structure string on its digit runs and ink only
 * the numbers; the words between them stay text nodes in the row's
 * ink-muted. The digit spans set their own ink, so they can't inherit
 * the row's `hover:text-ink` — they follow the hover / focus lift
 * through the row's named `group/fold` instead. */
function inkDigitRuns(text: string) {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="text-ink-soft group-hover/fold:text-ink group-focus-visible/fold:text-ink"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}
