# Managed Runtime: Browser Control Capability

> Part of the [managed GA runtime reference](./README.md).

## Browser Control Capability

Managed / bundled GA users should see Browser Control as a core completion
item, not as an optional advanced setting. GA's `web_scan` and
`web_execute_js` capabilities depend on the `tmwd_cdp_bridge` Chromium
extension, and without it the intended Galley experience is materially
incomplete.

Galley cannot silently install a Chromium extension for ordinary users. The
product contract is therefore:

```text
Galley prepares the `tmwd_cdp_bridge` folder -> user opens the Chromium
extensions page -> user drags or loads that folder -> the extension connects to
Galley's resident bridge -> Galley verifies the connection on its own ->
Galley offers a simple browser demo
```

Rules:

- The extension shipped in managed GA code is the source payload only.
- Galley syncs it to a stable app-data directory before asking the user to
  load it. Do not ask users to load from inside the app bundle or from a
  developer checkout path.
- Galley must also prepare the extension config automatically. Upstream GA
  tutorials ask users to run GA once before installing the extension because
  that first run generates `tmwd_cdp_bridge/config.js`; in managed mode this is
  Galley's responsibility, not a user-facing prerequisite.
- If the stable extension directory or `config.js` is deleted, reopening Browser
  Control setup should recreate it before showing the browser installation
  steps. If preparation fails, keep the user at the first step and show a retry
  action instead of sending them to the browser.
- If a compatible GA Browser Control extension is already installed and Galley
  verifies the bridge successfully, treat the capability as ready. Do not ask
  the user to reinstall Galley's copy just to match the extension source path.
- The extension's user-visible identity is Galley-branded (display name
  "Galley Browser Bridge", patch `0015`). It injects no in-page indicator:
  the toolbar icon badge shows `ON` only while the bridge WebSocket to the
  local driver is actually connected, and the popup is a status panel
  (connection state + operable tab count; cookie copy sits behind an explicit
  button). While an agent drives the browser via the debugger, Chromium's own
  infobar is the in-page signal. Do not reintroduce page-injected indicators.
- The first supported browser family is Chromium. The UI provides one-click
  open buttons for Chrome and Edge, while copy should mention that other
  Chromium browsers can load the same unpacked extension manually. Safari and
  Firefox are out of scope for the first version because this bridge is
  Chrome-extension / CDP based.
- While Browser Control was never set up, the TopBar keeps a persistent
  invitation (「浏览器控制 · 待解锁」, brand tone) and the main area shows the
  invitation banner. Both say what the user gains, not that something is
  broken (2026-10-04: the earlier warning-tone 「待连接」 read as a fault). No
  motion, no dismiss, no modal spam, no red. Once set up, the entry is a lamp:
  lit (the plain thin glyph, like every other topbar icon) while the extension
  is connected, dimmed to half opacity while it is not. Exact rules:
  [layout-and-chrome §4.1](../design/layout-and-chrome.md) Browser Control
  Indicator.
- The success test must be deterministic and model-free: verify extension
  layout, bridge connection, tab discovery, and a minimal JavaScript execution
  such as reading `document.title`. It verifies the install (the persisted
  `browser_control_verified` pref); the connection state itself is live from
  the resident bridge (see below). Galley runs it by itself once when the
  extension first connects before setup is verified, and the buttons
  `测试连接` / `重新检测` / `重新测试` run the same probe on demand.
- Browser Control probes must tolerate Chromium MV3 service-worker wake-up and
  reconnect timing, especially on Windows. Do not collapse the probe window
  back to a few seconds unless the extension has an equivalent immediate
  wake-up path. Fast recovery should come from an in-worker retry while it is
  awake; `chrome.alarms` is only a 30-second-level fallback.
- After the test succeeds, Galley may offer a beginner demo. In Chinese UI,
  use Baidu for the weather-search demo to avoid making Google reachability
  part of the setup experience. The demo should validate the managed GA browser
  flow without adding a new GA tool or modifying extension source: managed GA
  must open new tabs through the existing `web_execute_js` extension protocol
  (`{"cmd":"tabs","method":"create",...}`), not page-level `window.open`,
  because Chromium may block non-user-gesture popups. Demo success or failure
  must not mutate the Browser Control connection status; that status belongs to
  the resident bridge and the deterministic probe.
