# GUI 大组件拆分 · 第三轮 + provider 表单双实现合并

- **Date**: 2026-07-22
- **Status**: completed
- **Related**: `gui/src/components/conversation/Composer.tsx` + `Composer*.tsx` / `composer-props.ts` / `hooks/useComposerGoal.ts` · `gui/src/stores/sessions.ts` + `stores/sessions/*` · `gui/src/lib/provider-setup.ts` · `components/managed-models/use-provider-setup-controller.ts` · `screens/onboarding/StepModelConfig.tsx` · `screens/settings/SettingsModels.tsx` · commits `d3416ad` / `b9a2ce4` / `7f02d3a`
- **Supersedes**: [2026-07-06 第二轮](./2026-07-06-gui-large-component-split-round-two.md) 中 "Composer 不抽 `useGoalArm` / `useGoalLaunch`" 的子结论(见下)

## Context

JC 让再排查一轮"过大、值得拆的组件"。量化 + 结构分析后定了三个目标,按风险从低到高执行、各自一个 commit:

1. `Composer.tsx`(1001 行单组件)→ 522;
2. `stores/sessions.ts`(1553 行单 `create()`)→ 59 行 merge 入口 + `stores/sessions/` 四 slice;
3. onboarding `StepModelConfig`(938)与 settings `use-provider-form-controller`(571)的**两套平行 provider 表单实现**合并——唯一"拆分同时消重"的项,也是唯一涉及行为的项。

明确不动的:`App.tsx`(1226 行,但已是"selector→hook→JSX"接线枢纽,再拆只是搬接线)、`MarkdownView`(内部已分块)、i18n locales。

## Decisions

### Composer:重开 07-06 "不抽 goal hook" 的子结论

07-06 判"goal-arming 与 handleSubmit/handleKeyDown 咬合,抽出是把纠缠挪到 prop 边界"。本轮抽了 `useComposerGoal`,但形态不同于当时否掉的方案:hook 只收编 goal 状态 + 三个 handler + 派生 flags,容器通过显式闭包(`getSubmittableText` / `resetDraftAfterSubmit` / `focusTextarea`)供依赖,`effectiveGoalArmed` 等 flags 仍回流容器喂 placeholder / keydown / submit 按钮——`handleSubmit` 的 goal 分支保留在容器。纠缠没有消失,但被收拢成一个可读的显式接口,而不是散在 780 行里。视图侧(GoalControls / FooterHint / ActionSlot / ImageStrip / DropOverlay / AttachButton)全部是 pure move;公共类型迁 `composer-props.ts` 后由 Composer 再导出,MainView / EmptyState 零改动。

### sessions store:slice 只能在同一个 create() 内

探索确认四个 state 字段交叉写入密集(`deleteProject` 同写 projects+sessions+filter、`emptyArchive` 调批量删除、`activateSession` 横跨全域),**拆独立 store 不可行**;落地为仓库第一个 StateCreator slice 模式:lifecycle / archive-delete / project / hydrate 四 slice 共享 `(set, get)`,`shared.ts` 放 wire 类型与跨 slice 工具,`SessionsSliceCreator<T>` 别名作为后续 store 的约定种子。公共导出面不变;`sessions.shape.test.ts` 断言 merge 展开不漏 slice。布局沿 `messages.ts` + `messages/` 旁挂文件夹先例,`@/stores/sessions` 引用路径零改动。

### provider 表单:settings controller 为基座,行为差异参数化

settings 侧是近超集(create+edit、codex 登录/登出、post-save 副作用),以它为基座建共享层:

- `lib/provider-setup.ts` 纯核心:指纹(connection 含 model、list 不含)、`canCommitProviderSetup` 门控谓词、`planAutoPick`、`runProviderCommit` / `runCodexComplete` 注入依赖编排器。该层配了单测——此前两套实现都零测试。
- `use-provider-setup-controller.ts` 共享 hook:**默认值 = settings 现行为**;onboarding 用参数开启其独有契约(800ms 防抖自动连接测试 + verifiedFingerprint 门控 Start CTA、auto-pick 重置测试、hostname 显示名回退、`trimCredentialsOnSave`、probe-status 提交呈现),行为规格对照 `docs/design/onboarding-and-cards.md` §Step 1。
- 旧 `SetupState` 状态机并入 `ProbeState`(action 增 `"commit"` 成员);`types.ts` / `model-settings-utils.ts` 留 re-export shim,12 个 settings 文件零 import 改动。
- **视图不合并**:卡片网格 vs popover 是 07-17 定的有意分化,合并止步于逻辑层。

hook 测试基础设施不存在(vitest node 环境、无 testing-library),所以可测逻辑全部压进纯函数层——这也是纯核心单独成文件的原因,不只是分层洁癖。

### 已知行为变化(验收确认可接受)

- onboarding 编辑 API Key / URL 现在清空已拉取的模型列表(与 settings 一致,800ms 后自动重拉;旧行为保留旧列表);
- onboarding 底部错误行由 action="start" 一条拆为 commit / codex(provider-test)两条,同位置互斥;
- settings 保存成功后 reset 表单与 expand+toast 的 state 更新顺序翻转,同一 React batch,不可观测。

## Rejected

- App.tsx 继续拆:接线枢纽,收益为负(维持 07-06 判断)。
- provider 表单加 `enableLogout` 开关:codexLogout 始终返回、onboarding 不渲染入口即可,少一个参数。
- 图片视图合成单个 `ComposerImageStrip`:五段 JSX 分散在四个 DOM 槽位,合并要么破坏布局要么引入 portal,按槽位拆三个文件。

## Verification

每 commit:`pnpm --dir gui typecheck` + `lint` + `vitest run`(171 → 186,新增 shape test + 14 个 provider-setup 单测)+ `git diff --check`;commit 3 内含中途检查点(settings 迁移后、onboarding 动工前全套验证)。JC 在真实 app 验收了 Composer 交互、onboarding Step 1、settings provider 流程后分三 commit 提交。
