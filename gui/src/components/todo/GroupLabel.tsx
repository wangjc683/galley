import { CaretRight } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** A group's label: 11px semibold, muted — the sidebar's section
 * register without its uppercase, as one group is named 「Galley 在办」 and
 * the product name is never set in capitals (AGENTS.md, Names And
 * Terms). 已完成 folds: the whole label toggles it, its count and a caret
 * on the right. 3px above and below, about 22px tall (main chat ticket
 * 86, ruling 130: 6px before; beside Apple's Reminders the labels were
 * where the room went), so a label sits about 9px from its own group
 * and about 21px from the one above. The space over it is the groups'
 * gap (TodoPanelGroups); its own top margin, never in force as the
 * first child of its section, went with ticket 83. The 备忘 page's time
 * periods are labelled with it too (ticket 121; its days were, from
 * ticket 97 until ticket 119 set them in a column beside the memos).
 *
 * The count steps when it changes after the label mounted, up or down
 * (main chat ticket 161, PRD ruling 208 point 3): `sidebar-step-tick`,
 * once — a row ticked off with 已完成 folded fades where it stood, and
 * this is where it went. Not at mounting (the panel opening, the group
 * appearing); under reduced motion the class does nothing. */
export function GroupLabel({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  // Each change of the count after mounting, numbered: the number's own
  // box is keyed by it, so the step starts over on each.
  const [counted, setCounted] = useState(count);
  const [steps, setSteps] = useState(0);
  if (count !== counted) {
    setCounted(count);
    setSteps(steps + 1);
  }
  const register =
    "flex w-full items-center gap-1.5 rounded-sm px-2.5 py-[3px] text-left text-[11px] font-semibold text-ink-muted";
  if (!onToggle) {
    return (
      <div className={register}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        register,
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "outline-none hover:bg-hover hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-0.5 tabular-nums">
        {count !== undefined && (
          <span
            key={steps}
            data-role="group-count"
            className={steps > 0 ? "sidebar-step-tick" : undefined}
          >
            {count}
          </span>
        )}
        <CaretRight
          size={9}
          weight="thin"
          className={cn(
            "opacity-70 transition-transform duration-(--motion-fast) motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </span>
    </button>
  );
}
