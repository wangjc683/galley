import { describe, expect, it } from "vitest";

import { toolEventsFromRaw } from "@/lib/agent-turn";
import {
  browserFactsFromResult,
  buildBrowserSiteResolver,
  displayHost,
  leadingJsonObject,
} from "@/lib/browser-site";
import type { ConversationToolEvent, Turn } from "@/types/conversation";

// Fixtures are real GA results from JC's workbench.db (2026-10-04),
// sanitized: personal hosts, mail addresses and page bodies replaced,
// GA's own formatting (json.dumps separators, the 50-char URL clip,
// the trailing ```html page) kept.

const SCAN_FULL =
  String.raw`{"status": "success", "metadata": {"tabs_count": 3, "tabs": [{"id": "1267146815", "url": "https://bigmodel.cn/coding-plan/personal/usage", "title": "智谱AI开放平台"}, {"id": "1267147012", "url": "https://mail.google.com/mail/u/0/?ogbl#starred", "title": "Starred - someone@example.com - Gmail"}, {"id": "1267147241", "url": "https://www.google.com/search?q=codex+5.5+%E9%AB%9...", "title": "codex 5.5 高 超高 对比 - Google Search"}], "active_tab": "1267147241"}}
` +
  "```html\nSkip to main contentAccessibility help\n[TEXTAREA #APjFqb name=q]\ncodex 5.5 高 超高 对比\n```";

const SCAN_ARGS = {
  tabs_only: false,
  switch_tab_id: "1267147241",
  text_only: true,
};

// A tabs_only scan: the metadata object alone (GA returns the dict).
const SCAN_TABS_ONLY = String.raw`{"status": "success", "metadata": {"tabs_count": 3, "tabs": [{"id": "1267146815", "url": "https://bigmodel.cn/coding-plan/personal/usage", "title": "智谱AI开放平台"}, {"id": "1267147012", "url": "https://mail.google.com/mail/u/0/?ogbl#starred", "title": "Starred - someone@example.com - Gmail"}, {"id": "1267147241", "url": "https://www.google.com/search?q=codex+5.5+%E9%AB%9...", "title": "codex 5.5 高 超高 对比 - Google Search"}], "active_tab": null}}`;

// The same tab after the agent navigated it (the next scan).
const SCAN_AFTER_NAV =
  String.raw`{"status": "success", "metadata": {"tabs_count": 1, "tabs": [{"id": "1267147241", "url": "https://www.reddit.com/r/codex/comments/1su1it4/wi...", "title": "Reddit - 全网主阵地"}], "active_tab": "1267147241"}}
` + "```html\n跳到主要内容\n\nr/codex\n```";

const JS_ON_GOOGLE = String.raw`{"status": "success", "js_return": "opened", "tab_id": "1267147241", "diff": "DOM变化量: 63", "transients": []}`;

// A JS exception still ran in its tab. The error text carries escaped
// quotes and braces — the leading-object walk must not stop inside a
// string.
const JS_FAILED = String.raw`{"status": "failed", "js_return": null, "tab_id": "1267147012", "error": "{'message': \"Cannot read properties of undefined (reading 'sendMessage')\", 'name': 'TypeError'}", "transients": [], "suggestion": "页面无明显变化"}`;

// window.location navigation: the extension reports a tab that just
// connected, without a url yet.
const JS_NEW_TAB_NO_URL = String.raw`{"status": "success", "js_return": "https://www.google.com/search?q=bioluminescent%20waves", "tab_id": "1267149277", "newTabs": [{"id": 1267149920, "url": "", "title": ""}], "transients": []}`;

// GA's own fallback (no extension newTabs): a new session with its url.
const JS_NEW_TAB_WITH_URL = String.raw`{"status": "success", "js_return": null, "tab_id": "1267147241", "newTabs": [{"id": "1267154361", "url": "https://www.google.com/search?q=%E4%B8%8A%E6%B5%B7%E5%88%B0%E6%9D%AD%E5%B7%9E"}], "suggestion": "页面已刷新，以上新标签页在执行期间连接。", "transients": []}`;

const TABS_CREATE_SCRIPT = String.raw`{"cmd":"tabs","method":"create","url":"https://www.baidu.com/s?wd=%E4%BB%8A%E5%A4%A9%E5%A4%A9%E6%B0%94","active":true}`;
const TABS_CREATE_RESULT = String.raw`{"status": "success", "js_return": {"id": 1267154325, "url": "https://www.baidu.com/s?wd=%E4%BB%8A%E5%A4%A9%E5%A4%A9%E6%B0%94", "title": "", "windowId": 1267153812}, "tab_id": null, "transients": []}`;

