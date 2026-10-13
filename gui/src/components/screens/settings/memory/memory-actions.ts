import {
  deleteEntryEmotion,
  deleteLedgerEntry,
  setLedgerSwitch,
  writeGlobalMemory,
  type GlobalMemoryName,
  type SetLedgerSwitchArgs,
} from "@/lib/memory";

/** What Settings → Memory can ask for. Each resolves when done and
 * rejects with Core's error (the page words the identifier). */
export interface MemoryActions {
  setSwitch: (args: SetLedgerSwitchArgs) => Promise<void>;
  /** Delete an affair, its emotions with it. */
  deleteEntry: (id: string) => Promise<void>;
  /** Delete one emotion of affair `id`, named by its `line`. */
  deleteEmotion: (id: string, line: string) => Promise<void>;
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
      await setLedgerSwitch(args);
      reload();
    },
    deleteEntry: async (id) => {
      try {
        await deleteLedgerEntry(id);
      } finally {
        reload();
      }
    },
    deleteEmotion: async (id, line) => {
      try {
        await deleteEntryEmotion(id, line);
      } finally {
        reload();
      }
    },
    writeGlobal: async (name, content, revision) => {
      const next = await writeGlobalMemory(name, content, revision);
      reload();
      return next;
    },
    reload,
  };
}
