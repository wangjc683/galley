# 06 · 设置 → 模型：服务商小字改说「怎么接」，「添加」直接弹出服务商列表

Status: needs-dogfood

来源：2026-10-20 JC 真机走查设置 → 模型页时提出，PRD 裁决 15、16。只动界面，合入时 Core 不用重启。

## 1. 服务商小字改说「怎么接」（裁决 15）

现状：服务商卡片上 11.5px 的淡墨小字是协议名（`gui/src/lib/managed-model-preset-copy.ts:12` 的 `managedModelProtocolLabel`），所有 OpenAI 协议的服务商都写「OpenAI 兼容」，包括官方 OpenAI 和 ChatGPT。添加服务商时，选择器里每个预设旁边的小字（`ManagedModelProviderPicker.tsx:45`）也是同一套。

改成回答「这个服务商怎么接」：

| 服务商 | 中文 | 英文 |
|---|---|---|
| ChatGPT（`authKind` 为 `chatgpt_codex_oauth`） | ChatGPT 订阅 | ChatGPT plan |
| 地址是 OpenAI / Anthropic 官方预设的（按 apiBase 对到 OpenAI、Anthropic 预设，用现有的「记录对预设」逻辑） | 官方 API | Official API |
| 其余 | OpenAI 兼容 / Anthropic 兼容（不变） | 不变 |

- 卡片和选择器用同一个函数。选择器里 ChatGPT、OpenAI、Anthropic 三个预设的小字同样按此规则；预设说明那一行不动。
- 自定义服务商里的协议切换（`SegmentedControl` 的「OpenAI 兼容 / Anthropic 兼容」）说的是协议本身，**不改**。
- 同步改设计文档 `docs/design/overlays-and-settings.md`：409 行「协议名是 11.5px 淡墨文字」与 400 行附近的选择器说明。

## 2. 「添加」直接弹出服务商列表（裁决 16）

现状：点「添加」→ 展开一张空表单，顶上是「选择服务商」下拉 → 点开下拉 → 选，一共三下（`SettingsModels.tsx`、`ProviderEditor.tsx:239` 的 `ManagedModelProviderPicker`）。

改为：

- 「添加」按钮本身就是菜单按钮，点一下直接弹出服务商列表，内容和样式照搬现在下拉里的那份（预设名、说明、小字）。选中后，在原来新增表单的位置展开该服务商的表单，预设显示为只读文字，和编辑态一致。
- 按 Esc 或点外面关闭菜单，什么都不展开。
- 表单里的关闭按钮照旧。表单展开时再点「添加」：先关掉旧表单再弹菜单，或者禁用「添加」，选现有逻辑里冲突最少的一种，并在说明里写清。
- 没有任何服务商时保持现状：表单自动展开、不能关，「添加」隐藏，表单里仍然用下拉选服务商（这时表单本身就是唯一的下一步）。
- 键盘：菜单项能用 ↑ / ↓ 选、回车确认（照 Radix 菜单的默认行为）。
- 同步改设计文档：`overlays-and-settings.md` 407 行（`添加` 按钮）、410 行（新增表单与 picker）；`onboarding-and-cards.md:23` 那句「Settings 端保留紧凑 popover picker」改成现在的说法。

## 验收

- `pnpm --dir gui typecheck`、`lint`、`test` 全绿；`node scripts/check-docs-links.mjs` 通过；`git diff --check` 干净。
- 测试：
  - 小字三种取值：ChatGPT、官方地址、其余；另有自定义预设、地址改成中转的 OpenAI 卡；
  - 「添加」点开菜单 → 选中 → 表单出现且预设只读；
  - Esc 关菜单不出表单；
  - 零服务商状态不变。
- 实现说明附 JC 的真机步骤。

## 约束

- 动手前查设计禁令：`grep -n "不要\|有意\|分叉" docs/design/overlays-and-settings.md docs/design/onboarding-and-cards.md`，看服务商一节；有冲突写进说明，不要自己裁。
- gui 不是 prettier-clean：只格式化自己的 hunk。React 编译器 lint 规则照旧。
- 只在给定的 worktree 里工作，不碰主工作树，不跑 `tauri dev`；只动 `gui/` 与 `docs/design/`、`docs/copy-language-guidelines.md`。
- 提交只点名文件；英文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Comments
### 2026-10-20 交付与合入

- 代理交付，主会话验收后合入 main（`92158c8a` 界面、`d1470359` 设计文档）。期间另一个会话往 main 提交了助手卡片与按压动效的改动，rebase 后重跑门禁：gui 189 个文件、2012 条测试全过，typecheck、lint、文档链接、`git diff --check` 都通过。
- 小字：新函数 `providerConnectionLabel`（`gui/src/lib/managed-model-preset-copy.ts`）。ChatGPT 写「ChatGPT 订阅」；按协议、authKind、地址三项对上官方 OpenAI / Anthropic 预设的写「官方 API」；其余写协议名。卡片悬停时显示「小字 · 地址」。
- 「添加」：`ManagedModelProviderAddMenu.tsx`（Radix DropdownMenu）。
  - 选中后，表单的预设一栏只读。
  - 表单有改动时，点「添加」不弹菜单，并提示「先保存或关闭当前编辑」；表单是干净的，就先关掉它再弹菜单。
  - 零服务商时不变。
- 与票面不一致、交给 JC 真机判断的地方：
  - 原来的下拉里本就没有逐项小字，所以菜单也没加；
  - 新增表单里换预设要先关掉表单、重新从「添加」选，已填的密钥会丢（以前在下拉里换预设会保留密钥）；
  - 菜单宽度固定为 320px，这个数是估的。

- 2026-10-20 真机：服务商小字、「添加」菜单的选择与拦截、改地址后小字跟着变都没问题（JC）。发现菜单只露出 7 项、看不出能滚，按 PRD 裁决 17 改成单行加渐隐兜底，已交回代理。
