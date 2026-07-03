import { useEffect, useMemo, useState } from "react";

import type { Session } from "@/types/session";

/**
 * Shared state machine for the session-list dialogs (Archived /
 * Earlier): the text filter over title+summary plus the Gmail-style
 * select mode. Extracted because the two dialogs carried byte-identical
 * copies that had to be hand-synced.
 *
 * Resets query / mode / selection every time `open` flips true
 * (deferred a tick to satisfy react-hooks/set-state-in-effect).
 * Dialog-specific open-reset extras stay in the caller.
 */
export function useSessionSelectMode(open: boolean, rows: Session[]) {
  const [query, setQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setQuery("");
      setSelectMode(false);
      setSelected(new Set());
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (trimmedQuery === "") return rows;
    return rows.filter((s) => {
      const hay = `${s.title}\n${s.summary ?? ""}`.toLowerCase();
      return hay.includes(trimmedQuery);
    });
  }, [rows, trimmedQuery]);
  const isFiltered = trimmedQuery !== "";

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const enterSelectMode = () => setSelectMode(true);
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // "Select all visible" toggles between selecting every currently-
  // filtered row and clearing them. Other (non-visible) rows the user
  // may have already picked under a different filter stay selected —
  // toggling the visible set is the principle of least surprise when
  // filters and selection are independent.
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const s of filtered) next.delete(s.id);
      } else {
        for (const s of filtered) next.add(s.id);
      }
      return next;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return {
    query,
    setQuery,
    filtered,
    isFiltered,
    selectMode,
    selected,
    selectedIds,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    allVisibleSelected,
    toggleSelectAllVisible,
  };
}
