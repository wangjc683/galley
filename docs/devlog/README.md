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
- [Windows composer 焦点回归修复（未决）](./2026-07-21-windows-composer-refocus.md) — WebView2 焦点全链路调查：DOM/wry/SetFocus/MoveFocus(NEXT) 均无效，HWND 布局与死循环教训，裸 app 对照等未试线索；v0.3.7 draft 挂起

### 2026-07-22
- [GA upstream upgrade 5257dec -> 1d3c1a09](./2026-07-22-ga-upstream-upgrade-5257dec-to-1d3c1a09.md) — 上游正式弃用 plan mode 当天刷 baseline；0001/0003 两处真冲突，字节门抓出 0015 存量漂移（2848c4b 手改 payload 未回写补丁）
- [Plan Mode 可视化整链拆除](./2026-07-22-plan-mode-visibility-removal.md) — 上线 24h 即拆：上游弃用抽走前提，"只观察不做入口"成最佳止损位；📌 守卫全删，存量状态残余触发按外观回归接受
- [GUI 大组件拆分 · 第三轮 + provider 表单合并](./2026-07-22-gui-split-round-three-and-provider-form-merge.md) — Composer 抽 goal hook（重开 07-06 子结论）；sessions store 首个 slice 模式；onboarding/settings 双表单实现合并成共享 controller + 纯核心补测

### 2026-07-23
- [Rust 大文件拆分五连 + GUI 第四轮](./2026-07-23-rust-and-gui-large-file-split-rounds.md) — lib.rs run()/session_cmds/hive 主循环/codex_oauth/im_supervisor 五拆 + App.tsx host 组件/runtime store 切片/MarkdownView 三拆；migration_backup 决定不拆；workbench_bridge 缓做入 deferred
- [GA upstream upgrade 1d3c1a09 -> 4086d5c 与上游历史重写](./2026-07-23-ga-upstream-upgrade-1d3c1a09-to-4086d5c.md) — 上游 force-push 改写 main（提交信息英文化），旧基线 SHA 官方不可达，tree 等价锚点 8a75b39 证明内容同一；真实增量仅 5 提交；get_llm_name 去 Session 后缀 → bridge 容错匹配；基线文档增记 tree hash

### 2026-07-24
- [v0.4.0 发布:定时任务 + 内核基线 4086d5c](./2026-07-24-v0.4.0-release.md) — 聚合 `v0.3.7..HEAD` 打包 minor:定时任务(GUI 闭环 9/10 issue,06 CLI 面刻意留 v1 非目标)+ baseline `5257dec→1d3c1a09→4086d5c` 首发 + plan mode 移除 + Rust/GUI 拆分;版本决策否掉 `0.3.8` patch

### 2026-07-25
- [Dark theme 降暖一档](./2026-07-25-dark-theme-dewarm-pass.md) — dark 表面/墨色 chroma ×0.6（L 与色相不动，对比度 14.97→14.95）；相对饱和度 C/L 指标暴露 light 中性纸 vs dark 染色纸的策略分叉；Ghostty 参考结论是「抬画布」而非低对比，冷蓝色相不借；brand 家族与语义色留待下轮
- [深色下"主对话区字体太亮"](./2026-07-25-dark-prose-font-smoothing.md) — 病因不是颜色而是 `-webkit-font-smoothing: auto` 的笔画膨胀（macOS 已无次像素渲染），亮字压暗底被放大；覆盖限定浅色（`html:not([data-theme="dark"]) [data-cjk-prose]`），浅色行为不变；抬画布与降 ink 明度（Notion 档）双双未执行，数值留档

### 2026-07-28
- [架构审查第二轮:四个 Strong 候选落地](./2026-07-28-architecture-review-deepening-round.md) — scheduler fire 进 HandlerCtx seam(修时间戳字典序/fail-all 读取/re-enable 三缺陷 + SessionNewResult 类型化);`/btw` 判定统一到 lib/side-question(修 `\t` 不一致真 bug)+ composer-hint 政策抽纯函数;useMessageSend 21 参收 5 + 双 send-phase 状态机合一;GA baseline gate 改生成式(manifest 补 commitDate/treeHash,defaults.ts 与 fixture 退出手动同步);候选 5-7 与 quick wins 入 deferred

### 2026-07-30
- [窗口几何:失忆→持久化 + Reset to Default Layout](./2026-07-30-window-geometry-amnesia.md) — 同日三次决策:上午裁决启动失忆并实施,复议后反转为持久化 + 恢复默认布局三入口(Window 菜单/命令面板/分隔条双击),发版讨论中第三裁将分隔条双击从仅分栏升级为完整恢复(可发现性)并加 hover tooltip 教学;保留首启居中与小屏钳制两个净收益;失忆实现留在 git(`c7c994fc`)可考古
- [v0.4.1 发布:composer 文件拖放 + 窗口布局复位](./2026-07-30-v0.4.1-release.md) — 聚合 `v0.4.0..HEAD` 打包:文件拖放/文件引用(5/6 issue done,05 Windows smoke 留发布装机终验)+ 窗口布局 + 架构评审轮收口 + 主题微调;GA baseline 4086d5c 不变;版本定级 JC 裁决按功能量级判为 patch,agent 按 v0.4.0 先例推荐的 `0.5.0` minor 被否
- [定时任务信任面打磨轮](./2026-07-30-scheduled-tasks-trust-polish.md) — 信任三问框架驱动 issues 11–14:失败可见性(需行动数角标+失败通知)/表单触发预览(preview_scheduled_fire)/立即运行(run_task_now 盖戳语义)/自启条件式引导;否决总任务数角标(alarm fatigue);footer 按钮两轮返工教训(ghost+邻近)

