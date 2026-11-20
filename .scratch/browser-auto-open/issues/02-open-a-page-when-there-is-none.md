# 02 浏览器开着、但没有可用网页时，Galley 也打开一个

Status: needs-dogfood（2026-11-20 合入 main，efcfc4ac）
日期：2026-11-20
背景：[PRD](../PRD.md)、[票 01](./01-open-the-browser-when-needed.md)（已合入）。JC 裁：「这个也做，解决掉」。

## 要的行为

今天：扩展已连上、但浏览器里没有 `http` / `https` 标签页（例如用户刚打开 Chrome / Edge，只有新标签页）时，`web_scan` /
`web_execute_js` 立刻回 `NO_BROWSER_TABS_MSG`（「浏览器插件已连接，但没有可用网页……」）。

改为：和票 01 的「扩展没连上」一样处理。Galley 在扩展所在的那个浏览器里打开测试页（`https://example.com`，票 01 已有的打开函数），
等它出现（最多 20 秒），照常执行这次调用。打不开（不知道浏览器、浏览器桥不是主进程、已放弃）或 20 秒内没出现：回现在那句话
（两句提示原文不改，按当时状态选哪一句，即 `browser_control_empty_msg()`）。

## 1. 要改的文件

- `managed-ga/code/ga.py`，并重新生成补丁 `managed-ga/patches/0035-managed-browser-auto-open.patch`、更新
  `managed-ga/patches/manifest.md` 的重放记录（按 [managed GA runtime](../../../docs/managed-ga-runtime/README.md) 的规则）。
- `runner/managed_browser_bridge.py` 及其测试。
- `core/src/browser_bridge.rs` 及其测试。
- `docs/managed-ga-runtime/browser-control.md`「Opening The Browser When A Tool Needs It」一节。
- `docs/windows-build-checklist.md`「Browser auto-open」一节加一步（见第 6 节）。

## 2. 怎么改

- **`ga.py` `galley_wait_for_browser`**：去掉「扩展已连上就立刻回 `NO_BROWSER_TABS_MSG`」那个提前返回。没有标签页时一律先问
  `galley_browser_wanted()`；回否就回 `browser_control_empty_msg()`；回是就照旧每 0.5 秒查、最多 20 秒，到点回 `browser_control_empty_msg()`。
- **浏览器桥 `on_browser_wanted`**：回是的条件从「扩展没连上」放宽为「扩展没连上，**或**连上了但主进程上没有标签页」
  （`driver.get_all_sessions()` 为空），其余条件（主进程、知道浏览器）不变。钩子当场写的那一行如实写：没连上写
  `extensionConnected:false`；连上了写 `extensionConnected:true`、`tabCount:0`。不要再一律强制写 `false`。
- **重新启用**：除了票 01 的「新的扩展连接」与「新的浏览器桥进程」，再加一条：状态循环看到 `tab_count > 0` 时清掉计时。否则用户
  关掉测试页后，同一次连接里再也不会打开。30 秒内重复请求不再登记、过了 30 秒仍没有标签页就放弃，这两条照旧。
- **Core**：打开的条件从「`browserWantedAt` 变了且 `extensionConnected` 为 false」改为「`browserWantedAt` 变了，且
  `extensionConnected` 为 false **或** `tabCount` 为 0」（都是 `running` 行）。打开函数不变（总带测试页地址；浏览器开着时这会在它里面
  开一个新标签页）。
- **文档**：auto-open 一节写明两种情况都会打开、钩子写行的规则、新的重新启用条件。

## 3. 验证

```bash
GA_PATH=<worktree>/managed-ga/code <主 worktree>/.venv/bin/python -m pytest
<主 worktree>/.venv/bin/python -m mypy runner
<主 worktree>/.venv/bin/ruff check runner
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
rustfmt --edition 2021 --check core/src/browser_bridge.rs
git diff --check
node scripts/check-docs-links.mjs
node scripts/check-managed-ga-payload.mjs
node scripts/check-ga-baseline-drift.mjs
```

加上补丁重放（`scripts/build-managed-ga.sh` 对一份干净的上游克隆，重建出的 `ga.py` 与手改的逐字节一致）。

要有的测试：

- `ga.py`：扩展已连上、没有标签页、`opening` 为是 → 等到标签页出现后照常执行；`opening` 为否 → 立刻回 `NO_BROWSER_TABS_MSG`。
- 浏览器桥：连上且无标签页时回是、写出的行是 `extensionConnected:true, tabCount:0`；连上且有标签页时回否；放弃后 `tab_count > 0` 重新启用。
- Core：`browserWantedAt` 变了、`extensionConnected:true`、`tabCount:0` → 打开；`tabCount > 0` → 不打开。

## 4. 不要碰

- 扩展源码；两句提示的原文；`TMWebDriver.py`（这张票用不到它）；GUI；CLI / Agent API；runner IPC；外置模式。
- 不要在本机退出、打开任何浏览器，不要连 18765 / 18766。不要跑 `tauri dev`。

## 5. 报告

按 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints」的四部分，简短。

## 6. 验收

| 主会话能代验 | 只有 JC 能验 |
|---|---|
| 合入后 Core 重启，浏览器桥与偏好照旧 | Windows：Edge 开着、只有新标签页，让 Galley 用浏览器，Edge 里多出 `example.com`，任务接着做完 |
| 征得 JC 同意后，Vivaldi 开着时 `open -a` 带测试页地址，看是否在现有窗口开出新标签页（Mac 上没有「只有新标签页」的可测状态：JC 的 Vivaldi 总有网页） | |

Windows 清单「Browser auto-open」加一步：Edge open with only its New Tab page → the request adds an `example.com` tab in that Edge, and the task carries on.

## Comments

### 2026-11-20 macOS Chrome 真机（主会话代验）

正常打开 Chrome（只有新标签页，扩展连上、网页数 0）后，在同一临时会话里发「再用浏览器看一下 https://www.iana.org/domains 的页面标题」：
4.3 秒后 Chrome 里出现 `example.com`，第一步 7 秒落库，答对，全程 15.4 秒；Chrome 仍是 1 个窗口（`osascript` 计数），没有多开。
Windows 的 Edge 那一步仍等下一版草稿。
