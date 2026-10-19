import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { type RefObject, useEffect, useRef } from "react";

import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import { useSessionStatusView } from "@/hooks/useSessionStatusView";
import {
  type FaceActivityInput,
  type FaceReaction,
  faceActivity,
  liveToolKind,
  shouldDoze,
  wakeKind,
} from "@/lib/assistant-face";
import { assistantWriting } from "@/lib/assistant-conversation";
import {
  FaceDirector,
  type FaceClock,
  REAL_CLOCK,
} from "@/lib/assistant-face-director";
import {
  readComposerDraft,
  subscribeComposerDrafts,
} from "@/lib/composer-draft";
import { endsInSilentReport } from "@/lib/subtasks";
import { useAssistantFaceStore } from "@/stores/assistant-face";
import { useMessagesStore } from "@/stores/messages";
import { useQueueStore } from "@/stores/queue";
import { useSubtasksStore } from "@/stores/subtasks";
import type { Session } from "@/types/session";

/** How often 丙 checks whether it is time to doze. */
const DOZE_CHECK_MS = 20_000;
/** After a round ends, how long to wait before calling it done: the
 * question or the error that may have ended it lands just after. */
const DONE_SETTLE_MS = 300;

export interface FaceDriverOptions {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** The main chat itself is the open conversation. */
  open: boolean;
  /** 丙: alive at rest, dozing. */
  alive: boolean;
  /** The demo drives the face; the real state is not followed. */
  demo: boolean;
  clock?: FaceClock;
  random?: () => number;
}

interface Live {
  inputs: Omit<FaceActivityInput, "dozing">;
  running: boolean;
  dozing: boolean;
  /** Your last touch: any key or click in the window. */
  lastTouch: number;
  open: boolean;
  alive: boolean;
  demo: boolean;
  focused: boolean;
  /** This round was stopped / sent a subtask off. */
  stopped: boolean;
  dispatched: boolean;
}

/**
 * Drives the assistant's face (main chat ticket 65): reads what the page
 * already knows, turns it into the face's activity and reactions
 * (lib/assistant-face.ts), and hands them to one FaceDirector whose beats
 * every avatar plays (stores/assistant-face.ts). Mounted once.
 *
 * Where each thing comes from — all of it already on the page:
 *
 *   running, a question, an error   the main chat's status view and its
 *                                   subtasks' (useSessionStatusView,
 *                                   useSessionsAttention)
 *   writing words, the tool now     the round's raw stream
 *                                   (`assistantWriting`, `liveToolKind`)
 *   a subtask out                   its subtasks' running count
 *   a subtask sent off              Core's dispatch records (stores/subtasks)
 *   woken by a reminder / a report  the report row that opens the round
 *                                   (`wakeKind`)
 *   you sent, you stopped           the messages store's submit tick, the
 *                                   main chat's queue, its `isStopping`
 *   you type in its composer        its draft (lib/composer-draft.ts)
 *   a file dragged in               the window's native drag events
 *   the pointer on it               the card's and the header's hover
 *                                   (`signalAssistantLook`)
 *
 * Returns the director, for the trial's demo.
 */