### 2026-08-03
- [Question Rail:tooltip 加回答预览,用 final answer 而非 summary](./2026-08-03-question-rail-answer-preview.md) — 缺口定位为辨识而非导航,故只改 tooltip 不加 dot;初判推荐 `AgentTurn.summary` 后翻代码改判(它是喂回 agent 的工作记忆、语义前瞻、最终答案轮 `no_tool` 框架失配);跳 ATX 标题取首个正文行;配对取最后一个非 null finalAnswer(JC 裁 (a) 案);逻辑抽进 `lib/rail-preview.ts` 并单测;tooltip 竖直阈值 6/94→10/90
- [GA upstream 升级 4086d5c -> d8d90ee](./2026-08-03-ga-upstream-upgrade-4086d5c-to-d8d90ee.md) — 20 commits/11 天,2/3 是 upstream 前端(含新 `hub.py` WS peer hub)inert;引擎实质是中断响应性(`active_response`+`should_stop`)、`max_retry_after` 封顶、Responses API `incomplete`/`failed` 终止事件;方法论教训:零上下文 `git apply` 探针全绿≠无冲突,只有 commit-chain rebase 的 3-way merge 才测得出(`0007` codex 429 富化撞上游 retry-after 改写,两边保留);遗留耦合断裂:`thinking_delta` 现在吐**无标签**推理文本,而 Galley 剥的 `<thinking>` 标签是提示词约定(走 `text_delta`)、跟 API 原生 thinking block 是两条通道;因 `managed_model.rs` 默认 `thinking_type: adaptive`,对托管 Anthropic 模型**默认命中**(初判"不可达"系查错了开关名,已纠正);不动的代价是 `final_answer` 落库+FTS 索引被永久写脏、思考面板反而空、刚做的 rail tooltip 失效;同轮加 `0016` 补丁收口——整块缓冲后包 `<thinking>` 标签发出,归一到既有约定,顺带让原生推理正确进思考面板;否决"关 thinking"(拿模型质量换显示)和"撤 yield"(纯分叉且永久丢失推理)
- [TurnMarker 副标题与回答重复:GA summary 兜底的渲染层去重](./2026-08-03-turn-summary-echo-dedup.md) — draft dogfood 发现同一段话显示两遍;根因是 `ga.py:594-601` 在模型漏写 `<summary>` 时拿整段正文当摘要,Galley 把它渲染在同一段正文正上方;查证**非 v0.4.2 回归**(重复行早于 `d8d90ee` 升级,`turn_end_callback` 逐字未变,补丁 `0016` 不进 `response.content`),也**非协议问题**(是模型合规度:glm-5.2 12 行中 4 行漏写,gpt-5.6-sol 5 行全写);否决改 GA 兜底(summary 进 `history_info` 是 agent 工作记忆,完整正文在那端更有价值),改在渲染层判重,顺带修好已入库历史行;否决前缀匹配(误伤合规短摘要且盖不住带围栏的形状),改用"去围栏候选 + smart_format 省略形"精确比对;preamble 一半已被既有 `narrationDuplicatesPreamble` 盖住
- [v0.4.2 发布:定时任务信任面 + 引擎升级到 d8d90ee](./2026-08-03-v0.4.2-release.md) — 聚合 `v0.4.1..HEAD` 11 个提交:定时任务信任面 issues 11–14 + rail tooltip 回答预览 + GA baseline 首发 `d8d90ee`;定级沿用 v0.4.1 的功能量级规则判 patch(v0.2.16 发运审计 baseline 同为 patch);补丁 `0016` 是发运前提而非附带(不打则 thinking 脏数据永久落 `final_answer`);`06 CLI schedule` 继续留作 v1 非目标——属 Agent API 面,不搭 patch 版顺风车;构建机是 Intel Mac,bundled runtime gate 走 mac-x64,arm64 产物由 CI 出

### 2026-08-04
- [UI Polish 马拉松:六轮全域界面细节打磨](./2026-08-04-ui-polish-marathon.md) — polish-checklist 建档(make-interfaces-feel-better 摘录+否决);同心圆角/hover 瞬时/tabular-nums/pop-in register 六轮清扫;裁决:0.5px 按压判负、submit-ack 与 runtime-highlight off-scale 保留、focus-visible 暂缓;transition-colors 家族清零;dark 主题高亮环 color-mix 修复
- [自动标题 + 下一步建议 ghost text](./2026-08-04-auto-title-and-next-suggestion.md) — `<next-suggestion>` 标签走 managed prompt 同次补全(否独立侧调用/静态 chips);标题走 `GaSession.side_ask` 每会话一次(否 summary 复用/通用 side-ask 设施);`title_source` 四态 seed/derived/auto/user + CAS 防改名竞态;migration 038;`generate_title`/`title_generated` IPC;ghost 显示是派生条件非一次性事件;零模型选项零开关;立辅助 LLM 功能三条准入判据,否 EmptyState ghost 等一批候选

### 2026-08-05
- [Next-suggestion 默认强制 + ghost 可达性](./2026-08-05-next-suggestion-mandatory-and-ghost-a11y.md) — dogfood 首轮复现标签遵从率失灵(glm-5.2 散文提议无标签);推翻「有才写」为默认强制+枚举豁免(唯一豁免:对话明确终结),失败模式不对称+格式习惯优于逐次裁量+token 占比 <1%;「结尾提议即下一步」转换规则+grounding 地板;节挪 `RUNTIME_PROMPT_STATIC` 末尾,`prompt_hash` 翻新;ghost hint 改可点击 button(鼠标通道)+`aria-describedby` sr-only(AT 通道)+textarea `title` 看截断全文;否:正文风格管制、散文解析兜底

