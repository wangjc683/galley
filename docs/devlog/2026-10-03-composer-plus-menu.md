# Composer 打磨：＋ 菜单收纳文件与提示词、Goal 切换钮降为无底色

Date: 2026-10-03
Status: implemented; JC live-accepted in `tauri dev`（「整体满意」）; unreleased
Related: [conversation §4.4](../design/conversation.md)（＋ 菜单、常用提示词入口、Goal 模式）、
[file-drop PRD](../../.scratch/composer-file-drop/PRD.md)（定案 1 / 10）、
[06-29 常用提示词](./2026-06-29-composer-saved-prompts.md)、
[09-17 Goal 去确认框](./2026-09-17-composer-goal-mode-no-dialog.md)

## 起因

JC 想打磨 Composer 的细节，尤其是常用提示词和添加文件这两个按钮：怎么设计、放在哪里，
才能让普通用户心智负担低，同时功能又够得着。

## 事实底座

- **现状**：按钮行右侧四颗 32px 圆——🔖 常用提示词 · 📎（菜单「添加图片 / 添加文件…」）
  ｜ ◎ Goal ｜ ↑ 发送。前两颗是一组，组内间距 0、组间 6px（`gap-0` / `gap-1.5`），肉眼
  几乎分不出组。四颗都不带字，其中书签与靶心不是通用隐喻。
- **workbench.db**（只读，2026-05-15 至 10-01，391 条 GUI 用户消息）：

  | 指标 | 数 |
  |---|---|
  | 以预设正文开头的消息 | 0 |
  | 自定义提示词 | 0 条（`saved_prompts_v1` 为空） |
  | 图片附件 | 1 次 |
  | 含 `/Users/` 路径的消息 | 8 条 |

  JC 是开发者兼 dogfood，这组数说明不了新手怎么用；但它说明常驻的书签在重度用户身上
  回报为零，价值全押在新手发现上——而新手恰恰最难读懂书签。
- **真机截图**（新对话、空草稿）：◎ 是 `bg-surface` + 描边 + `shadow-neutral-control` 的
  凸起键，发送钮此时未点亮（`bg-hover` 平面灰圆、`shadow-none`）。整行最像「能按」的是
  Goal，不是发送。

## 诊断

1. **📎 菜单是一道用户看不懂的选择题。** 「添加图片」= 内容进模型，「添加文件…」= 插路径。
   同一张 PNG 拖进来、粘贴进来都是图片附件，从「添加文件…」进来却是模型看不到的路径——
   三个入口两套规则。issue 04 的理由「菜单项已显式承载意图」写于菜单项叫「引用文件…」的
   时期；定案 10 把文案改成「添加文件…」后，「引用」这个意图词已经不在，理由随之失效。
   定案 10 末条「令牌立刻可见、行为自解释」——令牌说明的是「文件加上了」，不是「AI
   看不到这张图」。
2. **点击路径选不了文件夹。** `openFileDialog({ multiple: true })` 只选文件；三条差异化
   预设之一「整理本地文件」的正文要的正是「[粘贴文件夹路径]」。issue 04 写「需求出现再加
   『引用文件夹…』」——这个需求是我们自己的预设造成的，不是用户报的。
3. **书签图标语义错位。** `BookmarkSimple` 通常读作「收藏 / 稍后读」，这里的动作却是
   「从库里取一段话填进来」，点开是 920×680 的工作台 dialog：最重的动作藏在最轻的图标后面。
4. **常用者反而最慢。** 书签 → dialog → 找卡片 → 点 →（有草稿再确认）→ 手动删掉末尾的
   「[写下要查证的问题]」（不删就连方括号一起发出去）；没有键盘路径。

## 方案与裁决

原则：同一份内容给两种速度——一个看得懂的入口，加一条键盘快路。

- **A** 只修语义、不动布局：📎 改按扩展名分流 + 「文件夹…」，书签换图标。
- **B** 合并成 ＋：菜单三行「文件或图片… / 文件夹… / 常用提示词…」。代价是提示词从
  两次点击变三次。
- **C** B + `/` 快路（我推荐）：空输入框首字符 `/` 就地弹提示词列表。
- **D** 只留 `/`、拿掉可见入口（不推荐：对新手等于藏起提示词库）。

JC 逐条裁决：

1. 📎 按扩展名分流、加「文件夹…」——推翻定案 10 末条与 issue 04 的「picker 只选文件」。
2. 走 **B**；`/` 快路进 [deferred](./deferred.md)（本机自定义提示词为 0，受益者尚不存在）。
3. ＋ 放**左**：与 ChatGPT / Claude.ai 同位；左边是「放进什么、谁来回答」，右边只剩
   「怎么发」，＋ 离发送钮也远。
