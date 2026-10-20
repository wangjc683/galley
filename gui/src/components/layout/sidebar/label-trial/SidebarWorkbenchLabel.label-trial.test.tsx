// TEMPORARY — 票 68 临时切换器，定档后由拆除票删掉 (see label-trial.ts).
import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { Sidebar } from "../../Sidebar";
import {
  type LabelLine,
  type LabelTier,
  type WorkbenchLabelTrial,
  LABEL_LINES,
  LABEL_TIERS,
  labelLineClass,
  useWorkbenchLabelTrialStore,
} from "./label-trial";

// Static rendering reads a zustand store's initial state only, so the
// tier is seeded on top of the real hook (none seeded: the real one).
const trial = vi.hoisted(() => ({
  seeded: null as WorkbenchLabelTrial | null,
}));
vi.mock("./label-trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./label-trial")>();
  return {
    ...actual,
    useWorkbenchLabelTrial: () =>
      trial.seeded ?? actual.useWorkbenchLabelTrial(),
  };
});

afterEach(() => {
  trial.seeded = null;
});

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    lastActivityAt: minutesAgo(5),
    ...extra,
  });
const external = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    lastActivityAt: minutesAgo(5),
    ...extra,
  });

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const sideChat = managed("s-side", {
  title: "订机票",
  origin: { via: "gui" },
});
const ALL = [mainChat, sideChat];

