import { invoke } from "@tauri-apps/api/core";

/**
 * Settings → Memory and its entry points (main chat ticket 04, 04b): what
 * the affairs ledger has written about the user, the switch that lets it
 * read at all, the "not used to understand me" marks, and the engine's
 * two global memory files. Core owns all of it (ticket 04a); this module
 * is the wire types and the command wrappers, word for word the
 * interface in `.scratch/main-chat/issues/04-what-it-remembers-page.md`
 * 「接口」. Tauri commands only, not part of the Agent API, and not in
 * `types/ipc.ts` (that file mirrors the runner bridge protocol).
 *
 * The new commands answer `managed_only` on the external runtime; the
 * GUI never calls them there.
 */

/** Core emits it (no payload) after the switch changes, a run starts or
 * ends, an entry is deleted or taken off the do-not-record list, and a
 * global memory file is written. Listeners read again. */
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
  /** The other 「- 键：值」 lines, verbatim. */
  extra: string[];
}

export interface LedgerEmotion {
  /** "E001" */
  id: string;
  title: string;
  at?: string;
  sessions: string[];
  tags: string[];
  quotes: LedgerQuote[];
  /** The related activity's id. */
  related?: string;
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

export type LedgerEmotions = Parsed<{
  entries: LedgerEmotion[];
  other?: string;
}>;

export interface LedgerRun {
  startedAt: string;
  outcome: "running" | "succeeded" | "failed" | "empty";
  turns: number;
  detail?: string;
}

export interface ForgottenEntry {
  id: string;
  kind: "activity" | "emotion";
  title: string;
  deletedAt: string;
}

/** Wire shape of core/src/ledger/mod.rs `LedgerTarget`. */
export interface LedgerTarget {
  kind: "session" | "project";
  id: string;
}

/** `list_ledger_exclusions` row (core/src/ledger/mod.rs
 * `LedgerExclusion`). */
export interface LedgerExclusion {
  target: LedgerTarget;
  createdAt: string;
}

/** An overview exclusion: the same row with the session / project title
 * (archived sessions included). */
export interface LedgerExclusionWithTitle extends LedgerExclusion {
  title: string | null;
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
    activities: LedgerActivities;
    emotions: LedgerEmotions;
    forgotten: ForgottenEntry[];
    exclusions: LedgerExclusionWithTitle[];
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

/** Turn the ledger on (from now / with earlier conversations) or off
 * (keep / clear). Answers the new switch. */
export async function setLedgerSwitch(
  args: SetLedgerSwitchArgs,
): Promise<LedgerSwitch> {
  return invoke<LedgerSwitch>("set_ledger_switch", { ...args });
}

/** Delete one activity or emotional event and put its title on the
 * do-not-record list. `ledger_busy` while a run is going, `not_found`
 * when it is already gone. */
export async function deleteLedgerEntry(id: string): Promise<void> {
  await invoke("delete_ledger_entry", { id });
}

/** Take an entry off the do-not-record list (it may be recorded again;
 * the deleted text does not come back). */
export async function unforgetLedgerEntry(id: string): Promise<void> {
  await invoke("unforget_ledger_entry", { id });
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

/** Mark (`excluded: true`) or unmark a session / project as "not used to
 * understand me" (existing command, ticket 01). */
export async function setLedgerExcluded(
  target: LedgerTarget,
  excluded: boolean,
): Promise<void> {
  await invoke("set_ledger_excluded", { target, excluded });
}

export async function listLedgerExclusions(): Promise<LedgerExclusion[]> {
  return invoke<LedgerExclusion[]>("list_ledger_exclusions");
}
