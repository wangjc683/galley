// TEMPORARY — 票 62 临时切换器，定档后由拆除票删掉 (see zones-trial.ts).
import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Project, Session } from "@/types/session";

import { Sidebar } from "../../Sidebar";
import {
  type SidebarZonesTrial,
  type ZonesTier,
  ZONES_TIERS,
  sidebarZonesLayout,
  useSidebarZonesTrialStore,
} from "./zones-trial";

// Static rendering reads a zustand store's initial state only, so the
// tier is seeded on top of the real hook (none seeded: the real one).
const trial = vi.hoisted(() => ({
  seeded: null as SidebarZonesTrial | null,
}));
vi.mock("./zones-trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./zones-trial")>();
  return {
    ...actual,
    useSidebarZonesTrial: () => trial.seeded ?? actual.useSidebarZonesTrial(),
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

const mainChat = managed("s-main", { title: "主聊天", mainChat: true });
const sideChat = managed("s-side", {
  title: "订机票",
  origin: { via: "gui" },
});
const cliChat = managed("s-cli", {
  origin: { via: "cli" },
  lastActivityAt: minutesAgo(2),
});
const projectChat = managed("s-proj", {
  origin: { via: "gui" },
  projectId: "p",
});
const project = {
  id: "p",
  name: "回归",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: minutesAgo(5),
  createdAt: minutesAgo(5),
  updatedAt: minutesAgo(5),
} as Project;
const external = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    lastActivityAt: minutesAgo(5),
    ...extra,
  });

const ALL = [mainChat, sideChat, cliChat, projectChat];

