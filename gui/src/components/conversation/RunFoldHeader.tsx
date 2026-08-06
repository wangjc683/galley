import { CaretRight } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { cn } from "@/lib/utils";

/**
 * Fold header for a settled run — the one-line stand-in for the run's
 * whole process section (conversation-run-fold PRD 定案 3/4).
 *
 * TurnMarker's Swiss family on purpose: same size var, same ink-soft
 * register, same thin vertical rule between segments — the fold row is
 * a structural sibling of "第 N 步", not a new visual species. Two
 * segments:
 *
 *   structure  — "10 步 · 2 分 14 秒", tabular figures. Always shown.
 *   scent      — tool mix ("修改文件 ×2"), ask_user count, denied
 *                badge. Muted, truncates first (min-w-0). Answers
 *                "what parts of the world did this run touch" without
 *                expanding. Tool names go through `copy.tools` — the
 *                same localized labels the InlineToolPill leads with;
 *                the wire-level mono name stays one expand away in the
 *                pill's right zone (2026-08-06 dogfood: raw GA names
 *                here read as untranslated codes, not information).
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
 * Ink altitude (dogfood round 3): the whole row rests at ink-muted —
 * one rung BELOW TurnMarker's ink-soft, on the scale's own logic:
 * a marker titles structure the reader can see; this row is metadata
 * about structure that is hidden. Affordance survives the demotion
 * because it lives in shape (leading triangle) and hover response
 * (background + ink lift), not in resting weight. The denied badge
 * keeps its warning color — the one scar an all-grey row must show.
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
}: {
  stats: RunStats;
  open: boolean;
  onToggle: () => void;
}) {
  const copy = useCopy();

  const duration = formatDuration(stats.elapsedMs, copy);
  const toolLabels = copy.tools as Record<string, string>;
  const scentParts: string[] = stats.toolCounts.map((t) => {
    const label = toolLabels[t.name] ?? t.name;
    return t.count === 1 ? label : `${label} ×${t.count}`;
  });
  if (stats.askUserCount > 0) {
    scentParts.push(copy.conversation.foldAskUser(stats.askUserCount));
  }

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
        "-mx-2 mb-2.5 mt-6 flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1 [font-size:var(--conversation-step-size)] text-ink-muted outline-none",
        "hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink",
      )}
    >
      <CaretRight
        size={11}
        weight="thin"
        className={cn(
          "shrink-0 transition-transform duration-(--motion-fast)",
          open && "rotate-90",
        )}
      />
      <span className="shrink-0 tabular-nums tracking-[0.01em]">
        {copy.conversation.foldSteps(stats.stepCount)}
        {duration && ` · ${duration}`}
      </span>
      {(scentParts.length > 0 || stats.deniedCount > 0) && (
        <span className="h-2.5 w-px shrink-0 bg-line" aria-hidden />
      )}
      {scentParts.length > 0 && (
        <span className="min-w-0 truncate">{scentParts.join(" · ")}</span>
      )}
      {stats.deniedCount > 0 && (
        <span className="shrink-0 text-warning">
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
