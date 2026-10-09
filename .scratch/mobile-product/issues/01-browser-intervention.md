# 01 浏览器任务要人介入：现有「在问你」能承载多少

Type: research
Status: resolved（2026-10-09 读码；桌面渲染一处为静态推断未真机验，见答案末尾）
裁决（JC，2026-10-09）：带图的提问走 A 约定式；滑块 / 拖拽类验证定为非目标，不做手机远程操作浏览器。

问题：助理在电脑上用登录态浏览器干活，卡在验证码、二次验证、扫码登录、确认支付时，人在手机上。
内置运行时现有的 `ask_user` 能不能承载？缺什么？

## Answer

### 现状

- **`ask_user` 是纯文本问答。** 工具签名只有 `question` 与可选 `candidates`（`managed-ga/code/ga.py:107-110`）；返回 `INTERRUPT / HUMAN_INTERVENTION`，
  GA 退出循环等下一条用户消息（`ga.py:352-357`）。runner 事件 `AskUserEvent` 只带 `question`、`candidates`（`runner/ipc.py:184-189`）；
  Core 的 `AskUserBrief` 同形（`core/src/api/message.rs:116-147`）。回答就是下一条文本消息（`runner/ipc.py:380`）。没有图片、没有「这是什么类型的介入」。
- **桌面把问题当 Markdown 渲染。** `AskUserBubble` 走 `MarkdownView`（`gui/src/components/conversation/AskUserBubble.tsx:55-66`、`:97-101`），
  而 `MarkdownImage` 会把绝对本地路径转成 Tauri asset URL（`gui/src/lib/markdown-image-src.ts:65-75`）。
  **静态推断**：问题里写 `![验证码](/abs/path.png)` 今天就能在桌面显示图；未真机验。
- **`[FILE:…]` 标记不是桌面的图片通道。** runner 与 GUI 都把它剥掉（`runner/workbench_bridge.py:173`、`gui/src/lib/ipc/ga-output-cleaning.ts` 第 4 步）；
  它是 IM 的文件通道（飞书补丁 0012 按标记发文件）。
- **助理自己看不见截图。** 浏览器工具只有 `web_scan`、`web_execute_js`（`ga.py:359`、`:374`），截图靠 CDP `Page.captureScreenshot`
  或 `canvas.toDataURL()`（种子记忆 `managed-ga/state-seed/memory/tmwebdriver_sop.md:122-124`，标「已验证」）。
  模型的图片输入只有用户附件一条路（`managed-ga/code/llmcore.py:796-848`、补丁 0008）；`file_read` 没有图片分支。
  所以图形验证码只能人看。
- **提示词没有登录墙的指引。** `core/src/managed_prompt.rs` 与 GA 提示词都没有「遇到二次验证 / 扫码 / 支付确认时怎么问」的条款，模型临场发挥。
- **上游的真浏览器本身挡掉一部分。** README 展示 hCaptcha 在真浏览器里直接过、reCAPTCHA v3 得 0.9 分（`managed-ga/code/README.md:77-85`、`:371-373`）。
  残留的是必须人参与的那几类。
- **IM 侧的提问显示**：候选项按行数与字数选 chips 或列表、文本作答（`managed-ga/code/frontends/galley_im_display.py:147-185`）。手机端可照抄这套布局规则。

### 介入类型对表

| 介入 | 人要做什么 | 现有 `ask_user` | 缺口 |
|---|---|---|---|
| 短信 / 验证器二次验证 | 把手机上收到的码告诉它 | 覆盖：文本问、文本答 | 无。**这是手机端最强的用例：码本来就在手机上** |
| 确认不可逆操作（支付、发送、删除） | 点「确认」 | 覆盖：问题 + 候选项 | 无 |
| 扫码登录（微信 / 支付宝） | 在手机上看到二维码并识别 | 不覆盖 | 问题要能带图；同一部手机可长按识别图中二维码，不必扫 |
| 图形验证码（字符、选图） | 看图，答字符或「第 2、5 张」 | 不覆盖 | 问题要能带图；回答仍是文本，助理按答案点 |
| 滑块 / 拖拽验证 | 做一个指针动作 | 不覆盖 | 不靠问答能解；需要远程操作浏览器，**不做**（见非目标） |

结论：五类里两类今天就通，两类只差「问题带一张图」，一类放弃。缺口只有一个：**带图的提问**。

### 方案

- **A. 约定式（推荐）。** 不改 `ask_user` 签名。提示词加一条：需要用户看图作答时，把截图存到会话工作目录，在 `question` 里用 Markdown 图片引用。
  桌面按现有 `MarkdownImage` 渲染（先真机验一次）；Core 从问题里抽出本地图片路径，经远程模块把图片字节送到手机（手机读不到电脑文件系统）。
  改动：提示词一条、Core 抽图一处、手机端渲染。符合「补丁最小、优先用显式扩展缝」（Rule 1）。
- **B. 显式参数。** 托管补丁给 `ask_user` 加可选 `image_path`，`AskUserEvent` / `AskUserBrief` 各加一个可空字段（契约内加字段，Rule 3 允许）。
  结构更清楚，但多一个 GA 补丁与一条 IPC 字段，而 A 已够用；A 的渲染真机验证不过再转 B。
- **非目标**：手机远程操作电脑浏览器（截图流 + 指针回传）。滑块验证留给助理在 CDP 里试，试不过就报告放弃。

### 对下游的要求

- iOS 票 07「回答提问」要支持：文本作答、候选项（含多选，`MULTI_SELECT_RE`）、问题上方一张图。
- iOS 票 08「Core 通知判断」：「在问你」已是四类之一；二次验证码有时效，P1 的时效性级别（裁决 17）应优先给这一类。
- 新增提示词条款进 Galley 的分层（准入、字节预算、台账、回归清单），属浏览器控制一节。
- 第一步是最廉价的真机验证：在桌面上让模型 `ask_user` 一个带 `![](绝对路径)` 的问题，看 `AskUserBubble` 是否显示图。

### 边界

- 读码范围：`managed-ga/code/ga.py`、`runner/ipc.py`、`runner/workbench_bridge.py`、`core/src/api/message.rs`、`gui/src/components/conversation/AskUserBubble.tsx`、
  `gui/src/lib/markdown-image-src.ts`、`managed-ga/code/llmcore.py`、种子记忆 `tmwebdriver_sop.md`。
- 没有查数据库里历史上 `ask_user` 出现过多少次登录 / 验证类问题；要估频率可在 `workbench.db` 的 `messages.tool_calls` 里按 `ask_user` 问题文本搜「验证码 / 登录 / 确认」。