function render(
  sessions: Session[],
  opts: {
    tier?: LabelTier;
    line?: LabelLine;
    language?: "zh-CN" | "en-US";
  } = {},
) {
  trial.seeded =
    opts.tier === undefined && opts.line === undefined
      ? null
      : { tier: opts.tier ?? "now", line: opts.line ?? "strong" };
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          expandedProjectIds={[]}
          archivedCount={2}
          onNewChat={() => {}}
          onSelectSession={() => {}}
          onOpenArchived={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};

const WORKBENCH = 'data-sidebar-zone-label="workbench"';
const SCROLL_LIST = "overflow-y-auto";
const CARD = 'data-role="assistant-card"';
const STICKY = "data-sidebar-section-header";
const TEXT =
  '<span class="shrink-0 whitespace-nowrap pl-4.5 pr-2 text-ui-label leading-[13px] text-ink-muted">';
/** The name's element, from its opening tag to the scrolling list. */
const labelOf = (html: string) =>
  html.slice(
    html.lastIndexOf("<div", html.indexOf(WORKBENCH)),
    html.lastIndexOf("<div", html.indexOf(SCROLL_LIST)),
  );
/** Today's name, as the base (5223a293) renders it. */
const TODAY =
  '<div data-sidebar-zone-label="workbench" class="flex h-[13px] shrink-0 items-center" style="background:linear-gradient(to bottom, transparent 6px, var(--color-app) 6px)">' +
  TEXT +
  '工作台</span><span aria-hidden="true" class="h-px min-w-0 flex-1 bg-line-strong"></span></div>';
const TRIAL_TIERS = LABEL_TIERS.filter((tier) => tier !== "now");

describe("票 68: the default is today's name on today's line", () => {
  it("starts on 现状 and 加重", () => {
    const state = useWorkbenchLabelTrialStore.getState();
    expect(state.tier).toBe("now");
    expect(state.line).toBe("strong");
    expect(labelLineClass("strong")).toBe("bg-line-strong");
    expect(labelLineClass("default")).toBe("bg-line");
  });

  it("draws 现状 + 加重 exactly as the base did, and as the real hook's default", () => {
    const real = render(ALL);
    expect(render(ALL, { tier: "now", line: "strong" })).toBe(real);
    expect(labelOf(real)).toBe(TODAY);
    // The card block, the sticky row and the list are untouched.
    expect(real).toContain('<div class="pb-1.5 pt-2">');
    expect(tagWith(real, STICKY)).toContain(
      "sticky top-0 z-20 bg-app pb-1 pt-1.5",
    );
    expect(tagWith(real, SCROLL_LIST)).toContain("scroll-pt-[42px] bg-app");
  });
});

describe("票 68: A and B take the word out of the line's gap", () => {
  it("draws one name, between the card block and the list, outside it", () => {
    for (const tier of TRIAL_TIERS) {
      for (const language of ["zh-CN", "en-US"] as const) {
        const html = render(ALL, { tier, language });
        const word = language === "zh-CN" ? ">工作台<" : ">Workbench<";
        expect(count(html, "data-sidebar-zone-label")).toBe(1);
        expect(count(html, word)).toBe(1);
        expect(html.indexOf(CARD)).toBeLessThan(html.indexOf(WORKBENCH));
        expect(html.indexOf(WORKBENCH)).toBeLessThan(html.indexOf(SCROLL_LIST));
        // The word keeps today's recipe, upright and untracked.
        expect(labelOf(html)).toContain(TEXT);
        for (const eyebrow of ["uppercase", "tracking-", "font-semibold"]) {
          expect(labelOf(html)).not.toContain(eyebrow);
        }
        // No ground turning inside a row any more.
        expect(html).not.toContain("linear-gradient(to bottom, transparent");
      }
    }
  });

  it("A: an unbroken line, then the word's row on the app ground", () => {
    const label = labelOf(render(ALL, { tier: "A" }));
    expect(label).toBe(
      '<div data-sidebar-zone-label="workbench" data-label-trial="A" class="shrink-0 bg-app">' +
        '<div aria-hidden="true" class="h-px bg-line-strong"></div>' +
        `<div class="mt-1 flex h-[13px] items-center">${TEXT}工作台</span></div></div>`,
    );
  });

  it("B: the word's row on the chrome, then an unbroken line, then the app ground", () => {
    const label = labelOf(render(ALL, { tier: "B" }));
    expect(label).toBe(
      '<div data-sidebar-zone-label="workbench" data-label-trial="B" class="shrink-0">' +
        `<div class="flex h-[13px] items-center">${TEXT}工作台</span></div>` +
        '<div aria-hidden="true" class="mt-px h-px bg-line-strong"></div>' +
        '<div aria-hidden="true" class="h-[3px] bg-app"></div></div>',
    );
  });

  it("leaves the card block, the sticky row and the list's scroll padding alone", () => {
    const today = render(ALL);
    for (const tier of TRIAL_TIERS) {
      const html = render(ALL, { tier });
      expect(html).toContain('<div class="pb-1.5 pt-2">');
      expect(tagWith(html, STICKY)).toBe(tagWith(today, STICKY));
      expect(tagWith(html, SCROLL_LIST)).toBe(tagWith(today, SCROLL_LIST));
      // Everything but the name's element is today's.
      expect(html.replace(labelOf(html), "")).toBe(
        today.replace(labelOf(today), ""),
      );
    }
  });
});

describe("票 68: the line tier", () => {
  it("switches the one line between line-strong and line, in every tier", () => {
    for (const tier of LABEL_TIERS) {
      const strong = labelOf(render(ALL, { tier, line: "strong" }));
      const plain = labelOf(render(ALL, { tier, line: "default" }));
      expect(count(strong, "bg-line-strong")).toBe(1);
      expect(count(plain, "bg-line-strong")).toBe(0);
      expect(count(plain, 'bg-line"')).toBe(1);
      expect(plain).toBe(strong.replace("bg-line-strong", "bg-line"));
      // Nowhere else in the sidebar does the tier reach.
      expect(render(ALL, { tier, line: "default" })).not.toContain(
        "line-strong",
      );
    }
  });
});

describe("票 68: the external runtime is left alone", () => {
  it("draws the same sidebar whatever the tier and the line", () => {
    const sessions = [
      external("e-1", { origin: { via: "gui" } }),
      external("e-2", { origin: { via: "cli" } }),
    ];
    const today = render(sessions);
    expect(today).not.toContain("data-sidebar-zone-label");
    for (const tier of LABEL_TIERS) {
      for (const line of LABEL_LINES) {
        expect(render(sessions, { tier, line })).toBe(today);
      }
    }
  });
});

describe("票 68: every branch point can be found", () => {
  const SRC = path.resolve(__dirname, "../../../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("says 票 68 wherever the trial is used", () => {
    const uses = [
      "label-trial",
      "WorkbenchLabelTrial",
      "galley.tmp.workbenchLabelTrial",
      "labelLineClass",
    ];
    const files = sources(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return uses.some((needle) => text.includes(needle));
    });
    expect(files.map((file) => path.relative(SRC, file)).sort()).toEqual([
      "App.tsx",
      "components/layout/sidebar/SidebarWorkbenchLabel.tsx",
      "components/layout/sidebar/label-trial/SidebarWorkbenchLabel.label-trial.test.tsx",
      "components/layout/sidebar/label-trial/SidebarWorkbenchLabelTrial.tsx",
      "components/layout/sidebar/label-trial/WorkbenchLabelTrialSwitcher.tsx",
      "components/layout/sidebar/label-trial/label-trial.test.tsx",
      "components/layout/sidebar/label-trial/label-trial.ts",
    ]);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).toContain("票 68");
    }
  });
});