const TABS_LIST_RESULT = String.raw`{"status": "success", "js_return": [{"id": 1267152165, "url": "https://www.youtube.com/", "title": "YouTube", "active": false, "windowId": 1267152164}, {"id": 1267152166, "url": "https://weibo.com/", "title": "weibo.com", "active": true, "windowId": 1267152164}], "tab_id": "1267152166", "transients": []}`;

const CDP_SCRIPT = String.raw`{"cmd":"cdp","tabId":1267224669,"method":"Runtime.evaluate","params":{"expression":"location.href"}}`;
const CDP_RESULT = String.raw`{"status": "failed", "js_return": null, "tab_id": "1267224652", "error": "Cannot access a chrome:// URL", "transients": [], "suggestion": "页面无明显变化"}`;

const NO_TABS_ERROR = String.raw`{"status": "error", "msg": "没有可用的浏览器标签页，查L3记忆分析原因。"}`;
const SCRIPT_MISSING =
  "[Error] Script missing. Use ```javascript block or 'script' arg.";
// smart_format clipped a long result mid-object.
const JS_CLIPPED = String.raw`{"status": "success", "js_return": "{\n  \"title\": \"Understanding Bioluminescence`;

interface Step {
  name: "web_scan" | "web_execute_js" | "file_read";
  args?: Record<string, unknown>;
  content: unknown;
}

const script = (
  content: unknown,
  args: Record<string, unknown> = {},
): Step => ({
  name: "web_execute_js",
  args: { script: "document.title", ...args },
  content,
});

/** One agent turn per step, built through the real construction path
 * with the live path's per-turn id prefix — so ids repeat (`t-0`). */
function turnsOf(steps: Step[]): Turn[] {
  return steps.map((step, i) => ({
    role: "agent",
    turnIndex: i + 1,
    finalAnswer: null,
    tools: toolEventsFromRaw(
      [{ toolName: step.name, args: step.args ?? {} }],
      [{ content: step.content }],
      "t-",
    ),
  }));
}

function previewsOf(steps: Step[]) {
  const turns = turnsOf(steps);
  const resolve = buildBrowserSiteResolver(turns);
  return turns.map((turn) =>
    turn.role === "agent" ? resolve(turn.tools[0]) : null,
  );
}

describe("leadingJsonObject", () => {
  it("parses the metadata object a scan result starts with", () => {
    const payload = leadingJsonObject(SCAN_FULL);
    expect(payload?.status).toBe("success");
  });

  it("is not fooled by braces and escaped quotes inside strings", () => {
    expect(leadingJsonObject(JS_FAILED)?.tab_id).toBe("1267147012");
  });

  it("returns null for prose, clipped objects and non-objects", () => {
    expect(leadingJsonObject(SCRIPT_MISSING)).toBeNull();
    expect(leadingJsonObject(JS_CLIPPED)).toBeNull();
    expect(leadingJsonObject("[1, 2]")).toBeNull();
    expect(leadingJsonObject(undefined)).toBeNull();
  });
});

