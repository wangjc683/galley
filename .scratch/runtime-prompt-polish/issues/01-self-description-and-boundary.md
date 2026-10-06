# 01 常驻部分：About 更新、能力边界、措辞清理

Status: done（2026-10-06 实施；真机回归清单第 10–13 条待 JC 在 `tauri dev` 里跑）

改动（`core/src/managed_prompt.rs`）：

- **About Galley** 重写：定位改为「跑在用户自己电脑上的个人 AI 助手，你就是这个助手」；引擎称「内核 / engine」，
  只在用户问底层时提一次 GenericAgent（文案规范的 GA 预算）。加一张按界面位置组织的功能地图（侧栏 / 输入框 / 阅读面板 /
  Settings 全部九页，标签按 `gui/src/i18n/locales/zh.ts`、`en.ts` 核实），加「地图之外的界面不要描述得像亲眼见过，说去哪里看」
  和 Releases 链接。
- **作者条款改成指令写法**：去掉「a somewhat mysterious figure」「the mystery is part of the answer」这类可整句复述的台词，
  改为「只知道这些；被追问时用自己的话说不知道，可以带一点神秘感」。闭世界规则不变。
- **新节 What Only The User Changes In Galley**：模型提供商与 API Key、Channels、定时任务、浏览器控制与插件、运行时、
  更新、显示只能由用户在界面里改；被要求改时不经文件 / 脚本 / 浏览器去试，不说「已完成」，指路并备好用户要填的内容。
  另加「问你能做什么时只说本会话里确认有的能力」。边界只划配置面：IM 入口层本来就让 agent 用 CLI 写操作当 Supervisor
  （`session new`、`project create`、`goal`、`llm set`），不在禁止之列。
- **过去的对话**一节的 IM 列表补上 Telegram、Discord。

体量：静态规则 724 → 1028 词（+304；讨论时估 +150，偏差来自作者条款重写、边界一节与 Settings 全列）。`PROMPT_PROFILE_ID` 不变
（照 09-09、10-01 先例），哈希随静态规则变化，只作诊断。

测试：`managed_prompt` 新增两条（两种表面都带地图、边界、指令式作者条款且不含原台词；列举 IM 平台的两节都含四个渠道），
13 条全过。
