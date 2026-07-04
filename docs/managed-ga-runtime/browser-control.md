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
extensions page -> user drags or loads that folder -> Galley tests the connection ->
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
- The first supported browser family is Chromium. The UI provides one-click
  open buttons for Chrome and Edge, while copy should mention that other
  Chromium browsers can load the same unpacked extension manually. Safari and
  Firefox are out of scope for the first version because this bridge is
  Chrome-extension / CDP based.
- While Browser Control is missing, TopBar must keep a persistent, high-weight
  setup entry. The entry may use low-frequency motion, but should not use red
  error styling or repeated modal spam.
- On each app launch, Galley may show the setup dialog once until the
  connection is verified. Users can close it for the current session, but the
  TopBar entry remains visible.
- The success test must be deterministic and model-free: verify extension
  layout, bridge connection, tab discovery, and a minimal JavaScript execution
  such as reading `document.title`.
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
  the deterministic probe.
- A lightweight `图文指南` link may appear near the folder-install step and open
  the official Datawhale tutorial directly at the Chrome install section
  (`#_2-1-1-chrome-安装步骤`). It is an auxiliary visual guide, not a
  replacement for Galley's setup flow and not a bottom-row CTA. Avoid linking
  to the chapter top because the upstream prerequisites mention raw GenericAgent
  paths and "run GA once", both of which Galley handles for managed users.

Recommended Chinese copy:

```text
TopBar missing: 浏览器控制 · 待连接
TopBar ready: icon-only browser button, tooltip: 浏览器控制已可用
Setup title: 连接浏览器控制
Permission line: 安装后，Galley 可以读取和操作浏览器，并沿用你的登录态。
Ready line: Galley 已能读取和操作浏览器，并沿用你的登录态。
Connected evidence: 已连接浏览器 / 检测到 N 个可操作标签页
Reload action: 重新加载插件
Success demo: 试用浏览器控制
Demo tooltip: 让 Galley 打开浏览器并搜索天气
Demo prompt: 请打开百度，搜索今天的天气，并告诉我结果。不要用代码或外部 API 查询。
```
