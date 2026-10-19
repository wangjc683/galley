// TEMPORARY — 票 66 临时切换器，定档后由拆除票删掉 (see face-trial.ts).
import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantIdentity } from "@/components/layout/assistant/AssistantIdentity";
import { Sidebar } from "@/components/layout/Sidebar";
import { SidebarAssistantCard } from "@/components/layout/sidebar/SidebarAssistant";
import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import { FaceDirector, type FaceClock } from "@/lib/assistant-face-director";
import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { FACE_DEMO_ITEMS, FaceDemo, type FaceDemoItem } from "./face-demo";
import {
  type AssistantFaceTrial,
  FACE_AMPLITUDES,
  useFaceTrialStore,
} from "./face-trial";

// Static rendering reads a zustand store's initial state only: the trial
// in force and the live status are seeded on top of the real hooks.
const seed = vi.hoisted(() => ({
  trial: null as AssistantFaceTrial | null,
  live: new Map<string, Partial<SessionStatusView>>(),
  reduced: false,
}));
vi.mock("./face-trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./face-trial")>();
  return {
    ...actual,
    useAssistantFaceTrial: () => seed.trial ?? actual.useAssistantFaceTrial(),
  };
});
vi.mock("@/hooks/useSessionStatusView", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionStatusView")>();
  return {
    ...actual,
    useSessionStatusView: (session: Session) => ({
      ...actual.useSessionStatusView(session),
      ...seed.live.get(session.id),
    }),
  };
});
vi.mock("@/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => seed.reduced,
}));

afterEach(() => {
  seed.trial = null;
  seed.live.clear();
  seed.reduced = false;
});

const TODAY: AssistantFaceTrial = {
  on: false,
  amplitude: 1,
  demo: false,
  pinned: null,
};
const trial = (patch: Partial<AssistantFaceTrial>): AssistantFaceTrial => ({
  on: true,
  amplitude: 1,
  demo: false,
  pinned: null,
  ...patch,
});

const mainChat = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
  lastActivityAt: new Date(Date.now() - 60_000).toISOString(),
});
const side = makeSession({
  id: "s-side",
  title: "订机票",
  gaRuntimeKind: "managed",
  runtimeKind: "managed",
  origin: { via: "gui" },
});

const card = (selected = false) =>
  renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <SidebarAssistantCard
        mainChat={mainChat}
        subtasks={[]}
        selected={selected}
        open={selected}
        onOpen={() => {}}
      />
    </CopyProvider>,
  );
