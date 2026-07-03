import type { ResolvedLanguage } from "@/lib/language";

/**
 * Empty-state conditions an epigraph can bind to. Each condition is a
 * genuine read on the *workspace's* pulse at the moment the empty
 * screen is entered (the epigraph frames the threshold; the live pulse
 * itself is carried by the sidebar status spine, not by this line):
 *
 * - `silent`  — no sessions at all (first run / emptied workspace).
 *               The screen is literally silent → Tractatus 7.
 * - `quiet`   — sessions exist but none are running (an inhabited
 *               practice at rest) → PI §19 (form of life).
 * - `working` — at least one session is running (tools/words in use)
 *               → PI §43 (meaning is use).
 *
 * `fresh` is kept as a back-compat default alias (older callers / the
 * safe fallback) and resolves to the same thesis line as `working`.
 *
 * The epigraph is resolved once on entry to the empty state and frozen
 * for that sitting (see EmptyState) — it does not mutate live under the
 * user's gaze, which would turn a quiet epigraph into a status light
 * and duplicate the sidebar's job. Adding a condition = one entry in
 * `EPIGRAPHS` + one line in `EPIGRAPH_BINDINGS`; the renderer is
 * untouched.
 *
 * Part A of the philosophical-voice feature. The epigraph is a single
 * state-bound Wittgenstein line shown above the empty-state Composer:
 * a translated line in the user's software language, with the German
 * original on an always-on secondary line. See
 * `docs/devlog/2026-06-03-philosophical-voice-and-austerity-copy.md`.
 *
 * Display policy (2026-07-03, docs/temperament.md): EmptyState only
 * renders the epigraph for `silent` — scarcity is what lets a line
 * land as an epigraph rather than wallpaper. The `quiet` / `working`
 * bindings below remain as data (resolution stays total; reverting is
 * a one-line gate change), and PI §43 additionally serves as the About
 * colophon's quotation (SettingsAbout reads `EPIGRAPHS` directly).
 */
export type EpigraphCondition = "silent" | "quiet" | "working" | "fresh";

export interface Epigraph {
  /** Stable key, e.g. `"tractatus-7"`. */
  id: string;
  /** Light citation, e.g. `"Tractatus 7"` / `"PI §133"`. */
  source: string;
  /** German original — rendered as the always-on secondary line. */
  de: string;
  /** Chinese translation. */
  zh: string;
  /** English translation. */
  en: string;
}

export interface ResolvedEpigraph {
  /** Translated line in the user's software language. Never empty. */
  primary: string;
  /** German original. Never empty. */
  de: string;
  source: string;
  id: string;
}

/**
 * Curated set — deliberately small. Each entry holds the German
 * original plus every software-language translation together so the
 * curation stays editable in one place.
 *
 * Later Wittgenstein is the body (PI §43 meaning-is-use, PI §19 form-
 * of-life — the two lines most load-bearing for an LLM workspace);
 * Tractatus 7 is kept as the single "silence" accent, reserved for the
 * one moment the workspace is genuinely empty.
 */
export const EPIGRAPHS: readonly Epigraph[] = [
  {
    // working: tools / words in use right now. Also the thesis the
    // Composer's contextual voice (Part B) is built on (PI §43), so the
    // epigraph and the input share one proposition when the team works.
    id: "pi-43",
    source: "PI §43",
    de: "Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.",
    zh: "语词的意义，在于它在语言中的用法。",
    en: "The meaning of a word is its use in the language.",
  },
  {
    // quiet: an inhabited practice at rest. The accumulated, idle
    // sessions are a language / form of life paused, not absent.
    id: "pi-19",
    source: "PI §19",
    de: "Sich eine Sprache vorstellen heißt, sich eine Lebensform vorstellen.",
    zh: "想象一种语言，就是想象一种生活形式。",
    en: "To imagine a language is to imagine a form of life.",
  },
  {
    // silent: the screen is literally silent (no sessions), so *sagen*
    // and *zeigen* coincide — the Tractatus accent, in its one honest
    // home.
    id: "tractatus-7",
    source: "Tractatus 7",
    de: "Wovon man nicht sprechen kann, darüber muss man schweigen.",
    zh: "凡不可说的，应当沉默。",
    en: "Whereof one cannot speak, thereof one must be silent.",
  },
];

