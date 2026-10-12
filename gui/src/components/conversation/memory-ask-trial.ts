import { create } from "zustand";

/**
 * TEMPORARY — the main chat memory-ask trial (main chat ticket 04b, PRD
 * ruling 46). JC compares the two forms of the one-time 「要让 Galley 从
 * 对话里了解你吗？」 ask live in tauri dev (pill: MemoryAskSwitcher.tsx)
 * and picks one; the pill's third control turns on demo data.
 *
 *   A — a strip above the Composer: one line of explanation and the
 *       three answers (the quietest form; MemoryAsk.tsx `MemoryAskStrip`).
 *   B — a card at the end of the timeline, after the last reply (ruling
 *       10's card form; `MemoryAskCard`).
 *   演示数据 — Settings → Memory renders the ledger eval's fixture (the
 *       made-up user 林晓, memory-overview.fixture.ts) instead of asking
 *       Core, and the ask shows in the main chat whatever its conditions
 *       say. Nothing in demo mode calls Core or touches a real file: the
 *       page's actions change a local copy (memory-demo-backend.ts), and
 *       the ask's answers only hide it.
 *
 * Development builds only (`import.meta.env.DEV`): a release build has
 * no pill, form A, and no demo data — the fixture is loaded by a dynamic
 * import inside a DEV branch, so it is not in the bundle. The choice is
 * a per-machine convenience in localStorage (wrapped: storage can be
 * unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * "ticket 04b trial"):
 *
 *   - delete this file, MemoryAskSwitcher.tsx and
 *     settings/memory/memory-demo-backend.ts; drop the switcher's line in
 *     App.tsx;
 *   - MainView.tsx: render only the winning form (`MemoryAskStrip` above
 *     the Composer, or `MemoryAskCard` at the timeline's end) and drop
 *     `useMemoryAskTrial`; MemoryAsk.tsx: delete the losing component and
 *     the `demo` prop;
 *   - SettingsMemory.tsx: drop the demo branch (`useMemoryDemoBackend`,
 *     the fixture's session titles);
 *   - keep memory-overview.fixture.ts — the page's tests use it;
 *   - write the winning form into docs/design/conversation.md and the
 *     page into docs/design/overlays-and-settings.md.
 */
export type MemoryAskForm = "A" | "B";

export const MEMORY_ASK_FORMS: readonly MemoryAskForm[] = ["A", "B"];

/** Form A is the default and what a release build shows. */
export const DEFAULT_MEMORY_ASK_FORM: MemoryAskForm = "A";

export const MEMORY_TRIAL_ENABLED = import.meta.env.DEV;

const FORM_KEY = "galley.tmp.memoryAskForm";
const DEMO_KEY = "galley.tmp.memoryDemo";

function readForm(): MemoryAskForm {
  if (!MEMORY_TRIAL_ENABLED) return DEFAULT_MEMORY_ASK_FORM;
  try {
    const stored = window.localStorage.getItem(FORM_KEY);
    return (
      MEMORY_ASK_FORMS.find((form) => form === stored) ??
      DEFAULT_MEMORY_ASK_FORM
    );
  } catch {
    return DEFAULT_MEMORY_ASK_FORM;
  }
}

function readDemo(): boolean {
  if (!MEMORY_TRIAL_ENABLED) return false;
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered across reloads; the switch itself still works.
  }
}

interface MemoryAskTrialState {
  form: MemoryAskForm;
  demo: boolean;
  setForm: (form: MemoryAskForm) => void;
  setDemo: (demo: boolean) => void;
}

export const useMemoryAskTrialStore = create<MemoryAskTrialState>((set) => ({
  form: readForm(),
  demo: readDemo(),
  setForm: (form) => {
    if (!MEMORY_TRIAL_ENABLED) return;
    write(FORM_KEY, form);
    set({ form });
  },
  setDemo: (demo) => {
    if (!MEMORY_TRIAL_ENABLED) return;
    write(DEMO_KEY, demo ? "1" : "0");
    set({ demo });
  },
}));

/** The trial's form and demo flag; form A and no demo in a release
 * build. */
export function useMemoryAskTrial(): { form: MemoryAskForm; demo: boolean } {
  const form = useMemoryAskTrialStore((s) => s.form);
  const demo = useMemoryAskTrialStore((s) => s.demo);
  return MEMORY_TRIAL_ENABLED
    ? { form, demo }
    : { form: DEFAULT_MEMORY_ASK_FORM, demo: false };
}