- A lightweight `图文指南` link may appear near the folder-install step and open
  the official Datawhale tutorial directly at the Chrome install section
  (`#_2-1-1-chrome-安装步骤`). It is an auxiliary visual guide, not a
  replacement for Galley's setup flow and not a bottom-row CTA. Avoid linking
  to the chapter top because the upstream prerequisites mention raw GenericAgent
  paths and "run GA once", both of which Galley handles for managed users.

## Resident Bridge And Live Status

Decision 2026-10-04 (`.scratch/browser-control-ux/PRD.md`, "S-b"): in managed
mode Galley Core owns one long-lived Python process,
`runner/managed_browser_bridge.py`, that hosts GA's own TMWebDriver master.
The extension connects to it as soon as the browser runs, every managed GA
session's driver becomes a remote client of it through upstream's remote mode,
and Galley knows the connection state live instead of probing once per launch.

Lifecycle (`core/src/browser_bridge.rs`, modeled on the IM supervisors):

- Started at app setup when the active runtime is managed, and whenever the
  `active_runtime_kind` pref is written (`set_pref_json` reconciles the bridge:
  start for managed, stop for external). Stopped on quit and before an update
  install, next to the IM supervisors.
- **Never started for attach / external GA** (Rule 1): an external GA's sessions
  would otherwise attach to a Galley-owned master. The bridge also refuses to
  run unless `GALLEY_RUNTIME_KIND=managed`.
- Restarted with backoff when it exits on its own (1 s doubling to 60 s; a run
  of at least 10 s resets it). A crash after a healthy run shows `starting`; a
  process that keeps exiting fast shows `error` with its last message.
- Exits with Core: stdin EOF (Core holds the pipe), the `GALLEY_CORE_PID`
  watchdog, or a closed status pipe. Spawned like every Core Python child
  (`configure_python`: `CREATE_NO_WINDOW` on Windows, UTF-8 I/O), with
  `PYTHONDONTWRITEBYTECODE=1` so nothing lands in the code payload.
- Does not fight over the ports. If 18766 is already served (a GA session that
  started a master first, a second Galley, an external upstream GA), it runs as
  role `remote`, reads the status through that master, and becomes master once
  the port frees. Remote GA clients follow automatically: they always post to
  `127.0.0.1:18766`, whoever serves it.

Ports and Rule 2: Core itself opens no listener. 18765 / 18766 are the GA
engine's own ports, bound by GA's own `TMWebDriver` code, on 127.0.0.1 only,
with upstream's `Origin`-header rejection on the HTTP side. Managed sessions
already opened the same ports whenever they were first to use the browser; the
bridge only makes that master resident.

What the bridge may do: construct `TMWebDriver()` and call `get_status()`. It
never executes JavaScript in pages (the master only relays the sessions' own
calls), never writes GA files or state, and discards TMWebDriver's stdout
prints (tab URLs and relayed script results) instead of logging them.

Status protocol (bridge stdout, one camelCase JSON object per line, written on
start and on change only):

```text
{"state":"running","role":"master"|"remote","extensionConnected":bool,"tabCount":n,"updatedAt":...}
{"state":"error","role":null|"remote","errorKind":"...","error":"<zh message>","updatedAt":...}
```

Core keeps the latest status (`state`: `stopped` / `starting` / `running` /
`error`, plus role, extension fields, `errorKind`, `error`, `pid`), serves it
through the Tauri command `get_browser_bridge_status`, and pushes every change
as the Tauri event `browser-bridge-updated`.

GUI mapping (`statusForBridge` in `gui/src/lib/browser-control.ts`; the store
subscribes in `useBrowserControlLiveStatus`, managed runtime only):

| Bridge | UI status |
|---|---|
| `running`, `tabCount > 0` | `connected` |
| `running`, extension connected, no tabs | `connected_no_tabs` |
| `running`, not connected | `offline` if verified, else `not_connected` |
| `error` | `error` with the bridge's message |
| `stopped` / `starting` / no report yet | `unknown` (resolves within about a second; the TopBar draws the unlit lamp if verified, 待解锁 if not, instead of a 「检测中」 badge) |

Tabs win over the extension flag: GA can drive any tab the master lists, and an
upstream master without `get_status` reports tabs but no extension flag.
A probe result still sets the status when it returns (a failed script round
trip shows as `error`) until the bridge reports its next change.

