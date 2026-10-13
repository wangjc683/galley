import { invoke } from "@tauri-apps/api/core";

/**
 * Settings → Memory (main chat ticket 04, 04b, 04d): what the affairs
 * ledger has written about the user — each affair with the emotions
 * recorded under it — the switch that lets it read at all, and the
 * engine's two global memory files. Core owns all of it (ticket 04a);
 * this module is the wire types and the command wrappers, the interface
 * in `.scratch/main-chat/issues/04-what-it-remembers-page.md` 「接口」 as
 * 04d reshaped it. Tauri commands only, not part of the Agent API, and
 * not in `types/ipc.ts` (that file mirrors the runner bridge protocol).
 *
 * The new commands answer `managed_only` on the external runtime; the
 * GUI never calls them there.
 */

/** Core emits it (no payload) after the switch changes, a run starts or
 * ends, an entry or one of its emotions is deleted, and a global memory
 * file is written. Listeners read again. */
export const MEMORY_CHANGED_EVENT = "memory-changed";

/** Core prefs key `affairs_ledger`; no key = undecided (never set — Core
 * turns it on when it creates the main chat, ticket 04c). `since` is
 * RFC3339; reading earlier conversations stores the Unix epoch with
 * `lookBack: true`. */
export type LedgerSwitch =
  | { state: "undecided" }
  | { state: "off" }
  | { state: "on"; since: string; lookBack: boolean };

export interface LedgerQuote {
  session?: string;
  /** "YYYY-MM-DD HH:MM", local time. */
  at?: string;
  text: string;
}

/** One 「情绪」 line of an affair (ticket 04d: emotions live inside the
 * affair they belong to). */
export interface EntryEmotion {
  session?: string;
  /** "YYYY-MM-DD HH:MM", local time. */
  at?: string;
  tags: string[];
  /** The user's words. */
  text?: string;
  /** The line as the file has it; deleting this emotion names it. */
  line: string;
}

/** One ongoing or ended activity. */
export interface LedgerEntry {
  /** "A001" */
  id: string;
  title: string;
  /** The 「现状：」 line. */
  status?: string;
  /** The 「最近：」 line, YYYY-MM-DD. */
  lastSeen?: string;
  /** Galley session ids, or `im-<channel>-<YYYY-MM-DD>`. */
  sessions: string[];
  quotes: LedgerQuote[];
  /** Its emotions, in file order. */
  emotions: EntryEmotion[];
  /** The other 「- 键：值」 lines, verbatim. */
  extra: string[];
}

/** A file the parser could not read at all is `raw` (shown read-only);
 * one it read in part keeps the rest in `other`. */
export type Parsed<T> =
  | { kind: "absent" }
  | ({ kind: "parsed" } & T)
  | { kind: "raw"; text: string };

export type LedgerActivities = Parsed<{
  ongoing: LedgerEntry[];
  ended: LedgerEntry[];
  /** Paragraphs the parser did not recognize, verbatim. */
  other?: string;
}>;

export interface LedgerRun {
  startedAt: string;
  outcome: "running" | "succeeded" | "failed" | "empty";
  turns: number;
  detail?: string;
}

export type GlobalMemoryName = "global_mem.txt" | "global_mem_insight.txt";

export interface GlobalMemoryFile {
  name: GlobalMemoryName;
  exists: boolean;
  content: string;
  /** Content hash; a write with a stale one answers `changed_on_disk`. */
  revision: string;
}

export interface MemoryOverview {
  ledger: {
    switch: LedgerSwitch;
    running: boolean;
    lastRun?: LedgerRun;
    /** RFC3339; while on, when the next run is due. */
    nextRunAt?: string;
    /** The affairs, each with its emotions. */
    activities: LedgerActivities;
  };
  globalMemory: GlobalMemoryFile[];
}

export type SetLedgerSwitchArgs =
  | { action: "enable"; lookBack: boolean }
  | { action: "disable"; clear: boolean };

/** Error identifiers the memory commands answer with; the page words
 * each one itself. */
export type MemoryErrorId =
  | "managed_only"
  | "ledger_busy"
  | "not_found"
  | "changed_on_disk";

const MEMORY_ERROR_IDS: readonly MemoryErrorId[] = [
  "managed_only",
  "ledger_busy",
  "not_found",
  "changed_on_disk",
];

/**
 * The identifier a failed memory command answered with, or null. Core
 * sends the bare identifier; a typed `GalleyError` arrives as JSON
 * (`{"error":"not_found","message":"…"}`) and a Display form as
 * `not_found: …`, so all three are read.
 */
export function memoryErrorId(error: unknown): MemoryErrorId | null {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  let tag = raw.trim();
  try {
    const parsed = JSON.parse(tag) as { error?: unknown };
    if (typeof parsed?.error === "string") tag = parsed.error;
  } catch {
    // Not JSON: the bare identifier or a Display form.
  }
  return (
    MEMORY_ERROR_IDS.find(
      (id) =>
        tag === id || tag.startsWith(`${id}:`) || tag.startsWith(`${id} `),
    ) ?? null
  );
}

/** Readable text of a failed command for an error line / toast. */
export function memoryErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** The switch alone — light; the menus use it. */
export async function getLedgerSwitch(): Promise<LedgerSwitch> {
  return invoke<LedgerSwitch>("get_ledger_switch");
}

export async function getMemoryOverview(): Promise<MemoryOverview> {
  return invoke<MemoryOverview>("get_memory_overview");
}

/** Turn the ledger on (the page always reads earlier conversations
 * too) or off (keep / clear). Answers the new switch. */
export async function setLedgerSwitch(
  args: SetLedgerSwitchArgs,
): Promise<LedgerSwitch> {
  return invoke<LedgerSwitch>("set_ledger_switch", { ...args });
}

/** Delete one affair, the emotions recorded under it with it. Only a
 * delete: said again later, it may be recorded again. `ledger_busy` while
 * a run is going, `not_found` when it is already gone. */
export async function deleteLedgerEntry(id: string): Promise<void> {
  await invoke("delete_ledger_entry", { id });
}

/** Delete one emotion of affair `id`, named by its `line` (its text,
 * never a position a run could have moved). Errors as above. */
export async function deleteEntryEmotion(
  id: string,
  line: string,
): Promise<void> {
  await invoke("delete_ledger_emotion", { id, line });
}

/** Write one global memory file. Answers the new revision;
 * `changed_on_disk` when the file changed since `revision`. */
export async function writeGlobalMemory(
  name: GlobalMemoryName,
  content: string,
  revision: string,
): Promise<string> {
  return invoke<string>("write_global_memory", { name, content, revision });
}
