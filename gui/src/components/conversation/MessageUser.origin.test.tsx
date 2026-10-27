import * as Tooltip from "@radix-ui/react-tooltip";
import { Clock, House, PlugsConnected } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { Origin } from "@/types/conversation";

import { MessageUser } from "./MessageUser";

/**
 * The provenance icon above your side's bubble (workbench conversation
 * PRD ruling 8): Galley's house on what Galley wrote through its CLI
 * and on a subtask's instructions, the plug on anything else through
 * Galley CLI, nothing on yours or Core's own. A static render never
 * opens a tooltip, so the tooltip's text is put on its trigger here.
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

const ROW = '<div class="mb-1 flex items-center gap-1.5 justify-end">';
const HOUSE = renderToStaticMarkup(<House size={12} weight="thin" />);
const PLUG = renderToStaticMarkup(<PlugsConnected size={12} weight="thin" />);
const CLOCK = renderToStaticMarkup(<Clock size={12} weight="thin" />);

function render(
  origin: Origin | undefined,
  language: "zh-CN" | "en-US" = "zh-CN",
): string {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <MessageUser content="帮我看看日程" origin={origin} messageId="u-1" />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** The provenance row, up to the bubble; "" when there is none. */
function provenance(html: string): string {
  const start = html.indexOf(ROW);
  if (start < 0) return "";
  const end = html.indexOf('data-role="user-msg"', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("the provenance icon above your side's bubble", () => {
  const words = zhCopy.conversation;

  it("is Galley's house for the assistant and a chat-app channel: 「Galley 创建」", () => {
    for (const supervisor of [
      "galley-assistant",
      "galley-im/wechat",
      "galley-im/discord/ch:123",
    ]) {
      const row = provenance(render({ via: "supervisor", supervisor }));
      expect(row).toContain(HOUSE);
      expect(row).not.toContain(PLUG);
      expect(row).toContain(`data-tooltip="${words.galleyCreated}"`);
      expect(row).toContain(`aria-label="${words.galleyCreatedAria}"`);
      expect(words.galleyCreated).toBe("Galley 创建");
      expect(words.galleyCreatedAria).toBe("Galley 创建的消息");
      // The label itself is never shown.
      expect(row).not.toContain(supervisor);
    }
  });

  it("is the plug for anything else through the CLI: 「Galley CLI」", () => {
    for (const origin of [
      { via: "supervisor", supervisor: "codex-supervisor/v1" },
      { via: "cli" },
      { via: "cli", supervisor: "claude-code" },
    ] satisfies Origin[]) {
      const row = provenance(render(origin));
      expect(row).toContain(PLUG);
      expect(row).not.toContain(HOUSE);
      expect(row).toContain(`data-tooltip="${words.cliCreated}"`);
      expect(row).toContain(`aria-label="${words.cliCreatedAria}"`);
      expect(words.cliCreated).toBe("Galley CLI");
      expect(words.cliCreatedAria).toBe("Galley CLI 创建的消息");
      expect(row).not.toContain("codex-supervisor");
      expect(row).not.toContain("claude-code");
    }
  });

  it("keeps a subtask's instructions on the house, now 「Galley 创建」", () => {
    const row = provenance(render({ via: "subtask" }));
    expect(row).toContain(HOUSE);
    expect(row).not.toContain(PLUG);
    const created = zhCopy.subtask.galleyCreated;
    expect(created).toBe("Galley 创建");
    expect(row).toContain(`data-tooltip="${created}"`);
    expect(row).toContain(`aria-label="${created}"`);
  });

  it("gives a scheduled task's first message the sidebar row's clock: 「定时任务创建」", () => {
    const row = provenance(
      render({
        via: "supervisor",
        supervisor: "galley-scheduler",
        reason: "scheduled_task:t1",
      }),
    );
    expect(row).toContain(CLOCK);
    expect(row).not.toContain(PLUG);
    expect(row).not.toContain(HOUSE);
    expect(words.scheduledCreated).toBe("定时任务创建");
    expect(words.scheduledCreated).toBe(zhCopy.sidebar.scheduledCreated);
    expect(row).toContain(`data-tooltip="${words.scheduledCreated}"`);
    expect(row).toContain(`aria-label="${words.scheduledCreated}"`);
    expect(row).not.toContain("galley-scheduler");
    const en = provenance(
      render({ via: "supervisor", supervisor: "galley-scheduler" }, "en-US"),
    );
    expect(en).toContain('data-tooltip="Created by scheduled task"');
    expect(en).toContain('aria-label="Created by scheduled task"');
  });

  it("draws one icon in the same place, the same size and ink", () => {
    for (const origin of [
      { via: "supervisor", supervisor: "galley-assistant" },
      { via: "cli" },
      { via: "subtask" },
      { via: "supervisor", supervisor: "galley-scheduler" },
    ] satisfies Origin[]) {
      const row = provenance(render(origin));
      expect(row.split('role="img"').length - 1).toBe(1);
      expect(row).toContain(
        'class="inline-flex items-center rounded-sm text-ink-muted hover:text-ink-soft"',
      );
      expect(row).toContain('width="12"');
    }
  });

  it("draws nothing on yours, Core's own rows or no origin", () => {
    for (const origin of [
      undefined,
      { via: "gui" },
      { via: "system", supervisor: "galley-report" },
    ] satisfies (Origin | undefined)[]) {
      const html = render(origin);
      expect(provenance(html)).toBe("");
      expect(html).not.toContain('role="img"');
    }
  });

  it("says no 「Supervisor」 in either language", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      for (const origin of [
        { via: "supervisor", supervisor: "galley-assistant" },
        { via: "supervisor", supervisor: "codex-supervisor/v1" },
        { via: "subtask" },
      ] satisfies Origin[]) {
        expect(provenance(render(origin, language))).not.toMatch(/Supervisor/i);
      }
    }
  });

  it("speaks English in the English interface", () => {
    const en = enCopy.conversation;
    const galley = provenance(
      render({ via: "supervisor", supervisor: "galley-im/wechat" }, "en-US"),
    );
    expect(galley).toContain('data-tooltip="Created by Galley"');
    expect(galley).toContain('aria-label="Message created by Galley"');
    expect(en.galleyCreated).toBe("Created by Galley");
    const cli = provenance(render({ via: "cli" }, "en-US"));
    expect(cli).toContain('data-tooltip="Galley CLI"');
    expect(cli).toContain('aria-label="Message created through Galley CLI"');
    const subtask = provenance(render({ via: "subtask" }, "en-US"));
    expect(subtask).toContain('data-tooltip="Created by Galley"');
    expect(subtask).toContain('aria-label="Created by Galley"');
  });
});
