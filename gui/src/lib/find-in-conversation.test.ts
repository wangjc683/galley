import { beforeEach, describe, expect, it } from "vitest";

import { findInOpenConversation } from "@/lib/find-in-conversation";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";

/**
 * ⌘F and the title menu's 查找聊天记录 (main chat ticket 28), through
 * the real UI and sessions stores.
 */
const main = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
});
const flight = makeSession({ id: "s-flight", title: "订机票" });

function openConversation(id: string | undefined, screen: "main" | "empty") {
  useSessionsStore.setState({ sessions: [main, flight], activeSessionId: id });
  useUiStore.setState({ screen });
}

const palette = () => {
  const { paletteOpen, paletteScope } = useUiStore.getState();
  return { open: paletteOpen, scope: paletteScope };
};

beforeEach(() => {
  resetStores();
});

describe("⌘F", () => {
  it("opens the palette inside the open conversation", () => {
    openConversation("s-main", "main");
    findInOpenConversation();
    expect(palette()).toEqual({
      open: true,
      scope: { sessionId: "s-main", mainChat: true },
    });

    useUiStore.getState().setPaletteOpen(false);
    openConversation("s-flight", "main");
    findInOpenConversation();
    expect(palette()).toEqual({
      open: true,
      scope: { sessionId: "s-flight", mainChat: false },
    });
  });

  it("is ⌘K with no conversation open: the new-chat empty state, Settings", () => {
    openConversation(undefined, "empty");
    findInOpenConversation();
    expect(palette()).toEqual({ open: true, scope: null });
    findInOpenConversation();
    expect(palette()).toEqual({ open: false, scope: null });

    openConversation("s-flight", "main");
    useUiStore.setState({ settingsOpen: true });
    findInOpenConversation();
    expect(palette()).toEqual({ open: true, scope: null });
  });

  it("closes on a second press; ⌘K and every close forget the scope", () => {
    openConversation("s-main", "main");
    findInOpenConversation();
    findInOpenConversation();
    expect(palette()).toEqual({ open: false, scope: null });

    findInOpenConversation();
    useUiStore.getState().togglePalette();
    expect(palette()).toEqual({ open: false, scope: null });
    // ⌘K opens everywhere.
    useUiStore.getState().togglePalette();
    expect(palette()).toEqual({ open: true, scope: null });

    useUiStore.getState().setPaletteOpen(false);
    findInOpenConversation();
    useUiStore.getState().setPaletteOpen(false);
    expect(palette()).toEqual({ open: false, scope: null });
  });

  it("gives an open ⌘K palette the scope; Backspace / × take it away again", () => {
    openConversation("s-flight", "main");
    useUiStore.getState().togglePalette();
    findInOpenConversation();
    expect(palette().scope).toEqual({ sessionId: "s-flight", mainChat: false });
    useUiStore.getState().dropPaletteScope();
    expect(palette()).toEqual({ open: true, scope: null });
  });
});
