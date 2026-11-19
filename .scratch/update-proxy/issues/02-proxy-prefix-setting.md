# 02 「更新加速地址」设置

Status: ready-for-agent
日期：2026-11-19
背景：[PRD](../PRD.md) 裁决 2–5
顺序：在票 [01](./01-system-proxy.md) 之后做，同一个 worktree、同一个分支，接着往同一篇 devlog 里写

先读 `docs/agents/dispatch.md`（执行代理的常设约束在那里，不在本票重复）。

## 接口约定（Core 与 GUI 共用，逐字照此）

- pref 键：`update_proxy_prefix`，值是 JSON 字符串。缺失、空串、只有空白，都表示关闭（直连）。
- 合法值：去掉首尾空白后能解析成 URL，scheme 是 `https`，有主机名。其余一律不合法。
- 规范化：合法值去掉末尾所有 `/` 再补一个 `/`。
- 拼接：`<规范化前缀><原地址全文>`，原地址不做任何转义。例：前缀 `https://example.com`，
  原地址 `https://github.com/o/r/releases/download/v1/a.exe`，结果
  `https://example.com/https://github.com/o/r/releases/download/v1/a.exe`。
- GUI 只把合法值或空串写进 pref；Core 读到不合法的值按关闭处理（不报错）。

## 1. 要改的文件

Core：

- `core/src/app_update.rs`

GUI：

- `gui/src/stores/prefs.ts`、`gui/src/stores/prefs.test.ts`
- `gui/src/stores/app-update.ts`（及其现有测试文件，如有）
- `gui/src/components/screens/settings/SettingsHost.tsx`、`Settings.tsx`、`SettingsGeneral.tsx`
- `gui/src/components/screens/settings/SettingsAbout.tsx`、`SettingsUpdateControl.tsx`、
  `update-control-view.ts`、`update-control-view.test.ts`
- `gui/src/i18n/locales/zh.ts`、`en.ts`
- 新增一个放校验纯函数的小文件及其测试（位置照 `gui/src/lib/` 里同类纯函数的惯例）

文档：

- `docs/design/overlays-and-settings.md`（「应用行为」列表、About「更新控件」表的「出错」行）
- `docs/copy-language-guidelines.md`（只在它已有逐行列出通用页 / 更新文案的表时补行；没有就不动）
- `docs/devlog/2026-11-19-update-proxy.md`（票 01 建的那篇，接着写）

实际需要动的文件与此不符（多或少）时，照实际情况做，并在报告里说明差异。

## 2. 怎么改

### 2.1 Core：`core/src/app_update.rs`

1. 两个纯函数，带单测：
   - 规范化：入参是 pref 里读到的原始字符串，返回 `Option<String>`（规范化后的前缀，或关闭）。
   - 拼接：前缀 + 原地址，返回拼好的字符串。
   单测覆盖：空串、纯空白、`http://`（不合法）、没有 scheme、`https://example.com`、
   `https://example.com/`、`https://example.com///`、带路径的前缀 `https://example.com/gh/`、
   上面「接口约定」里的拼接例子。
2. `check_available_update` 读 pref `update_proxy_prefix`（经 Core 自己的数据库接口，照
   `get_pref_json` 现有的读法；读失败按关闭处理）。
   - **关闭时：行为必须与现在逐字节相同**（同一个端点、同样的错误字符串），除下面第 4 条的超时外。
   - **开启时：做两次检查。** 先用拼接后的端点建更新器并 `check()`；成功（有更新或已是最新）就用它的
     结果。失败则用原端点再检查一次；这一次成功就用它的结果，这一次也失败则返回**第一次（加速地址）**
     的错误，`endpoint=` 写拼接后的地址。
     不要把两个地址塞进同一个 `endpoints` 列表：插件遇到「200 但不是 JSON」会直接返回错误，不试下一个。
3. 开启时，检查拿到的 `Update` 在返回前把 `download_url` 换成拼接后的地址（`Update::download_url` 是
   公开字段）。不管清单是从加速地址还是直连拿到的，下载都走加速地址。下载失败不回退直连。
   `download_app_update` 的下载错误在开启时要带上实际下载地址，格式在现有
   `update_error: phase=download; …` 上**加一个字段** `url=<地址>`，其余字段与顺序不变；关闭时错误字符串
   与现在相同。
4. 两次检查都设超时 20 秒（`UpdaterBuilder::timeout`）。现在检查没有超时，加速地址挂住时会一直等不到
   回退。这个超时只作用于检查：插件构造 `Update` 时把 `timeout` 置空，下载不受影响——动手前在插件源码里
   确认这一点（`tauri-plugin-updater` 2.10.1 `src/updater.rs` 构造 `Update` 处），与此不符就停下写进报告。
5. `install_app_update` 不动。模块头注释补一段说明加速地址的两条规则（检查回退、下载不回退）。

### 2.2 GUI：pref 与校验

- `prefs.ts`：加 `updateProxyPrefix: string`（默认 `""`）与 `setUpdateProxyPrefix(value: string)`，
  持久化到 pref `update_proxy_prefix`，照 `autoDownloadUpdates` / `setAutoDownloadUpdates` 的写法；
  启动时的读取照 `auto_download_updates` 现有的读取位置。
- 校验纯函数：入参是输入框原文，返回「空（关闭）/ 合法（附规范化后的值）/ 不合法」。规则与上面
  「接口约定」一致，测试用同一组用例。

### 2.3 GUI：通用页的一行

