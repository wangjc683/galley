import * as Tooltip from "@radix-ui/react-tooltip";
import { Clock, House, PlugsConnected } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { Origin } from "@/types/conversation";
import type { Session } from "@/types/session";

import { SidebarSessionRow } from "./SidebarSessionRow";

/**
 * The origin badge after a sidebar row's title (workbench conversation
 * PRD ruling 8): Galley's house on what Galley opened through its CLI,
 * the plug on anything else through Galley CLI, the scheduler's clock
 * before both, nothing on yours. A static render never opens a
 * tooltip, so the tooltip's text is put on its trigger here.
 */
vi.mock("@/components/ui/tooltip", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/tooltip")>();
  const Shown = ({
    text,
    children,
  }: {
    text: ReactNode;
    children: ReactNode;
  }) => (
    <span data-tooltip={typeof text === "string" ? text : ""}>{children}</span>
  );
  return { ...actual, IconTooltip: Shown, TooltipLabel: Shown };
});

const HOUSE = renderToStaticMarkup(<House size={12} weight="thin" />);
const PLUG = renderToStaticMarkup(<PlugsConnected size={12} weight="thin" />);
const CLOCK = renderToStaticMarkup(<Clock size={12} weight="thin" />);

const session = (origin: Origin | undefined): Session =>
  ({
    id: "s",
    title: "查厦门天气",
    status: "idle",
    errorCount: 0,
    lastActivityAt: "2026-10-10T12:00:00.000Z",
    createdAt: "2026-10-10T12:00:00.000Z",
    updatedAt: "2026-10-10T12:00:00.000Z",
    origin,
  }) as Session;

function render(
  origin: Origin | undefined,
  language: "zh-CN" | "en-US" = "zh-CN",
): string {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <SidebarSessionRow session={session(origin)} projects={[]} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** The badges after the title: every `role="img"` span's tag. */
function badges(html: string): string[] {
  return [...html.matchAll(/<span role="img"[^>]*>/g)].map((m) => m[0]);
}

describe("the origin badge after a sidebar row's title", () => {
  const words = zhCopy.sidebar;

  it("is Galley's house for the assistant and a chat-app channel: 「Galley 创建」", () => {
    for (const supervisor of [
      "galley-assistant",
      "galley-im/wechat",
      "galley-im/discord/ch:123",
    ]) {
      const html = render({ via: "supervisor", supervisor });
      expect(badges(html)).toEqual([
        `<span role="img" tabindex="-1" aria-label="${words.galleyCreated}" class="inline-flex shrink-0 items-center rounded-sm text-ink-muted hover:text-ink-soft">`,
      ]);
      expect(html).toContain(`data-tooltip="${words.galleyCreated}"`);
      expect(words.galleyCreated).toBe("Galley 创建");
      expect(html).toContain(HOUSE);
      expect(html).not.toContain(PLUG);
      expect(html).not.toContain(supervisor);
    }
  });

  it("is the plug for anything else through the CLI: 「Galley CLI」, read 「Galley CLI 创建」", () => {
    for (const origin of [
      { via: "supervisor", supervisor: "codex-supervisor/v1" },
      // The untagged CLI session drew nothing before ruling 8.
      { via: "cli" },
      { via: "cli", supervisor: "claude-code" },
    ] satisfies Origin[]) {
      const html = render(origin);
      expect(badges(html)).toEqual([
        `<span role="img" tabindex="-1" aria-label="${words.cliCreatedAria}" class="inline-flex shrink-0 items-center rounded-sm text-ink-muted hover:text-ink-soft">`,
      ]);
      expect(html).toContain(`data-tooltip="${words.cliCreated}"`);
      expect(words.cliCreated).toBe("Galley CLI");
      expect(words.cliCreatedAria).toBe("Galley CLI 创建");
      expect(html).toContain(PLUG);
      expect(html).not.toContain(HOUSE);
      expect(html).not.toContain("codex-supervisor");
    }
  });

  it("keeps the scheduler's clock, and only the clock", () => {
    const html = render({ via: "supervisor", supervisor: "galley-scheduler" });
    expect(badges(html)).toEqual([
      `<span role="img" tabindex="-1" aria-label="${words.scheduledCreated}" class="inline-flex shrink-0 items-center rounded-sm text-ink-muted hover:text-ink-soft">`,
    ]);
    expect(html).toContain(CLOCK);
    expect(html).not.toContain(PLUG);
    expect(html).not.toContain(HOUSE);
  });

  it("marks nothing on yours, Core's own or a subtask", () => {
    for (const origin of [
      undefined,
      { via: "gui" },
      { via: "system", supervisor: "galley-review" },
      { via: "subtask" },
    ] satisfies (Origin | undefined)[]) {
      expect(badges(render(origin))).toEqual([]);
    }
  });

  it("says no 「Supervisor」 and speaks English in the English interface", () => {
    const en = enCopy.sidebar;
    const galley = render(
      { via: "supervisor", supervisor: "galley-assistant" },
      "en-US",
    );
    expect(galley).toContain('aria-label="Created by Galley"');
    expect(galley).toContain('data-tooltip="Created by Galley"');
    expect(en.galleyCreated).toBe("Created by Galley");
    const cli = render({ via: "cli" }, "en-US");
    expect(cli).toContain('aria-label="Created through Galley CLI"');
    expect(cli).toContain('data-tooltip="Galley CLI"');
    for (const html of [galley, cli, render({ via: "cli" })]) {
      expect(html).not.toMatch(/Supervisor/i);
    }
  });
});