4. 填入预设后选中末尾的 `[…]`——第一轮说法 JC 没看懂，补了「事实查证」的实例后按建议做。
5. Goal 不进 ＋（ChatGPT 把 Deep research 放进 ＋ 是另一种取舍；Goal 是模式不是内容，
   armed 后整框换装，需要一个常驻开关）。

接着 JC 要求看 Goal 按钮本身的样式与手感。诊断三条：空草稿时层级倒挂（见事实底座）；
它用的是发送键同一套按键手感（悬停上浮、按下下沉），读作「执行动作」，而它其实是开关；
15px 细线靶心放在圆钮里像录制键或单选框，tooltip「作为 Goal 运行」是用功能名解释功能名。
两个方案：**G1** 降为无底色图标钮（与 ＋ 同族，armed 的 × 不变）；**G2** 带字开关
「◎ Goal」、armed 时按下锁住（我推荐，能顺带解决图标难认）。**JC 选 G1**；tooltip 按建议改成
「名称 · 结果」句式，与上限 pill 同腔。

## 落地

- **`ComposerAddMenu`**（由 `ComposerAttachButton` 改名重写）：`Plus` thin 17px 无底色圆钮，
  菜单向上开、左对齐；关闭时焦点回输入框（保留原选区），打开提示词库时不抢焦点（同
  `SessionTitleMenu` 改名用的 ref 标记）。
- **`SavedPromptDialogs`**（由 `SavedPromptControl` 改名）：去掉书签触发钮，开合状态归
  Composer；「替换草稿」确认按钮的图标随之换成 `BookOpenText`。
- **`useImageAttachments`**：去掉隐藏的 `<input type=file>` 与 `IMAGE_ACCEPT`，新增
  `acceptPickedPaths`，与拖放共用 `splitDropPaths`。不支持图片的运行时，选中的图片作路径
  引用（标签没许诺图片）；拖放仍按原规则拒收并提示。
- **文件两行不受运行中门控**：07-05 给 📎 加 `stopMode` 门控时，运行中 Enter 还不能发送；
  有了消息队列（galley#19/#20）后路径引用是纯文本、可以排队，与拖放一致。运行中带图片
  发送仍在发送处被拦（既有规则）。
- **填空选中**：`findPromptFillSlot`（`lib/saved-prompts.ts`，只认独占最后一行的方括号）+
  `applyComposerText` 的 `selection` 选项。
- **Goal**：未 armed 用 `COMPOSER_TERTIARY_ICON_BUTTON` + `Target` 17px；`COMPOSER_GOAL_BUTTON`
  删除；armed 的 × 保持 `bg-elevated` 圆。设计文档写下规则：Composer 里凸起的键只留给发送位，
  armed × 是唯一例外。
- **＋ 紧贴模型短语**：第一版沿用行间距 `gap-2`，截图量得 ＋ 与 ⚡ 之间视觉空白约 31px
  （右侧 ◎ 到发送圆约 16px），读作离群控件；改为与模型短语同一个无间距 flex。
- **文案**（zh / en）：tooltip「添加文件或提示词」、菜单「文件或图片…」（无图运行时
  「文件…」）/「文件夹…」/「常用提示词…」；Goal tooltip「Goal · 让 Galley 自己一直做到
  完成」。删掉 `attachImage` / `attachTooltip` / `referenceFiles` / `savedPrompts.trigger`。
- 运行时影响：外置与内置都只改 GUI；外置模式下 ＋ 第一行写「文件…」、行为与旧版 📎 直达
  一致，并多了「文件夹…」。Core / CLI / runner 不动。

## 验证

- `pnpm --dir gui typecheck` / `lint` / vitest 全量（含新增 2 条 `findPromptFillSlot` 用例）/
  `git diff --check` 通过。
- tauri dev 截图看按钮行；Vite 页面 + Playwright（缺 Tauri 运行时，只验纯前端链路）：
  ＋ → 「Saved prompts…」→ 点「Check facts」，输入框获焦并选中
  `[Write the question to verify]`。
- 未验：原生文件 / 文件夹面板（无头环境没有 Tauri）、Windows（已更新
  [windows-build-checklist](../windows-build-checklist.md) 的对应项）。

## 插曲

改名（`git mv`）先于改 import 落盘，Vite 在中间态整页重载、撞上缺失模块，tauri dev 窗口
变成空白；之后的热更新救不回来，touch `gui/index.html` 触发一次整页重载后恢复。下次改名与
import 一次改完再保存。

## 被否

- **C 的 `/` 快路**：进 deferred，启动信号见台账。
- **D**、**A**：见上。
- **G2 带字开关**：JC 取更安静的 G1。
- **Goal 进 ＋ 菜单**：见裁决 5。
