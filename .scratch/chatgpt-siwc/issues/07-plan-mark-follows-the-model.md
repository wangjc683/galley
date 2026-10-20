# 07 · 订阅标志跟着模型走：⌘K「切换模型」与「我的模型」补标志，⌘K 补同名规则

Status: ready-for-agent

来源：[PRD](../PRD.md) 裁决 18（2026-10-20）。只动界面，合入时 Core 不用重启。

## 规则

界面上出现一个会花 ChatGPT 订阅额度的模型，名字前就放 ChatGPT 标志（`ChatGptMark`，`gui/src/components/conversation/ChatGptPlanMark.tsx`）。服务商身份不放：服务商卡、「添加」菜单、引导页网格都**不加**；其他服务商也不加 logo。现有两处是输入框的模型 pill 和模型菜单的行（`gui/src/components/conversation/LLMPill.tsx:165`、`:284`），这张票补另外两处。

## 1. ⌘K →「切换模型」

现状：`gui/src/components/overlay/CommandPalette.tsx` 的 `SwitchLLMPage`（约 705 行起），每行都是 `PaletteRow`，带 `Icon={Cube}` 和 `label={llm.displayName}`，不显示服务商。`LLMOption`（约 46 行）没有 `providerDisplayName` 字段；但 App 传进来的 `llms` 来自 `useLLMDisplay`，内置运行时的数据里有 `key`（托管模型 id）和 `providerDisplayName`（`gui/src/lib/managed-model-options.ts:30-36`）。外置运行时的列表是 GA 自己的，既没有服务商名，也没有订阅模型。

改成：

- **订阅行**：用标志代替 `Cube`，走 `PaletteRow` 现成的 `iconNode` 槽位。判定和模型菜单一样，用 `isChatGptPlanOption`（`gui/src/lib/llm-menu.ts`），订阅模型的集合用 `useChatGptPlanModelIds()`（`gui/src/hooks/useChatGptPlanModelIds.ts`）。这个 hook 在外置运行时返回空集，所以外置零变化。集合在 App 里取、作为 prop 传进 `CommandPalette`，还是在 `SwitchLLMPage` 里直接调 hook，按现有测试好不好写来定，在说明里写清楚。
  - 默认尺寸：标志 14px、`text-ink-muted`，放在一个 16px 宽、居中的盒子里，保证文字和别的行左边对齐。理由：别的行图标是 16px 的细线 `text-ink-soft`，实心标志用同样的墨色、同样的尺寸会显得更重。这两个值 JC 真机会看，写成容易改的样子即可。
- **同名规则**：与模型菜单共用 `providerLabelAlwaysShown(llms, planKeys)`。返回 true 的行在右侧显示服务商名，挂在勾号之前。规则是：同名、而标志又分不开（都走订阅或都不走）的行常显，其余行不显示。模型菜单里「悬停才浮出」的那一半**不移植**，⌘K 没有悬停浮出的语法。
  - `PaletteRow` 的 `sub` 注释写着「Never truncates, so only feed it bounded strings」，服务商名不是有界的（自定义服务商的显示名可能是一长串主机名）。要么加一个可截断、有上限宽度（约 160px，`title` 显示全文）的变体，要么另开一个槽位；不能把模型名挤没。
- **cmdk 的 `value`**：现在是 `` `llm ${llm.displayName}` ``，同名两行的 value 相同。先确认这在 cmdk 里会不会出问题：两行同时高亮、键盘选不到第二行、回车只触发第一行之类。有问题就让 value 唯一（例如带上 `llm.index` 或 `key`），同时保证这一页的搜索照旧能用；在说明里写清楚核实的结果。
- 当前项的勾号、点选后切换的行为不变。

## 2. 设置 → 模型 →「我的模型」的行

现状：`gui/src/components/screens/settings/models/ConfiguredModelsPanel.tsx` 约 410–433 行，行内是模型名（`display.title`），后面跟着「· 服务商名」的淡墨文字。

改成：订阅模型的行在名字前加标志，和模型菜单同款：13px、`text-ink-muted`，与名字隔 4px（菜单的写法是外层 `flex items-center gap-1`）。别的行不留空位。「· ChatGPT」照旧保留，这里的服务商名是常显的，规则不变。