`SettingsGeneral.tsx` 的「应用行为」分组里，紧跟 `自动下载更新` 之后加一行，沿用 `PreferenceRow`：

- 左边标题与描述；右边一个单行文本输入框。输入框沿用设置页里已有的输入框写法（如运行环境页），
  不新造样式；宽度取能放下 `https://example.com/` 加若干字符的固定宽度，窄窗口下不把标题挤没。
- 失焦或按 Enter 时提交：空 → 存空串；合法 → 存规范化后的值，输入框显示规范化后的值；
  不合法 → 不存，描述那一行换成不合法提示（warning 色），输入框保留用户原文。用户再改到合法或清空后，
  描述恢复。按 Esc 还原为已存的值。
- 不加开关、不加预设、不加「测试」按钮。

### 2.4 GUI：关于页错误块的链接

「关于」页更新出错时，错误块标题行现在是「原因 + 手动下载」。在「手动下载」后面加第二个链接，点了把
设置切到「通用」页。**只在这三种原因时显示**：`channelUnavailable`、`networkUnavailable`、
`downloadFailed`。其余原因（校验失败、安装失败、更新包失效、通道配置有误、平台没有包等）不显示。

- 在 `readableUpdateError` 的返回值与错误状态上**加一个布尔字段**表示要不要显示；`update-control-view.ts`
  透传；`update-control-view.test.ts` 与 `app-update` 的测试各补用例（三种显示、至少两种不显示）。
- 这是应用内跳转，不是外链：不用 `ExternalTextLink` 的外链图标，样式与同一行的「手动下载」文字链接一致。
  切页用设置页现有的 `onTabChange`。
- 这条规则不覆盖：TopBar 更新弹层。它如果也有错误展示，本票不动，在报告里写出它现在的样子。
- Core 的错误字符串开启时会带上用户填的地址，而 `readableUpdateError` 是对整串做子串匹配。补一条测试：
  地址为 `https://example.com/` 的检查错误与下载错误，分类结果与不带地址时相同。

### 2.5 文案（逐字，不要改写）

| 键（放在现有对象里的位置） | 中文 | 英文 |
|---|---|---|
| 通用页 `updateProxyPrefixTitle` | `更新加速地址` | `Update proxy prefix` |
| 通用页 `updateProxyPrefixDescription` | `连不上 GitHub 时填一个加速前缀，检查和下载更新都经它转发；留空则直连。` | `If GitHub is unreachable, enter a proxy prefix; update checks and downloads go through it. Leave empty to connect directly.` |
| 通用页 `updateProxyPrefixInvalid` | `地址要以 https:// 开头。` | `The address must start with https://.` |
| 输入框占位（不进 i18n 也可） | `https://example.com/` | `https://example.com/` |
| `updates.setProxyPrefix` | `设置加速地址` | `Set a proxy prefix` |

界面与代码里不出现任何真实反代服务的域名；测试与文档的例子一律用 `example.com`。

### 2.6 文档

- `docs/design/overlays-and-settings.md`：「应用行为」列表在 `自动下载更新` 后加这一行的规则（一个输入框、
  留空即关闭、不带预设及理由、提交与不合法时的表现）；About「更新控件」表「出错」行补「三种网络类原因时
  多一个『设置加速地址』链接，跳到通用页」。
- devlog：接着票 01 写。要有：来源（issue #33）、两类用户、裁决与被否的选项（预设；放在关于页；
  开关加输入框；下载回退直连；自建镜像及其启动信号）、接口约定、检查 20 秒超时这一处对直连用户的行为
  变化、安全说明（验签不变，反代能看到 IP 与版本、能不给更新、不能换包）、没验证到的（见第 6 节）。
- 中文语境标点一律全角。

## 3. 验证命令

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
rustfmt --check --edition 2021 core/src/app_update.rs
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
```

`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可整篇格式化。`core/` 同理，只看自己动过的文件。
gui 的 lint 带 React 编译器规则：effect 里同步 `setState`、渲染期读 `Date.now` 都是 error。

## 4. 不要碰

- `install_app_update`、`PreparedAppUpdate`、进度事件、`check_app_update` 的返回形状。
- `scripts/`、`.github/`、`core/tauri.conf.json`：更新通道与清单生成不变。
- `cli/`、`runner/`、`managed-ga/`：没有 CLI 契约变化，没有新 IPC 命令，没有迁移。
- 错误块里「手动下载」的地址不变（仍是 GitHub 的发布页）。
- 「关于」页除错误块那一个链接外不加任何东西。

## 5. 报告格式

按 `docs/agents/dispatch.md` 的四段。另附：关闭时错误字符串与改动前一致的依据（哪条测试或哪段 diff）；
TopBar 更新弹层现在怎么展示错误。

## 6. 真机步骤

| 主会话可代验 | 只有 JC 能验 |
|---|---|
| 单测与门禁；dev 里在通用页填合法值后，库里 pref `update_proxy_prefix` 是规范化后的值；填不合法值后库里不变；清空后是空串 | 通用页这一行的样子（输入框宽度、不合法时描述换色） |
| 通用页与关于页错误块的真窗口截图，交 JC 看 | 关于页错误块两个链接并排的样子 |

没法在合入前验证的：真实走一遍「填了加速地址 → 检查 → 下载 → 验签」。开发版不连更新通道，而已发出的
版本没有这项设置，所以第一次真实验证要等「带这项设置的版本」升级到它的下一版。合入前的依据是：拼接格式
已用公共反代实测（PRD「已核实的事实」），拼接与回退逻辑有单测。

## Comments
