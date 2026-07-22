# Devlog

Galley 开发日志：记录设计与工程决策的"为什么"，以及考虑过但被否的方案。

补充于 PRD（产品定义）、DESIGN.md（设计规则）、CLAUDE.md（项目宪法）—— devlog 提供历史叙事和 decision provenance。git log 太短只说"是什么"，PRD 太静态只说"现在是什么"，devlog 才记录"我们怎么走到这里的"。

## 谁在读 · 怎么用

本 devlog 的主要读者是**跨 session 的 agent** —— 用它在新会话里快速接回项目的决策脉络。按三层用：

- **检索**（已知关键词）：`rg docs/devlog/`，搜正文每个字，对体量免疫。
- **路由**（不确定去哪篇）：扫下方[时间线](#时间线)的一行索引，再 Read 命中的 entry。
- **开工前**：扫一眼 [deferred.md](./deferred.md)，别重新提议早已被否或搁置的方案。

索引只负责路由，搜索交给 `rg` —— 所以时间线保持一行一条，不塞长摘要（长摘要既吃 agent 的 context，又会和正文双写漂移）。

## 时间线

按日期分组，每条一行索引供 agent 路由；hook 只需含**能判断相关性、可 grep 的关键词**（功能名 / 模块名 / 版本号），不追求文采。点标题进对应 entry 看完整叙事。

### 2026-05-07
- [Stage 1 Bridge POC 完成](./2026-05-07-stage1-bridge-poc-complete.md) — IPC 协议 v0.1 + WorkbenchHandler 双轨 + 5 项 e2e 全过，POC 打通
- [设计方向转向 Notion + Claude](./2026-05-07-design-direction-pivot.md) — 从 dark/Linear 转向 light 文档对话工作台，9 块设计基础对齐

### 2026-05-08
- [首次体验三连 + LLM 切换](./2026-05-08-onboarding-and-llm-switching.md) — Onboarding/Empty/Health Check 设计定稿，LLM 切换工程层打通
- [设计三连收尾 + file_patch diff + Error hint](./2026-05-08-design-trio-finale.md) — Error/Palette/Settings 设计 + file_patch diff 入 V0.1，DESIGN.md v0.2 定稿
- [Stage 2 桌面端骨架完成](./2026-05-08-stage2-desktop-skeleton-complete.md) — Tauri+React+Tailwind+Zustand+SQLite+bridge 端到端串通，11 子任务一气呵成

### 2026-05-09
- [Project 模型 · coding agent 用户的归类容器](./2026-05-09-project-model-coding-agent.md) — Project 定为纯归类抽屉，不绑 instructions 不改 GA 体验；migration 直改 001
- [YOLO Mode · 审批是出口而非围栏](./2026-05-09-yolo-mode.md) — 确立"审批是出口非围栏"，加 YOLO Mode + set_yolo_mode IPC
- [Stage 3 #1 端到端真跑 + 一波 dogfood UX polish](./2026-05-09-stage3-end-to-end-and-ux-polish.md) — 16 commits 打通端到端真跑 + dogfood polish，提前做部分 V0.2 范围

### 2026-05-11
- [Stage 3 multi-session：N-active + useShallow 踩坑 + LRU 5](./2026-05-11-stage3-multi-session-and-perf.md) — N-active 多进程架构定案 + useShallow 反模式踩坑修复 + LRU 5 拍板
- [Stage 3 V0.1 收尾 + dogfood 7 轮 UX 打磨](./2026-05-11-stage3-v0.1-completion.md) — 14 commits 做齐 V0.1 七件事 + 7 轮 dogfood UX 打磨

### 2026-05-12
- [Stage 3 dogfood polish marathon + turn_index 双层语义拆分](./2026-05-12-dogfood-polish-marathon.md) — 拆 turn_index 双层语义修 conversation 错乱，17 commits 第二轮 dogfood 收尾

### 2026-05-13
- [Sidebar IA 重塑 · FTS5 全文搜索 · Inspector 退役 · Projects V0.1 · GA baseline cf65515](./2026-05-13-sidebar-overhaul-and-projects.md) — 一 session 跨 8 主题：Sidebar 重塑 + FTS5 搜索 + Inspector 退役 + Projects V0.1
- [GA Baseline 升级 cf65515 → 6bb3104](./2026-05-13-ga-baseline-upgrade-cf65515-to-6bb3104.md) — 首次实跑 baseline 升级，dispatch 加 tool_num 透传适配 breaking change
- [Baseline regression · 改用 feature detection 适配](./2026-05-13-baseline-regression-and-feature-detection.md) — 硬绑签名在旧 GA 炸 → 改 inspect 特性探测双向兼容，方法论沉淀进 CLAUDE.md
- [LLM warmup bridge · 启动时自动刷新模型列表](./2026-05-13-llm-warmup-bridge.md) — 冷启动跑一次性 warmup bridge 拉模型列表，修新模型不显示 bug
- [V0.2 增量 · /btw 侧问 · /branch 分支 · /rewind 悔棋](./2026-05-13-v0.2-side-question-branch-rewind.md) — 三个新交互原语提案进 V0.2：侧问/分支/悔棋
- [Galley 重命名 + 多项 V0.1 功能马拉松](./2026-05-13-galley-rename-and-features-marathon.md) — 超长 session：品牌改名 Galley + CLAUDE.md 宪法重写 + ask_user/Pet 等 13 件事
- [V0.2 增量 · AI Session Rename (user-triggered)](./2026-05-13-v0.2-ai-session-rename.md) — ⋯ 菜单加 AI 重命名（user-triggered），复用 raw_ask 出中文标题
- [V0.2 增量 · 空闲自主行动 (Idle Autonomy)](./2026-05-13-v0.2-idle-autonomy.md) — Idle Autonomy 适配设计：全局 toggle + 必须 YOLO gate + 硬限 30 step
- [UI 文案 i18n + brand 一致性 sweep + TopBar 标题菜单重构 + repo 重命名](./2026-05-13-ui-copy-i18n-and-brand-sweep.md) — 从"⋯像省略号"连出 10 决策：标题 dropdown + i18n Plan B + repo 改名 galley

### 2026-05-14
- [Project = 纯分组 · 回收 rootPath/CWD 绑定（GA memory/ 静默降级修复）](./2026-05-14-project-rootpath-rollback-ga-memory-coupling.md) — 发现 os.chdir 让 GA 读不到 memory/ 静默失灵 → 回收 cwd 绑定，Project 改纯分组
- [Conversation polish marathon: streaming, /btw, Desktop Pet UX, fence filter](./2026-05-14-conversation-streaming-and-btw-marathon.md) — 18 commits 全面打磨对话区：启用流式输出 + /btw 实现 + Pet UX + fence filter

### 2026-05-15
- [Release CI · Mac menubar · icon 4 轮迭代 · README screenshots](./2026-05-15-release-ci-menubar-icon-screenshots.md) — 14 commits 补齐发版能力：Release CI + Mac 菜单栏 + icon 4 轮 + README 截图
- [Windows 发版 prep · Y 计划自绘 chrome + A 阶段杂项](./2026-05-15-win-prep-y-plan-custom-chrome.md) — Win/Mac 双发版准备，窗口 chrome 选全自绘 Y 方案 5 步全 landed
- [Vision pivot · workbench → local agent team orchestrator (dual-native)](./2026-05-15-vision-pivot-to-orchestrator.md) — 定位 reframe 为 local agent team orchestrator，CLI 一等公民 + Core 迁 Rust
- [v0.1 prod-build dogfood fixes（Onboarding routing · Python probe · bridge stderr · Settings revisit）](./2026-05-15-v0.1-prod-dogfood-fixes.md) — 首次 .dmg 真启动 30 秒暴露 4 bug：Onboarding 路由/Python probe/bridge stderr/Settings
- [GA Baseline 升级 6bb3104 → fc6b5ad（零接口表面变化）](./2026-05-15-ga-baseline-upgrade-6bb3104-to-fc6b5ad.md) — 升到 upstream HEAD，13 commits 审完 bridge 零改动，新旧 GA 双端测试通过
- [v0.1 ship · CI Intel queue fallback · tiered release pattern · macOS terminology](./2026-05-15-v0.1-ship-and-ci-fallback.md) — Galley v0.1 公开发布：macOS RC + Windows Alpha 双 tier，Intel queue 卡死手动 fallback
- [v0.1.0-alpha.2 Windows attach hotfix（fs:scope · mixed-separator joinPath · Settings GA Path editable）](./2026-05-15-v0.1-alpha.2-windows-attach-fixes.md) — 修 Win attach 两 bug：joinPath 混合分隔符 + fs:scope D 盘越界；CI 永久 drop macos-13
- [Onboarding & empty-state polish · YOLO default · button system · v0.1 Mac-only 决策](./2026-05-15-onboarding-empty-state-yolo-button-polish.md) — 两 commits 覆盖 8 件：步骤渲染 + 教程系统 + YOLO 默认 ON + 按钮系统 + v0.1 Mac-only

### 2026-05-18
- [Bridge-owner prototype · 17/17 PASS · GO for B1](./2026-05-18-prototype-go-for-b1.md) — 17/17 checklist 全过，300s 内存 +0.4MB zero-leak，GO for B1
- [GA baseline upgrade fc6b5ad → b063518](./2026-05-18-ga-baseline-upgrade-fc6b5ad-to-b063518.md) — 发版前对齐基线，49 提交（最大单跳）不触 bridge，契约无断裂
- [v0.1.1 · Bundled Python:zero-config attach + Phase 0/1](./2026-05-18-v0.1.1-bundled-python.md) — 静态 allowlist 追不上 Python 管理器 → 决策随 app 捆绑 CPython，Phase 0/1 落地
- [B1 Rust core 骨架 + CLI 只读 · 完成](./2026-05-18-b1-rust-core-complete.md) — B1 全 7 milestone：目录重组 + Cargo workspace + GalleyApi 只读 + galley CLI

### 2026-05-19
- [B2 Bridge ownership 迁 Rust · 完成（代码 + 文档）](./2026-05-19-b2-bridge-ownership-complete.md) — B2 全 7 milestone 代码层推完：bridge 进程 owner 迁 Rust + socket listener + CLI send/watch
- [B3 M1 完成 · slice 设计 + ADR + Rust emit catalogue（0 代码改动）](./2026-05-19-b3-m1-design-complete.md) — M1 paperwork：89 项 field 级 inventory 分 5 slice + ADR + Rust emit catalogue
- [B3 M3 完成 + 4 个 B2 latent bug 修复 + perf baseline 落地](./2026-05-19-b3-m3-complete.md) — 9 commits：runtime store 抽离 + 4 个 B2 latent bug 修复 + perf baseline 实测
- [B3 prerequisites · 1 周日历仪式改成事件驱动 + 双层 gate](./2026-05-19-b3-prereq-relaxation.md) — 把"dogfood 1 周"日历门改事件驱动 + 双层启动 gate
- [B3 M5 完成 — messagesStore 抽离 + active-session projection retire](./2026-05-19-b3-m5-complete.md) — messagesStore 抽离 + active-session projection 退役，useAppStore 降到 465 行
- [B3 M4 完成 — sessionsStore + Rust GalleyApi 17 trait methods](./2026-05-19-b3-m4-complete.md) — sessionsStore 抽离 + Rust GalleyApi 加 17 trait method

### 2026-05-20
- [B3 完成 · useAppStore 拆 slice + 改订阅 Rust event](./2026-05-20-b3-store-slice-complete.md) — M1-M7 全 ship + tag，useAppStore 整文件删除，21× 快于估算
- [Disk cleanup + repo hygiene pass](./2026-05-20-disk-cleanup-and-repo-hygiene.md) — 32G→122M 清盘 + repo hygiene：删旧项目名残留 + 带空格目录名
- [Demo / mock cleanup + alive-bridge cap bump](./2026-05-20-demo-mock-cleanup-and-lru-bump.md) — 4 commits 清 V0.1 脚手架 + LRU cap 5→20，删 stores/demo.ts
- [B4 M8 完成 — Pre-migration backup 机制(B4-I6 兑现)](./2026-05-20-b4-m8-migration-backup.md) — 迁移前整目录备份 + 恢复路径落地，真跑 dogfood 留下版

### 2026-05-21
- [v0.2 beta agent surface + historical-session restore dogfood](./2026-05-21-v02-beta-agent-surface-and-history-restore.md) — Settings→Agent copy 简化 + copy-first Supervisor SOP + 历史会话恢复 dogfood + Session Close SOP
- [Supervisor provenance + delegation dogfood](./2026-05-21-supervisor-provenance-delegation-dogfood.md) — Supervisor 标识收到 message 级 robot marker + session new 改真 delegation dispatch

### 2026-05-22
- [GA baseline upgrade b063518 -> 1a8abc4](./2026-05-22-ga-baseline-upgrade-b063518-to-1a8abc4.md) — 36 commits：dispatch callback 被 plugins.hooks 替代，加特性探测适配
- [Auto Update Phase 1](./2026-05-22-auto-update-phase-1.md) — Settings→About 检查/下载/重启入口，更新通道显式 env 启用
- [Conversation UX and Update Closeout](./2026-05-22-conversation-ux-and-update-closeout.md) — 等待改整句 typing indicator + dot rail 聚合 + updater 运行中保护
- [Project Review sidebar UX](./2026-05-22-project-review-sidebar-ux.md) — Projects 从 inline filter 改为 Quick Action 进入的 Project Review

### 2026-05-25
- [Managed GA runtime closeout](./2026-05-25-managed-ga-runtime-closeout.md) — Managed/bundled GA 进 dogfood：边界 + Persona + CLI sidecar + lazy Keychain 全落地
- [Settings Models + Runtime UX polish](./2026-05-25-settings-models-runtime-ux.md) — Settings→Models 按 Provider 重组 + Provider 检查与模型测试分离

### 2026-05-26
- [Background Mode · Tray Lifecycle](./2026-05-26-background-mode-tray-lifecycle.md) — 默认后台运行：关窗改隐藏，tray 提供 Open/Hide/Quit
- [Setup Assistant Re-Entry](./2026-05-26-setup-assistant-reentry.md) — Settings→Runtime 加 Open Setup Assistant 深入口，复用首装向导无副作用
- [Managed Credentials · Local Encrypted SQLite](./2026-05-26-managed-credentials-local-sqlite.md) — 放弃 Keychain 默认后端，改本地加密 SQLite 存 managed API Key
- [Session Progress + Model Settings Polish](./2026-05-26-session-progress-and-model-settings-polish.md) — Sidebar 改诚实 liveness + 主对话读秒 + session 模型持久化改稳定身份

### 2026-05-27
- [GA upstream upgrade 1a8abc4 -> 1c9f141](./2026-05-27-ga-upstream-upgrade-1a8abc4-to-1c9f141.md) — 首次按 external baseline + managed rebase 双门跑升级，补 clean-source guard 等
- [Browser Control as managed GA completion item](./2026-05-27-browser-control-managed-ga.md) — Browser Control 作内置 GA 核心完成项：稳定目录 + 确定性 probe + demo
- [Main surface polish closeout](./2026-05-27-main-surface-polish-closeout.md) — Browser Control 成功态收静 + Supervisor 入口进 managed sidebar header + 流式防跳变
- [Agent SOP dogfood refresh](./2026-05-27-agent-sop-dogfood-refresh.md) — 真实 Supervisor CLI dogfood 全覆盖，修 session show/watch + CLI FTS 索引
- [Project Batch Follow](./2026-05-27-project-batch-follow.md) — Project 定为批量任务容器，新增 session follow + project brief/show/follow
- [Project Follow Until Idle](./2026-05-27-project-follow-until-idle.md) — 补 project follow --until-idle --final-show，盯到子 session 全 idle 收束
- [Supervisor User-Facing Copy](./2026-05-27-supervisor-user-facing-copy.md) — SOP 加面向新手的 Galley mode 话术 + Settings→Agent 两句可复制试用 prompt

### 2026-05-28
- [Settings refactor closeout](./2026-05-28-settings-refactor-closeout.md) — Settings shell/Models/Runtime 低风险分拆，明确停止为拆而拆
- [Update Channel Verifier](./2026-05-28-update-channel-verifier.md) — updater beta 通道加 live verifier，promote 后自动查 latest.json 各项
- [Windows DB path hotfix](./2026-05-28-windows-db-path-hotfix.md) — 修 Win 进不了主界面：Core 与 plugin-sql 的 DB 路径统一到 app config dir
- [Alpha release prep and Browser Control dogfood closeout](./2026-05-28-alpha-release-prep.md) — Win dogfood 收口，Browser Control 改强非阻塞引导，target v0.2.0-alpha.1

### 2026-05-29
- [Managed IM Supervisor · WeChat alpha.2 prep](./2026-05-29-managed-im-supervisor-wechat.md) — Settings→IM 首版：微信扫码接入 + IM Supervisor prompt，target v0.2.0-alpha.2

### 2026-05-31
- [Alpha.2 dogfood UX polish](./2026-05-31-alpha2-dogfood-ux-polish.md) — 小屏 Onboarding + 外部 GA probe + Tooltip/Toast 降噪 + Channels 入口
- [v0.2.0 stable release](./2026-05-31-v020-stable-release.md) — 第一个正式版 v0.2.0 非 prerelease Latest，release notes 中英双语，promote beta 通道

### 2026-06-01
- [v0.2.1 dogfood polish release](./2026-06-01-v021-dogfood-polish-release.md) — post-0.2 polish patch 发布 + 顺手加固 live update verifier 防旧 manifest 误判

### 2026-06-02
- [GA upstream upgrade 1c9f141 -> 5f46b438](./2026-06-02-ga-upstream-upgrade-1c9f141-to-5f46b438.md) — external 契约未断，managed patch 重放补长 prompt temp / /continue cache 漏点
- [v0.2.3 Browser Control hotfix prep](./2026-06-02-v023-browser-control-hotfix-prep.md) — 加 connected_no_tabs 诊断，教程改拖整个文件夹 + Chrome/Edge 测试页
- [v0.2.4 release prep](./2026-06-02-v024-release-prep.md) — target v0.2.4：ChatGPT/Codex provider + BC offline recovery + Settings polish

### 2026-06-03
- [v0.2.5 Codex backend hotfix](./2026-06-03-v025-codex-hotfix.md) — 修 Codex backend 参数兼容：Responses input list + 强制 stream + 不发 max_output_tokens
- [Stable release update-channel default](./2026-06-03-stable-release-update-channel-default.md) — release SOP 改：stable/patch 完成标准含默认通道 promotion + live 验证
- [Windows updater file-lock fix](./2026-06-03-windows-updater-file-lock.md) — 修 Win 覆盖安装卡 _bz2.pyd：更新前先停 runner/IM + NSIS preinstall hook
- [v0.2.6 Memory/SOP and UI polish release](./2026-06-03-v026-memory-sop-and-ui-polish-release.md) — v0.2.6 发布：内置 GA Memory/SOP seed + Models 三层视觉 + updater file-lock 修复
- [哲学气质定位 · philosophical-voice + austerity 文案](./2026-06-03-philosophical-voice-and-austerity-copy.md) — 注入维特根斯坦哲学气质：空状态题词 + Composer 三寄存器 + austerity 准则重写双语文案

### 2026-06-04
- [v0.2.7 Windows runtime hotfix release](./2026-06-04-v027-windows-runtime-hotfix-release.md) — v0.2.7 发布：修 Win managed code_run stdin 继承卡住 + 更新失败显手动下载
- [GA upstream upgrade 5f46b438 -> 5d122e20](./2026-06-04-ga-upstream-upgrade-5f46b438-to-5d122e20.md) — external 未断，managed patch 把 BC recovery / Codex backend 改显式 replay patch
- [Bundled Python runtime contract](./2026-06-04-bundled-python-runtime-contract.md) — 明确 release managed GA 必须用 bundled Python，加 import smoke gate
- [Galley Goal V1](./2026-06-04-galley-goal-v1.md) — Goal V1 落成 Core-owned headless Hive：模型型 Master Planner + worker 懒创建 + CLI controller

### 2026-06-09
- [GA upstream upgrade 5d122e20 -> ba19018a](./2026-06-09-ga-upstream-upgrade-5d122e20-to-ba19018a.md) — baseline 升 ba19018a，managed payload 纳入 conductor/TUI/scheduler/user-agent 更新

### 2026-06-10
- [TopBar polish + Browser Control onboarding 减负重构](./2026-06-10-topbar-and-browser-control-onboarding-polish.md) — TopBar 触觉 + .galley-pop-in；BC setup 走方向 C 六步压三拍

### 2026-06-11
- [Settings 逐 tab 视觉一致性打磨](./2026-06-11-settings-tab-by-tab-polish.md) — 7 tab 视觉统一：hairline 容器基准 + 触觉诚实 + brand 纪律 + 圆形 stepper

### 2026-06-12
- [GA upstream upgrade ba19018a -> 0def7441](./2026-06-12-ga-upstream-upgrade-ba19018a-to-0def7441.md) — baseline 升 0def7441，纳入 Project Mode / Responses client_metadata
- [v0.2.8 Goal and workbench polish release](./2026-06-12-v028-goal-and-workbench-polish-release-prep.md) — v0.2.8 发布：Goal V1 交付 + 主工作台/Settings/BC polish + baseline 0def7441

### 2026-06-15
- [Knowledge Sync rules](./2026-06-15-knowledge-sync-rules.md) — neat-freak 原则裁成轻量 Session Close 子流程：按受众同步 + 允许 no-op

### 2026-06-16
- [Product Design audit and status surfaces](./2026-06-16-product-design-audit-status-surfaces.md) — Product Design audit 推三组状态可扫性收口：TopBar/Sidebar/question rail
- [Managed IM Supervisor · Feishu Channel](./2026-06-16-managed-im-supervisor-feishu.md) — Settings→Channels 加飞书接入：本机托管 + fsapp.py 长连接 + lark-oapi gate
- [Galley Native Runtime Checkpoint](./2026-06-16-galley-native-runtime-checkpoint.md) — galley_native 锁定为 GA 的 Rust 语义移植，拆出 Native RFC 1-7

### 2026-06-18
- [Project Workspace and GA upstream upgrade 0def7441 -> 12655687](./2026-06-18-project-workspace-and-ga-upstream-12655687.md) — 上游进 Workspace 后恢复 Project 文件夹绑定（GUI 选即启用），baseline 升 12655687
- [GA upstream upgrade 12655687 -> 53b48aea](./2026-06-18-ga-upstream-upgrade-12655687-to-53b48aea.md) — 上游 1 个 llmcore 日志提交，baseline 升 53b48aea + GUI 用 manifest commit 作对比 baseline
- [v0.2.9 Project Workspace and GA baseline release](./2026-06-18-v029-project-workspace-and-ga-baseline-release.md) — v0.2.9 发布：Project Workspace 回归 + baseline 53b48aea + Feishu/Channels polish
- [Supervisor SOP Lite + Reference Split](./2026-06-18-supervisor-sop-lite-reference-split.md) — SOP 从 775 行拆成 277 行 Lite + 376 行 reference，Settings 仍复制 canonical

### 2026-06-19
- [v0.2.10 migration recovery hotfix](./2026-06-19-v0210-migration-recovery-hotfix.md) — 修 v0.2.9 迁移 DROP TABLE 触发外键级联丢历史，加 pre-plugin 安全迁移 + 备份恢复

### 2026-06-20
- [v0.2.11 process lifecycle hotfix](./2026-06-20-v0211-process-lifecycle-hotfix.md) — Mac 发烫补进程生命周期：bridge 父进程 watchdog + 注入 GALLEY_CORE_PID 防套娃

### 2026-06-22
- [Composer 图片 intake 拆分 + 拖拽落区](./2026-06-22-composer-image-split.md) — Composer 拆第一刀：图片 intake 抽纯模块 + hook，补 too-many toast + 拖拽落区

### 2026-06-23
- [GA upstream upgrade 53b48aea -> 70792af](./2026-06-23-ga-upstream-upgrade-53b48aea-to-70792af.md) — 上游 9 提交不触 bridge，managed payload 纳入 loop-mode/conductor/180-turn limit
- [v0.2.12 image intake and GA upgrade release](./2026-06-23-v0212-image-intake-and-ga-upgrade-release.md) — v0.2.12 发布：图片 intake + 拖拽 + 内置 GA 70792af（loop 180/context_win 90000）
- [Composer paste-fold split + hook-split closeout](./2026-06-23-composer-paste-fold-and-split-closeout.md) — 长文本粘贴折叠关注点拆出 Composer，大组件拆分轮判 settled（后于 07-06 重开）

### 2026-06-24
- [README 默认语言翻转 · 英文设为 default](./2026-06-24-readme-default-language-flip.md) — 求职定位下 README 默认从中文翻英文 + 同轮中英同步打磨首屏
- [TopBar 拆双栏 header + 浅色调色板收敛 + 对话框配色统一](./2026-06-24-topbar-split-and-light-palette.md) — 全宽 TopBar 拆双栏各 44px header + 浅色收敛到 true-neutral+whisper-warm + 对话框配色统一

### 2026-06-25
- [GitHub Release notes 英文优先](./2026-06-25-release-notes-english-first.md) — 21 个 GitHub Release 正文改英文在前中文在后，稳定版 What's New 改结果优先

### 2026-06-29
- [GA upstream upgrade 70792af -> b1e173dc](./2026-06-29-ga-upstream-upgrade-70792af-to-b1e173dc.md) — 上游 11 提交不触 bridge，managed 纳入 --func/--history/UltraPlan/summary fallback
- [Composer saved prompts](./2026-06-29-composer-saved-prompts.md) — Composer 右侧加 saved prompts 入口（dialog-only）：预设模板 + 可排序自定义
- [Pointer-first button focus](./2026-06-29-pointer-first-button-focus.md) — 清 button 点击后残留蓝色 focus outline，鼠标点击不落焦点

### 2026-07-02
- [全 codebase review + 前三档可靠性修复](./2026-07-02-codebase-review-and-reliability-fixes.md) — 4 agent 深读四模块产出 56 findings，修前三档：quick wins/数据安全/Stop 审批链路

### 2026-07-03
- [气质总纲（文库定位）+ 中文微排印 pass](./2026-07-03-temperament-charter-and-cjk-typography.md) — 诊断"气质不够"根因在感官层：新增 temperament.md + typography-principles.md + text-autospace
- [About 版权页（colophon）+ 题词稀缺性收敛](./2026-07-03-about-colophon-and-epigraph-scarcity.md) — About 按版权页重组 + 题词收敛为仅 silent 渲染；记录 owner 独立产品定位决策
- [About「GA 预算」收敛 + onboarding 引擎称谓 pass](./2026-07-03-about-ga-budget-and-onboarding-copy.md) — 确立"GA 预算"原则（一次 origin + 一次引擎行）+ managed 语境称引擎为"内核"
- [定位同步：PRD / AGENTS.md / Runtime 页内核化](./2026-07-03-positioning-sync-prd-agents-runtime.md) — "独立产品"定位补进 PRD/AGENTS.md + UI"内置 GA"清零改"内核/engine"（双语 ~26 处）
- [README 双层价值主张重构（中文定稿 + 英文同步）](./2026-07-03-readme-two-layer-value-prop.md) — README 定为项目主页：Highlights 重组为"单 agent 能干活 + 一支团队管得住"
- [Supervisor 主动汇报：定位收敛 + 可行性 spike + 设计](./2026-07-03-supervisor-proactive-reporting-design.md) — 补管理 loop 缺的主动汇报：reporter daemon + 模型组稿 + 只做飞书，同日落地
- [Supervisor SOP 前沿模型重校准](./2026-07-03-supervisor-sop-frontier-recalibration.md) — SOP 按前沿模型重划确认边界：拆 exact-phrase 咒语 + 风险动作按可逆性分档
- [Goal 单实例化：一次一个 + 重启自动恢复 + 控制器重入锁](./2026-07-03-goal-single-instance.md) — Goal 定为重武器一次一个：DB 唯一索引 + 启动 resume + controller.lock 防双开
- [README 截图双语重拍：实拍偏差与最终口径](./2026-07-03-screenshot-reshoot-bilingual.md) — zh/en 双套截图重拍（真跑），四项偏差入正式口径；可行性结论沉入 playbook
- [题词稀缺性门控翻案：空状态完全恢复](./2026-07-03-epigraph-scarcity-reverted.md) — owner dogfood 翻案：silent-only 门控让题词永久消失 → 完全恢复；Denk nicht, sondern schau

### 2026-07-04
- [文档系统整备：生命周期 + 单一索引 + 巨型文档拆分 + 链接门禁 + 资产政策](./2026-07-04-docs-system-overhaul.md) — 诊断活死文档混住：建 docs/archive + 单一索引路由 + 拆三巨型文档 + 链接门禁 CI + 资产政策

### 2026-07-05
- [Topbar 外观控件语法统一](./2026-07-05-topbar-appearance-controls-grammar.md) — 字号/主题控件重建为图标按钮→popover→共享 SegmentedControl，抽 TopBarIconButton
- [主对话区审计与三层打磨](./2026-07-05-conversation-area-audit-and-polish.md) — 三 agent 审计 7000 行对话组件分级修：IME 守卫 + 草稿驻留 + denied 工具留痕
- [Settings 打磨系列 + tailwind-merge 字号陷阱](./2026-07-05-settings-polish-series-and-twmerge-trap.md) — 八 tab 权重纪律统一 + 修 tailwind-merge 把 text-ui-* 当颜色组静默删的字号陷阱
- [Managed IM Supervisor · Telegram](./2026-07-05-managed-im-supervisor-telegram.md) — Channels 第三渠道：复用上游 tgapp.py + patch 0014，reporter 泛化为 ChannelAdapter
- [Sidebar 状态板审计与三层打磨](./2026-07-05-sidebar-status-board-audit-and-polish.md) — 两 agent 审计 Sidebar：三信号优先级统一 + 时间桶跨午夜重算；产品决策鼠标优先

### 2026-07-06
- [macOS 红绿灯 dev/release 错位与「接受默认灯」收场](./2026-07-06-macos-traffic-light-dev-release-divergence.md) — dev 调好的灯位打包 .app 不生效，两修复路都否 → 接受默认灯，v0.3.1 放弃
- [Goal 模式打磨轮：定位入档、Stop 收尾、进度与结果呈现](./2026-07-06-goal-mode-polish-round.md) — 定位入 PRD §6.4（Supervisor 第一）→ 裁掉 Goal 专屏；stop 收尾 + 进度条 pill + 实时任务板
- [GUI 大组件拆分 · 第二轮 + 项目上下文逃生口](./2026-07-06-gui-large-component-split-round-two.md) — 重开 06-23 结论，导航优先于尺寸洁癖：4 组件沿内聚缝拆 + 项目上下文可撤销 chip

### 2026-07-07
- [架构 review 驱动的重构冲刺 + 三次诚实收回](./2026-07-07-architecture-review-refactor-sprint.md) — Explore 扫 12 候选逐个核实：做 G1/G3/P3，三次诚实收回被证伪的断言
- [Managed runtime prompt 打磨：封闭世界作者事实 + 状态块](./2026-07-07-managed-runtime-prompt-polish.md) — 真实幻觉事故 → 作者事实改封闭世界 + 加会话启动状态块 compose_runtime_prompt

### 2026-07-09
- [Goal solo 打磨轮二：过程可见 · 无项目 solo · 收口竞态 · Composer 入口](./2026-07-09-goal-solo-dogfood-round-two.md) — 六决策：nudge/turn 可见性分开关 + 无项目 solo 正经迁移 + 收口竞态 + controller 拆 4 模块

### 2026-07-10
- [GA upstream upgrade b1e173dc -> 502be0a](./2026-07-10-ga-upstream-upgrade-b1e173dc-to-502be0a.md) — 上游 10 提交不触 bridge，llmcore 纳入 refusal 不重试等；改用上游 GA_ULTRAPLAN_RUNDIR 缝

### 2026-07-11
- [Typed socket protocol module + CLI SocketClient](./2026-07-11-typed-socket-protocol-module.md) — core/src/protocol/ 成 schemaVersion 1 唯一类型之家，CLI 走 SocketClient，字段漂移变编译错误
- [Socket write handlers:注入缝(HandlerCtx / RunnerPort / Notifier)](./2026-07-11-socket-write-handler-seams.md) — 写处理器依赖注入 dispatch_line_with，10 新集成测试覆盖 spawn_failed 回滚
- [AgentTurn 构建单一之家(lib/agent-turn.ts)](./2026-07-11-agent-turn-single-home.md) — live/persist/restore 三处重算收敛进 lib/agent-turn.ts，往返恒等测试钉 live===restored
- [GaSession:GA 集成缝成为模块](./2026-07-11-ga-session-seam.md) — runner/ga_session.py 收拢约 10 处 agent reach-in，baseline 审计从全文 grep 变读一个文件
- [文档全面体检:陈旧修正 + 防漂移机制](./2026-07-11-docs-governance-round.md) — 三路审计 + 核实：15 处陈旧修正 + docs/README 补全唯一索引 + Update Triggers 表 + 补 8 篇 devlog

### 2026-07-15
- [顶栏更新提醒 + toast 严重级驻留 + OAI 恢复验证](./2026-07-15-topbar-update-indicator-and-toast-severity.md) — 加 UpdateIndicator 徽章 + warning/error toast 不自动消失 + OAI 恢复误报修复
- [GA upstream upgrade 502be0a -> 1e89c3e](./2026-07-15-ga-upstream-upgrade-502be0a-to-1e89c3e.md) — 上游 362 提交几乎全是 desktop 前端，引擎 delta 仅 12 文件；0005 删除 + patch 栈改提交链 rebase
- [桌面工艺打磨轮：窗口记忆 + 菜单栏精修 + skeleton 否决](./2026-07-15-desktop-craft-polish-round.md) — 十维审计定缺口：窗口状态持久化 + 删两灰菜单占位 + 补系统标准菜单项；Skeleton 明确否决

### 2026-07-16
- [更新下载真实进度条 + spinner 统一](./2026-07-16-update-download-progress-and-spinner-unification.md) — 接通 Tauri 下载回调广播 app-update-progress + ProgressThrottle 节流；顺手统一 10 处 spinner
- [Windows 滚动条打磨（Mac 不动）](./2026-07-16-windows-scrollbar-polish.md) — 全库零自定义滚动条 → 加 data-platform=windows 限定的 webkit 滚动条样式，Mac byte-identical

### 2026-07-17
- [模型配置 UX 三连 + General tab / 开机自启](./2026-07-17-model-config-ux-and-general-tab.md) — 预设换 2026-07 前沿模型 + Onboarding 降门槛五连 + Models 行操作收敛 + 开机自启 + General tab

### 2026-07-20
- [浏览器插件去侵入化](./2026-07-20-extension-badge-deintrusive.md) — 补丁 0015：移除上游页内常驻徽标，连接状态移到扩展图标 badge + popup 改状态面板
- [GA upstream upgrade 1e89c3e -> 5257dec](./2026-07-20-ga-upstream-upgrade-1e89c3e-to-5257dec.md) — 发 v0.3.4 前刷 baseline，上游 7 提交几乎全 desktop 前端，引擎 delta 仅 ga.py/llmcore.py
- [审批模式重构：更名 + per-session + Composer 单控](./2026-07-20-approval-mode-rename-and-per-session.md) — YOLO 更名"自动执行/逐步审批" + per-session 化并入 LLM pill 成会话配置 capsule，runner 零改动

### 2026-07-21
- [题词可点击：装饰成为第一条消息的入口](./2026-07-21-epigraph-click-to-ask.md) — 空状态题词点击预填解读请求进 Composer（Enter 才发），装饰自身成零打字提问入口
- [Question Rail：门槛降到 1，间距保持等比映射](./2026-07-21-question-rail-threshold.md) — rail 门槛 3→1（索引 vs 跳转锚双职能），dot 间距保持等比映射不紧凑化
- [Plan Mode 可视化：GUI 只观察，不做入口](./2026-07-21-plan-mode-visibility.md) — GUI 只观察不做入口：bridge 每 turn_end plan_watch 只读探测发 plan_update，薄条显计划步骤
- [回复完成通知：只通知 GUI 发起的 run](./2026-07-21-reply-done-notification.md) — replyDone 通知 pending 标记方案，Goal/CLI run 静默，macOS dev 模式通知路由终端坑
- [Runtime tab 瘦身：删版本行 + 激活态去重](./2026-07-21-runtime-tab-slimdown.md) — 删底部版本行/「当前模式」诊断行，内置内核卡激活态去重显默认模型；否掉 Models+Runtime 合并 Engine tab
- [Windows composer 焦点回归修复](./2026-07-21-windows-composer-refocus.md) — WebView2 不发 DOM focus 事件（#4626）+ activeElement 语义差异，改 Tauri onFocusChanged + 让位守卫；预留 Rust webview.set_focus 第三层

## 格式约定

每个 entry 6 段：

- **Date / Status / Related** — 元信息（含 PRD/DESIGN/commit 引用）
- **Context** — 这次讨论或工作的背景
- **Decisions** — 对齐的具体结论，列表化、可索引
- **Rejected alternatives** — 考虑过但没选的方案 + 理由（最有价值的部分）
- **Open questions** — 留待后续的问题
- **Next** — 这次工作的下一步

## 触发时机

主动写 devlog 的三种场合：

1. 每次 work session 结束（"今天先到这里"）
2. 重大设计/架构决策对齐后（不一定等 session 结束）
3. 阶段切换（如 Stage 1 → Stage 2，写一份阶段总结）

## 写作责任

- Claude 主写：每次决策对齐后主动提议落 devlog
- 作者 review：可以 inline 调整，Claude 根据反馈改
- 不重复信息：devlog 不复述 PRD / DESIGN.md / CLAUDE.md 已有的内容，只记叙事 + decision provenance
- 命名一致性（为 agent 检索）：同一条线（baseline 的 commit 短哈希、IPC 命令名、模块名等）在 hook 和正文里用同一个稳定、可 grep 的词。agent 靠 `rg` 把散在数月里的相关 entry 串起来，命名一飘就串不起来

## 文件命名

`YYYY-MM-DD-topic-in-kebab-case.md`，一天可以多个 entry（按主题分）。

挂起 / 暂不实施的想法**不单独成 entry** —— 记进 [deferred.md](./deferred.md) 台账（一想法一节：状态 / 提出 / 启动信号 / 方案 / 实施要点 / 待定 / 关联）。真正开工时再从台账拎出、落成正式 entry。
