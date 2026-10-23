# 02 GUI：删掉 Goal 的全部界面与状态

Status: done（2026-10-13，执行记录见 Comments）
Blocked by: 无

先读 [PRD](../PRD.md) 的「契约」一节（写死，本票必须照做）。本票只碰 `gui/`。

## 工作位置（硬约束）

- **只在 worktree 里工作**：`/private/tmp/claude-501/-Users-inkstone-Documents-genericagent-webui/ab7a31ac-a0f8-4206-b6ee-0c4affeea868/scratchpad/wt-remove-goal`（下称 `$WT`）。
  `$WT/gui/node_modules` 已装好。
- **绝不碰主工作树** `~/Documents/genericagent-webui`：JC 的 `pnpm tauri dev` 常驻在那里，
  改它会让正在用的窗口热更新。
- **不跑 `tauri dev` / `pnpm dev`**，不 commit，不 push，不改别的票的域（`core/`、`cli/`、`runner/`、`managed-ga/`、
  `remote-protocol/`、`ios/`、`docs/`、`README*`、`scripts/`、`.scratch/` 除本票 Comments）。
- 另外三张票与你同时在 `$WT` 里改各自目录，别碰它们的文件。

## 改什么

### 删除的文件

`gui/src/components/conversation/{ComposerGoalControls,ComposerGoalEyebrow,GoalCeilingWheel,GoalRunMarkers}.tsx`、
`gui/src/components/layout/header/GoalIndicator.tsx`、`gui/src/hooks/{useComposerGoal,useGoalActions,useGoalEffects}.ts`、
`gui/src/lib/{goal-run-groups,goal-thread,goals}.ts` 及各自的 `.test.ts`、`gui/src/types/goal.ts`。
`GoalPausedTail` 若在别的文件里，一并删。

### 要改的文件（`grep -ric goal gui/src`，2026-10-13 计数，从大到小）

`i18n/locales/en.ts`（73）、`i18n/locales/zh.ts`（68）、`conversation/Composer.tsx`（54）、`screens/MainView.tsx`（51）、
`App.tsx`（46）、`sidebar/SidebarSessionRow.tsx`（41）、`conversation/Conversation.tsx`（39）、`error-card/ErrorCard.tsx`（20）、
`header/StatusCluster.tsx`（17）、`layout/MainHeader.tsx`（15）、`stores/prefs.ts`（14）、`layout/MainHeaderHost.tsx`（14）、
`conversation/ComposerActionSlot.tsx`（14）、`lib/notify.test.ts`（13）、`conversation/composer-props.ts`（12）、
`lib/composer-hint.test.ts`（11）、`conversation/ComposerFooterHint.tsx`（11）、`lib/run-groups.ts`（10）、
`hooks/useSessionsAttention.ts`（10）、`settings/SettingsGeneral.tsx`（10）、`screens/EmptyState.tsx`（10）、`lib/notify.ts`（9）、
`lib/ipc/ga-output-cleaning.test.ts`（9）、`lib/composer-hint.ts`（9）、`lib/run-groups.test.ts`（8）、`layout/Sidebar.tsx`（8）、
`lib/rail-preview.ts`（7）、`lib/ipc/ga-output-cleaning.ts`（7）、`conversation/SystemMessageBubble.tsx`（7），
以及计数 1–6 的约 60 个文件（`types/{conversation,db,ipc,app-error}.ts`、`stores/prefs.test.ts`、
`stores/messages/rowsToTurns(.test).ts`、`lib/step-limit(.test).ts`、`StepLimitTail.tsx`、`settings/{Settings,SettingsHost,SettingsShortcuts}.tsx`、
`sidebar/*`、`stores/messages.ts`、`lib/ipc-handlers(.test/.step-limit.test).ts`、`styles/globals.css`、
`stores/sessions/lifecycle-slice.ts`、`stores/runtime/bridge-slice.ts`、`test/factories.ts` 等）。很多只是注释里拿 Goal 当参照，
改写成不提 Goal 即可。

## 怎么改（行为写死）

1. **Tauri 命令与事件**：删掉对 8 个命令的全部调用——`list_active_goals`、`list_visible_goals`、`list_goals_for_session`、
   `goal_status`、`mark_goal_result_seen`、`request_goal_stop`、`start_session_goal`、`extend_goal`；删 `goal-updated`
   监听；删 5 秒轮询兜底。
2. **类型**：删 `types/goal.ts`；消息行（`types/db.ts`、`types/conversation.ts` 等）去掉 `goal_id` / `goalId`；
   `types/ipc.ts` 的 `turn_end.goalStatus` 删除（runner 与 Core 两边由别的票删，三边要一致）。
3. **输入框**：任何地方都没有 Goal 入口——加号菜单里的项、Goal 模式开关、眉标、上限滚轮 / 自定义框、发送按钮的
   Goal 变体、底部提示里的 Goal 文案都删。普通发送不变。`EmptyState` 的 Goal 提交路径（`onGoalSubmit`、
   `hasActiveGoal`）删除。
4. **顶栏**：`GoalIndicator` 从状态簇里拿掉，不补别的东西。
5. **侧栏**：会话行 / 时间线里的 goal 状态、徽标、未读 goal 结果都删；四态（等你回复 / 出错 / 运行中 / 未读）不变。
6. **对话**：goal 委派 / 收口标记、goal-thread 括段、`GoalPausedTail`、goal 的 live 窗口那一层
   （`goal-run-groups.ts`）全删，`buildRunGroups`（`lib/run-groups.ts`）成为唯一的分组。历史 goal 会话按普通的
   用户 / 智能体轮次显示。`MainView` 的 in-flight rail「窗口里已有落定步」判断是通用逻辑，保留。
