import type { LedgerExclusion, LedgerSwitch } from "@/lib/memory";
import type { Turn } from "@/types/conversation";
import type { RuntimeKind } from "@/types/session";

/**
 * Where the memory page is reached from (main chat ticket 04b): the
 * title menu, the project menu, and the main chat's one-time ask. Pure
 * rules, so the conditions are tested apart from the menus.
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

/**
 * At least one exchange is complete: a user message followed by an
 * answer that finished (a final answer, not a run still going or one
 * waiting on ask_user).
 */
export function hasCompletedExchange(turns: readonly Turn[]): boolean {
  let askedByUser = false;
  for (const turn of turns) {
    if (turn.role === "user") {
      askedByUser = true;
      continue;
    }
    if (
      askedByUser &&
      turn.role === "agent" &&
      typeof turn.finalAnswer === "string" &&
      turn.finalAnswer.trim() !== ""
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the main chat asks, once, whether the ledger may read (PRD
 * ruling 46): the managed runtime's main chat, the switch never answered
 * (`undecided`), and at least one exchange complete — an empty main
 * chat stays empty (conversation.md §7 empty-state austerity). It also
 * waits while a run is open or the AI is asking something, so it never
 * stacks on the busy choice or an ask_user bubble; it comes back when
 * the run settles. Answering moves the switch off `undecided`, so it is
 * never asked again.
 *
 * `demo` (TEMPORARY, ticket 04b trial) shows it in the main chat
 * whatever the rest says.
 */
export function shouldAskAboutMemory({
  runtimeKind,
  isMainChat,
  ledgerSwitch,
  turns,
  runOpen,
  waitingAskUser,
  demo = false,
}: {
  runtimeKind: RuntimeKind;
  isMainChat: boolean;
  ledgerSwitch: LedgerSwitch | null;
  turns: readonly Turn[];
  runOpen: boolean;
  waitingAskUser: boolean;
  demo?: boolean;
}): boolean {
  if (runtimeKind !== "managed" || !isMainChat) return false;
  if (demo) return true;
  if (ledgerSwitch?.state !== "undecided") return false;
  if (runOpen || waitingAskUser) return false;
  return hasCompletedExchange(turns);
}