Auto-verify: when the bridge first sees the extension (connected, or tabs
listed) while `browser_control_verified` is not set, the GUI runs the existing
deterministic probe once (`context: auto_verify`). With the resident master
running the probe is a remote client, so it grabs no port. Success persists the
pref, which completes setup step 3 without a click, and offers the demo once in
a sticky info toast (「浏览器控制已连接」 + 「试一试」); a manual 测试连接 does
not, since Settings shows the demo button next to it. One attempt per
connection: it re-arms only after the bridge stops seeing the extension.

Removed: the per-launch probe (it showed 「浏览器控制 · 检测中」 for 35 s every
launch with the browser closed, went stale right after, and briefly held the
ports itself). `ensureLayout()` still runs once per launch.

When the bridge cannot serve, the GUI shows `error` with an honest message and
the bridge keeps retrying (2 s doubling to 30 s) without exiting:

| `errorKind` | Cause |
|---|---|
| `missing_dependency` | GA's driver imports failed (`bottle`, `simple_websocket_server`, `requests`) |
| `port_in_use` | 18765 is bound by another program, or a non-TMWebDriver program answers on 18766 |
| `master_unreachable` | the master on 18766 keeps dropping connections |
| `start_failed` / `status_failed` | anything else upstream raised |
| `http_failed` | the master's HTTP side never came up; the bridge exits so Core restarts it |
| `spawn_failed` / `exited` | Core could not start the process, or it keeps exiting fast |

Coupling points (read-only use of upstream behaviour, re-check on every
baseline upgrade):

- `TMWebDriver(host, port)` constructor semantics: the first instance becomes
  master (WebSocket server on `port`, bottle HTTP on `port + 1`, `/link`
  commands); an instance that finds `port + 1` listening sets `is_remote = True`
  and proxies `execute_js` / `get_all_sessions` / `get_status` /
  `find_session` over HTTP. A remote client raises `ConnectionError` once the
  master is gone.
- Ports 18765 / 18766 (TMWebDriver's defaults; the extension's `background.js`
  dials `ws://127.0.0.1:18765`).
- `get_status()` returning `{extension_connected, extension_connected_at,
  tab_count}`: added by Galley patch `0006`, not upstream.
- GA's `ga.py` `first_init_driver()` constructs `TMWebDriver()` lazily on the
  first web tool call, which is what makes sessions remote clients.
- Patch `0028` (`managed-ga/patches/manifest.md`): upstream's remote client
  never tracked a default tab, so every remote `execute_js` paid the master's
  3 s dead-session wait and the web tools reported no `active_tab` / `tab_id`.
  The remote `get_all_sessions` now keeps the first live tab as default, as a
  master does. Without it the resident master would make every managed
  session's browser calls seconds slower.

Chinese copy (source of truth: `gui/src/i18n/locales/zh.ts`):

```text
TopBar never set up: 浏览器控制 · 待解锁 (brand badge, tooltip 解锁浏览器控制)
Invitation banner: 让 Galley 用你已登录的浏览器办事：查资料、填表单、操作网页后台。 / 解锁浏览器控制
TopBar set up: PuzzlePiece lamp, plain while connected, half opacity while not; tooltip 浏览器控制已可用 / 已配置，浏览器未打开
Popover: 已连接 · N 个标签页 / 已连接 · 暂无网页 / 浏览器未连接 + 打开装了插件的浏览器后自动连接。 / 设置…
Scope line (Settings connected card only, not the popover): Galley 只在你交代的任务里读取和操作这个浏览器，沿用你的登录态。读网页时，它能看到你打开的所有标签页的标题和网址。
Error badges: 浏览器控制 · 缺少组件 / 端口被占用 / 连接中断 / 未能启动 / 需检查
Step 3 hint: 插件装好后，Galley 会自动检测到连接。没反应时，在该浏览器打开任意网页（或点「打开测试页」），再点「测试连接」。
Connected evidence: 已连接浏览器 / 检测到 N 个可操作标签页
Auto-verify toast: 浏览器控制已连接 / 新建对话，让 Galley 用浏览器查天气。 / 试一试
Reload action: 重新加载插件
Success demo: 新建测试对话
Demo prompt: 请打开百度，搜索今天的天气，并告诉我结果。不要用代码或外部 API 查询。
```

The scope line's second sentence is literal: every `web_scan` result hands the
model the whole tab list (titles and URLs, each URL cut at 50 characters; GA's
`ga.py` `web_scan` `metadata.tabs`), not only the page it reads.
