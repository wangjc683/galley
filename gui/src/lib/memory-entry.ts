import type { RuntimeKind } from "@/types/session";

/**
 * Where the memory page is reached from (main chat ticket 04b): the main
 * chat's title menu. A pure rule, so the condition is tested apart from
 * the menu. (The main chat's one-time ask went with ticket 04c; the
 * other sessions' and the projects' 「不用于了解我」 went with 04d — the
 * switch on the page is the one way to stop the reading.)
 */

/** The session the title menu belongs to, as far as this rule cares. */
export interface TitleMenuSession {
  id: string;
  mainChat?: boolean;
  gaRuntimeKind: RuntimeKind;
}

/**
 * 「它记得我什么」 → Settings → Memory: the main chat's title menu only.
 * Nothing on the external runtime, which has no ledger.
 */
export function titleMenuOpensMemory({
  runtimeKind,
  session,
}: {
  runtimeKind: RuntimeKind;
  session: TitleMenuSession | undefined;
}): boolean {
  return (
    runtimeKind === "managed" &&
    session?.gaRuntimeKind === "managed" &&
    session.mainChat === true
  );
}
