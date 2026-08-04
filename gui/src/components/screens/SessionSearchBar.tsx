import { MagnifyingGlass } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shared raised search field for the session-list dialogs (Archived /
 * Earlier). Body is the app canvas (matching Settings' workbench
 * treatment), so the input is a *raised* field: bg-surface + a crisp
 * border-line, same as the Settings model-filter inputs. Focus swaps in
 * the brand border + ring.
 */
export function SessionSearchBar({
  query,
  onChange,
}: {
  query: string;
  onChange: (q: string) => void;
}) {
  const copy = useCopy();
  return (
    <div className="relative shrink-0 border-b border-line bg-app px-4 py-2.5">
      <MagnifyingGlass
        size={14}
        weight="thin"
        className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={copy.projects.filterArchive}
        autoFocus
        className={cn(
          "h-7 w-full rounded-sm border border-line bg-surface pl-7 pr-3 text-[12.5px] text-ink",
          "placeholder:text-ink-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
        )}
      />
    </div>
  );
}
