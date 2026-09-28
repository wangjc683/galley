# 01 回答操作栏四档临时切换器（现状 / 悬停 / 最新常显 / 精简）

Status: done

先读 `../PRD.md`。本票做四档变体和一个临时切换器，给 JC 真机比较。只改 `gui/`，不 commit。

## 改哪些文件

- `gui/src/components/conversation/MessageActions.tsx`（主要改动）
- `gui/src/components/conversation/MessageAgent.tsx`（透传「是否最新回答」、悬停区域）
- `gui/src/components/conversation/Conversation.tsx`（算出哪一条是最新回答；挂载切换器）
- `gui/src/i18n/locales/zh.ts`、`en.ts`（仅当 C 的合并提示需要新文案时）
- 新建临时文件：切换器状态（例如 `gui/src/lib/action-bar-variant.ts`）与切换器组件
  （例如 `gui/src/components/conversation/ActionBarVariantPill.tsx`）。所有临时代码带
  `TEMP(answer-action-bar)` 注释，方便事后 grep 拆除。

## 四档

- **现状**（`current`）：不变，作对照。
- **A 悬停**（`hover`）：整条栏平时不可见，悬停该回答（答案正文 + 栏所在的
  `MessageAgent` 外层）或栏内有焦点时显示。隐藏时**保留占位**（`opacity-0` +
  `pointer-events-none`），不能让悬停引起位移。复制 / 保存处于「已复制 / 已保存」反馈
  期间保持可见。显隐瞬时切换即可（`ActionChip` 本身 `transition-none`），用 CSS
  `group-hover` / `focus-within` 实现最简单。
- **B 最新常显**（`latest`）：对话里最后一条带操作栏的回答常显（同现状），其余同 A。
  「最后一条」= 当前渲染出来的、会显示 `MessageActions` 的最后一个回答；新一轮运行
  还没出最终回答时，上一条仍是最新。由 `Conversation` 算出后经 `MessageAgent` 传入。
- **C 精简**（`compact`，默认）：栏常显，内容改为：
  - 复制、保存两个 chip 不变；
  - 竖分隔线保留（区分「动作」和「信息」）；
  - token 与上下文数字**不再常显**，只剩一个 `Gauge` 图标（与现在上下文用的同一个
    图标、同尺寸、同墨色）。悬停该图标，tooltip 合并显示现在三个 tooltip 的内容：
    输入（含缓存拆分）、输出、上下文用量 + 现有的灰色注释行。沿用现在的两层 tooltip
    写法（`AnswerTelemetry` 里 context tip 的结构），自行排版成几行；
  - **上下文占用 ≥ 50% 时**，图标后常显百分比文字（样式同现在的百分比）。判断用
    `telemetry.ts` 里现成的读数（`readContextChars` 或 `contextUsageTokens` 等，
    必要时在 `lib/telemetry.ts` 加一个导出的小函数并补单测），门槛写成命名常量；
  - 没有上下文数据但有 token 时，仍显示图标（tooltip 只含 token）；什么 telemetry 都
    没有时，和现在一样：没有分隔线、没有图标。

## 切换器（TEMP）

- 常驻、可点击的分段 pill，只在 `import.meta.env.DEV` 下渲染；一组「回答操作栏：
  现状 / 悬停 / 最新常显 / 精简」，默认精简。当前项高亮。
- 选值存 `localStorage`（新 key），读写包 try/catch；非开发构建一律用精简，不读存储。
- 位置与挂载方式参照上一个切换器的做法：通过 portal 挂进 MainView 滚动列外层带定位
  的容器（`anchor.closest(".overflow-y-auto")?.parentElement`），`absolute bottom-4
  left-3`，用 `@/components/ui/segmented-control` 的 `SegmentedControl`（`size="sm"`）。
  不遮挡输入框、问题轨、回到底部按钮、运行计时。
- 状态可用小 zustand store（参照 `gui/src/stores/` 里的写法）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
```

全部贴输出尾部。不要启动 `tauri dev`，JC 自己真机看。

## 别动什么

- 不碰 `gui/` 以外；不动 `MessageUser`、发送时间相关代码、`ActionChip` 的皮肤与行为、
  折叠头、问题轨。
- gui ESLint 带 React 编译器规则：渲染期不能调 `Date.now()`，effect 体内不能同步
  setState，组件文件不能导出非组件函数（工具函数放 `lib/`）。
- **不要对既有文件跑 `prettier --write` / `pnpm --dir gui format`**：`gui/src` 不是
  prettier-clean。新文件可以整篇格式化，旧文件只保证自己写的 hunk 风格一致。
- tailwind-merge 注意：字号 class 排在 `leading-*` 之后会把 `leading-*` 吞掉；用
  `cn()` 拼 class 时字号在前，拼完自己核对。
- 注释密度与语气跟周边一致；写理由用 PRD 里的理由，不要把你推断的理由写成 JC 的裁决。
- 不写 docs / devlog；不 commit；工作区里与本票无关的改动不要碰。

## 回报格式

1. 改动文件清单，每个一句话。
2. 票面没写清、你自己做的决定（逐条，附理由）。
3. 验证命令输出尾部。
4. 切换器在哪、怎么用、拆除时要删哪些（grep `TEMP(answer-action-bar)` 能否删干净），
   以及每一档胜出时要保留 / 删除的代码。
5. 注意到但没处理的边角或风险。

## Comments

### 2026-09-28 实现（子代理，未提交）

- 已做：四档变体 + 临时切换器。`MessageActions` 读切换器状态：A / B 在栏的外层 div 上加 `opacity-0 pointer-events-none`，由 `MessageAgent` 外层的 `group/answer` 悬停或 `focus-within` 显示，已复制 / 已保存反馈期间强制可见；C 换成 `CompactTelemetry`（单个 Gauge 图标，合并提示为「输入 / 输出 / 上下文」三行 + 灰色注释）。`Conversation` 按 `AgentTurnView` 的同一组条件（非空回答、只剩 `no_tool`（ask_user 除外）、非 Goal 步骤、非泄漏标记）从尾部找最新回答，经 `AgentTurnView` → `MessageAgent` → `MessageActions` 传 `latest`。`lib/telemetry.ts` 加 `CONTEXT_USAGE_REMINDER_PERCENT = 50` 与 `contextUsageNeedsReminder`（按标签同样的取整比较，49.6% 显示为 50%，算在内），补 1 条单测。
- 切换器：`ActionBarVariantPill.tsx` + `lib/action-bar-variant.ts`，仅 dev 渲染，挂在对话区左下角；localStorage key `galley_temp_answer_action_bar_variant`。`grep -rn "TEMP(answer-action-bar)" gui/src` 列出全部改动点（胜出档的代码也带标记，裁决后去掉标记）。
- 自定：C 的图标悬停区扩到 24px 高、左右各 4px（`-mx-1 h-6 px-1`，字形位置不变），因为它是看 token 的唯一入口；`Metric` 的 children 改为可选、加 `className` 合并。zh / en 文案未改，现有词条够用。
- 待真机看：A / B 的悬停区只含回答正文 + 栏，不含上方分隔线与折叠头；ask_user 提问轮若带正文，现在就会显示操作栏，B 下它会成为「最新」；切换器在窄窗口会盖住对话列左下角的最后几行。
