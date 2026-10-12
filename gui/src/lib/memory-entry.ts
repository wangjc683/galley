import type { LedgerExclusion, LedgerSwitch } from "@/lib/memory";
import type { RuntimeKind } from "@/types/session";

/**
 * Where the memory page is reached from (main chat ticket 04b): the
 * title menu and the project menu. Pure rules, so the conditions are
 * tested apart from the menus. (The main chat's one-time ask went with
 * ticket 04c: the ledger is on by default and the main chat's greeting
 * says so.)
 */

/** The session the title menu belongs to, as far as these rules care. */
export interface TitleMenuSession {
  id: string;
  mainChat?: boolean;
  gaRuntimeKind: RuntimeKind;
}

export interface TitleMenuMemoryItems {
  /** 「它记得我什么」 → Settings → Memory. The main chat only. */
  whatItRemembers: boolean;
  /** 「不用于了解我」 with its check state, or null when not offered. */
  exclusion: { checked: boolean } | null;
}

/**
 * The main chat's title menu leads to the memory page; every other
 * managed session's menu offers 「不用于了解我」 while the ledger is on
 * (off, there is nothing it would stop reading). Nothing on the external
 * runtime, which has no ledger.
 */
export function titleMenuMemoryItems({
  runtimeKind,
  session,
  ledgerSwitch,
  exclusions,
}: {
  runtimeKind: RuntimeKind;
  session: TitleMenuSession | undefined;
  ledgerSwitch: LedgerSwitch | null;
  exclusions: readonly LedgerExclusion[];
}): TitleMenuMemoryItems {
  const none = { whatItRemembers: false, exclusion: null };
  if (runtimeKind !== "managed" || !session) return none;
  if (session.gaRuntimeKind !== "managed") return none;
  if (session.mainChat) return { whatItRemembers: true, exclusion: null };
  if (ledgerSwitch?.state !== "on") return none;
  return {
    whatItRemembers: false,
    exclusion: {
      checked: exclusions.some(
        (row) => row.target.kind === "session" && row.target.id === session.id,
      ),
    },
  };
}

/** A project's menu offers 「不用于了解我」 under the same rule. Null when
 * not offered, else the check state. */
export function projectMenuExclusion({
  runtimeKind,
  projectId,
  ledgerSwitch,
  exclusions,
}: {
  runtimeKind: RuntimeKind;
  projectId: string;
  ledgerSwitch: LedgerSwitch | null;
  exclusions: readonly LedgerExclusion[];
}): { checked: boolean } | null {
  if (runtimeKind !== "managed" || ledgerSwitch?.state !== "on") return null;
  return {
    checked: exclusions.some(
      (row) => row.target.kind === "project" && row.target.id === projectId,
    ),
  };
}
