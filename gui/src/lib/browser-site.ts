// Browser step sites — which website a `web_scan` / `web_execute_js`
// step touched, for the conversation's tool pill.
//
// GA's browser tools take no URL (`web_scan`'s only arguments are
// `tabs_only` / `switch_tab_id` / `text_only`), so the site lives in
// the RESULT, a documented wire format on the pinned managed baseline
// (coupling points, read-only):
//
//   web_scan        managed-ga/code/ga.py `web_scan` + `do_web_scan`:
//                   {"status": "success", "metadata": {"tabs_count",
//                   "tabs": [{id, url, title}], "active_tab"}}, then
//                   "\n```html\n<page>```" unless tabs_only. Tab URLs
//                   are clipped to 50 chars + "...".
//   web_execute_js  managed-ga/code/simphtml.py `execute_js_rich`:
//                   {"status", "js_return", "tab_id", "newTabs"?, …}.
//                   A script that parses as a JSON object with a `cmd`
//                   is an extension command instead
//                   (assets/tmwd_cdp_bridge/background.js): `tabs` +
//                   `create` returns the opened tab, `tabs` with any
//                   other method but `switch` returns the tab list.
//
// Two stages, because a script's result names its tab only by id:
//
//   1. browserFactsFromResult — per tool event, at construction
//      (lib/agent-turn.ts), from the full result content.
//   2. buildBrowserSiteResolver — per session, at render
//      (Conversation.tsx), walking the steps in order with the most
//      recent tab list to map each script's tab id to a site.
//
// A step whose tab cannot be resolved shows nothing extra — never a
// guess. Scripts show the host only: the tab's title is from the last
// scan, and titles go stale with every in-site navigation (in JC's
// data the next scan named a different title for 38% of resolved
// scripts, a different host for 17%, mostly the navigating script
// itself, which did run on the old page).

import { createContext } from "react";

import type {
  BrowserFacts,
  BrowserTab,
  ConversationToolEvent,
  Turn,
} from "@/types/conversation";

/** What the pill shows after the tool label: the site the step touched
 * (`title` only for scans, which read the page right then), or the tab
 * count of a step that only listed tabs. */
export type BrowserStepPreview =
  | { kind: "site"; title: string | null; host: string | null }
  | { kind: "tabs"; count: number };

export type BrowserSiteResolver = (
  tool: ConversationToolEvent,
) => BrowserStepPreview | null;

export const BrowserSitesContext = createContext<BrowserSiteResolver | null>(
  null,
);

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/**
 * The JSON object a result starts with, or null. A scan result is the
 * metadata object followed by the page, so a whole-string JSON.parse
 * fails on it; this walks to the leading object's closing brace (string
 * aware) and parses only that — the same job as Python's raw_decode.
 */
