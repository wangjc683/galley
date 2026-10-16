import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { Sidebar } from "./Sidebar";

/**
 * The sidebar's width rules on macOS (sidebar/sidebar-width.ts read the
 * platform once, at load): with a main chat the masthead has no
 * wordmark, so its three icons fit down to 184px and move into the
 * new-chat row below that — the row is there either way, so the list
 * never moves. The rest of the suite runs as Linux, which has no narrow
 * state with a main chat.
 */
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    isMac: true,
    isWindows: false,
    platformName: "mac",
  };
});

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    origin: { via: "gui" },
    ...extra,
  });

function render(sessions: Session[], language: "zh-CN" | "en-US" = "zh-CN") {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <Sidebar sessions={sessions} onNewChat={() => {}} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const between = (html: string, from: string, until: string) =>
  html.slice(html.indexOf(from), html.indexOf(until, html.indexOf(from) + 1));
const MASTHEAD_ICONS =
  'class="items-center hidden @min-[184px]/sidebar:flex shrink-0 gap-1"';
const ROW_ICONS =
  'class="items-center flex @min-[184px]/sidebar:hidden min-w-0 gap-0.5"';

describe("on macOS, with a main chat", () => {
  const sessions = [managed("s-main", { mainChat: true }), managed("s-side")];

  it("clears the traffic lights and holds the three icons down to 184px", () => {
    const html = render(sessions);
    const masthead = html.slice(0, html.indexOf('data-role="assistant-card"'));
    expect(masthead).toContain("pl-20");
    expect(masthead).toContain(MASTHEAD_ICONS);
  });

  it("moves them into the new-chat row below that, where the label gives way and ⌘N goes", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      const row = between(
        render(sessions, language),
        'data-role="sidebar-new-chat-row"',
        "data-sidebar-section-fade",
      );
      expect(row).toContain(ROW_ICONS);
      for (const label of language === "zh-CN"
        ? ["搜索", "待办", "新建项目"]
        : ["Search", "To-do", "New project"]) {
        expect(row).toContain(`aria-label="${label}"`);
      }
      // Beside the icons the label needs more than 184px: plus only.
      expect(row).toContain("@max-[184px]/sidebar:hidden");
      expect(row).toContain("hidden @min-[184px]/sidebar:block");
      expect(row).toContain("⌘");
    }
  });

  it("leaves the external runtime's masthead and its 251px threshold alone", () => {
    const html = render([managed("s-side", { gaRuntimeKind: "external" })]);
    expect(html).toContain("pl-[88px]");
    expect(html).toContain("hidden @min-[251px]/sidebar:flex");
    expect(html).toContain("flex @min-[251px]/sidebar:hidden");
    expect(html).not.toContain("184px");
  });
});