7. **步数上限尾标**：`lib/step-limit.ts` 删 `hasOpenGoal` 输入，其余判断不变；`StepLimitTail.tsx` 注释里的参照改掉。
8. **通知**：`lib/notify.ts` 删 `goalEnd` 这一类；设置 → 通用 → 通知去掉「Goal 结束或需要介入时通知」那一行，
   `anyNotifyEnabled` 只看 `notifyOnReplyDone`（提示音开关在它关时变灰，照原规则）。`stores/prefs.ts` 删
   `notifyOnGoalEnd` 的类型、默认值、setter、hydrate；库里的 `notify_on_goal_end` 值留着、不再读。
9. **注意力与错误**：`useSessionsAttention` 不再数 goal 结果；`ErrorCard` / `types/app-error.ts` 删 goal 错误类型。
10. **输出清洗（唯一保留的 goal 痕迹）**：`lib/ipc/ga-output-cleaning.ts` 里 `goal-status` 现在出现在四处——
    `GA_TAG_PATTERNS`（:15）、`GA_TAG_NAMES`（:206）、`extractPreamble`（:582 与 :602）。**只保留 `GA_TAG_PATTERNS`
    那一条**，注释改写为：Goal 已于 2026-10-13 移除，旧会话落库的回答末尾还带着这个完整标签，渲染时照剥。其余三处删掉。
    先核实渲染**落库**智能体行 `content` 的那条路径确实经过 `GA_TAG_PATTERNS`（本机 4 条历史行的标签都在
    `content` 里，`final_answer` / `summary` 里没有）；再在 `ga-output-cleaning.test.ts` 留一条用例：带完整
    `<goal-status>complete</goal-status>` 的回答经该函数后不含标签。
11. **i18n**：`en.ts` 与 `zh.ts` 删掉全部 goal 键，**不新增键**。剩下的文案里若有句子提到 Goal（例如某段说明里的
    「…或 Goal…」），改成去掉 Goal 的说法；每条「改了而不是删了」的文案在回报里列 zh / en 前后对照。中文用全角标点。
12. **快捷键**：`SettingsShortcuts.tsx` 若有 Goal 相关项，删除。

## 别动什么

- 不对旧文件整篇跑 prettier（`gui/` 不是 prettier-clean，会重排无关行）；只整理你自己的 hunk。
- React 编译器 lint 规则：effect 里同步 setState、渲染期 `Date.now()` 都会报 error；删代码时别把现有的
  guarded setState-in-render 写法改坏。
- 不改 `run-groups.ts` 的形状判定本身，只删它与 goal 层的衔接。
- 不碰 `gui/src-tauri`（若存在）与 Rust 代码。

## 验证命令（都在 `$WT` 下）

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
node scripts/check-ipc-protocol-drift.mjs     # runner / Core 票没落地前可能因它们而红，回报里说明
git diff --check -- gui
grep -rn -i "goal" gui/src
```

最后一条的剩余命中逐条说明理由（允许：`GA_TAG_PATTERNS` 那一条及其注释与测试、与 Goal 功能无关的普通英文词）。

## 回报格式

1. 删除的文件列表；
2. 每个改动文件一行摘要（注释-only 的可以合并成一行列文件名）；
3. 第 10 条的核实结果：落库行渲染走哪个函数（`file:line`）、新增 / 保留的测试名；
4. i18n：删掉的键数（zh / en 各多少，应相等）；改写的文案 zh / en 前后对照；
5. grep 剩余命中与理由；
6. 每条验证命令的结尾输出；
7. 需要 JC 真机看的视觉变化清单（输入框、顶栏、侧栏、设置 → 通知、空状态等，每处一句话）；
8. 域外看到的问题（只报不改）。

## Comments

**2026-10-13 · 票 02 执行记录**

结论：完成。删 15 个 Goal 专属文件（含 3 个测试文件），改 79 个文件。`goal-run-groups.ts` 里的通用部分（按位置编步号、live 窗口判定、「窗口里已有落定步」）并入 `lib/run-groups.ts`（`runStepNumbers` / `liveRunGroup` / `liveWindowHasSettledStep`），`buildRunGroups` 去掉 `goalId` 衔接。i18n 两边各删 62 键、不新增；`goalNarration`、`imageBlockedGoal` 仍被非 Goal 代码使用，改名为 `narration`、`imageBlockedSideOrReply`（键数不变）；系统行 variant `"goal"` 改名 `"narration"`。第 10 条核实与票面前提有出入：落库智能体行渲染读的是 `final_answer`（`rowsToTurns.ts:85`，只经 `normalizeFinalAnswer` 把空白归为 null，不剥标签），本机 4 条带标签行的 `final_answer` 本就干净，`content` 不经 GUI 渲染；保留的 `GA_TAG_PATTERNS` 一条护的是直播路径（`ipc-handlers.ts:814` 的 `cleanFinalAnswer` 及 `cleanPartialContent` / `stripGATags`）——重开旧会话时 Core 把带标签的 `content` 回放进模型历史，新回复可能照抄。注释按此写。

验证：typecheck / lint 0 错；vitest 113 文件 1101 例全过；drift 门禁过（三边已对齐）；`git diff --check -- gui` 干净；`grep -rni goal gui/src` 剩 8 行，均为允许项。