export function leadingJsonObject(content: unknown): JsonRecord | null {
  if (typeof content !== "string") return asRecord(content);
  const start = content.search(/\S/);
  if (start < 0 || content[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return asRecord(JSON.parse(content.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  // Unclosed: GA's smart_format clipped a long script result mid-object.
  return null;
}

/** GA's `_arg(args, name, False, bool)` (ga.py): strings count as true
 * only for the usual yes-words, anything else by truthiness. */
function gaFlag(value: unknown): boolean {
  if (typeof value === "string")
    return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function tabId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function tabOf(value: unknown): BrowserTab | null {
  const raw = asRecord(value);
  const id = tabId(raw?.id);
  if (!raw || !id) return null;
  return {
    id,
    url: typeof raw.url === "string" ? raw.url : "",
    title: typeof raw.title === "string" ? raw.title : "",
  };
}

function tabsOf(value: unknown): BrowserTab[] {
  if (!Array.isArray(value)) return [];
  return value.map(tabOf).filter((tab): tab is BrowserTab => tab !== null);
}

/** The extension command a script is, or null for plain JavaScript —
 * the extension's own test: the whole script parses as a JSON object
 * with a truthy `cmd`. */
function extensionCommand(script: unknown): JsonRecord | null {
  if (typeof script !== "string") return null;
  try {
    const parsed = asRecord(JSON.parse(script));
    return parsed?.cmd ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Tab facts of one settled browser tool result; undefined for other
 * tools and for results that carry none (GA's error envelope, a
 * denial, a clipped result, extension commands other than opening or
 * listing tabs — `cdp` / `batch` name their own target tab, and the
 * result's `tab_id` is then only GA's default tab).
 */
export function browserFactsFromResult(
  toolName: string,
  args: Record<string, unknown> | undefined,
  content: unknown,
): BrowserFacts | undefined {
  if (toolName !== "web_scan" && toolName !== "web_execute_js")
    return undefined;
  const payload = leadingJsonObject(content);
  if (!payload) return undefined;

  if (toolName === "web_scan") {
    const metadata = asRecord(payload.metadata);
    if (payload.status !== "success" || !Array.isArray(metadata?.tabs))
      return undefined;
    return {
      kind: "scan",
      tabsOnly: gaFlag(args?.tabs_only),
      activeTabId: tabId(metadata.active_tab),
      tabs: tabsOf(metadata.tabs),
    };
  }

  const command = extensionCommand(args?.script);
  if (command) {
    if (payload.status !== "success" || command.cmd !== "tabs")
      return undefined;
    if (command.method === "create") {
      const tab = tabOf(payload.js_return);
      if (!tab) return undefined;
      // Chrome can hand back a still-loading tab with an empty url; the
      // command's own url is then what the step opened.
      const url =
        tab.url || (typeof command.url === "string" ? command.url : "");
      return url ? { kind: "tab-open", tab: { ...tab, url } } : undefined;
    }
    if (command.method !== "switch" && Array.isArray(payload.js_return))
      return { kind: "tab-list", tabs: tabsOf(payload.js_return) };
    return undefined;
  }

  if (!("tab_id" in payload)) return undefined;
  return {
    kind: "script",
    tabId: tabId(payload.tab_id),
    // The extension reports a tab that just connected with an empty url
    // — nothing to show for it yet.
    newTabs: tabsOf(payload.newTabs).filter((tab) => tab.url),
  };
}

/**
 * Display host of a tab URL: hostname without port or a leading
 * `www.`; null for non-web URLs and for a URL GA clipped inside its
 * host (a partial host would be a guess).
 */
export function displayHost(url: string): string | null {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(url)?.[1];
  if (!authority || authority.endsWith("...")) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** A page title worth showing beside the host, or null: blank titles
 * and titles that are just the address (pages without a <title> show
 * their URL as the tab title) would only repeat the host. */
function displayTitle(title: string, url: string): string | null {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (/^https?:\/\//.test(lower)) return null;
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    // Non-URL tab address: nothing for the title to repeat.
  }
  if (hostname) {
    const bare = hostname.replace(/^www\./, "");
    for (const host of [hostname, bare]) {
      if (lower === host || lower.startsWith(`${host}/`)) return null;
    }
  }
  return clean;
}

function sitePreview(
  tab: BrowserTab,
  withTitle: boolean,
): BrowserStepPreview | null {
  const host = displayHost(tab.url);
  const title = withTitle ? displayTitle(tab.title, tab.url) : null;
  return host || title ? { kind: "site", title, host } : null;
}

function indexTabs(tabs: BrowserTab[]): Map<string, BrowserTab> {
  return new Map(tabs.map((tab) => [tab.id, tab]));
}

/**
 * Site previews for every browser step of a session, keyed by the tool
 * event object itself: live tool ids are only unique within a turn
 * (`t-0` repeats), and the conversation renders the very objects the
 * turns hold.
 *
 * Tab memory: a full list (any scan, the tab-list command) replaces
 * it — a tab missing from the newest list is gone, and a stale entry
 * is exactly the guess to avoid; an opened tab and tabs that connected
 * during a script are added. The memory spans the whole session, user
 * turns included: in JC's data (2026-10-04) all 25 scripts that
 * resolved only across a user turn and could be checked against a
 * later scan named the same host.
 */
export function buildBrowserSiteResolver(turns: Turn[]): BrowserSiteResolver {
  const previews = new Map<ConversationToolEvent, BrowserStepPreview>();
  let tabs = new Map<string, BrowserTab>();
  for (const turn of turns) {
    if (turn.role !== "agent") continue;
    for (const tool of turn.tools) {
      const facts = tool.browser;
      if (!facts) continue;
      let preview: BrowserStepPreview | null = null;
      switch (facts.kind) {
        case "scan": {
          tabs = indexTabs(facts.tabs);
          if (facts.tabsOnly) {
            preview = { kind: "tabs", count: facts.tabs.length };
          } else {
            // GA sets active_tab before reading the page, so an id the
            // list does not hold is a dead tab it fell back from —
            // which page it actually read is unknown.
            const active = facts.activeTabId
              ? tabs.get(facts.activeTabId)
              : undefined;
            preview = active ? sitePreview(active, true) : null;
          }
          break;
        }
        case "tab-list":
          tabs = indexTabs(facts.tabs);
          preview = { kind: "tabs", count: facts.tabs.length };
          break;
        case "tab-open":
          tabs.set(facts.tab.id, facts.tab);
          preview = sitePreview(facts.tab, false);
          break;
        case "script": {
          const tab = facts.tabId ? tabs.get(facts.tabId) : undefined;
          preview = tab ? sitePreview(tab, false) : null;
          for (const added of facts.newTabs) tabs.set(added.id, added);
          break;
        }
      }
      if (preview) previews.set(tool, preview);
    }
  }
  if (previews.size === 0) return () => null;
  return (tool) => previews.get(tool) ?? null;
}