const sidebar = (sessions: Session[]) =>
  renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          expandedProjectIds={[]}
          onNewChat={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
const CARD = 'data-role="assistant-card"';
const FACE = 'data-role="assistant-face"';
const SPINNER = 'class="spin"';

describe("票 66: the switcher's defaults", () => {
  it("starts at 1×, demo off; the amplitudes are 1, 1.5 and 2", () => {
    const state = useFaceTrialStore.getState();
    expect(state.amplitude).toBe(1);
    expect(state.demo).toBe(false);
    expect(state.pinned).toBeNull();
    expect(FACE_AMPLITUDES).toEqual([1, 1.5, 2]);
  });

  it("keeps no 乙 and no 大头像行 64 (ruling 119 point 1)", () => {
    const state = useFaceTrialStore.getState() as unknown as Record<
      string,
      unknown
    >;
    expect(state.motion).toBeUndefined();
    expect(state.layout).toBeUndefined();
  });
});

describe("票 66: today's card stays the production branch", () => {
  it("draws the 40px still avatar and the spinner while it runs", () => {
    seed.trial = TODAY;
    seed.live.set("s-main", { status: "running" });
    const html = card();
    expect(tagWith(html, CARD)).toContain("h-[58px]");
    expect(tagWith(html, CARD)).not.toContain("data-layout");
    expect(html).toContain("size-10");
    expect(html).not.toContain(FACE);
    expect(html).toContain(SPINNER);
  });
});

describe("票 66: the stage, the one layout in a dev build", () => {
  it("centres a 72px face, 48px on a narrow sidebar, name and line under it", () => {
    seed.trial = trial({});
    const html = card();
    const tag = tagWith(html, CARD);
    expect(tag).toContain('data-layout="stage72"');
    expect(tag).toContain("flex-col items-center");
    expect(html).toContain("size-12 @min-[184px]/sidebar:size-18");
    expect(html).toContain(FACE);
    expect(html.indexOf(FACE)).toBeLessThan(html.indexOf(">Galley<"));
    expect(tagWith(html, "mt-1.5 flex h-5")).toContain("text-ink-soft");
    expect(tag).toContain("hover:bg-hover");
    expect(html).not.toContain("assistant-selected-ring");
  });

  it("lets the figure out of the circle; only the ground is cropped", () => {
    seed.trial = trial({});
    const html = card();
    const avatar = tagWith(html, 'data-role="assistant-avatar"');
    expect(avatar).toContain("rounded-full");
    expect(avatar).not.toContain("overflow-hidden");
    expect(tagWith(html, FACE)).toContain('overflow="visible"');
  });

  it("plays at the amplitude the pill picked", () => {
    for (const amplitude of FACE_AMPLITUDES) {
      seed.trial = trial({ amplitude });
      expect(tagWith(card(), FACE)).toContain(`data-amplitude="${amplitude}"`);
    }
  });

  it("selects with a brand ring round the face and the name in full ink, no fill", () => {
    seed.trial = trial({});
    const html = card(true);
    const tag = tagWith(html, CARD);
    expect(tag).toContain('aria-current="page"');
    expect(tag).not.toContain("bg-selected");
    expect(tag).not.toContain("hover:bg-hover");
    expect(tagWith(html, "assistant-selected-ring")).toContain(
      "border-2 border-brand",
    );
    expect(tagWith(html, "mt-1.5 flex h-5")).not.toContain("text-ink-soft");
    expect(tagWith(html, "mt-1.5 flex h-5")).toContain("text-ink");
  });

  it("gives the zone its own air: 8px over the card, 6px under", () => {
    seed.trial = trial({});
    expect(sidebar([mainChat, side])).toContain('<div class="pb-1.5 pt-2">');
    seed.trial = TODAY;
    expect(sidebar([mainChat, side])).toContain('<div class="pb-2.5 pt-3">');
  });
});

describe("票 66: the face says it runs, the spinner goes — but not under reduced motion", () => {
  it("drops the spinner while it runs, keeps a question's mark", () => {
    seed.trial = trial({});
    seed.live.set("s-main", { status: "running" });
    expect(card()).not.toContain(SPINNER);
    seed.live.set("s-main", { status: "idle", hasPendingAskUser: true });
    expect(card()).toContain('data-kind="ask"');
  });

  it("brings the spinner back under reduced motion", () => {
    seed.trial = trial({});
    seed.live.set("s-main", { status: "running" });
    seed.reduced = true;
    expect(card()).toContain(SPINNER);
  });
});

describe("票 66: the header's 28px avatar stays still (ruling 119 point 6)", () => {
  it("draws the still icon whatever the trial", () => {
    for (const t of [TODAY, trial({}), trial({ amplitude: 2, demo: true })]) {
      seed.trial = t;
      const html = renderToStaticMarkup(
        <AssistantIdentity mainChat={mainChat} subtasks={[]} />,
      );
      expect(html).not.toContain(FACE);
      expect(html).toMatch(/src="[^"]*\/galley-icon\.svg"/);
      expect(html).toContain("size-7");
    }
  });
});

describe("票 66: the external runtime is left alone", () => {
  it("draws the same sidebar whatever the trial", () => {
    const sessions = [makeSession({ id: "e-1", origin: { via: "gui" } })];
    seed.trial = TODAY;
    const today = sidebar(sessions);
    for (const amplitude of FACE_AMPLITUDES) {
      seed.trial = trial({ amplitude });
      expect(sidebar(sessions)).toBe(today);
    }
    expect(today).not.toContain(CARD);
    expect(today).not.toContain(FACE);
  });
});

describe("票 66: the demo", () => {
  function demoRig() {
    let now = 0;
    let id = 0;
    const timers = new Map<number, { t: number; fn: () => void }>();
    const clock: FaceClock = {
      now: () => now,
      setTimeout: (fn, ms) => {
        timers.set(++id, { t: now + ms, fn });
        return id;
      },
      clearTimeout: (h) => void timers.delete(h as number),
    };
    const beats: string[] = [];
    const director = new FaceDirector({
      clock,
      random: () => 0.5,
      onBeat: (beat) => beats.push(beat.name),
    });
    director.setAlive(true);
    const seen: (FaceDemoItem | null)[] = [];
    const demo = new FaceDemo(director, clock, (item) => seen.push(item));
    const advance = (to: number) => {
      for (;;) {
        let next: [number, { t: number; fn: () => void }] | null = null;
        for (const e of timers) if (!next || e[1].t < next[1].t) next = e;
        if (!next || next[1].t > to) break;
        timers.delete(next[0]);
        now = next[1].t;
        next[1].fn();
      }
      now = to;
    };
    return { director, demo, seen, beats, advance };
  }

  it("plays every state of ticket 66's table in turn", () => {
    const r = demoRig();
    r.demo.start(null);
    r.advance(200_000);
    const ids = r.seen.filter(Boolean).map((item) => item!.id);
    const rotation = FACE_DEMO_ITEMS.filter((item) => !item.pinnedOnly).map(
      (i) => i.id,
    );
    expect(ids.slice(0, rotation.length)).toEqual(rotation);
    for (const id of [
      "think",
      "browse",
      "read",
      "note",
      "work",
      "talk",
      "dispatch",
      "await",
      "sent",
      "listen",
      "look",
      "drop",
      "stop",
      "done",
      "ask",
      "error",
      "reminder",
      "back",
      "alive",
      "doze",
      "wake",
      "woken-busy",
    ]) {
      expect(rotation).toContain(id);
    }
    // The long one only when pinned.
    expect(rotation).not.toContain("quiet");
  });

  it("repeats one state when pinned, at full size each time", () => {
    const p = demoRig();
    p.demo.start("browse");
    p.advance(40_000);
    expect(new Set(p.seen.filter(Boolean).map((item) => item!.id))).toEqual(
      new Set(["browse"]),
    );
    expect(p.director.currentActivity).toBe("browse");
    expect(p.director.quiet).toBe(false);
    p.demo.stop();
    expect(p.seen[p.seen.length - 1]).toBeNull();
  });

  it("lets the quiet's own step quiet down", () => {
    const p = demoRig();
    p.demo.start("quiet");
    p.advance(40_000);
    expect(p.director.currentActivity).toBe("browse");
    expect(p.director.quiet).toBe(true);
  });

  it("shows the moves at rest at once, not after 8–15 seconds", () => {
    const r = demoRig();
    r.demo.start("alive");
    r.advance(3_000);
    expect(r.beats.some((name) => name.startsWith("idle:"))).toBe(true);
  });

  it("walks the woken round through looking things up", () => {
    const r = demoRig();
    r.demo.start("woken-busy");
    const acts = new Set<string>();
    for (let t = 0; t <= 6_000; t += 100) {
      r.advance(t);
      acts.add(r.director.currentActivity);
    }
    expect(acts).toEqual(new Set(["think", "browse", "read"]));
  });
});

describe("票 66: every branch point can be found", () => {
  const SRC = path.resolve(__dirname, "../../../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("says 票 66 wherever the trial is used", () => {
    const uses = [
      "face-trial",
      "useAssistantFaceTrial",
      "AssistantFaceTrialSwitcher",
      "faceRuns",
      "STAGE_AVATAR",
    ];
    const files = sources(SRC).filter((file) => {
      const text = readFileSync(file, "utf8");
      return uses.some((needle) => text.includes(needle));
    });
    expect(files.length).toBeGreaterThan(7);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).toContain("票 66");
    }
  });

  it("leaves no 乙 tier and no 行 64 behind", () => {
    for (const file of sources(SRC)) {
      if (file === __filename) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/row64|FACE_MOTION_TIERS|行 64/);
    }
  });
});
