import { useEffect, useState } from "react";

import type {
  GlobalMemoryName,
  LedgerTarget,
  MemoryOverview,
  SetLedgerSwitchArgs,
} from "@/lib/memory";

import type { MemoryActions } from "./memory-actions";

/**
 * TEMPORARY — ticket 04b trial (see conversation/memory-ask-trial.ts):
 * the 「演示数据」 mode of Settings → Memory. Renders the ledger eval's
 * fixture and keeps the page's actions on a local copy, so deleting,
 * removing from the do-not-record list, switching and saving all show
 * their effect without Core or a real file. Gone again when demo mode
 * is turned off (the copy is dropped).
 *
 * The fixture comes in through a dynamic import inside a DEV branch, so
 * a release build does not carry it.
 */
export function useMemoryDemoBackend(active: boolean): {
  overview: MemoryOverview | null;
  sessionTitles: Readonly<Record<string, string>>;
  actions: MemoryActions;
} {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [sessionTitles, setSessionTitles] = useState<
    Readonly<Record<string, string>>
  >({});

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (import.meta.env.DEV) {
      void import("./memory-overview.fixture").then((fixture) => {
        if (cancelled) return;
        setOverview(structuredClone(fixture.MEMORY_OVERVIEW_FIXTURE));
        setSessionTitles(fixture.MEMORY_FIXTURE_SESSION_TITLES);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Leaving demo mode drops the local copy (guarded set-state-in-render:
  // the next demo session starts from the fixture again).
  if (!active && overview !== null) setOverview(null);

  const update = (change: (draft: MemoryOverview) => void) => {
    setOverview((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      change(next);
      return next;
    });
  };

  const actions: MemoryActions = {
    setSwitch: async (args: SetLedgerSwitchArgs) => {
      update((draft) => {
        if (args.action === "enable") {
          draft.ledger.switch = {
            state: "on",
            since: args.lookBack
              ? "1970-01-01T00:00:00Z"
              : new Date().toISOString(),
            lookBack: args.lookBack,
          };
          return;
        }
        draft.ledger.switch = { state: "off" };
        draft.ledger.nextRunAt = undefined;
        if (args.clear) {
          draft.ledger.activities = { kind: "absent" };
          draft.ledger.emotions = { kind: "absent" };
          draft.ledger.forgotten = [];
          draft.ledger.lastRun = undefined;
        }
      });
    },
    deleteEntry: async (id: string) => {
      update((draft) => {
        const { activities, emotions } = draft.ledger;
        let title: string | null = null;
        let kind: "activity" | "emotion" = "activity";
        if (activities.kind === "parsed") {
          for (const list of [activities.ongoing, activities.ended]) {
            const index = list.findIndex((entry) => entry.id === id);
            if (index >= 0) {
              title = list[index].title;
              list.splice(index, 1);
            }
          }
        }
        if (emotions.kind === "parsed") {
          const index = emotions.entries.findIndex((entry) => entry.id === id);
          if (index >= 0) {
            title = emotions.entries[index].title;
            kind = "emotion";
            emotions.entries.splice(index, 1);
          }
        }
        if (title !== null) {
          draft.ledger.forgotten.push({
            id,
            kind,
            title,
            deletedAt: new Date().toISOString(),
          });
        }
      });
    },
    unforget: async (id: string) => {
      update((draft) => {
        draft.ledger.forgotten = draft.ledger.forgotten.filter(
          (entry) => entry.id !== id,
        );
      });
    },
    restoreExclusion: async (target: LedgerTarget) => {
      update((draft) => {
        draft.ledger.exclusions = draft.ledger.exclusions.filter(
          (row) =>
            row.target.kind !== target.kind || row.target.id !== target.id,
        );
      });
    },
    writeGlobal: async (
      name: GlobalMemoryName,
      content: string,
    ): Promise<string> => {
      const revision = `demo-${Date.now()}`;
      update((draft) => {
        const file = draft.globalMemory.find((entry) => entry.name === name);
        if (file) {
          file.content = content;
          file.exists = true;
          file.revision = revision;
        }
      });
      return revision;
    },
    reload: () => {},
  };

  return { overview: active ? overview : null, sessionTitles, actions };
}
