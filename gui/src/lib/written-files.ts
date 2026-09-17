import { createContext } from "react";
import type { Turn } from "@/types/conversation";

/**
 * Files this session's own file tools wrote, keyed by the names a reply
 * is likely to repeat. The chat has no reliable base directory for
 * relative paths (the 2026-09-08 boundary), but a name that matches a
 * file the bridge already resolved is a lookup, not a guess: the
 * absolute path came from GA's handler cwd at the moment of the write.
 *
 * Strict on purpose (2026-09-17): a reference resolves only when it
 * equals a written file's relative spelling or bare filename exactly,
 * and a name that two different files share resolves to nothing.
 */
export type WrittenFileResolver = (reference: string) => string | null;

export const WrittenFilesContext = createContext<WrittenFileResolver | null>(
  null,
);

const AMBIGUOUS = Symbol("ambiguous");

function normalizeReference(value: string): string {
  let v = value.trim().replace(/\\/g, "/");
  while (v.startsWith("./")) v = v.slice(2);
  return v;
}

export function buildWrittenFileResolver(turns: Turn[]): WrittenFileResolver {
  const index = new Map<string, string | typeof AMBIGUOUS>();
  const add = (key: string, path: string) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing === undefined) index.set(key, path);
    else if (existing !== path) index.set(key, AMBIGUOUS);
  };
  for (const turn of turns) {
    if (turn.role !== "agent") continue;
    for (const tool of turn.tools) {
      const path = tool.resolvedPath;
      if (!path) continue;
      const arg = typeof tool.args?.path === "string" ? tool.args.path : "";
      add(normalizeReference(arg), path);
      add(path.split(/[\\/]/).filter(Boolean).pop() ?? "", path);
    }
  }
  if (index.size === 0) return () => null;
  return (reference) => {
    const hit = index.get(normalizeReference(reference));
    return typeof hit === "string" ? hit : null;
  };
}