- 判定：`chatGptPlanModelIds(models, statusByProvider)`（`gui/src/lib/chatgpt-plan.ts:220`）。**不按当前运行时过滤**：设置页列的是内置运行时的配置，外置运行时下也显示；服务商卡的「ChatGPT 订阅」小字同样只看记录、不看运行时（`providerConnectionLabel`）。所以这里不要直接用 `useChatGptPlanModelIds()`，它在外置运行时返回空集。服务商卡已经会去拉订阅状态（`ProviderCard.tsx` 约 129–132 行，`useChatGptPlanStore`）；如果这一页拿不到 `statusByProvider`，就照 hook 的做法 `ensureStatus` 一次。
- 拖动中、编辑中（名字变成 `text-brand-strong`）时标志的颜色不跟着变，保持 `text-ink-muted`。如果真机看着不对，JC 会提。

## 3. 设计文档

- `docs/design/conversation.md` 约 1046–1062 行「ChatGPT 订阅标志」一节：把「为什么破『无图标』」里的窄例外写成规则——标志跟着会花订阅额度的模型走（pill、模型菜单、⌘K、「我的模型」），不跟服务商走；服务商卡、「添加」菜单、引导页不放；其他服务商不加 logo。理由写一句：ChatGPT 标志就是 OpenAI 的花形标，给「OpenAI（官方 API）」也加，就成了一图两义。链接 PRD 裁决 18。
- `docs/design/overlays-and-settings.md`：
  - ⌘K「Action 类」里「切换模型」那一条（约 107 行）：补上订阅行的标志和同名规则，链回 conversation.md 的同名规则；
  - 「我的模型」行的说明（约 406 行，「Provider 名称是淡墨文字……」那一条）：补订阅行名字前的标志。
- 「`ChatGptMark`」组件顶部的注释（`ChatGptPlanMark.tsx`）列着标志用在哪里，同步补上 ⌘K 和「我的模型」。

## 测试

- `gui/src/lib/llm-menu.test.ts` 已经覆盖 `providerLabelAlwaysShown`，不用重测规则本身。
- ⌘K：订阅行渲染出 `data-role="chatgpt-mark"`、非订阅行没有；同名且标志分不开的两行都显示服务商名，标志分得开的两行都不显示。参考现有的 `CommandPalette.*.test.tsx`。如果 cmdk 的 value 改了，补一条「同名两行能分别被选中」。
- 「我的模型」：订阅行有标志、别的行没有；外置运行时下订阅行仍然有标志。

## 验证

在 worktree 根目录跑：

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check
```

中文全角标点：在 scratchpad 里你自己的子目录 `siwc07/` 写一个小脚本，扫 `git diff -U0` 的新增行，找「CJK 字符紧邻半角 `, ; : ? ! ( )`」，跳过代码块、行内反引号和 markdown 链接目标。hits 必须为 0。`Status:` 这类给工具读的英文键保持半角。

## 约束

- 只在给定的 worktree 里工作：不碰主工作树，不跑 `tauri dev`，不跑 `pnpm dev`。
- 只动 `gui/` 和 `docs/design/`，加上本票文件的 Comments 一节。不改 locale，这张票不需要新文案；如果发现确实需要，停下来在说明里写清楚。
- gui 不是 prettier-clean：不要对整个文件跑 `prettier --write` 或 `pnpm --dir gui format`，只保证自己写的 hunk 风格一致；新文件可以整篇格式化。
- React 编译器 lint 规则：effect 体内不能同步 setState，渲染期不能调 `Date.now()`；组件文件只导出组件，工具函数放 `lib/`。
- 动手前查设计禁令：`grep -n "不要\|有意\|分叉" docs/design/overlays-and-settings.md docs/design/conversation.md`，看命令面板、「我的模型」和模型菜单几节。有冲突写进说明，不要自己裁。
- 提交：在 worktree 分支上点名文件提交，禁用 `git add -A` / `git commit -a`。英文提交信息，界面和文档分两个提交（参考 `92158c8a`、`d1470359` 的写法），结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交后跑 `git log --oneline -3` 和 `git show --stat HEAD~1 HEAD`。

## 回报

在本票末尾加 `## Comments`，写一节「2026-10-20 交付」：

- 改了什么（file:line）；
- cmdk value 的核实结论；
- 订阅集合在 ⌘K 里怎么接进来的，为什么这么接；
- 门禁输出的摘要，包括测试文件数和条数；
- 与票面不一致、交给 JC 真机判断的地方；
- **没验证到的 / 未解决的风险**，单列一节，没有也写「无」；
- 给 JC 的真机步骤：⌘K 和设置页各自看什么、怎么造出同名的一对。

Status 改成 `needs-dogfood`，随界面提交一起提交。最后回报提交号（抄 `git log` 的输出）和上面这些内容。
