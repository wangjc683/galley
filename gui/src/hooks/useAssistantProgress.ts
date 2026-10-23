import { useEffect, useMemo, useState } from "react";

import {
  assistantTyping,
  assistantWriting,
} from "@/lib/assistant-conversation";
import {
  assistantRunMinutes,
  msToNextRunMinute,
} from "@/lib/assistant-progress";
import { liveRunElapsedBaseMs } from "@/lib/run-groups";
import {
  EMPTY_TURNS,
  type MessagesStore,
  useMessagesStore,
} from "@/stores/messages";

/*
 * TEMP variant switcher (main chat 90) — the sidebar card's reads for
 * 「新」 while the main chat runs (main chat PRD ruling 134; removal in
 * components/conversation/live-progress-variants/live-progress-variants.ts).
 * Kept if 「新」 wins.
 */

/** Whose round runs: one you started (`own`; `own-writing` while it
 * writes words, `assistantWriting`) or one Core woke it for (`woken`). */
export type AssistantRound = "own" | "own-writing" | "woken";

/** useAssistantRound's selector: null at rest without looking at the
 * turns or the stream. */
export function selectAssistantRound(
  state: MessagesStore,
  sessionId: string,
  running: boolean,
): AssistantRound | null {
  if (!running) return null;
  const m = state.byId[sessionId];
  // A round you started reads as typing with nothing streaming
  // (`assistantTyping`'s report-round check, kept for the last turns).
  if (!assistantTyping(m?.turns ?? EMPTY_TURNS, "")) return "woken";
  return assistantWriting(m?.inFlightContent ?? "") ? "own-writing" : "own";
}

/**
 * While the main chat runs, whose round it is and whether it writes
 * words: a string, so the card re-renders only when it changes, never
 * per chunk.
 */
export function useAssistantRound(
  sessionId: string,
  running: boolean,
): AssistantRound | null {
  return useMessagesStore((s) => selectAssistantRound(s, sessionId, running));
}

/** Past the minute's turn, so a timer that fires early by a few
 * milliseconds does not land just short of it. */
const MINUTE_PAD_MS = 50;

/**
 * The run's whole minutes while `active` (0 otherwise): the round's run
 * clock (`currentRunStartedAtMs`) plus what its answered segments banked
 * (`liveRunElapsedBaseMs`) — the figure the line under the dots and the
 * workbench's corner clock count (lib/assistant-progress.ts
 * `assistantRunMinutes`). The card re-renders only when the minute turns:
 * a timer is set for the next whole minute, and the render reads the
 * time it last set, never the clock. A clock gone stale (the hook
 * turned active, a new segment started) is caught up at once by a timer
 * of 0.
 */
export function useAssistantRunMinutes(
  sessionId: string,
  active: boolean,
): number {
  const startedAtMs = useMessagesStore((s) =>
    active ? (s.byId[sessionId]?.currentRunStartedAtMs ?? null) : null,
  );
  const turns = useMessagesStore((s) =>
    active ? s.byId[sessionId]?.turns : undefined,
  );
  const baseMs = useMemo(
    () => (turns ? liveRunElapsedBaseMs(turns) : 0),
    [turns],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) return;
    const actual = Date.now();
    const stale =
      assistantRunMinutes(baseMs, startedAtMs, now) !==
      assistantRunMinutes(baseMs, startedAtMs, actual);
    const due = stale
      ? 0
      : msToNextRunMinute(baseMs, startedAtMs, actual) + MINUTE_PAD_MS;
    const id = window.setTimeout(() => setNow(Date.now()), due);
    return () => window.clearTimeout(id);
  }, [startedAtMs, baseMs, now]);
  return startedAtMs === null
    ? 0
    : assistantRunMinutes(baseMs, startedAtMs, now);
}
