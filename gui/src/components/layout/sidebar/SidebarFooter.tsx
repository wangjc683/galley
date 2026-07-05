import { Archive } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";


export function SidebarFooter({
  count,
  onOpenArchived,
}: {
  count: number;
  onOpenArchived?: () => void;
}) {
  const copy = useCopy();
  // "Archived" not "Trash": our archive flow keeps data forever
  // (status="archived", row preserved). Trash semantics would imply
  // a holding area that's eventually purged — not what we do. The
  // ArchivedDialog provides single-row Delete and an Empty-all
  // operation if the user wants to actually purge.
  return (
    <button
      type="button"
      onClick={onOpenArchived}
      className="flex w-full items-center gap-2 border-t border-line/70 px-3.5 py-1.5 text-left text-[11px] text-ink-muted transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-hover hover:text-ink-soft active:translate-y-px active:duration-[45ms] outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <Archive size={12} weight="thin" className="text-ink-muted" />
      <span>{copy.sidebar.archived}</span>
      {count > 0 && <span className="ml-auto text-ink-muted">{count}</span>}
    </button>
  );
}