### 2026-08-06
- [v0.4.3 发布](./2026-08-06-v0.4.3-release.md) — 聚合会话智能(自动标题+ghost 建议)、阅读体验(run 折叠+高亮笔)、polish marathon、0017 记账;patch 定级(单功能量级判,不按批次总量);发布准备修掉两个 gate 缺口:ipc.ts 缺 generate_title 镜像(CI 自 08-04 连红)、baseline gate 的 replay=auditedAt 假设被首个补丁单独落地案例打破(改为不早于)
- [完成 run 的过程折叠](./2026-08-06-conversation-run-fold.md) — settled run 过程段折成一行折叠头,`pickToolTier` 哲学升维到 run 层;`run-groups.ts` 单一真相源(折叠+rail 共用,ask_user 回复启发式);折叠时机=注意力交接点(最新展开/提交即折/重开全折);rail 圆点重定义为 run 发起消息;四轮 dogfood:行首 disclosure triangle、工具名走 `copy.tools`、墨阶降档+折叠头 vs Footer 领土表(耗时归折叠头,Footer 删 ⏱)、「用时」前缀防中文时长模板误读
- [0017 兼容端点 input token 记账修复](./2026-08-06-compat-usage-accounting.md) — Footer ↑0 根因:GLM 等 Anthropic 兼容端点在 message_start 给零 usage、完整 usage 在 message_delta,上游只从 message_start 记 input;llmcore delta 侧兜底(真 Anthropic 不重复计数)+cost_tracker requests 门控;基线重放验证
- [Settings 泛用入口默认 tab 收口](./2026-08-06-settings-default-tab.md) — 齿轮/命令面板/⌘, 裸调 setSettingsOpen 落点不确定;收口 `openSettings()` 确定落 General(对应性原则);深链不变;否:记住上次 tab
- [User 消息重设计:callout → 高亮笔](./2026-08-06-user-message-highlighter.md)（含 08-10 后续修正:copy chip 没跟上换皮——`ml-1.5` 被 box-shadow 出头吃成净 2px 间隙、`floating` 装甲贴笔触致寄存器再次倒挂;拆掉「常驻=bare／触发=floating」的错误等式,皮肤只由「背后是什么」决定） — 用户消息从大棱角矩形改高亮笔形态(b-fused),文档隐喻重推,两轮真机 A/B 落定
- [折叠 run 的垂直节奏](./2026-08-06-run-fold-header-spacing.md) — 折叠态移除 StrongHr,折叠头贴紧回答;proximity 绑定修正(header 是回答的 eyebrow)
- [单步 run 也可折](./2026-08-06-run-fold-single-step.md) — 删 foldable 的 stepCount>=2 条件;耗时归折叠头独家后缺席即丢数据;否:单步专属元数据头、Footer 恢复 ⏱
- [ask_user 三连修 + 折叠头截断策略](./2026-08-06-ask-user-ux-polish.md) — pending 期回显与气泡同屏去重(askUserPending 抑制);ask_user 终止 run 误发「回复完成」通知改 askUser 类(复用 replyDone 开关);重启后从 tool args 重建 pendingAskUser(chips/黄点复活);折叠头 scent 按次数降序+提问计数移出截断区+溢出 tooltip

### 2026-08-07
- [Dialog 关闭按钮统一](./2026-08-07-dialog-close-button-unification.md) — 抽 DialogCloseButton 进 ui/(inline ghost / floating 软化双变体;否 DialogShell:骨架不同构);内容型必有 X、确认型不放 X 成文;真机 A/B 否 secondary 凸起;Settings 右栏 pt-12 安全区+同色渐隐(角落争议是结构问题皮肤解不了);删 session-browser 冗余 onClick 与重复 close 文案 key
- [v0.4.4 发布](./2026-08-07-v0.4.4-release.md) — 聚合 ask_user 可达性三连、滚动双态信号、overlay 920 档 + 摘要清洗、推理强度徽章;patch 定级(同 v0.4.1 规则,按最大单功能判);发版触发是 v0.4.3 自带的 sidebar hover 失明回归,不是攒够了;零 Rust 改动、未触 managed GA 故跳过 bundled runtime gate;顺带补掉连续两版 carry over 的应用内更新 dogfood 欠账
- [滚动按钮双态信号 + 追尾修复](./2026-08-07-scroll-button-two-state-signal.md) — 置底按钮运行中 pulse ring / 完成未读静态点(边沿触发真未读,回底即清);三轮语义翻转(区分→未读反转→双态合成);smooth scroll 追移动靶+超时 snap+attach,点击语义定为「挂上尾部」
- [Sidebar hover 失明修复](./2026-08-07-sidebar-chrome-hover-retune.md) — 08-05 chrome 加深后 --color-hover 反比底亮(ΔL* 0.7 反向);.chrome-hover-scope 作用域覆写 #E5E3E0(ΔL* ~3.9 复刻 chrome 递进);否:专用 token(忘用即重演)、全局 alpha 叠层(波及 inline code);selected 明度持平记 deferred
- [Overlay 920 档定型 + session 摘要清洗](./2026-08-07-overlay-920-tier-and-session-recaps.md) — 尺寸阶梯 420/920/1040(否:全统一 Settings 尺寸;640 中档被真机推翻清空);PaletteRow sub 挤压 bug→inline preview;GA 兜底摘要脏数据双端镜像清洗(_clean_turn_summary / cleanSessionSummary);定时空状态 grid-cols-3 模板卡;Earlier/Archived 维持双行(否:与 palette 统一单行,邮件客户端类比)
- [推理强度默认语义 + 第一方 high + 行徽章](./2026-08-07-reasoning-effort-default-and-badge.md) — 「默认」=不发参数跟随服务商;仅三个第一方预设显式 high(第三方兼容端点保留不传);存量不迁移;Models 行档位 chip 读快照不读推荐叠加;否:Composer 快捷入口(作用域错位,走 effort 变体条目路线,记 deferred)