describe("browserFactsFromResult", () => {
  it("reads a scan's tab list and the tab it read", () => {
    const facts = browserFactsFromResult("web_scan", SCAN_ARGS, SCAN_FULL);
    expect(facts).toMatchObject({
      kind: "scan",
      tabsOnly: false,
      activeTabId: "1267147241",
    });
    expect(facts?.kind === "scan" && facts.tabs).toHaveLength(3);
  });

  it("reads tabs_only the way GA's _arg does", () => {
    for (const flag of [true, "true", " Yes ", 1]) {
      const facts = browserFactsFromResult(
        "web_scan",
        { tabs_only: flag },
        SCAN_TABS_ONLY,
      );
      expect(facts).toMatchObject({ kind: "scan", tabsOnly: true });
    }
    expect(
      browserFactsFromResult("web_scan", { tabs_only: "no" }, SCAN_TABS_ONLY),
    ).toMatchObject({ tabsOnly: false });
  });

  it("reads a script's tab and only the new tabs that have a url", () => {
    expect(
      browserFactsFromResult("web_execute_js", {}, JS_NEW_TAB_NO_URL),
    ).toEqual({ kind: "script", tabId: "1267149277", newTabs: [] });
    expect(
      browserFactsFromResult("web_execute_js", {}, JS_NEW_TAB_WITH_URL),
    ).toMatchObject({
      kind: "script",
      newTabs: [{ id: "1267154361" }],
    });
  });

  it("reads the extension's open-tab and list-tabs commands", () => {
    expect(
      browserFactsFromResult(
        "web_execute_js",
        { script: TABS_CREATE_SCRIPT },
        TABS_CREATE_RESULT,
      ),
    ).toMatchObject({ kind: "tab-open", tab: { id: "1267154325" } });
    for (const cmd of ['{"cmd": "tabs"}', '{"cmd":"tabs","method":"list"}']) {
      expect(
        browserFactsFromResult(
          "web_execute_js",
          { script: cmd },
          TABS_LIST_RESULT,
        ),
      ).toMatchObject({ kind: "tab-list" });
    }
  });

  it("falls back to the command's url when Chrome returns a loading tab", () => {
    const loading = String.raw`{"status": "success", "js_return": {"id": 1267154328, "url": "", "title": "", "windowId": 1267153812}, "tab_id": null}`;
    const facts = browserFactsFromResult(
      "web_execute_js",
      { script: TABS_CREATE_SCRIPT },
      loading,
    );
    expect(facts?.kind === "tab-open" && facts.tab.url).toContain("baidu.com");
  });

  it("has no facts for errors, other commands and other tools", () => {
    expect(browserFactsFromResult("web_scan", {}, NO_TABS_ERROR)).toBe(
      undefined,
    );
    expect(browserFactsFromResult("web_execute_js", {}, NO_TABS_ERROR)).toBe(
      undefined,
    );
    expect(browserFactsFromResult("web_execute_js", {}, SCRIPT_MISSING)).toBe(
      undefined,
    );
    expect(browserFactsFromResult("web_execute_js", {}, JS_CLIPPED)).toBe(
      undefined,
    );
    // cdp names its own target tab; the result's tab_id is only GA's
    // default tab (here even a different one).
    expect(
      browserFactsFromResult(
        "web_execute_js",
        { script: CDP_SCRIPT },
        CDP_RESULT,
      ),
    ).toBe(undefined);
    expect(
      browserFactsFromResult(
        "web_execute_js",
        { script: '{"cmd":"tabs","method":"switch","tabId":1}' },
        '{"status": "success", "js_return": {"ok": true}, "tab_id": "1"}',
      ),
    ).toBe(undefined);
    expect(browserFactsFromResult("file_read", {}, SCAN_FULL)).toBe(undefined);
    // A denial is Galley's own payload, not a browser result.
    expect(
      browserFactsFromResult(
        "web_execute_js",
        {},
        '{"status": "denied", "msg": "User denied this tool call"}',
      ),
    ).toBe(undefined);
  });
});

describe("displayHost", () => {
  it("drops the scheme, port and a leading www.", () => {
    expect(displayHost("https://www.google.com/search?q=x")).toBe("google.com");
    expect(displayHost("https://movie.douban.com/top250")).toBe(
      "movie.douban.com",
    );
    expect(displayHost("http://192.168.31.5:9090/ui/")).toBe("192.168.31.5");
  });

  it("keeps a host GA's 50-char clip left whole, refuses a clipped one", () => {
    expect(
      displayHost("https://chatgpt.com/codex/cloud/settings/analytics..."),
    ).toBe("chatgpt.com");
    expect(
      displayHost("https://a-very-long-internal-dashboard.example-corp..."),
    ).toBeNull();
  });

  it("has no host for non-web addresses", () => {
    expect(displayHost("chrome://newtab/")).toBeNull();
    expect(displayHost("about:blank")).toBeNull();
    expect(displayHost("")).toBeNull();
  });
});

