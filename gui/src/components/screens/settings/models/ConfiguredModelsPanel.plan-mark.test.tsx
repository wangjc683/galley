// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { ChatGptPlanStatus } from "@/lib/managed-models";
import { useChatGptPlanStore } from "@/stores/chatgpt-plan";
import { usePrefsStore } from "@/stores/prefs";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

import { ConfiguredModelsPanel } from "./ConfiguredModelsPanel";

/**
 * 我的模型 rows follow the model menu (SIWC decision 18): a model that
 * spends the ChatGPT plan has the 13px mark before its name; other rows
 * hold no space for it. The plan set comes from the stored records and
 * plan status, not the active runtime — the page lists the managed
 * runtime's models on the external one too. Mounted in jsdom: a static
 * render reads only the stores' initial state.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  useChatGptPlanStore.setState({ statusByProvider: {} });
  usePrefsStore.setState({ activeRuntimeKind: "managed" });
});

function provider(id: string, displayName: string): ManagedModelProviderRecord {
  return {
    id,
    displayName,
    protocol: "openai",
    authKind: id === "mp_chatgpt" ? "chatgpt_codex_oauth" : "api_key",
    apiBase: "https://example.test/v1",
    apiKeyRef: "ref",
    credentialStatus: "present",
    createdAt: "",
    updatedAt: "",
  };
}

function model(
  id: string,
  providerRecord: ManagedModelProviderRecord,
  name: string,
): ManagedModelRecord {
  return {
    id,
    providerId: providerRecord.id,
    providerDisplayName: providerRecord.displayName,
    displayName: name,
    protocol: "openai",
    authKind: providerRecord.authKind,
    apiBase: providerRecord.apiBase,
    model: name,
    apiKeyRef: "ref",
    presetOptions: {},
    advancedOverrides: {},
    advancedOptions: {},
    isDefault: false,
    sortOrder: 0,
    credentialStatus: "present",
    createdAt: "",
    updatedAt: "",
  };
}

const SIWC: ChatGptPlanStatus = {
  flow: "siwc",
  signedIn: true,
  needsReauth: false,
  registered: true,
  scopes: [],
  expiresAt: null,
  lastRefreshAt: null,
  lastRefreshError: null,
};

const CHATGPT = provider("mp_chatgpt", "ChatGPT");
const CPA = provider("mp_cpa", "CPA");
const MODELS = [
  model("mm_cpa", CPA, "gpt-6.1-sol"),
  model("mm_plan", CHATGPT, "gpt-6.1-sol"),
];

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <ConfiguredModelsPanel
            models={MODELS}
            providers={[CPA, CHATGPT]}
            saving={false}
            moveFeedback={null}
            modelDraft={null}
            onMoveModel={() => {}}
            onReorderModels={() => {}}
            onSetDefaultModel={() => {}}
            onToggleModelDraft={() => {}}
            onChangeModelDraft={() => {}}
            onCancelModelDraft={() => {}}
            onTestModelDraft={() => {}}
            onSaveModelDraft={() => {}}
            onTestModel={() => {}}
            onDeleteModel={() => {}}
            savedModelProbeStateFor={() => ({ kind: "idle" })}
            modelDraftProbeStateForProvider={() => ({ kind: "idle" })}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

/** Each row's name button (the one that opens its editor), in order. */
function nameButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `button[aria-label^="${zhCopy.settings.models.editModel}:"]`,
    ),
  );
}

const mark = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('[data-role="chatgpt-mark"]');

describe("我的模型's ChatGPT plan mark", () => {
  it("is on the plan row, 13px ink-muted, right before the name; not on the other", () => {
    useChatGptPlanStore.setState({ statusByProvider: { mp_chatgpt: SIWC } });
    const [cpa, onPlan] = nameButtons(mount());

    const planMark = mark(onPlan);
    expect(planMark).not.toBeNull();
    expect(planMark!.className).toContain("size-[13px] text-ink-muted");
    // Name next, 4px away; the provider's 「· ChatGPT」 stays after it.
    expect(planMark!.parentElement!.className).toContain("gap-1");
    expect(planMark!.nextElementSibling!.textContent).toBe("gpt-6.1-sol");
    expect(onPlan.textContent).toContain("ChatGPT");

    expect(mark(cpa)).toBeNull();
    // No space held for it: the name is the wrapper's only child.
    const cpaName = Array.from(cpa.querySelectorAll("div")).find(
      (el) => el.textContent === "gpt-6.1-sol" && el.children.length === 0,
    );
    expect(cpaName!.parentElement!.children).toHaveLength(1);
  });

  it("stays on the external runtime", () => {
    usePrefsStore.setState({ activeRuntimeKind: "external" });
    useChatGptPlanStore.setState({ statusByProvider: { mp_chatgpt: SIWC } });
    const [cpa, onPlan] = nameButtons(mount());
    expect(mark(onPlan)).not.toBeNull();
    expect(mark(cpa)).toBeNull();
  });

  it("is gone once the ChatGPT provider has no Sign in with ChatGPT credential", () => {
    useChatGptPlanStore.setState({
      statusByProvider: {
        mp_chatgpt: { ...SIWC, flow: null, signedIn: false },
      },
    });
    expect(nameButtons(mount()).map(mark)).toEqual([null, null]);
  });
});