### 2026-08-13
- [Code block 参考审计：零采纳](./2026-08-13-code-block-reference-audit.md) — 对照外部 CodeBlock 参考，结论**参考落后于现状、JC 裁决零改动**，留痕防重提案：高亮（参考手工 token 假货 vs Galley Shiki + LRU + 流式防频闪 + 度量同一性）、头部栏（已有反向裁决：浪费整行，控件右上悬浮；文件名伪需求——GA fence 不带文件名，带路径走 tool callout）、**逐行入场架构性否决**（Shiki 走 innerHTML 每 chunk 整块重建，行级入场 = 所有已有行每 chunk 重播频闪；块级已由 `streaming-prose > *` 覆盖）、**行号否决**（对话代码块是读完即复制的交付物非导航面、与换行模式打架、Claude/ChatGPT/Cursor 均不做）、流式尾部代码块 `::after` 光标排除微调 JC 裁决不做
- [Sidebar 导航参考审计：滑动高亮否决](./2026-08-13-sidebar-nav-reference-audit.md) — 对照 Linear/Raycast 系 SidebarNav 参考审计，结论**基本无可拿**且值得留痕：招牌的滑动 hover 高亮胶囊撞「hover 一律瞬时」（2026-07-16，原生桌面惯例），与 shimmer 案不同这次**规则该赢、不开变体重审**——①规则保护响应性，220ms 才滑到 = 手感变慢，桌面原生 vs web 美学的取向差异正是规则存在的理由②sidebar 是外围监控面，鼠标扫长列表时胶囊追光标 = 常驻环境动感③量尺寸方案与行重排/分桶/滚动打架（参考只有 5 个静态项）④合法表亲「state 驱动选中滑动」也否决（跨桶跨距、主视图换内容已承担连续性）；其余元素已有等价或更精致（`⌘K` hint 已在；参考的 `key={badge}` pop **首挂也弹**，Galley 的挂载抑制闩早已解决参考没解决的缺陷；palette/hover 菜单/translate-y 键程均既定）；取一枚小件：**定时徽章计数增加时 pop**（仅增不减、prev-count 抑制挂载态、keyed span 恰在入场帧播放，三纪律全沿用 SidebarSessionRow 闩习语）
- [流式正文打磨：光标归位 + 块级软淡入](./2026-08-13-streaming-prose-polish.md) — 对照外部 StreamingText 参考评估流式正文；四元素对表后核心只剩**词级 blur 入场**，规则合法（一次性入场非 §2.7 逐字波浪）但三条实质理由否决：撞 markdown 重解析稳定性（mend 残余 6 次回溯每次都会重建词 span，把小位移放大成**已读文字重新模糊的重影**，根治需自定义 text renderer）、千词 filter 层落在每 token 重渲染热路径、blur-resolve 的「AI 光泽感」正是衬线文档语域有意避开的质感；**原型也否决**（JC 裁决）——原型会撒谎且方向是美化（无 markdown 干扰/无长文压力/演示文本精挑=理想上限），且气质票即使被翻两条硬理由仍站着，一小时买到的信息改变不了行动；采纳两件便宜事（全 CSS、`streaming-prose` 类、仅显示态挂载，settled 无类=落定瞬间零变化，同 mend 分离纪律）：①光标从正文块下方独立行**归位到最后一个块的文字末尾**（`::after` 伪元素与调和零交互，列表钉尾 li；表格/代码块尾停块边缘属已知妥协；StreamingCursor 组件退役）②新块/li 首现 opacity **0.4→1** 一次性软淡入（0.4 起点承 waku「150ms 尺度从 0 淡入读作闪烁」教训；追加式流保证不重放）