describe("buildBrowserSiteResolver", () => {
  it("shows a scan's page title and host, a script's host only", () => {
    expect(
      previewsOf([
        { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
        script(JS_ON_GOOGLE, { switch_tab_id: "1267147241" }),
        script(JS_FAILED),
      ]),
    ).toEqual([
      {
        kind: "site",
        title: "codex 5.5 高 超高 对比 - Google Search",
        host: "google.com",
      },
      { kind: "site", title: null, host: "google.com" },
      // The failed script ran in the Gmail tab of the same list.
      { kind: "site", title: null, host: "mail.google.com" },
    ]);
  });

  it("follows the newest scan after a navigation", () => {
    const [, , scan, after] = previewsOf([
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
      script(JS_ON_GOOGLE),
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_AFTER_NAV },
      script(JS_ON_GOOGLE),
    ]);
    expect(scan).toEqual({
      kind: "site",
      title: "Reddit - 全网主阵地",
      host: "reddit.com",
    });
    expect(after).toEqual({ kind: "site", title: null, host: "reddit.com" });
  });

  it("forgets tabs the newest list no longer holds", () => {
    const [, , gone] = previewsOf([
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_AFTER_NAV },
      script(JS_FAILED), // the Gmail tab, absent from the second scan
    ]);
    expect(gone).toBeNull();
  });

  it("reports a tab count for steps that only listed tabs", () => {
    const [scan, list, onWeibo] = previewsOf([
      { name: "web_scan", args: { tabs_only: true }, content: SCAN_TABS_ONLY },
      script(TABS_LIST_RESULT, { script: '{"cmd": "tabs"}' }),
      script(
        String.raw`{"status": "success", "js_return": 1, "tab_id": "1267152166"}`,
      ),
    ]);
    expect(scan).toEqual({ kind: "tabs", count: 3 });
    expect(list).toEqual({ kind: "tabs", count: 2 });
    // The tab list feeds later scripts too.
    expect(onWeibo).toEqual({ kind: "site", title: null, host: "weibo.com" });
  });

  it("shows the opened tab and resolves scripts in it", () => {
    expect(
      previewsOf([
        script(TABS_CREATE_RESULT, { script: TABS_CREATE_SCRIPT }),
        script(
          String.raw`{"status": "success", "js_return": "ok", "tab_id": "1267154325"}`,
        ),
      ]),
    ).toEqual([
      { kind: "site", title: null, host: "baidu.com" },
      { kind: "site", title: null, host: "baidu.com" },
    ]);
  });

  it("resolves a tab that connected during a script only once it has a url", () => {
    const [, , withUrl, noUrl] = previewsOf([
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
      script(JS_NEW_TAB_WITH_URL),
      script(
        String.raw`{"status": "success", "js_return": 1, "tab_id": "1267154361"}`,
      ),
      script(
        String.raw`{"status": "success", "js_return": 1, "tab_id": "1267149920"}`,
      ),
    ]);
    expect(withUrl).toEqual({ kind: "site", title: null, host: "google.com" });
    expect(noUrl).toBeNull();
  });

  it("shows nothing when the tab is unknown", () => {
    const deadActive = String.raw`{"status": "success", "metadata": {"tabs_count": 1, "tabs": [{"id": "1267150047", "url": "https://www.google.com/", "title": "Google"}], "active_tab": "1688888987"}}`;
    expect(
      previewsOf([
        // A script before any tab list was seen.
        script(JS_ON_GOOGLE),
        // A scan whose active tab died: which page GA read is unknown.
        { name: "web_scan", args: SCAN_ARGS, content: deadActive },
        script(
          String.raw`{"status": "success", "js_return": 1, "tab_id": null}`,
        ),
        script(NO_TABS_ERROR),
      ]),
    ).toEqual([null, null, null, null]);
  });

  it("drops a title that only repeats the address", () => {
    const tab = (url: string, title: string) =>
      `{"status": "success", "metadata": {"tabs_count": 1, "tabs": [{"id": "1", "url": "${url}", "title": "${title}"}], "active_tab": "1"}}`;
    expect(
      previewsOf([
        { name: "web_scan", content: tab("https://weibo.com/", "weibo.com") },
        { name: "web_scan", content: tab("https://x.com/home", "x.com/home") },
        {
          name: "web_scan",
          content: tab("http://127.0.0.1:8317/management.html#/", "127.0.0.1"),
        },
        {
          name: "web_scan",
          content: tab(
            "https://a-very-long-internal-dashboard.example-corp...",
            "Dashboard",
          ),
        },
      ]),
    ).toEqual([
      { kind: "site", title: null, host: "weibo.com" },
      { kind: "site", title: null, host: "x.com" },
      { kind: "site", title: null, host: "127.0.0.1" },
      // A clipped host is unknown; the title alone still names the page.
      { kind: "site", title: "Dashboard", host: null },
    ]);
  });

  it("keys previews by the event, not its turn-local id", () => {
    const turns = turnsOf([
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_AFTER_NAV },
    ]);
    const tools = turns.flatMap((turn) =>
      turn.role === "agent" ? turn.tools : [],
    );
    expect(tools.map((tool) => tool.id)).toEqual(["t-0", "t-0"]);
    const resolve = buildBrowserSiteResolver(turns);
    expect(resolve(tools[0])).toMatchObject({ host: "google.com" });
    expect(resolve(tools[1])).toMatchObject({ host: "reddit.com" });
    // An event the session does not hold (an approval card's synthetic
    // event) resolves to nothing.
    const stranger: ConversationToolEvent = { ...tools[0] };
    expect(resolve(stranger)).toBeNull();
  });

  it("ignores sessions without browser steps", () => {
    const resolve = buildBrowserSiteResolver(
      turnsOf([{ name: "file_read", args: { path: "a.md" }, content: "hi" }]),
    );
    const [turn] = turnsOf([
      { name: "web_scan", args: SCAN_ARGS, content: SCAN_FULL },
    ]);
    expect(turn.role === "agent" && resolve(turn.tools[0])).toBeNull();
  });
});
