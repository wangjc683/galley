import { Archive } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";


export function SidebarFooter({
  onOpenArchived,
}: {
  onOpenArchived?: () => void;
}) {
  const copy = useCopy();
  // "Archived" not "Trash": our archive flow keeps data forever
  // (status="archived", row preserved). Trash semantics would imply
  // a holding area that's eventually purged — not what we do. The
  // ArchivedDialog provides single-row Delete and an Empty-all
  // operation if the user wants to actually purge.
  //
  // Sits on the session-row grid: a row's 16px icon column starts at
  // 18px (mx-1.5 + px-3), so its icon centre is 26px and its title
  // starts at 42px. pl-4.5 (18px) + the 12px glyph centred in a w-4
  // box + gap-2 lands on the same two lines; the button itself stays
  // full-bleed for the border-t and hover fill.
  return (
    <button
      type="button"
      onClick={onOpenArchived}
      className="flex w-full items-center gap-2 border-t border-line/70 py-1.5 pl-4.5 pr-3.5 text-left text-[11px] text-ink-muted transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft active:translate-y-px outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <span className="flex w-4 shrink-0 justify-center">
        <Archive size={12} weight="thin" className="text-ink-muted" />
      </span>
      <span>{copy.sidebar.archived}</span>
    </button>
  );
}
