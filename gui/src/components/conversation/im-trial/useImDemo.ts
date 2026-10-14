import { useEffect, useMemo, useState } from "react";

import type { ResolvedLanguage } from "@/lib/language";

import type { ImDemo } from "./im-trial";
import {
  type ImDemoView,
  imDemoBase,
  imDemoLanded,
  imDemoQuestion,
  imDemoStreaming,
  imDemoTurns,
} from "./im-trial-demo";

/** How often the 「在跑」 demo moves (its streaming narration). */
const RUNNING_TICK_MS = 150;

/**
 * TEMPORARY — the 「演示」 conversation for MainView (ticket 19; see
 * im-trial-demo.ts), or null while it is off. Display only.
 *
 * The clock: each opening of a demo variant notes when it began (the
 * history's today and the 「在跑」 round's start), and 「在跑」 ticks every
 * 150ms. The history is built once per opening and the 「在跑」 turns
 * only when a step lands, so between steps only the streaming text
 * changes and every settled message keeps its identity (MessageAgent /
 * MessageUser stay memoized instead of re-parsing on every tick).
 */
export function useImDemo(
  variant: ImDemo,
  language: ResolvedLanguage,
): ImDemoView | null {
  const [clock, setClock] = useState(() => {
    const t = Date.now();
    return { variant, startedAt: t, now: t };
  });
  useEffect(() => {
    // The first callback notes when this variant began (off too, so a
    // later opening starts fresh): setState stays out of the effect body
    // (React compiler rule) and out of render.
    // Unchanged (the mount's own variant, every ordinary conversation's
    // "off") keeps the same state object, so React renders nothing.
    const begin = window.setTimeout(() => {
      const t = Date.now();
      setClock((c) =>
        c.variant === variant ? c : { variant, startedAt: t, now: t },
      );
    }, 0);
    const tick =
      variant === "running"
        ? window.setInterval(
            () => setClock((c) => ({ ...c, now: Date.now() })),
            RUNNING_TICK_MS,
          )
        : null;
    return () => {
      window.clearTimeout(begin);
      if (tick !== null) window.clearInterval(tick);
    };
  }, [variant]);

  // Just switched, before the first callback: the round starts now.
  const fresh = clock.variant === variant;
  const startedAt = fresh ? clock.startedAt : clock.now;
  const elapsed = clock.now - startedAt;
  const running = variant === "running";
  const landed = running ? imDemoLanded(elapsed) : 0;

  const base = useMemo(
    () => (variant === "off" ? null : imDemoBase(language, startedAt)),
    [variant, language, startedAt],
  );
  const turns = useMemo(
    () =>
      base && variant !== "off"
        ? imDemoTurns(variant, base, landed, startedAt)
        : null,
    [base, variant, landed, startedAt],
  );
  const streaming = running && base ? imDemoStreaming(base, elapsed) : "";

  return useMemo(() => {
    if (!base || !turns || variant === "off") return null;
    return {
      turns,
      running,
      pendingAskUser: variant === "asking" ? imDemoQuestion(base) : null,
      currentTurnIndex: running ? landed + 1 : null,
      runStartedAtMs: running ? startedAt : null,
      inFlight: streaming,
      greetingAt: base.greetingAt,
      cards: base.cards,
    };
  }, [base, turns, variant, running, landed, startedAt, streaming]);
}
