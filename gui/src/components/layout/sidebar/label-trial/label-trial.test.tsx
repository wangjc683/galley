// TEMPORARY — 票 68 临时切换器，定档后由拆除票删掉 (see label-trial.ts).
//
// No module mocks here: each test loads the trial's store afresh, so it
// reads the stubbed storage as it starts, the way a page load does.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const TIER_KEY = "galley.tmp.workbenchLabelTrial.tier";
const LINE_KEY = "galley.tmp.workbenchLabelTrial.line";
const STORED: Record<string, string> = {
  [TIER_KEY]: "A",
  [LINE_KEY]: "default",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function storage(getItem: (key: string) => string | null) {
  vi.stubGlobal("window", { localStorage: { getItem } });
}

/** The trial's store and the name that reads it, loaded afresh (the
 * name alone, not the whole sidebar: a fresh sidebar's module graph is
 * slow to load under the full suite). */
async function load() {
  vi.resetModules();
  const trial = await import("./label-trial");
  const { SidebarWorkbenchLabel } = await import("../SidebarWorkbenchLabel");
  return { trial, SidebarWorkbenchLabel };
}

const TODAY_LINE =
  '<span aria-hidden="true" class="h-px min-w-0 flex-1 bg-line-strong"></span>';

describe("票 68: the stored choice", () => {
  it("is read as the page starts in a dev build", async () => {
    storage((key) => STORED[key] ?? null);
    const { trial, SidebarWorkbenchLabel } = await load();
    expect(trial.useWorkbenchLabelTrialStore.getState()).toMatchObject({
      tier: "A",
      line: "default",
    });
    const html = renderToStaticMarkup(<SidebarWorkbenchLabel />);
    expect(html).toContain('data-label-trial="A"');
    expect(html).not.toContain("line-strong");
  });

  it("is the default when nothing, or nonsense, is stored", async () => {
    storage((key) => (key === TIER_KEY ? "C" : null));
    const { trial } = await load();
    expect(trial.useWorkbenchLabelTrialStore.getState()).toMatchObject({
      tier: "now",
      line: "strong",
    });
  });

  it("is the default when storage throws", async () => {
    storage(() => {
      throw new Error("blocked");
    });
    const { trial } = await load();
    expect(trial.useWorkbenchLabelTrialStore.getState()).toMatchObject({
      tier: "now",
      line: "strong",
    });
  });
});

describe("票 68: a production build ignores what is stored", () => {
  it("never reads storage", async () => {
    const getItem = vi.fn((key: string) => STORED[key] ?? null);
    storage(getItem);
    vi.stubEnv("DEV", false);
    const { trial } = await load();
    expect(trial.useWorkbenchLabelTrialStore.getState()).toMatchObject({
      tier: "now",
      line: "strong",
    });
    const keys = getItem.mock.calls.map(([key]) => key);
    expect(keys).not.toContain(TIER_KEY);
    expect(keys).not.toContain(LINE_KEY);
  });

  it("draws today's name on line-strong whatever the store holds", async () => {
    // A store that started on A + 默认 (read in a dev build) ...
    storage((key) => STORED[key] ?? null);
    const { trial, SidebarWorkbenchLabel } = await load();
    expect(trial.useWorkbenchLabelTrialStore.getState().tier).toBe("A");
    // ... answers 现状 + 加重 once the build is not a dev one.
    vi.stubEnv("DEV", false);
    const html = renderToStaticMarkup(<SidebarWorkbenchLabel />);
    expect(html).not.toContain("data-label-trial");
    expect(html).toContain(
      'data-sidebar-zone-label="workbench" class="flex h-[13px] shrink-0 items-center"',
    );
    expect(html).toContain(TODAY_LINE);
  });
});
