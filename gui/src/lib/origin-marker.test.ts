import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SUPERVISOR,
  IM_SUPERVISOR_PREFIX,
  originMarker,
} from "@/lib/origin-marker";
import type { Origin } from "@/types/conversation";

/**
 * The origin marker's two kinds (workbench conversation PRD ruling 8):
 * Galley's own CLI writes are Galley, everything else in through the
 * CLI is Galley CLI, and nothing else is marked.
 */
describe("originMarker", () => {
  const supervisor = (label: string): Origin => ({
    via: "supervisor",
    supervisor: label,
  });

  it("is Galley for the assistant's label and a chat-app channel's", () => {
    expect(originMarker(supervisor("galley-assistant"))).toBe("galley");
    expect(originMarker(supervisor("galley-im/wechat"))).toBe("galley");
    expect(originMarker(supervisor("galley-im/telegram"))).toBe("galley");
    // Discord's per-channel agents: matched by the prefix.
    expect(originMarker(supervisor("galley-im/discord/ch:123"))).toBe("galley");
  });

  it("is Galley CLI for any other supervisor label", () => {
    expect(originMarker(supervisor("codex-supervisor/v1"))).toBe("cli");
    expect(originMarker(supervisor("ga-claude-1"))).toBe("cli");
    // Near misses are not Galley's.
    expect(originMarker(supervisor("galley-assistant-2"))).toBe("cli");
    expect(originMarker(supervisor("galley-im"))).toBe("cli");
    expect(originMarker(supervisor("x/galley-im/wechat"))).toBe("cli");
    // A supervisor origin whose label went missing still came through
    // the CLI.
    expect(originMarker({ via: "supervisor" })).toBe("cli");
  });

  it("is Galley CLI for via=cli, with a label or without", () => {
    expect(originMarker({ via: "cli" })).toBe("cli");
    expect(originMarker({ via: "cli", supervisor: "claude-code" })).toBe("cli");
    // `via` decides: Galley's labels count only on a supervisor write.
    expect(originMarker({ via: "cli", supervisor: "galley-assistant" })).toBe(
      "cli",
    );
  });

  it("marks nothing else: you, Core's own rows, a subtask's instructions, no origin", () => {
    expect(originMarker({ via: "gui" })).toBeNull();
    expect(
      originMarker({ via: "system", supervisor: "galley-report" }),
    ).toBeNull();
    expect(
      originMarker({ via: "system", supervisor: "galley-greeting" }),
    ).toBeNull();
    expect(originMarker({ via: "system" })).toBeNull();
    // MessageUser draws the subtask's house itself.
    expect(originMarker({ via: "subtask" })).toBeNull();
    expect(originMarker(undefined)).toBeNull();
  });

  it("pins the labels Core writes (core/src/managed_prompt.rs)", () => {
    // Cross-language seam: Galley's assistant and its chat-app channels
    // write these on every CLI write; a rename must land on both sides.
    expect(ASSISTANT_SUPERVISOR).toBe("galley-assistant");
    expect(IM_SUPERVISOR_PREFIX).toBe("galley-im/");
  });
});
