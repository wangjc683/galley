# B4 M9 sub-plan · v0.2.0-beta.1 release ceremony prep

> **Status**: draft, ship 前 review。Sub-plan 完成后开 paperwork。
> **Parent**: [B4 playbook M9](./B4-cli-bg-artifact.md#m9--b4-acceptance--v02-ship-准备-d65)
> **Date**: 2026-05-20

---

## 0. TL;DR

M9 是 v0.2.0-beta.1 release ceremony，但**今天能推**的只是 paperwork 子集。`git tag v0.2.0-beta.1` / CI build / GitHub publish 都要等 A14（1-week dogfood）+ A12（M7 dogfood）+ A10（M5 dogfood）+ A11 真 dogfood 全 tick。

**今天 paperwork scope**:
1. T9.0 本 sub-plan ship
2. T9.3 README rewrite（v0.1 工作台 framing → v0.2 dual-native）
3. T9.4 v0.2.0-beta.1 release notes draft
4. T9.7 PRD / refactor README v0.2 align

**今天不做**：
- T9.1 A1-A14 acceptance run（A12/A10/A11 需要 JC dogfood）
- T9.2 1-week dogfood（calendar gate）
- T9.5 tag v0.2.0-beta.1（dogfood 完才能 tag）
- T9.6 GitHub Release publish（依赖 T9.5 + CI 出 artifact）
- T9.8 B4 完成 devlog + v0.2 release devlog（ship 后写）
- T9.9 sophub 投稿（optional + post-ship）

DESIGN.md onboarding subtitle 改 dual-native framing（playbook T9.3 mention）放到本 session paperwork —— `gui/src/components/onboarding/StepWelcome.tsx` 是 React 文案改不是文档，留 M9 ship 阶段再动。

---

## 1. Scope assessment vs playbook

| Sub-task | Today paperwork? | 触发条件 | 备注 |
|---|---|---|---|
| T9.0 sub-plan | ✅ | now | 本文件 |
| T9.1 A1-A14 acceptance run | ❌ | M9 ship session | 几条 partial ✅ 等 dogfood 转 ✅ |
| T9.2 1-week dogfood | ❌ | calendar gate | JC 用一周观察零 P0/P1 |
| **T9.3 README rewrite** | ✅ | now | 本文件 §3 详细 |
| **T9.4 release notes draft** | ✅ | now | 本文件 §4 详细 |
| T9.5 tag v0.2.0-beta.1 | ❌ | dogfood 后 | git tag + push |
| T9.6 GitHub Release publish | ❌ | T9.5 后 | draft prerelease；不标 Latest |
| **T9.7 PRD / refactor README align** | ✅ | now | 本文件 §5 详细 |
| T9.8 完成 devlog | ❌ | post-ship | 两个 entry: B4 工程过程 + v0.2 产品 milestone |
| T9.9 sophub 投稿 | ❌ | optional | post-ship |

> **G1 (today)**: T9.3 README rewrite 是 staged paperwork —— 写到 `README.md` 但 v0.1 用户看到的还是 git HEAD 这版（v0.2 ship 时 tag 自动 freeze 这版到 release page）。commit 信息要明确这是 "v0.2 framing draft"，避免读者误以为 v0.2 已发。

> **G2 (today)**: T9.4 release notes 不写到任何文件，而是 sub-plan 内附 draft。M9 ship session 时再正式写入 GitHub Release body。理由：release notes 通常 ship 时还会补「具体下载文件名 + 当天截止」等动态信息。

> **G3 (today)**: PRD.md 已经是 v0.3 dual-native framing（[CLAUDE.md](../../../CLAUDE.md) 写明），T9.7 主要是 status section / 阶段进度同步，不是大改。

---

## 2. v0.2 framing decisions

### 2.1 主语：dual-native local agent team orchestrator

PRD v0.3 已经定 framing：「local agent team 编排器，人和 agent 都是一等公民」+「Galley GUI 给坐在桌前的 human operator，Galley CLI 给 Supervisor Agent 远程操作整个 session team」。README + release notes 沿用这个 framing。

**不用** 之前的 framing:
- ❌「本地桌面工作台」（v0.1 framing，scope 太小）
- ❌「Multi-session GA frontend」（technical-first，没说价值）
- ❌「ChatGPT 替代品」（reductive + 误导）

**用 framing**:
- ✅「local agent team orchestrator」（PRD 主用）
- ✅「dual-native（GUI 给人 / CLI 给 agent）」（v0.2 卖点 #1）
- ✅「Supervisor Agent 远程编排」（v0.2 卖点 #2）

### 2.2 Tagline 候选（README 顶部 blockquote）

| ID | Tagline | 评估 |
|---|---|---|
| A | 「本地 Agent Team 编排器 Desktop，人和 Agent 都是一等公民。」（**当前**） | ✅ PRD 直译；中性；缺 dual-native 直接信号 |
| B | 「Dual-native local agent team orchestrator. GUI for humans, CLI for supervisors.」 | ✅ 信号最直接；但中文读者要先翻译 |
| C | 「让人和 agent 都能编排你的 agent team。」 | ✅ 短；但「agent team」+「编排你的 agent team」重复 |
| D | 「本地 agent team 编排器 —— GUI 给人，CLI 给 supervisor agent。」 | ✅ 中文直接 + dual-native 信号 + 不冗余 |

**选 D**。当前 A 留作 fallback。

### 2.3 Hero 章节顺序

README 当前结构：
```
1. tagline
2. 截图大图
3. badges
4. Galley 是什么
   - 今天（v0.1）
   - v0.2 之后
5. 功能
   - 今日（v0.1）
   - 即将（v0.2）
6. 截图小图
7. 架构
8. 技术栈
9. 安装
10. 贡献 / 构建
11. 致谢
12. License
```

**v0.2 重写后**：v0.1 阶段表述要从「这是今天，那是未来」**整体退役**，全文以 v0.2 为现在时；v0.1 退到「演进过程」一段简短交代。具体改动 §3 详。

### 2.4 「Supervisor Agent」第一次出现给非读者的解释

README 受众包括第一次看到的人（GitHub 浏览者 / 社交分享点进来）。「Supervisor Agent」是 Galley 自创术语，**第一次出现必须自带 inline 解释**：

> Supervisor Agent —— 跑在你电脑或手机 IM 上的另一个 agent，通过 `galley` CLI 给你电脑里的 session team 派任务（你出门后还能远程指挥）。

之后段落自由使用「Supervisor」简称。

### 2.5 dual-native 解释

「dual-native」对程序员熟悉（dual binding），普通用户陌生。inline 解释：

> Galley 是 dual-native —— 既给坐在电脑前的你 GUI，也给跑在另一个进程的 agent CLI，两边对等访问同一份本地数据。

---

## 3. README rewrite plan

### 3.1 删 / 改 / 保留 map

| Section | 处理 |
|---|---|
| tagline blockquote | **改** Tagline D（§2.2 选项） |
| 致敬 Galley/GA 来源（origin quote） | 保留 |
| 截图大图（screenshot_05.png） | 保留 |
| Badges (License / Release / Platform / Stars) | 保留 |
| "Galley 是什么" section | **大改**：v0.1/v0.2 时序分裂 → 单段 v0.2-现在时；v0.1 退化为括号注 |
| Local-first + non-invasive 段 | 保留 |
| "功能" 今日/即将 split | **大改**：合并为一份「v0.2 能做什么」list；v0.1-only 不重列；GA-non-invasive / per-session LLM / FTS5 等核心能力跨 v0.1+v0.2 |
| 截图 grid | 保留 |
| 架构图 ASCII | **改**：去掉 🚧 v0.2 markers（v0.2 框架已落地） |
| "v0.1 今天 ship 的是" comment | **删**（v0.2 上下文不需要） |
| 技术栈 | **改**：去 "v0.2 实现中" 字样 |
| 平台行 | 保留（macOS + Windows） |
| 安装 / 前置 / macOS / Windows | 保留 + 微调（drop "v0.x.x" placeholder → "v0.2.x"） |
| 贡献 / 从源码构建 | **改**：`cd desktop` 已经是 [B1 后改 gui](../../../CLAUDE.md)，commands 同步 |
| 致谢 GA paper | 保留 |
| License | 保留 |

### 3.2 新增 section（可选）

| Candidate | 评估 | 决策 |
|---|---|---|
| "给 Supervisor Agent 用：装 Skill / SOP" mini-section | ✅ v0.2 卖点直接关联 | **加**，2-3 段，链接到 docs/integrations/galley-supervisor-sop.md + .claude/skills/galley-supervisor/README.md |
| "Galley CLI 速查表" | ❌ 完整 CLI doc 在 docs/agent-api.md | **不加**，README 不重复 |
| "Roadmap (v0.6+)" | ❌ 未确定，过早 | **不加** |
| "比较 X / Y / Z" 竞品对照 | ❌ 招黑 | **不加** |
| Stargazers Over Time / 性能 benchmark | ❌ 不必要 | **不加** |

### 3.3 具体改写示例

**改前**:
```markdown
**今天（v0.1）**：Galley 是 GenericAgent 的本地桌面工作台。多个 agent session 并排跑…

**v0.2 之后**：Galley 变成 dual-native ——…
```

**改后**:
```markdown
Galley 是一个本地 agent team orchestrator —— 同一台机器上跑多个 AI agent session，
左边 GUI 给坐在电脑前的你，右边 CLI 给另一个 Supervisor Agent 来远程编排
（出门后通过手机 IM 让 supervisor agent 帮你监管 session team 状态）。

Supervisor Agent —— 跑在你电脑或手机 IM 上的另一个 agent，通过 `galley` 命令给
你电脑里的 session team 派任务、看进度、改 LLM 配置（你出门后还能远程指挥）。

Galley 是 **dual-native** —— GUI 给人 / CLI 给 agent，两边对等访问同一份本地数据。

**v0.1 (历史)**：Galley 最初只是 GenericAgent 的桌面工作台（multi-session 并行 +
工具时间线 + 审批系统）。v0.2 引入 Galley Core（Rust 写的本地权威层）+ Galley CLI，
工作台 + 编排器 一体。

Galley 是 **local-first** —— 你的数据不离开你的机器。**远程访问**由 Supervisor
在外部传输层（GA IM frontend / SSH / 其他）负责，不是 Galley 的责任。

Galley 不会修改用户已有的 GenericAgent。删 Galley，GenericAgent 独立运行不受影响。
```

类似 expansion for 功能 section / 架构 section / 安装 section 内 v0.x.x → v0.2.x。

### 3.4 总长度目标

- 改前 154 行
- 改后 estimate 140-160 行（删 v0.1/v0.2 split 省一些，加 Supervisor 卡片 + dual-native 解释多一些，净大致持平）
- README 不超过 200 行，超过就拆 docs/ 子文件

### 3.5 验证

- [ ] 一遍 GitHub Markdown preview 渲染正常（ASCII 框图 / 截图 grid / blockquote / list）
- [ ] tagline + 第一段 30 秒读完能 get 到 "v0.2 = dual-native orchestrator + CLI"
- [ ] grep `v0.2 之后` / `今天（v0.1）` / `即将（v0.2）` → 0 hit
- [ ] grep `🚧` → 0 hit （v0.2 markers 全清）
- [ ] README_en.md 标 "(legacy v0.1 doc)" 或同步更新 —— **decision in T9.3 impl**

---

## 4. v0.2 release notes draft

Release notes 不写到任何 repo 文件，而是 sub-plan 内附 draft。M9 ship session 时复制到 GitHub Release body。

### 4.1 风格

沿用 [feedback_release_notes_style](../../../) 简洁优先 pattern:
- 不写 lead-in（"今天我们 ship 了..." 类）
- 不写 Alpha 含义解释
- 不写 Upstream 段
- Installation 用命令而非 GUI 描述（macOS `xattr -d com.apple.quarantine`）
- Sections: Highlights / New / Fixes / Installation / Footer

### 4.2 Draft

```markdown
# v0.2.0-beta.1 — Dual-native: Galley CLI ships

## Highlights

- **Galley CLI** (`galley` binary) — 跟 GUI 对等访问同一份本地数据，让外部
  Supervisor Agent 远程编排你的 session team
- **Agent API** schema v1 frozen — 19 个命令 stable identifier set，下游
  SOP / Skill 长期兼容
- **Galley Supervisor SOP** (给 GenericAgent) + **galley-supervisor skill**
  (给 Claude Code) — supervisor agent 集成开箱即用
- **Pre-migration backup** — schema migration 自动备份数据目录，零数据丢失风险

## New

- Galley CLI 11 个 write 命令（session new / send / btw / stop / archive /
  restore / move / project create / list / delete / llm list / set）
- localhost-only Unix socket / Windows named pipe transport
- Settings → Agent tab：可选安装 `galley` 命令，复制 Supervisor SOP
  发给你信任的 Agent
- TopBar supervisor activity pill + per-message origin annotation
- macOS menubar daemon mode（关窗不退出，留在 menubar）

## Fixes

- (from v0.1.1 dogfood) `availableLLMs` serde camelCase 修复
- (from v0.1.1 dogfood) Spawn `io::Error` 不带路径修复
- (from v0.1.1 dogfood) `gaConfig.python` capability alias 修复

## Migration

升级跑 schema 迁移时自动备份 `~/Library/Application Support/app.galley/`
到 sibling `app.galley.backup.<UTC-timestamp>/`。失败拒启动 + dialog 给出
数据安全位置。

## Installation

### macOS
下载 `Galley_0.2.0-beta.1_macOS_aarch64.dmg`（Apple Silicon）或
`Galley_0.2.0-beta.1_macOS_x64.dmg`（Intel），拖到应用程序文件夹，跑：

```
xattr -d com.apple.quarantine /Applications/Galley.app
```

### Windows
下载 `Galley_0.2.0-beta.1_Windows_x64-setup.exe`。SmartScreen 警告点 "更多信息"
→ "仍要运行"。

---

🤖 [B4 完成 devlog](https://github.com/wangjc683/galley/blob/main/docs/devlog/2026-05-20-b4-cli-feature-complete.md) · [agent-api.md schema v1](https://github.com/wangjc683/galley/blob/main/docs/agent-api.md)
```

### 4.3 ship 时还要补的动态信息

- 具体 `Galley_0.2.0-beta.1_*` 文件名（CI 出 artifact 后填）
- B4 完成 devlog 路径（M9 T9.8 写完才有）
- Supervisor 集成新功能图（截图）

---

## 5. PRD / refactor README v0.2 align

### 5.1 PRD.md 状态

- PRD 已经是 v0.3 dual-native framing（per CLAUDE.md）
- 主要 align 工作：阶段进度 / B4 状态 update（B4 7/9 milestones shipped）
- v0.2 milestone 行更新（10月底-11月初 时间表 → 实际 ship 日期 placeholder "TBD" + 显示已完成项）

### 5.2 docs/refactor/README.md 状态

- 当前 105 行；中央调度器索引
- align 工作：B4 状态 column 加 "M1/M3/M5/M6/M7/M8 ✅ + M4 partial + M2/M9 ⏳"
- B4-M8/M9 sub-plan 加链接

### 5.3 CLAUDE.md status

已经在 M8 closeout 时更新过 stage 9 row（包含 M8 ✅ + B4 status 7/9）。M9 paperwork session 不动 CLAUDE.md。

---

## 6. Commit shape

**Single docs commit**：M9 paperwork 是一个语义单元（sub-plan + README + PRD align + B4 playbook M9 sub-task tick）。Release notes draft 在 sub-plan §4 内 inline，不单独存档。

```
Docs: B4 M9 prep — sub-plan + README dual-native rewrite + PRD align

- docs/refactor/B4-M9-sub-plan.md (NEW)
- README.md — v0.2 framing rewrite
- docs/PRD.md — B4 阶段进度 align
- docs/refactor/README.md — B4 status column update
- docs/refactor/B4-cli-bg-artifact.md — M9 sub-task ticks (T9.0/T9.3/T9.4/T9.7)
```

Closeout devlog 不写 —— M9 paperwork 不是 milestone ship，M9 真正 milestone 是 v0.2 release。Closeout devlog 在 v0.2 ship 时写两个 entry（T9.8）。

---

## 7. Open decisions

- [ ] **O1** README_en.md 同步更新还是标 "(legacy v0.1)"？倾向**标 legacy**，v0.2 ship 后再做英文重写（防止本 session paperwork 过长）
- [ ] **O2** Tagline 选 D 还是 A？倾向 **D（`本地 agent team 编排器 —— GUI 给人，CLI 给 supervisor agent`）**
- [ ] **O3** 截图 grid 是否 v0.2 更新？倾向**不动**，v0.1.1 6 张 hero 截图（screenshot_01-06）+ screenshot_05 hero 仍有效，supervisor 功能 GUI 改动小（TopBar pill / annotation strip 不显眼，不值单独截图重做）
- [ ] **O4** 「Galley CLI 速查表」加在 README 还是单独 docs/galley-cli-cheatsheet.md？倾向**不加**，docs/agent-api.md 是 canonical reference

---

## 8. References

- B4 playbook M9 段：[B4-cli-bg-artifact.md §M9](./B4-cli-bg-artifact.md#m9--b4-acceptance--v02-ship-准备-d65)
- PRD：[docs/PRD.md](../../PRD.md)
- README：[README.md](../../../README.md)
- Release notes 风格：feedback_release_notes_style memory

---

## 9. End of M9 sub-plan
