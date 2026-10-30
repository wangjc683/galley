// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { useMessagesStore } from "@/stores/messages";
import { rowsToTurns } from "@/stores/messages/rowsToTurns";
import { makeMessageRow, makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { MessageRow } from "@/types/db";

import { useAssistantLastMessage } from "./useAssistantState";

/**
 * The sidebar card's last message (ticket 113): until this page has
 * read the main chat's history, the card reads the latest page itself —
 * live turns that landed first (a silent wake at launch) are not the
 * history, and alone they hold nothing to quote.
 */

const MAIN = "s-main";
const MAIN_CHAT = makeSession({
  id: MAIN,
  mainChat: true,
  gaRuntimeKind: "managed",
  turnCount: 2,
});
const tauriMocks = getTauriMocks();

function row(overrides: Partial<MessageRow>): MessageRow {
  const r = makeMessageRow({ session_id: MAIN, ...overrides });
  return { ...r, id: `msg_${MAIN}_${r.turn_index}_${r.role}` };
}

const ROWS = [
  row({ role: "user", turn_index: 0, content: "明天十点开会，帮我记一下" }),
  row({
    role: "assistant",
    turn_index: 0,
    content: "记下了。",
    final_answer: "记下了。",
  }),
  row({
    role: "user",
    turn_index: 1,
    content: "早上的巡看",
    created_via: "system",
    supervisor: "galley-report",
    origin_note: "review",
  }),
  row({ role: "assistant", turn_index: 1, content: "<no-reply/>" }),
];
// The wake alone, as it arrived live.
const WAKE_ONLY = rowsToTurns(ROWS.slice(2));

function Probe() {
  const message = useAssistantLastMessage(MAIN_CHAT);
  return <p data-last>{message?.text ?? "(none)"}</p>;
}

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetStores();
  tauriMocks.invoke.mockImplementation(async (command) =>
    command === "session_message_turns_page"
      ? { rows: ROWS, hasMore: false, previousUserCreatedAt: null }
      : undefined,
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount() {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <Probe />
      </CopyProvider>,
    ),
  );
}

const shown = () => host.querySelector("[data-last]")?.textContent;

function pageReads(): number {
  return tauriMocks.invoke.mock.calls.filter(
    ([command]) => command === "session_message_turns_page",
  ).length;
}

describe("the card's last message", () => {
  it("reads the history when only a silent wake is in memory", async () => {
    act(() => {
      useMessagesStore.getState().ensureMessages(MAIN);
      useMessagesStore.setState((s) => ({
        byId: { ...s.byId, [MAIN]: { ...s.byId[MAIN], turns: WAKE_ONLY } },
      }));
    });
    mount();
    await vi.waitFor(() => expect(shown()).toBe("记下了。"));
    expect(pageReads()).toBe(1);
  });

  it("quotes the cache, reading nothing, once the history is read", () => {
    act(() => {
      useMessagesStore.getState().ensureMessages(MAIN);
      useMessagesStore.setState((s) => ({
        byId: {
          ...s.byId,
          [MAIN]: {
            ...s.byId[MAIN],
            turns: rowsToTurns(ROWS),
            historyRead: true,
          },
        },
      }));
    });
    mount();
    expect(shown()).toBe("记下了。");
    expect(pageReads()).toBe(0);
  });
});