### 2026-08-12
- [v0.4.6 发布](./2026-08-12-v0.4.6-release.md) — 聚合 `v0.4.5..HEAD` 3 个提交;**第二个用户 issue 驱动的版本,且四条 issue 全来自同一位报告人**(Kinda2419);与 v0.4.5 的性质差别:上一版修的是通路(收不到通知、找不到反馈入口),这一版修工作流本身——两条线的共同点是**功能都在、坏的是人机之间那一层**(排队能力 GA 引擎层本就有只是不可控;#22 的数据 payload 里一字不少只是渲染让人读不了);patch 定级(最大单项消息队列有 Core 新模块/命令/事件/CLI 契约字段,但落在 composer 既有 surface 上);managed GA 零改动故 bundled runtime gate 跳过且跳得对(与 v0.4.4 同、v0.4.5 异);最值得记的一件事是**调查推翻了「运行中 send 是错误路径」这个前提**——保守默认姿势本是「不动现有行为加 `--queue`」,核实后发现现状是事件流损坏的 de facto 排队,保它没意义,故 CLI 改默认走 Core 队列;教训:**「保持现有行为不变」的前提是现有行为是对的**,兼容性默认值不该盖过对现状的核实,尤其当那条路径从没人显式设计过只是碰巧能跑;明确不随本版发运:#21(只有 PRD+三个 ready-for-agent 子 issue,release notes 勿计入)、#18 的点击跳转半边(v0.4.5 只兑现了通知带会话名,`notify.ts` 无 action/回调链路)、#16 的自定义音频半边;验收方法经验:历史脏行与代理透传行为没法靠真实模型稳定复现故用 SQLite 夹具会话造,但 `code_run` 报错那条坚持真跑——它验的是 GA 错误信封形状这个 coupling point 本身,夹具造等于自证;galley#13 的 tauri 2.12 触发线距上次表态已三周,值得查一次是否已发布
- [会话消息队列](./2026-08-12-session-message-queue.md) — galley#19/#20 合成一个 feature(#20 是队列在 stopping 态的特例,#19 的「插队」= 自动执行一次「暂停→排队→停止完成自动发出」);调查推翻两个前提:一是「运行中 send 是错误路径」——实为**事件流损坏的 de facto 排队**(Core `dispatch_session_send` 不检查 `agent_running` 就透传,bridge 收到 mid-run 消息立刻 `run_in_progress.set()`+`_emit_turn_start(1)`,把还没开跑的排队消息谎报为已开跑、两个进度 drain 互踩),故 CLI 改为默认走 Core 队列(`dispatch:"queued"` additive)而非加 `--queue` 保「现有行为」;二是 GA 引擎层已有串行队列但**不可控**(`abort()` 开头 `if not self.is_running: return`,排队中未开跑的任务无法撤销/插队/abort 后照跑),故队列必须建在 GA **之前**、GA 内部队列永远只持有当前活跃任务;队列挂 Core `RunnerManager` per-session `VecDeque`(Rule 5 + CLI/GUI 同权);**出队门用 `open_run` 而非 `agent_running`**——后者 TurnEnd 也清零,轮间有假空闲窗口会让队列抢在下一轮开跑前挤进去;统一入口 `dispatch-or-enqueue` 在 Core 内原子判定,天然免掉「点发送瞬间 run 恰好结束」的竞态;落库时机 = 出队下发时(排队项不进 transcript,否则消息序≠执行序 + 撤销项留幽灵行);不持久化(重启丢队列≈丢草稿);ask_user 挂起时队列让路(否则替用户把问题答掉);崩溃兜底 = 队列原地保留(挂 session 键不挂 `RunnerProcess`,respawn 不丢)+ 手动「立即发送」,不自动重拉;连发严格按序不合并;bridge 留 mid-run 业务拒绝闸防事件流再被别的路径打乱;v1 纯文本(带图走 image-block toast);两个坑:drain task 误用裸 `tokio::spawn` 而 Tauri setup hook 无 runtime → 改 `tauri::async_runtime::spawn`;插队抢占后提问气泡残留 → `turn_start` 改为无条件失效 `pendingAskUser`,不再依赖 user-row append 事件
- [运行中动作槽变体裁决：定 B](./2026-08-12-queue-slot-variant-verdict.md) — 消息队列(galley#19/#20)的 composer 动作槽三变体真机实测;槽保持 Stop、Enter 排队;几何稳定先例 + 失败模式不对称 + 可逆性;A/C 与切换器已拆
- [PRD 非目标清单对账](./2026-08-12-prd-non-goals-reconcile.md) — 查「artifact 要不要做视觉处理」时发现 PRD §6.3 把 **Follow-up Queue** 列为非目标，而那正是 8/12 刚发的 `v0.4.6` 主功能（PRD 是 v0.3 / 2026-05-15 写的，两份非目标清单都以 v0.2 为锚点）；两条漂移：① Follow-up Queue 已发运，移除；② **「自动安装/升级/修复 GA」现在同时是真和假**——attach 模式仍成立且是宪法 Rule 1 硬约束，managed 模式**恰恰相反**（managed runtime 自 `v0.2.0` 随包发运，Galley 装它升它打 patch，是产品引擎），**这类「字面没错但丢了限定词」的漂移比「发运了忘删」更隐蔽**；§6.2 五条里三条写「v0.2 不做」是死锚点，删锚点但**不借对账之机调整任何一条强度**（原文「留 v0.6++」的仍留 v0.6++）；新增 §6.3a「已发运，不再是非目标」表 + 维护规则——**光删不够**，因为非目标清单的主要读者是跨 session 的 agent，它拿这份清单判断「这提议是不是早被否过」，静默删除会让下次把同一条当新提议重提；仍成立的：完整 IDE（补注 `PatchView` 不算）、Context Window 占用展示、**Artifacts 一等公民**、完整 tracing/多人审批/RBAC；未做：§17/§20/§21 同样有 v0.2 锚点漂移，留独立对账
- [waku 前端细节通读：取一条，其余归档](./2026-08-12-waku-frontend-sweep.md) — 通读 waku `src/app/`+`src/ui/` 找设计与动效细节，**只有一条是真缺陷**：`ToastHost` 是平的 `setTimeout(dismiss,6000)` 无悬停暂停，而 Galley toast 带 `重启 Channels`/`查看项目`/`查看 Goal`/`重启更新` 这类 CTA——鼠标伸向按钮路上 toast 消失就点空，慢读的人更易触发，故是缺陷不是打磨；实现 = `held`（悬停**或**焦点在内，动作按钮 Tab 得到故焦点也算，`onBlurCapture` 用 `contains(relatedTarget)` 排除内部控件间移动）暂停并把剩余时间存 ref，恢复时续跑且下限 `Math.min(800, total)`（只剩 40ms 时立刻消失读作「toast 在躲鼠标」；下限不超调用方预算），规则抽成纯函数 `lib/toast-timing.ts` 可单测；**学到没做的手法**：入场从 0.4 起而非 0 起（waku toast 位移 8px/opacity 0.4→1 读作「本来就在正在落位」，Galley 位移 2px/0→1 读作「凭空出现」，150ms 尺度从 0 淡入易读成闪烁）、**reduce-motion 的静止帧应被设计而非只是关掉**（waku 三点波浪停在循环首帧＝有方向的省略号，Galley 一次性 8 个 class 设 `animation:none;opacity:1`）；**待实机确认三条**：折叠展开时阅读位置（`overflow-anchor` 与自定义 sticky-bottom 打架）、菜单打开时 composer 视觉焦点丢失（Radix 真移焦点）、陈旧滚动偏移泄漏进新列表；**Galley 已持平或更好勿重提**：队列 chips 取回编辑、`UserQuestionRail` 的 hover-intent 比 waku 细、rename/archive 不 bump `last_activity_at`（`api.rs:191` 早有契约）、无 document 级 Escape→stop、macOS 保留原生 overlay scrollbar；侧栏相对时间 JC 决定不做，但补准事实——waku 那个时间 running 时是**当前 turn 已跑多久**、settled 时才是距上次回复多久，本身就是停滞信号，日后若真要做应是**条件信号**而非常驻列
- [流式 markdown 补全：只补代码 span 和链接目标](./2026-08-12-streaming-markdown-mend.md) — waku `mend.rs` 对照的第三条产物；先把「值不值得做」变成可测量（**回溯改动** = 某帧渲染出的纯文本不是上一帧的纯追加）再决定，而不是让人盯屏幕：典型中文技术回答 509 字符 / 84 帧 @20Hz 测得**16 次回溯、位移 230 字符、单次最大 75**，约每 32 字符重排一次，且这是下界（计数器看不见 serif→mono 的额外宽度变化）；按构造归类**行内代码 59% / 链接 35% / 强调仅 6%**——数字直接砍掉原方案，**强调不做**（占位移 6% 却是 CommonMark 定界符消解那套开定界符栈+欠闭合计数的复杂度大头，且补错会让文字先斜后粗地闪，等于用一种抖动换另一种），表格弹跳（`| a | b |` 缺分隔行）是 GFM 语法所致补不出来，`[文字` 无 `](` 时不碰（散文方括号远多于链接）；**推翻一个前提**：半截 URL 现在就能点是 `remark-gfm` autolink literal 造成的**既有问题**、不是补全带来的，故 pending 哨兵并入本次而非单独做（`galley:pending-link` → `markdownUrlTransform` 映射 `null` → `href` 整个不出现，锚点仍匹配 `[&_a]` 故 URL 落定零位移但不可点不可聚焦）；**「显示态/落定态」分离在 Galley 是白得的**（流式 partial 与落定 turn 本就是两条渲染路径，补全只挂前者，故只需「对已闭合输入是恒等」这一条单测即可保证落定语义）；结果 16→6 次、230→20 字符（**次数降 63% 位移降 91%**，剩下全是强调且都很小——让重排显眼的是位移幅度不是变化频次）；回归测试断言用相对阈值（位移≤25%）避免 react-markdown 升级误报
- [markdown 纵向节奏挂上字号档位](./2026-08-12-markdown-vertical-rhythm.md) — waku 对照的第二条产物，核实后发现**不是整洁问题、是现存偏差**：会话字号三档（13.5/15/16.5px × leading 1.65/1.70/1.75）字号和行高都跟随，但 `PROSE_BASE` 每个纵向间距都写死（`my-3`=12px 三档不变），段间距÷行盒高 small 0.54 / standard 0.47 / large 0.42——**用户调大字号想要更松，相对分离度反而掉 23%**，方向与意图相反；是 2026-07-05「块代码硬编码 13px 不跟随字号」的**第二层**（那次是尺寸、这次是间距，后者更隐蔽因为只表现为"比例感有点怪"）；方案 = 一个 `--conversation-block-gap` 随档位注入（10.5/12/13.5）+ 其余全写成倍数；裁决点「保留区分 vs 压成纯倍数」JC 定**保留**（代码块/表格 1.1667× 比正文多喘一口是有意义的、标题 close 阶梯 12/10/8/6 原样留）；发现现有 4/6/8/10/12/14/16/20 除以 12 恰是 1/3·1/2·2/3·5/6·1·7/6·4/3·5/3 **本就是以 12 为基数的六分族**，故改动零视觉值变化；两个坑：`:root` 12px 兜底**不可省**（`MarkdownView` 也渲染在 `TutorialModal` 等未注入档位变量的根之外，变量缺失时 `font-size:var()` 只是回退继承看着还行，`margin:calc(var()*N)` 却 invalid → margin 归零 → 文档糊成一坨），倍数须写**字面量**（Tailwind 扫源码文本找候选，模板字符串拼的 arbitrary property 不会被 emit，别抽函数）；验证除 typecheck/lint/测试外另跑 build 在产物 CSS 里核对规则确实 emit
- [行内代码变体裁决：定 C](./2026-08-12-inline-code-warm-ink.md) — 对照 egoist/waku（Rust+GPUI 本地 coding agent 端，GPL-3.0，**思路可借鉴代码不能抄**）打磨主对话区 markdown；截图里"版本号/文件名/路径带底色"查证后就是**行内代码**、无实体识别；核心差异不在底色而在**区分维度**——waku 换色相（`#9A5528` 暖赤褐，亮度对比反而低于正文），Galley 降明度（`ink-soft` + 0.86em），后者把路径/文件名/版本号这些"最需要认清和复制的内容"读成了"不太重要"；三变体真机实测定 C：新 token `--color-code-ink`（浅 `#9A5528` / 深 `#E0A882`，与杏沙 brand 同族）+ 0.92em + `box-decoration-clone`（长路径软换行时续行不丢 padding/圆角，`CommandPalette`/`MessageUser` 早就在用、markdown 是漏网的）；**暖色预算零和故链接让位**（`text-ink` + `ink-muted` 下划线，hover 才转 `brand-strong`——下划线本就承载可点性、颜色冗余；频率决定分配：agent 回答里路径多外链少）；B（低彩度）输在 Galley 衬线正文本就与 mono 字形对比强、克制两头不靠；`thinking` 共用 `PROSE_BASE` 故思考摘要行内代码也走暖色，若日后觉吵应在 `PROSE_THINKING` 单独压一档而非回退；同轮未采纳待议四条见 entry 末（流式悬挂标记补全 `mend.rs` 消抖 **推荐但需先实机确认**、间距节奏派生自单一 `block_gap`、任务列表 checkbox 现为系统原生方块、增量解析 stable boundary **先测再修**）
- [失败输出可读性](./2026-08-12-error-display-readability.md) — galley#22 三症状(错误带传输信封平铺无 headline、`\r\n`/`\\` 不解码、`<invoke>` markup 渲染成 assistant 正文并泄漏进 session summary);地基判断是**纯呈现层问题、数据里该有的都有**,故不改 IPC/GA/不迁移历史行,全部渲染时修;GA 错误信封识别走**精确匹配**(`status` 恰等于 `"error"`,与 `denied` 同级的 coupling point,非内容嗅探;GA 换形状会静默退化成 `success-historical` 不会炸,每轮 baseline 升级应 grep);headline 提取**刻意收窄**为 traceback 末行或 `msg` 首行,不对自由文本猜测——headline 占的是折叠态唯一可见位,猜错比不猜更坏(用户会照错原因排查),故字段可选;traceback 取末行 + 错误体做**尾部**截断(异常行在最后,banner 与栈帧才是可丢的);markup 主导判定用 starts-with(GA 兜底 recap 从回复首字符开始截,真泄漏必顶在最前;正常散文提到 `<invoke>` 不误伤),runner/GUI 双端同形状;runner 写**固定常量** `TURN_PROTOCOL_FAILURE_SUMMARY` 而非清洗后文本——剥完标签剩 `code_run script import json` 这种脚本残渣信息量为零却像内容,且固定常量才能被 GUI 精确匹配换成 en 文案(CLI 消费者看 verbatim 中文,Agent API 不做 i18n);`failed-historical` 折叠而非强制展开(`-historical` 惯例,headline 已摆在折叠行);泄漏 markup 正文不走 MarkdownView 而是 `ProtocolFailureNotice`(借 callout 形制,**无 Copy/Save**——没有可交付物给保存按钮是骗人),配套流式防闪现 + `RunComplete.finalContent` 置空防自动标题拿脚本拟标题(**仅对 markup 泄漏置空**,正常错误内容原样放行);验收两处疑问结论均为实现无误:callout 展开是因 `useState(cfg.defaultOpen)` 只在挂载取值、live 路径以 `running` 挂载 + keep-expanded 指针有意保持展开(折叠只在恢复路径可见,`success-historical` 一直如此),最终回答那段 traceback 是模型自己的答复;扫出两条打磨另开 `.scratch/tool-callout-polish/`
- [thinking 计时器与 shimmer 裁决：定 Shimmer](./2026-08-12-thinking-timer-and-shimmer-verdict.md) — 等待态计时器 0 秒起跳 + 0.1s 精度（十分位快速走字化解「立即读数太机械」的旧反对，3 秒门槛随之删；60s 后转整秒——分钟量级抖十分位会由「有进展」滑向「焦躁」）；「仍在运行」与「已」前缀删（跳动数字即活性证明，安抚文案冗余）；**步内意外归零修复**：占位与流式抬头原是两个兄弟条件槽位、首字落地时 React 重建 marker 时钟跳回 0，合一后时钟连续 = 本步总耗时；**run 总时否**——目的论裁决：这行职责是降等待感非展示信息，累积大数字是盯锅效应、每步归零的小数字才是把长等待切短，且 `RunElapsedHud` 右下浮卡早已承担 run 计时（「live 归外围」的落地，讨论时双方都没召回它），行内再加是第三处；工作指示三点 vs 状态文字扫光真机 A/B（右上 pill + localStorage）定 **shimmer**，实质是 §2.7 已裁决案重审（thinking 行正是「逐字波浪 → 三点 + 计数器」旗舰案例）：元素经济学（新秒表已是行内最强活性信号，三点沦为第三并列元素；shimmer 把动效折进已有文字，信号源 3→2，**规则字面与精神打架时精神赢**）+「LLM 正在思考」语义上扫光已是约定俗成（Claude/ChatGPT 同款）+ 连续光带 ≠ 当年删的逐字波浪且旧前提（计数器 3s 后才上岗、需三点掩护空窗）已不存在；§2.7 开**唯一豁免**：仅 in-flight 状态文字、一视图至多一处，骨架/容器/装饰性 shimmer 照禁；LiveDots 其余三站点（ToolCallout/RunElapsedHud/GoalRunMarkers）语义是工具/run/goal 级忙碌非「LLM 思考」，暂不统一记 deferred；**后记：deferred 启动信号当日触发**（浮卡与 shimmer 行都挂 `isRunning` 必然同屏，记 deferred 而非当场处理是判断保守），RunElapsedHud 出列——三点删（计数器即活性，不上 shimmer 守一视图一处；「外围加强」例外够不着悬在会话区视野内的浮卡）+ 时长改会话方言（`2m15s`→「1 分 23 秒」，`formatElapsedCompact` 唯一消费者即浮卡随删，与折叠头「用时」同语交接），deferred 收窄至 ToolCallout/GoalRunMarkers
- [折叠头展开/收起动画](./2026-08-12-run-fold-animation.md) — 原折叠是整段 DOM 瞬时进出，唯一动效三角旋转反衬更生硬；§2.7 展开/折叠明文 A 类（不削减反而加强），无需重审规则；采纳 `grid-rows 0fr↔1fr`+opacity（height:auto 动画的免测量解法，transition 可中断可反向合 P9），时长守 token `--motion-slow`+`ease-firm`，参考的 400ms 字面量不进代码；**否决逐行 stagger**——参考里它服务于工作中新行陆续出现（一次性入场合法），我们是手动展开已存在内容，每次展开重放入场正是 P9 禁的模式，且任意长文档流不可伸缩；两处非显然设计：①**最终步 marker+StrongHr 搬进动画区**（`AgentTurnView` 拆 `markerOnly`/`hideMarker` 两半，原 answerOnly 在折叠瞬间 ~80px 突跳是生硬感另一半；回答体常驻区外永远可见只平滑滑动）②**margin 编排**（grid=BFC 杀死 mt-6/mb-2.5 兄弟折叠 24→34px，包装器 `-mt-2.5↔mt-0` 随 rows 同步过渡，两端点分别精确落回平铺 24px 与折叠 10px hug；底边免补偿因区外回答体零 margin）；取舍：闭合区不渲染子树保 DOM 经济（卸载 300ms 定时器而非 transitionend——reduce-motion 下后者永不触发）、run 展开态完成瞬间重挂载仅丢 run 中手动收起的 callout 态、超大内容跳过动画的保险丝先不做真机观察

### 2026-08-10
- [社区 issue 分批落地与 Settings 打磨](./2026-08-10-community-issues-triage-and-settings-polish.md) — 通知音三音调(done/needsYou/alert,省略 sound 即静音,UA 嗅探否 plugin-os);health ga_path 按运行时分警级;反馈通路 B+A+D(Settings 报告问题 tab + issue forms 预填 + 载荷预览「所见即所发」,否常驻 chrome,About 区块加了又删);#14 Retry/Continue 否决入 deferred;rail 右侧三理由裁决;Settings 入场运动三连修(Channels 闪跳 ready 门槛+缓存、Models 联动展开残留、模型列表软失败 404 归 success/no-list)
- [Footer 三个数字:单位不一致与仪表的量程](./2026-08-10-footer-telemetry-units-and-tooltips.md) — `↑↓` 是 token、`⏲` 是字符,并排同款式暗示同类;识别出更深一层是 flow(每轮流量)vs stock(会话存量)两个范畴,单位只是表征;否「统一单位」——`context_win×3` 的 ×3 是 GA 启发式,字符才是 trim 的真实测量,除回 token 是在真值上套反向估算得假精度,与旁边 provider 返回的真值并置更误导;故行内仪表改只显示百分比(无量纲),绝对值退 tooltip;反转一:tooltip 反而该用 token(JC 裁决)——`270000÷3=90000` 正是 Settings 里的 `context_win`,分母对上用户自己设过的数,保留「约」标记区分精度;`↑` 拆缓存但只拆 cacheRead(计费权重 fresh 1×/create 1.25×/read 0.1×,create 折进总量失真小;read 是正面信号+可诊断,`0017` 当初就靠 `↑0` 暴露);dogfood 发现第二层——`↑3.5k` vs 仪表 `59` 差 60 倍,根因 `context_usage()` 只测 `backend.history`,system prompt+tools schema 每次都发但不在 history(实测 ≈3.4k token 正好是差额),且**必须**只测 history 因为 `trim_messages_history` 只裁 history,加进去反而与裁剪阈值脱钩;反转二:tooltip 说明用负面表述「不含系统提示与工具定义」而非我提的正面「仅计会话历史」(JC 裁决)——用户的疑问形态是「为什么小 60 倍」即关于差额,负面表述当场闭合;层级用最低墨色+6px 间距不压字号(11.5px 中文已到地板);否 `↑` 也拆两行——注解(永不变、读一次)该压低,数据(每轮在变、正是用户要的答案)不该,且 `↑` 第二行条件性存在会致 tooltip 高度抖动;由此立规则进 `tooltip.tsx`:第二行是注解→最低墨色,是数据→同权重,条件性额外行留单行;`0%`→`<1%`(非空历史舍成 0% 在会话早期像坏了);坑:`Metric` 未 forwardRef+spread 会让 Radix `asChild` 的事件丢失、tooltip 静默不弹而静态检查全绿
- [自动标题元层泄漏:side_ask 带着系统提示去要标题](./2026-08-10-auto-title-system-prompt-conflict.md) — 英文标题前挂 `**` 且主题不对(`**Resolving title and summary conflict**` 出现在一场相容论哲学讨论上);确认非英文表达问题而是命名对象错——标题描述的是模型当时纠结的事,且起得很规范(守 6 词限)反证不是能力问题;根因:`summary` 一词在 title prompt 里根本不存在,只能来自 `raw_ask` 的 `payload["system"]`——`side_ask` 无 history 但**带系统提示**,`sys_prompt.txt` 的 `<summary>` 与 `managed_prompt.rs` 的 `<next-suggestion>` 强制要求撞上「只输出标题本身」,模型把冲突本身当了主题;同根因第二种表现更隐蔽:模型服从则输出 `<summary>标题</summary>` 被 `_TAG_PATS` 整块剥空→标题静默丢弃(表现为「标题有时不更新」);修法根治(prompt 显式豁免两标签+点明标题主题是对话内容,两条缺一不可)+兜底(`_clean_generated_title` 改循环剥壳,单趟固定顺序处理不了 `**标题：x**` 与 `「**x**」` 的反向嵌套;markdown 只做对称剥离,`parse_title_only`/`a*b` 进单测当守卫);否 side_ask 清 `backend.system`(破 read-only 契约+与并发 turn 竞争)、否清洗侧提取 `<summary>` 内容(适应冲突而非消除,且同标签两路径语义不一致);局限:根治半边单测证不了,标签遵从率 08-05 已翻过车,dogfood 需专开英文会话;补记耦合事实「side_ask 带 system」——此前两处文档只写了「不带 history」
- [GA upstream 升级 d8d90ee -> 308153b](./2026-08-10-ga-upstream-upgrade-d8d90ee-to-308153b.md) — 15 commits/7 天,插入行数最误导的一轮:~90% 是新 P2P 栈(`p2p_ws_client.py` +1045)等前端,引擎核心仅四文件 49 行,`agent_loop.py`/`pyproject.toml` 零 diff;引擎实质是限流错误改判为网络错误(`_parse_claude_sse` 抛 `ConnectionError` 进 `_stream_with_retry` 重试)、退避 1.5→3.0、context 默认值 30000→35000 与 `cut_msg_interval` 5→7;**当天更正**(JC 追问触发):初判「裁剪推迟、看长会话」对 Galley 不成立且方向相反——`cap=context_win*3` 只看显式设的 90000 故 trim 一动没变,真正变的是拿 `default_context_win` 当**分母**的 `maxlen_multiplier`(2.25→1.93 降 14%),经 `get_ctx_multiplier`→`_get_tool_maxlen` 把**工具输出上限压了 14%**(`file_read` 33750→28928 等),dogfood 该看工具输出是否更早撞 `[Truncated]`;教训:评估上游默认值变化先查下游有无显式覆盖,覆盖后该常量常只作分母间接生效、方向可能反转;`0007` 连续第二轮成为唯一冲突——上游在它插 codex 凭据块的同一行抬高 context 默认值,裁决保留 codex 行 + 采纳上游新默认(该行只是零上下文 hunk 顺带的尾巴,`0007` 与 context 无关);origin discipline 查证 `_i()` 空值兜底(`a1e470b`)**不吸收** `0017`(前者是到达值的类型安全,后者是 compat provider 的 input 根本不到达),补丁保留;方法论:预测 `0017` 零上下文 hunk 会漂移是对的,但 commit-chain rebase 三方合并重导出后 `0016`/`0017` 字节未变——行号算术看着对却是错的中间态,正是不该手改 hunk 的理由,改以 payload 语义 grep + `test_managed_ga_llmcore` 验证落点;hub 从远程查看功能升格为常驻观察项(联邦 peer bus,任何本机进程可对已接入 agent `put`/`abort`,绕过 Core 审计与确认闸门;今日隔离靠 `hub.connect()` 在 `__main__` 块内而 Galley 以模块导入 agentmain,属偶然非设计,建议每轮 `grep hub.connect managed-ga/code/` 守卫);顺带补掉 `0016` 缺失的 ledger 行(16 补丁栈只有 15 行)
- [v0.4.5 发布](./2026-08-10-v0.4.5-release.md) — 聚合 `v0.4.4..HEAD` 18 个提交;**首个由真实用户 issue 驱动的版本**(galley#15/#16/#17/#18),发版性质随之变化:此前几个 patch 发不发是自家节奏,这次有人在等——#17 意味着他们此刻收不到提醒、#15 意味着下个问题可能根本报不上来,反馈通路本身坏了故优先;patch 定级(沿用 v0.4.1 规则按最大单功能判,最大单项「报告问题 tab」属 Settings 面增量);#15 的修法要点是入口不可见与入口不存在对用户是同一件事——那行链接本就存在,但夹在版本号与致谢间读作 colophon,故搬出单独成块并补 macOS Help 与 Windows 托盘两路;与 v0.4.4 最大差别是 **GA baseline 变了**(`d8d90ee`→`308153b`),bundled runtime gate 从「可跳过」变「必跑」且已跑(mac-x64 153M,managed GA import 通过);本版唯一回归风险是引擎升级把工具输出上限压了 14%(`maxlen_multiplier` 2.25→1.93 作分母),观感是 `[Truncated]` 来得更早,列为 smoke 首要项;smoke 另三项:英文会话自动标题(根治的 prompt 半边单测证不了、中文路径从未坏过)、三种通知音(需装机版,tauri dev 在 macOS 不出通知)、报告问题 tab 载荷预览与 GitHub 表单预填是否对得上

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
