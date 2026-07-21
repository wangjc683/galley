import { CaretDown, ListChecks } from "@phosphor-icons/react";
import { useState } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMessagesStore } from "@/stores/messages";
import type { PlanStatus } from "@/types/conversation";

/**
 * Thin plan-mode progress bar above the conversation scroll area.
 *
 * GA enters plan mode on its own judgement (plan_sop.md) — Galley
 * deliberately has no entry control (PRD: plan-mode-visibility). This
 * bar is pure observation: it exists only while the bridge reports an
 * active plan (`plan_update` events), shows "current step · n/N", and
 * expands to the full checklist on click. When GA exits plan mode
 * (checklist drained) the store nulls the state and the bar unmounts —
 * no persistent chrome, no toggle to explain.
 *
 * Sits in the same slot family as GoalWorkerContextBar: above the
 * scroll container, readable regardless of scroll position — the whole
 * point is orientation during a long (up to ~100-turn) plan run.
 */
export function PlanContextBar({ sessionId }: { sessionId?: string }) {
  const copy = useCopy();
  const conv = copy.conversation;
  const plan = useMessagesStore((s) =>
    sessionId ? (s.byId[sessionId]?.plan ?? null) : null,
  );
  const [open, setOpen] = useState(false);
  if (!plan) return null;

  const expandable = plan.items.length > 0;
  const expanded = open && expandable;
  // Current-step text: prefer the explicit `📌 当前步骤` snippet; fall
  // back to the first open checklist item (same information, one hop
  // less fresh); placeholder mode shows the drafting label + path.
  const stepText = plan.placeholder
    ? `${conv.planBarDrafting}${plan.pathHint ? ` · ${plan.pathHint}` : ""}`
    : plan.step ||
      plan.items.find((item) => item.status === "open")?.content ||
      "";

  return (
    <div className="w-full border-b border-line bg-surface text-[12px]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? conv.planBarCollapse : conv.planBarExpand}
        className={cn(
          "flex w-full items-center gap-2 px-8 py-1.5 text-left",
          expandable && "hover:bg-hover",
        )}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
      >
        <ListChecks size={12} weight="bold" className="shrink-0 text-ink-soft" />
        <span className="shrink-0 font-medium text-ink">
          {conv.planBarLabel}
        </span>
        {!plan.placeholder && (
          <span className="shrink-0 tabular-nums text-ink-soft">
            {conv.planBarProgress(plan.done, plan.total)}
          </span>
        )}
        {stepText && (
          <>
            <span aria-hidden className="shrink-0 text-ink-muted">
              ·
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-soft">
              {stepText}
            </span>
          </>
        )}
        {expandable && (
          <CaretDown
            size={11}
            weight="thin"
            className={cn(
              "ml-auto shrink-0 text-ink-muted transition-transform duration-(--motion-fast)",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>
      {expanded && <PlanChecklist items={plan.items} />}
    </div>
  );
}

function PlanChecklist({ items }: { items: PlanStatus["items"] }) {
  return (
    <ul className="max-h-64 overflow-y-auto px-8 pb-2 pt-0.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={cn(
            "flex items-start gap-2 py-0.5 leading-5",
            item.status === "done" ? "text-ink-muted" : "text-ink-soft",
          )}
        >
          <span
            aria-hidden
            className="shrink-0 pt-px font-medium tabular-nums"
          >
            {item.status === "done" ? "✓" : "○"}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1",
              item.status === "done" && "line-through decoration-line-strong",
            )}
          >
            {item.content}
          </span>
        </li>
      ))}
    </ul>
  );
}
