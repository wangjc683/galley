# README 刷新：对齐 Goal v2、Agent API v2、设置改版与 09-09 之后的功能

**日期**：2026-10-07
**范围**：`README.md` / `README.zh-CN.md`、`CONTRIBUTING.md`、Supervisor SOP 与参考文档头部（含 4 份 skill 副本）、
两份 `SKILL.md`、skill README、`docs/architecture.md`、`docs/agent-api.md`；截图不动

## 背景

README 上一次实质改版是 2026-09-09（定位切到「Less harness. More model.」与截图 v2），之后发了
v0.4.13 … v0.6.0 共 11 个版本，main 上又有 10-06 / 10-07 两轮未发版改动。JC 要求全面排查后讨论怎么改。

排查分三路子代理逐条对代码（CLI / Agent API、GUI 功能、构建 / 技术栈 / 链接 / 截图），主会话抽查关键结论
（`goal.png` 实物、`gui/src` 里搜不到「min ago」、种子脚本的 goals 列、预设清单、打包依赖清单）。

## 审计结论

**写错了的**：

- Goal 卡与 Supervisor 段：「定时长与 Subagent 预算」。v2 没有 worker，只有时间上限（10–240 分钟、默认 60、
  可无上限），模型宣告完成即止。
- CLI 示例：`goal propose` / `goal run --confirm-token` / `goal deliverable get` 已退役（CLI 解析即失败）；
  注释里的「重启」没有对应命令。
- 「每条命令自动携带 origin 三元组」：只有写命令接受 `--supervisor` / `--reason`，不传是 `via=cli`。
- 「GUI 时间线标注 @ga-claude-1 · reason · 2 分钟前」：只存在于归档设计稿；现在是 Supervisor 图标 + 固定显示
  发送时间，supervisor 名与 reason 不显示。
- 工程笔记：「schemaVersion 自 0.2 冻结」；「任一端退出都不受影响」（GUI 与 Core 同进程，退出 app 后 Core 也停）；
  「IM channel 接同一套 Core 协议」（IM 里的模型以 supervisor 身份调 CLI）；「有序 migration 保证可重放」
  （真正兜底的是迁移前整目录备份）。
- 设置路径：外部 GA 入口多了「更多」一层；中文按 10-07 文案规则写「设置 → X」；「选择渠道」应为「选择服务商」。
- 定时任务漏了每月；Quick Start「先准备 API Key」对 ChatGPT / Codex 登录不成立；架构图「Galley prompt profile」
  正式名是 Galley Runtime Prompt。
- 构建段 `pnpm tauri build` 缺 `bundle-python.sh` 前置（Windows checklist 记录过同一报错，干净机器实测）。

**说少了**：工具时间线（完成的调用是一行，点开才见全文）、浏览器要装扩展、仅内置模式可用的功能、
架构图漏了 Core 托管的 IM 与浏览器桥常驻进程、`0600` 只在 Unix 成立、⌘K 在 Windows 是 Ctrl+K。

**没写进去的新功能**：图片输入、写出的文件从那一步打开、推理强度、思考实时预览、聊天软件手机优先、Claude Skill。

**README 以外的同类过时**：SOP 与参考文档头部、两份 `SKILL.md`、skill README、`architecture.md`、
`agent-api.md` 都还写「`schemaVersion: 1` 自 v0.2 冻结」；`CONTRIBUTING.md` 在仓库根跑 `cargo check`（根目录没有
`Cargo.toml`）。

## 决策（JC「按建议推进」）

1. **范围**：文字这轮全改；截图另记暂缓。JC 中途追加「截图先不动，不重拍」，截图区（含图注）原样保留，
   重拍进 [deferred](./deferred.md) 与 `.scratch/readme-screenshots-v3/`。
2. **新功能并进现有卡片，保持两组各 6 张**（09-09 定的版式）：阅读面板卡吸收图片与「写出的文件直接打开」；
   工具时间线卡改为「透明运行」吸收思考预览；任意模型卡吸收推理强度与 ChatGPT 登录；IM 卡改成手机上找到同一个
   助手。否决加新卡（表格要重排）和「最近更新」节（随版本腐烂）。
3. **仅内置可用的功能**写进安装提示里接入外部 GA 那段：浏览器控制、聊天软件、设置 → 模型。思考预览没写进去：
   外置模式下是否完全没有，本轮没核实到能下定论的程度。
4. **中文 Supervisor 段标题**改为「Supervisor 与聊天软件」，IM 卡标题改为「聊天软件」。09-09 保留英文
   「Channels」的理由是界面 tab 就叫这个词；09-16 起中文 tab 主标签已是「聊天软件」，10-07 页头也跟上，理由失效。
   「Supervisor」保留：它是贯穿文档的角色名，界面里也以这个词出现。
5. **构建说明的单一来源是 CONTRIBUTING**：README 只留四行最短路径加链接；CONTRIBUTING 写干净克隆步骤、
   `--manifest-path`、sidecar 前置、runner 测试与构建；验证门禁仍以 engineering-workflow 为准。
   否决以 engineering-workflow 为唯一来源：外部贡献者的入口是 GitHub 惯例的 CONTRIBUTING。
6. **系统级执行卡保持原文**：键鼠、视觉、ADB 是预置 SOP 加脚本，依赖不在内置 Python 里，但上游 GA 的叙事本来
   就是「装依赖 → 沉淀技能」，不算错。

## 照事实改、不需裁决的

- CLI 示例按 `schemaVersion: 2` 重写，每条命令与参数都对过 `cli/src/args.rs`（`goal start --budget-minutes`、
  `goal extend --minutes`、`session follow`、`session wait --until-idle --timeout`、`session restore`）。
- Settings → Agent 表格补「安装 galley 命令」（macOS，在高级选项里）：示例用的是裸 `galley`。
- 架构图补 IM 渠道与浏览器桥两类常驻进程、定时任务、「Galley patch stack」，`prompt profile` 改为
  `runtime prompt`，去掉「0600」改在工程笔记里限定到 Unix；图下加一句外置模式下的变化。
- SOP / 参考文档头部只改 Target 一行，「Last reviewed」保持 2026-09-09：本轮没有逐条重审正文。

## 验证

- `node scripts/check-supervisor-sop-drift.mjs`：4 份副本与正本一致，两份 `SKILL.md` 对齐。
- `node scripts/check-docs-links.mjs`：通过。
- `git diff --check`；新增中文行全角标点扫描（scratchpad 自写脚本）。

## 未决

- 截图重拍（见 deferred）。
- 外置模式下思考预览的确切行为，如要写进 README 的「仅内置」清单，先核实。
