import { useCallback, useEffect, useState } from "react";

import {
  inspectFilePresence,
  knownFilePresence,
  rememberFilePresence,
  samePresence,
  type FilePresence,
} from "@/lib/file-cards";

type Presences = Readonly<Record<string, FilePresence>>;

function fromMemory(paths: readonly string[]): Presences {
  const out: Record<string, FilePresence> = {};
  for (const path of paths) {
    const known = knownFilePresence(path);
    if (known) out[path] = known;
  }
  return out;
}

/**
 * Whether a reply's files are still there (main chat ticket 74): Core
 * is asked once per path when the cards mount — the conversation
 * opening, MainView mounting per session — not per frame; the answers
 * are remembered for the page, so a card drawn again starts from the
 * last one. `recheck` asks again (a click on a card), and says what
 * Core answered.
 */
export function useFilePresences(paths: readonly string[]): {
  presence: Presences;
  recheck: (path: string) => Promise<FilePresence>;
} {
  // The paths by value: a reply's list is a fresh array after a reload
  // of the same turns.
  const key = paths.join("\n");
  const [presence, setPresence] = useState<Presences>(() => fromMemory(paths));

  const settle = useCallback((path: string, answer: FilePresence) => {
    rememberFilePresence(path, answer);
    setPresence((previous) =>
      samePresence(previous[path], answer)
        ? previous
        : { ...previous, [path]: answer },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    for (const path of key.split("\n")) {
      if (!path) continue;
      // setState only in the promise callback, never synchronously in
      // the effect body (react-hooks/set-state-in-effect).
      void inspectFilePresence(path).then((answer) => {
        if (cancelled) rememberFilePresence(path, answer);
        else settle(path, answer);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key, settle]);

  const recheck = useCallback(
    async (path: string) => {
      const answer = await inspectFilePresence(path);
      settle(path, answer);
      return answer;
    },
    [settle],
  );

  return { presence, recheck };
}