export function useAssistantFaceDriver({
  mainChat,
  subtasks,
  open,
  alive,
  demo,
  clock = REAL_CLOCK,
  random = Math.random,
}: FaceDriverOptions): RefObject<FaceDirector | null> {
  const directorRef = useRef<FaceDirector | null>(null);
  const live = useRef<Live>({
    inputs: {
      asking: false,
      erroring: false,
      running: false,
      writing: false,
      tool: null,
      subtasksRunning: false,
    },
    running: false,
    dozing: false,
    lastTouch: 0,
    open,
    alive,
    demo,
    focused: true,
    stopped: false,
    dispatched: false,
  });

  const mainId = mainChat.id;
  const view = useSessionStatusView(mainChat);
  const attention = useSessionsAttention(subtasks, undefined);
  const running = view.status === "running";
  const asking = useMessagesStore(
    (s) =>
      s.byId[mainId]?.pendingAskUser != null ||
      subtasks.some((t) => s.byId[t.id]?.pendingAskUser != null),
  );
  const erroring = view.status === "error" || attention.kind === "error";
  const writing = useMessagesStore(
    (s) => running && assistantWriting(s.byId[mainId]?.inFlightContent ?? ""),
  );
  const tool = useMessagesStore((s) =>
    running ? liveToolKind(s.byId[mainId]?.inFlightContent ?? "") : null,
  );
  const subtasksRunning = attention.runningCount > 0;

  // The director: one per driver, its beats to the shared store.
  useEffect(() => {
    const director = new FaceDirector({
      clock,
      random,
      onBeat: (beat) => useAssistantFaceStore.getState().play(beat),
      onBob: (beat) => useAssistantFaceStore.getState().playBob(beat),
    });
    directorRef.current = director;
    live.current.lastTouch = clock.now();
    return () => {
      director.dispose();
      directorRef.current = null;
    };
  }, [clock, random]);

  /** Turn the latest inputs into the activity. */
  const recompute = () => {
    const director = directorRef.current;
    const l = live.current;
    if (!director || l.demo) return;
    director.setActivity(faceActivity({ ...l.inputs, dozing: l.dozing }));
  };
  const react = (reaction: FaceReaction) => {
    if (live.current.demo) return;
    directorRef.current?.react(reaction);
  };
  /** You touched it: the doze clock restarts, and it wakes. */
  const touch = (wakes: boolean) => {
    const l = live.current;
    l.lastTouch = clock.now();
    if (wakes && l.dozing) {
      l.dozing = false;
      recompute();
      react("wake");
      return true;
    }
    return false;
  };

  // What lasts: the activity, and the reactions its edges set off.
  useEffect(() => {
    const l = live.current;
    const before = l.inputs;
    const wasRunning = l.running;
    l.inputs = { asking, erroring, running, writing, tool, subtasksRunning };
    l.running = running;
    // Busy is no doze: it wakes for the work, and dozes again only after
    // a quiet spell.
    if (running || asking || erroring) {
      l.dozing = false;
      l.lastTouch = clock.now();
    }
    if (l.demo) return;
    recompute();
    if (asking && !before.asking) react("askEnter");
    else if (erroring && !before.erroring) react("errorEnter");
    if (running && !wasRunning) {
      l.stopped = false;
      l.dispatched = false;
      const turns = useMessagesStore.getState().byId[mainId]?.turns ?? [];
      const woke = wakeKind(turns);
      if (woke === "reminder") react("wakeReminder");
      else if (woke === "subtask") react("subtaskBack");
    }
    if (!running && wasRunning) {
      const handle = clock.setTimeout(() => {
        const now = live.current;
        if (now.running || now.inputs.asking || now.inputs.erroring) return;
        if (now.stopped || now.dispatched) return;
        const turns = useMessagesStore.getState().byId[mainId]?.turns ?? [];
        if (endsInSilentReport(turns)) return;
        react("done");
      }, DONE_SETTLE_MS);
      return () => clock.clearTimeout(handle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, erroring, running, writing, tool, subtasksRunning, mainId]);

  // 乙 / 丙.
  useEffect(() => {
    live.current.alive = alive;
    directorRef.current?.setAlive(alive);
    if (!alive && live.current.dozing) {
      live.current.dozing = false;
      recompute();
    }
  }, [alive]);

  // The demo takes over; when it ends, back to the real state.
  useEffect(() => {
    live.current.demo = demo;
    if (!demo) {
      useAssistantFaceStore.getState().setDemoLabel(null);
      recompute();
    }
  }, [demo]);

  // Switching to the main chat wakes it.
  useEffect(() => {
    const wasOpen = live.current.open;
    live.current.open = open;
    if (open && !wasOpen) touch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // You sent a message, queued one, pressed stop.
  useEffect(() => {
    const unsubscribeMessages = useMessagesStore.subscribe((state, prev) => {
      const l = live.current;
      if (
        state.userSubmitTick !== prev.userSubmitTick &&
        (state.lastSubmitSource === "composer" ||
          state.lastSubmitSource === "side") &&
        l.open
      ) {
        if (!touch(true)) react("sent");
      }
      const stopping = state.byId[mainId]?.isStopping ?? false;
      if (stopping && !(prev.byId[mainId]?.isStopping ?? false)) {
        l.stopped = true;
        react("stop");
      }
    });
    const unsubscribeQueue = useQueueStore.subscribe((state, prev) => {
      const now = state.bySession[mainId]?.length ?? 0;
      const before = prev.bySession[mainId]?.length ?? 0;
      if (now > before && live.current.open) react("sent");
    });
    return () => {
      unsubscribeMessages();
      unsubscribeQueue();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId]);

  // A reply sent a subtask off: a dispatch record the page had not seen.
  useEffect(() => {
    const key = (d: { messageId: string; ordinal: number }) =>
      `${d.messageId}#${d.ordinal}`;
    let seen: Set<string> | null = null;
    const look = (
      records: { messageId: string; ordinal: number }[] | undefined,
    ) => {
      if (!records) return;
      const keys = new Set(records.map(key));
      // The first records the page reads are history, not news.
      if (seen === null) {
        seen = keys;
        return;
      }
      const fresh = [...keys].some((k) => !seen!.has(k));
      seen = keys;
      if (fresh) {
        live.current.dispatched = true;
        react("dispatch");
      }
    };
    look(useSubtasksStore.getState().byParent[mainId]);
    return useSubtasksStore.subscribe((state, prev) => {
      if (state.byParent[mainId] !== prev.byParent[mainId]) {
        look(state.byParent[mainId]);
      }
    });
  }, [mainId]);

  // You type in its composer: it listens.
  useEffect(() => {
    let text = readComposerDraft(mainId)?.text ?? "";
    return subscribeComposerDrafts(() => {
      const next = readComposerDraft(mainId)?.text ?? "";
      if (next === text) return;
      text = next;
      if (!live.current.open) return;
      if (!touch(true)) react("listen");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainId]);

  // The pointer came onto it: it looks at you, or wakes.
  useEffect(
    () =>
      useAssistantFaceStore.subscribe((state, prev) => {
        if (!state.signal || state.signal.seq === prev.signal?.seq) return;
        if (state.signal.kind !== "look") return;
        if (!touch(true)) react("look");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A file dragged in over its conversation. Read-only beside the
  // composer's own listener (useNativeDragDrop): drops are its alone.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (
          event.payload.type !== "enter" ||
          event.payload.paths.length === 0
        ) {
          return;
        }
        if (live.current.open) react("drop");
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No drag events: no reaction to them.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Paused when the window is not in front or no avatar is on screen;
  // still under the system's reduced motion (read live, as
  // lib/animate-scroll.ts does).
  useEffect(() => {
    const l = live.current;
    const update = () => {
      const onScreen =
        Object.keys(useAssistantFaceStore.getState().onScreen).length > 0;
      directorRef.current?.setActive(l.focused && onScreen);
    };
    const onFocus = () => {
      l.focused = document.hasFocus() && document.visibilityState === "visible";
      update();
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const unsubscribe = useAssistantFaceStore.subscribe((state, prev) => {
      if (state.onScreen !== prev.onScreen) update();
    });
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotion = () =>
      directorRef.current?.setStill(query?.matches ?? false);
    onMotion();
    query?.addEventListener("change", onMotion);
    // Any key or click in the window is a touch for the doze clock.
    const onInput = () => {
      l.lastTouch = clock.now();
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      unsubscribe();
      query?.removeEventListener("change", onMotion);
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
    };
  }, [clock]);

  // 丙: time to doze?
  useEffect(() => {
    if (!alive) return;
    let handle: unknown = null;
    const check = () => {
      const l = live.current;
      const now = clock.now();
      if (
        !l.dozing &&
        !l.running &&
        !l.inputs.asking &&
        !l.inputs.erroring &&
        shouldDoze(now - l.lastTouch, new Date(now).getHours())
      ) {
        l.dozing = true;
        recompute();
      }
      handle = clock.setTimeout(check, DOZE_CHECK_MS);
    };
    handle = clock.setTimeout(check, DOZE_CHECK_MS);
    return () => {
      if (handle !== null) clock.clearTimeout(handle);
    };
  }, [alive, clock]);

  return directorRef;
}
