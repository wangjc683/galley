import {
  deleteLedgerEntry,
  unforgetLedgerEntry,
  writeGlobalMemory,
  type GlobalMemoryName,
  type LedgerTarget,
  type SetLedgerSwitchArgs,
} from "@/lib/memory";
import { useMemoryStore } from "@/stores/memory";

/** What Settings → Memory can ask for. Each resolves when done and
 * rejects with Core's error (the page words the identifier). */
export interface MemoryActions {
  setSwitch: (args: SetLedgerSwitchArgs) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  unforget: (id: string) => Promise<void>;
  restoreExclusion: (target: LedgerTarget) => Promise<void>;
  /** Answers the file's new revision. */
  writeGlobal: (
    name: GlobalMemoryName,
    content: string,
    revision: string,
  ) => Promise<string>;
  /** Read the overview again. */
  reload: () => void;
}

/**
 * The page's actions against Core. Core also sends `memory-changed`
 * after each, but the page reads again right away as well: the event is
 * the cross-surface signal, not something an action should wait on.
 */
export function coreMemoryActions(reload: () => void): MemoryActions {
  return {
    setSwitch: async (args) => {
      await useMemoryStore.getState().setSwitch(args);
      reload();
    },
    deleteEntry: async (id) => {
      try {
        await deleteLedgerEntry(id);
      } finally {
        reload();
      }
    },
    unforget: async (id) => {
      await unforgetLedgerEntry(id);
      reload();
    },
    restoreExclusion: async (target) => {
      await useMemoryStore.getState().setExcluded(target, false);
      reload();
    },
    writeGlobal: async (name, content, revision) => {
      const next = await writeGlobalMemory(name, content, revision);
      reload();
      return next;
    },
    reload,
  };
}