function render(
  sessions: Session[],
  opts: {
    tier?: ZonesTier;
    newUser?: boolean;
    archivedCount?: number;
    language?: "zh-CN" | "en-US";
  } = {},
) {
  trial.seeded =
    opts.tier === undefined && opts.newUser === undefined
      ? null
      : { tier: opts.tier ?? "now", newUser: opts.newUser ?? false };
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          projects={[project]}
          expandedProjectIds={[]}
          archivedCount={opts.archivedCount ?? 2}
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

const CARD = 'data-role="assistant-card"';
const SCROLL_LIST = "overflow-y-auto";
const LABEL = "data-sidebar-zone-label";
const WORKBENCH = 'data-sidebar-zone-label="workbench"';
const ASSISTANT = 'data-sidebar-zone-label="assistant"';
const TODAY_BLOCK = "border-b border-line-strong py-1.5";
const EMPTY = "你的对话会出现在这里。";
const ARCHIVED = ">已归档</span>";
const TRIAL_TIERS = ZONES_TIERS.filter((tier) => tier !== "now");

describe("票 62: the default is today's sidebar", () => {
  it("starts on 现状 with the real list", () => {
    const state = useSidebarZonesTrialStore.getState();
    expect(state.tier).toBe("now");
    expect(state.newUser).toBe(false);
    expect(sidebarZonesLayout("now")).toBeNull();
  });

  it("draws 现状 exactly as the real hook's default does", () => {
    const real = render(ALL);
    expect(render(ALL, { tier: "now", newUser: false })).toBe(real);
    expect(real).not.toContain(LABEL);
    expect(real).not.toContain("工作台");
    expect(count(real, TODAY_BLOCK)).toBe(1);
    expect(tagWith(real, SCROLL_LIST)).not.toContain("bg-app");
    // 已归档 on the chrome, as today: no ground around its row.
    expect(real).toContain(ARCHIVED);
    expect(real).not.toContain('<div class="bg-app"><button');
  });
});

describe("票 62: the tiers' zone names", () => {
  it("names the workbench in A and C, both zones in B", () => {
    for (const tier of TRIAL_TIERS) {
      const html = render(ALL, { tier });
      expect(count(html, LABEL)).toBe(tier === "B" ? 2 : 1);
      expect(count(html, WORKBENCH)).toBe(1);
      expect(count(html, ">工作台<")).toBe(1);
      expect(count(html, ">助理<")).toBe(tier === "B" ? 1 : 0);
    }
  });

  it("sets 「工作台」 between the card block and the list, 「助理」 at the block's top", () => {
    for (const tier of TRIAL_TIERS) {
      const html = render(ALL, { tier });
      expect(html.indexOf(CARD)).toBeLessThan(html.indexOf(WORKBENCH));
      // Outside the scrolling list: it stays put with the card.
      expect(html.indexOf(WORKBENCH)).toBeLessThan(html.indexOf(SCROLL_LIST));
      if (tier === "B") {
        expect(html.indexOf(ASSISTANT)).toBeLessThan(html.indexOf(CARD));
        // In flow, pulled up onto the masthead's line, 4px over the card.
        expect(tagWith(html, ASSISTANT)).toContain("-mt-[7px] mb-1");
        expect(tagWith(html, ASSISTANT)).not.toContain("absolute");
        expect(tagWith(html, ASSISTANT)).toContain("pointer-events-none");
      }
    }
  });

  it("moves the strong line into 「工作台」's row, drawn from after the word", () => {
    for (const tier of TRIAL_TIERS) {
      const html = render(ALL, { tier });
      expect(html).not.toContain(TODAY_BLOCK);
      expect(count(html, "border-line-strong")).toBe(0);
      const row = html.slice(
        html.indexOf(WORKBENCH),
        html.indexOf(SCROLL_LIST),
      );
      expect(row.indexOf(">工作台<")).toBeLessThan(
        row.indexOf("bg-line-strong"),
      );
      expect(count(html, "bg-line-strong")).toBe(1);
      // The ground turns at the line: the sidebar's chrome above (left
      // unpainted for the card's shadow), the app ground below.
      expect(tagWith(html, WORKBENCH)).toContain("h-[13px]");
      expect(tagWith(html, WORKBENCH)).toContain(
        "linear-gradient(to bottom, transparent 6px, var(--color-app) 6px)",
      );
    }
  });

  it("is quieter than a bucket's label: regular, untracked, never uppercase", () => {
    const html = render(ALL, { tier: "B", language: "en-US" });
    for (const needle of [WORKBENCH, ASSISTANT]) {
      const word = html.slice(html.indexOf(needle));
      const span = word.slice(word.indexOf("<span"), word.indexOf("</span>"));
      expect(span).toContain("text-ui-label");
      expect(span).toContain("text-ink-muted");
      expect(span).toContain("whitespace-nowrap");
      for (const eyebrow of [
        "uppercase",
        "tracking-",
        "font-semibold",
        "font-medium",
      ]) {
        expect(span).not.toContain(eyebrow);
      }
    }
    expect(html).toContain(">Workbench<");
    expect(html).toContain(">Assistant<");
    // The buckets keep their eyebrow.
    expect(html).toContain("font-semibold uppercase tracking-[0.08em]");
  });

  it("gives each tier its card block's air", () => {
    const blocks: Record<string, string> = {
      A: "pb-1 pt-1.5",
      B: "pb-1",
      C: "pb-2.5 pt-3",
    };
    for (const tier of TRIAL_TIERS) {
      expect(sidebarZonesLayout(tier)?.cardBlock).toBe(blocks[tier]);
      expect(sidebarZonesLayout(tier)?.assistantLabel).toBe(tier === "B");
      const html = render(ALL, { tier });
      expect(html).toContain(`<div class="${blocks[tier]}">`);
    }
  });
});

describe("票 62: the workbench's ground and 「已归档」", () => {
  it("runs the app ground to the window's foot and pins 已归档 on it", () => {
    for (const tier of TRIAL_TIERS) {
      const html = render(ALL, { tier });
      expect(tagWith(html, SCROLL_LIST)).toContain("bg-app");
      // Scrolling, the sticky new-chat row and its fade are as today.
      expect(tagWith(html, SCROLL_LIST)).toContain("scroll-pt-[42px]");
      expect(tagWith(html, "data-sidebar-section-header")).toContain(
        "sticky top-0 z-20 bg-app pb-1 pt-1.5",
      );
      // 已归档 stays outside the list, last, on the app ground, its line
      // and grid as before.
      const i = html.indexOf(ARCHIVED);
      expect(i).toBeGreaterThan(html.lastIndexOf(SCROLL_LIST));
      const button = html.lastIndexOf("<button", i);
      expect(html.slice(0, button).endsWith('<div class="bg-app">')).toBe(true);
      expect(tagWith(html, ARCHIVED)).toBe(tagWith(render(ALL), ARCHIVED));
      expect(html.slice(button, i)).toContain("border-t border-line/70");
    }
  });

  it("shows 已归档 only with something archived, as today", () => {
    for (const tier of ZONES_TIERS) {
      expect(render(ALL, { tier, archivedCount: 0 })).not.toContain(ARCHIVED);
      expect(render(ALL, { tier, archivedCount: 1 })).toContain(ARCHIVED);
    }
  });
});

describe("票 62: the 新用户 demo", () => {
  it("lists nothing and hides 已归档 in every tier; the card stays", () => {
    for (const tier of ZONES_TIERS) {
      const html = render(ALL, { tier, newUser: true });
      expect(html).toContain(EMPTY);
      expect(html).not.toContain("data-session-id=");
      expect(html).not.toContain("data-project-id=");
      expect(html).not.toContain(ARCHIVED);
      expect(count(html, CARD)).toBe(1);
      expect(count(html, 'aria-label="新对话"')).toBe(1);
      // The tier's frame is the same as with the real list.
      expect(count(html, LABEL)).toBe(count(render(ALL, { tier }), LABEL));
    }
  });

  it("shows the real list with the switch off", () => {
    const html = render(ALL, { tier: "A" });
    expect(html).not.toContain(EMPTY);
    for (const id of ["s-side", "s-proj"]) {
      expect(html).toContain(`data-session-id="${id}"`);
    }
    expect(html).toContain('data-project-id="p"');
    expect(html).toContain(ARCHIVED);
  });
});

describe("票 62: the external runtime is left alone", () => {
  it("draws the same sidebar whatever the tier or 新用户", () => {
    const sessions = [
      external("e-1", { origin: { via: "gui" } }),
      external("e-2", { origin: { via: "cli" }, projectId: "p" }),
    ];
    const today = render(sessions);
    expect(today).toContain('data-session-id="e-1"');
    expect(today).toContain(ARCHIVED);
    for (const tier of ZONES_TIERS) {
      for (const newUser of [false, true]) {
        expect(render(sessions, { tier, newUser })).toBe(today);
      }
    }
  });
});

describe("票 62: every branch point can be found", () => {
  const SRC = path.resolve(__dirname, "../../../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("says 票 62 wherever the trial is used", () => {
    const uses = [
      "zones-trial",
      "zoneWorkbench",
      "zoneAssistant",
      "demoNewUser",
      "SidebarZonesTrialSwitcher",
    ];
    const files = sources(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return uses.some((needle) => text.includes(needle));
    });
    expect(files.map((file) => path.relative(SRC, file)).sort()).toEqual([
      "App.tsx",
      "components/layout/Sidebar.tsx",
      "components/layout/sidebar/zones-trial/Sidebar.zones-trial.test.tsx",
      "components/layout/sidebar/zones-trial/SidebarZoneLabel.tsx",
      "components/layout/sidebar/zones-trial/SidebarZonesTrialSwitcher.tsx",
      "components/layout/sidebar/zones-trial/zones-trial.ts",
      "i18n/locales/en.ts",
      "i18n/locales/zh.ts",
    ]);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).toContain("票 62");
    }
  });
});