/** Condition -> epigraph id. */
export const EPIGRAPH_BINDINGS: Readonly<Record<EpigraphCondition, string>> = {
  silent: "tractatus-7",
  quiet: "pi-19",
  working: "pi-43",
  // Back-compat alias: generic empty state resolves to the thesis line.
  fresh: "pi-43",
};

/**
 * Safe default used when a condition has no binding or referenced data
 * is missing. Must reference an existing entry id.
 * The thesis line is the most representative fallback for a populated
 * workspace (showing "silence" on a non-empty workspace would misread
 * the state).
 */
export const DEFAULT_EPIGRAPH_ID = "pi-43";

/** Pick the translated field for a language, with cross-field fallback
 * so a single empty translation never yields an empty render. */
function pickPrimary(entry: Epigraph, language: ResolvedLanguage): string {
  const ordered =
    language === "en-US"
      ? [entry.en, entry.zh, entry.de]
      : [entry.zh, entry.en, entry.de];
  for (const candidate of ordered) {
    if (candidate.trim().length > 0) return candidate;
  }
  // All translations empty: fall back to id so we still render something
  // visible rather than a blank line. The dev guard below prevents this
  // in practice.
  return entry.id;
}

function findById(id: string): Epigraph | undefined {
  return EPIGRAPHS.find((e) => e.id === id);
}

/**
 * Resolve a condition + language to a displayable epigraph. Pure and
 * total: unknown/unbound condition -> default entry; missing default
 * -> first entry; empty field -> cross-field fallback. Never returns an
 * empty `primary` or `de`.
 */
export function resolveEpigraph(
  condition: EpigraphCondition,
  language: ResolvedLanguage,
): ResolvedEpigraph {
  const boundId = EPIGRAPH_BINDINGS[condition] ?? DEFAULT_EPIGRAPH_ID;
  const entry =
    findById(boundId) ?? findById(DEFAULT_EPIGRAPH_ID) ?? EPIGRAPHS[0];

  const primary = pickPrimary(entry, language);
  // `de` falls back to the primary line only if the original is somehow
  // empty — keeps the secondary line non-empty.
  const de = entry.de.trim().length > 0 ? entry.de : primary;

  return { primary, de, source: entry.source, id: entry.id };
}

/**
 * Dev-only integrity guard. Runs once at module load under Vite's DEV
 * flag so curation mistakes surface immediately in development without
 * shipping a runtime cost or throw to users.
 */
function assertEpigraphIntegrity(): void {
  const ids = new Set<string>();
  for (const e of EPIGRAPHS) {
    for (const [field, value] of Object.entries({
      id: e.id,
      source: e.source,
      de: e.de,
      zh: e.zh,
      en: e.en,
    })) {
      if (value.trim().length === 0) {
        throw new Error(
          `Epigraph integrity: entry "${e.id || "<no id>"}" has empty field "${field}".`,
        );
      }
    }
    if (ids.has(e.id)) {
      throw new Error(`Epigraph integrity: duplicate id "${e.id}".`);
    }
    ids.add(e.id);
  }
  for (const [condition, id] of Object.entries(EPIGRAPH_BINDINGS)) {
    if (!ids.has(id)) {
      throw new Error(
        `Epigraph integrity: binding "${condition}" -> "${id}" references a missing entry.`,
      );
    }
  }
  if (!ids.has(DEFAULT_EPIGRAPH_ID)) {
    throw new Error(
      `Epigraph integrity: DEFAULT_EPIGRAPH_ID "${DEFAULT_EPIGRAPH_ID}" references a missing entry.`,
    );
  }
}

if (import.meta.env.DEV) {
  assertEpigraphIntegrity();
}
