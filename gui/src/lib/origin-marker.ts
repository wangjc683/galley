import type { Origin } from "@/types/conversation";

/**
 * Supervisor label on every CLI write of Galley's assistant: answering
 * or sending back a subtask, opening a conversation (its manual, Core
 * `core/src/managed_prompt.rs`: "Every write but `llm set` carries
 * `--supervisor=galley-assistant`"). The literal is pinned by
 * `origin-marker.test.ts` — a rename must land in Rust too.
 */
export const ASSISTANT_SUPERVISOR = "galley-assistant";

/**
 * Prefix of a chat-app channel's supervisor label (Core
 * `im_supervisor_id`, `core/src/managed_prompt.rs`:
 * `galley-im/{platform}`; Discord's per-channel agents write
 * `galley-im/discord/ch:<id>`), hence matched by prefix. Pinned by
 * `origin-marker.test.ts` too.
 */
export const IM_SUPERVISOR_PREFIX = "galley-im/";

/**
 * The two kinds of origin marker (workbench conversation PRD ruling 8,
 * 2026-10-27), on your side of the conversation above a message and on
 * a sidebar row after its title:
 *
 *   - `"galley"`: Galley itself wrote it through its own CLI — the
 *     assistant ({@link ASSISTANT_SUPERVISOR}) or a chat-app channel
 *     opening a conversation for you ({@link IM_SUPERVISOR_PREFIX}).
 *     Drawn with the house, as a subtask's instructions are.
 *   - `"cli"`: anything else that came in through Galley CLI — another
 *     supervisor label, or `via: "cli"` with or without one. Drawn
 *     with `PlugsConnected`, read as 「Galley CLI」.
 */
export type OriginMarker = "galley" | "cli";

/**
 * Which origin marker a message or a session gets, or `null` for none:
 * you (`gui`, the phone included), Galley Core's own rows (`system`:
 * a subtask report, the main chat's greeting), a subtask's
 * instructions (`subtask`: MessageUser draws their house itself, with
 * a tooltip of their own) and no origin at all.
 *
 * The label is the caller's own claim: an outside agent calling itself
 * `galley-assistant` is drawn as Galley, accepted within the local
 * trust boundary (ruling 8). The label itself is never shown; it stays
 * in the database and the CLI JSON. The sidebar puts the scheduler's
 * clock (`SCHEDULER_SUPERVISOR`) before this.
 */
export function originMarker(origin: Origin | undefined): OriginMarker | null {
  if (origin?.via === "cli") return "cli";
  if (origin?.via !== "supervisor") return null;
  const label = origin.supervisor ?? "";
  return label === ASSISTANT_SUPERVISOR ||
    label.startsWith(IM_SUPERVISOR_PREFIX)
    ? "galley"
    : "cli";
}
