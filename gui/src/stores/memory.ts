import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  getLedgerSwitch,
  listLedgerExclusions,
  MEMORY_CHANGED_EVENT,
  setLedgerExcluded,
  setLedgerSwitch,
  type LedgerExclusion,
  type LedgerSwitch,
  type LedgerTarget,
  type SetLedgerSwitchArgs,
} from "@/lib/memory";

interface MemoryState {
  /** Core's ledger switch; null until read, and always null on the
   * external runtime (nothing there asks Core). */
  ledgerSwitch: LedgerSwitch | null;
  /** The "not used to understand me" marks, for the menus' check state. */
  exclusions: LedgerExclusion[];
  /** Read the switch and the marks again. A read that started before a
   * newer one is dropped, so an old answer never overwrites a new one. */
  refresh: () => Promise<void>;
  /** Live from `memory-changed` and read once now; returns the
   * unsubscribe. Managed runtime only (useMemorySync). */
  connect: () => () => void;
  /** Forget everything (the external runtime has no ledger). */
  reset: () => void;
  /** Answer the switch (the main chat's ask, Settings → Memory). */
  setSwitch: (args: SetLedgerSwitchArgs) => Promise<LedgerSwitch>;
  /** Mark / unmark a session or project, then read the marks again. */
  setExcluded: (target: LedgerTarget, excluded: boolean) => Promise<void>;
}

let readGeneration = 0;

/**
 * A mirror of Core's ledger switch and exclusion marks (ticket 04b). Core
 * owns both (Rule 5); this store only reads them, live from
 * `memory-changed`, so the main chat's ask and the title / project menus
 * agree with Settings → Memory without each asking Core. Settings →
 * Memory reads the full overview itself.
 */
export const useMemoryStore = create<MemoryState>((set, get) => ({
  ledgerSwitch: null,
  exclusions: [],

  refresh: async () => {
    const generation = ++readGeneration;
    const [switchResult, exclusionsResult] = await Promise.allSettled([
      getLedgerSwitch(),
      listLedgerExclusions(),
    ]);
    if (generation !== readGeneration) return;
    if (switchResult.status === "fulfilled") {
      set({ ledgerSwitch: switchResult.value });
    } else {
      console.warn(
        "[memory] reading the ledger switch failed",
        switchResult.reason,
      );
    }
    if (exclusionsResult.status === "fulfilled") {
      set({ exclusions: exclusionsResult.value });
    } else {
      console.warn(
        "[memory] reading the ledger exclusions failed",
        exclusionsResult.reason,
      );
    }
  },

  connect: () => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen(MEMORY_CHANGED_EVENT, () => {
      if (!cancelled) void get().refresh();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e: unknown) => {
        console.warn("[memory] subscribing to memory-changed failed", e);
      });
    void get().refresh();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  },

  reset: () => {
    readGeneration += 1;
    set({ ledgerSwitch: null, exclusions: [] });
  },

  setSwitch: async (args) => {
    const next = await setLedgerSwitch(args);
    readGeneration += 1;
    set({ ledgerSwitch: next });
    return next;
  },

  setExcluded: async (target, excluded) => {
    await setLedgerExcluded(target, excluded);
    await get().refresh();
  },
}));

/** Whether `target` carries a "not used to understand me" mark. */
export function isLedgerExcluded(
  exclusions: readonly LedgerExclusion[],
  target: LedgerTarget,
): boolean {
  return exclusions.some(
    (row) => row.target.kind === target.kind && row.target.id === target.id,
  );
}
