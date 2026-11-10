# 05 文档：SOP 过时事实、章程、归档、评测输出、PRD、超长文档、README、手动兜底流程

Status: ready-for-agent

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 B12、B13、C16、D21、E25、E26、E27、E28（JC：「按建议推进」）。

先读 `docs/agents/dispatch.md`、`docs/README.md`（文档生命周期、Update Triggers、Keep Docs Lean 三节是本票的规则）、`docs/copy-language-guidelines.md`。本票不跑 cargo、pnpm、pytest。

通用规则：英文文档保持英文，中文文档用全角标点；`docs/devlog/` 的条目与 `docs/archive/` 里已有的文件不改内容；每条事实先对着代码或 git 核对再写；开源仓库，不写本机路径、私有地址、真实个人数据。

## 1. 改哪些文件

`docs/`（除 `docs/agent-api/`、`docs/ipc-protocol.md`、`docs/design/onboarding-and-cards.md`，它们另有票在改）、`README.md`、`README.zh-CN.md`、`.gitignore`、`.scratch/main-chat/entry-layer-eval/` 下的 `results.json`（只从索引里移除）、`.claude/skills/` 与 `.agents/skills/` 里 Supervisor 参考文档的副本。

## 2. 怎么改

一组一个提交。B12、B13、E27 三组是给 JC 过目的文字，**各自单独提交**，回报里把这三组的 diff 要点列出来。

**B12 Supervisor SOP 与参考文档的三处过时事实**

`docs/integrations/galley-supervisor-sop.md` 与 `galley-supervisor-reference.md` 随包下发给 agent，也被两份 skill 副本逐字复制。
1. 步数上限：现在写的是「180 steps, 100 in plan mode」一类的话。内置内核自 2026-10-18 的基线升级起没有计划模式的单独上限。先在 `managed-ga/code` 里核实现在的上限，再改成只说内置内核的那一个数；外置 GA 的版本各不相同，别替它下断言。`docs/ipc-protocol.md` 里同一句话不在本票范围，写进回报。
2. 参考文档里 pin 的是 `--schema=1`，SOP 说 `--schema=3`：参考文档改成 3。
3. 参考文档里把当前应答写成 `"schemaVersion":1` 的示例改成 3（讲版本 1、2 历史的句子不动）。
4. 参考文档的维护说明描述「IM 提示词复述 SOP 的规则」，而 `core/src/managed_prompt.rs` 的测试现在断言的是相反的事（提示词指向 SOP，不复述）。读那条测试，把维护说明改成现状。
5. 按 `docs/README.md` 的 Update Triggers 那一行收尾：重新同步两份 `references/` 副本，更新它们的「Last synced」头，核对 `core/src/managed_prompt.rs` 仍与 SOP 一致（只读，不改它），跑 `node scripts/check-supervisor-sop-drift.mjs`。

**B13 `docs/temperament.md` 的拒绝清单（起草稿）**

章程自己的规则是：要推翻一条拒绝，先改章程。产品已经推翻了至少三条：主对话用 IM 气泡、设置里有保存按钮、有 toast。对每一条：在主聊天 PRD（`.scratch/main-chat/PRD.md`）、设计文档与 devlog 里找到推翻它的裁决（编号与日期），把这一条改写成现状并引上出处；找不到裁决出处的，不改，列进回报。不新增拒绝，不改章程的其他部分。这是给 JC 改的起草稿。

**C16 归档 `docs/galley-native/`**

原生运行时已于 2026-06-17 放弃（迁移 025 的说明与 devlog 里有记录，先核实并找到那篇 devlog）。按 `docs/README.md`「To archive a doc」的四步做：仍有约束力的规则先并入活文档（预计没有）；`git mv` 整个目录到 `docs/archive/`；在它的 `README.md` 顶上加 `> **ARCHIVED 2026-11-10**` 横幅，说明放弃的日期与出处；更新 `docs/archive/README.md` 的表。`docs/README.md` 任务表里「Plan or design Galley Native runtime」那一行删掉。活文档里指向旧路径的链接改到新路径。

**D21 评测原始输出不再跟踪**

`.scratch/main-chat/entry-layer-eval/` 下各套件的 `results.json`（12 个，约 73 MB）是每次评测的原始转录，累计了所有旧提示词版本；`results.md` 是它们的摘要。
- `.gitignore` 加规则忽略该目录下的 `results.json` 与 `dispatch-results.json`；`git rm --cached` 把已跟踪的移出索引（工作区里的文件留着，`run.py --render-only` 还要读）。
- `results.md`、`run.py`、用例文件照常跟踪。
- 评测目录的 README 或 `run.py` 头注释里写一句：原始结果只在本机，摘要是证据。活文档里把 `results.json` 当作可点开的证据来引用的地方，改指 `results.md`。
- 不改写历史。

**E25 `docs/PRD.md`：小修加横幅**

不重写。改这几处事实，每处先核对：
- 调用方 pin 版本的写法是 `--schema=N`，不是 `?schema=N`。
- 仍把 Approval（已于 v0.6.0 移除）写成验收要求的地方，标成已移除并指向那次发版的 devlog。
- 非目标清单里已经发布的两项（上下文用量表、Git 审阅面板）移出非目标。
- 决策表里与 `AGENTS.md` Rule 2 现状矛盾的行、仍列着 `--pretty` 的行。
- Windows 的安装位置（按 `core/tauri.conf.json` 的安装模式写）与文档里说有、实际没做的 Windows PATH 按钮。
- 顶部加一段横幅：路线图一节是 v0.2 之前的历史记录；现状看 `docs/project-status.md`，助理与主对话的产品定义看 `.scratch/assistant/PRD.md`；全面重写暂缓，启动信号是下次 minor 或要对外介绍产品。
别处不动。

**E26 两份超长文档**

- `docs/project-status.md`（约 1,380 行）：开头按版本排列的发版段落，只保留最近三次（`v0.7.7`、`v0.7.6`、`v0.7.5`）。更早的每一段，先确认它末尾指向的发版 devlog 存在，再删掉这一段；如果某一段里有 devlog 没有的事实，保留这一段并写进回报。在这一节开头加一句规则：只留最近三次，其余看各自的发版 devlog。`docs/release-update-sop.md` 里教人往这里加段落的步骤，补上「同时删掉第四旧的那一段」。「Current Release State」「Unreleased On Main」、规则类小节不动。看板与时间线里停在 v0.2 的行不在本票范围。
- `docs/design/conversation.md`（约 1,600 行）：按 `docs/README.md` 的拆分规则拆成目录 `docs/design/conversation/`，带一份 `README.md` 路由索引，按一个会话通常一起读的内容分组（比如工作台对话、主对话、输入区，以文档实际的章节为准）；原路径留一份跳转桩，并把它加进 `docs/README.md` 列出的现有桩清单。内容只搬不改。全仓指向它的链接与锚点（包括代码注释里的 `docs/design/conversation.md`）继续能用：桩保证路径，锚点改到新文件。

**E27 两份 README 的文字**

只改文字，不动截图与图片引用。补上 v0.7.2 起的备忘（它记下关于你的事、每段开头会读、在待办面板的「备忘」页里看）；界面上主对话就叫 Galley（主聊天 PRD 裁决 173），把 README 里的 "Main chat" / 「主对话」的叫法对齐到界面与文案规范。中英两份说同一件事。回报里写明哪些截图因此与文字不符（截图重拍已暂缓到下次发版前）。

**E28 `docs/release-workflow.md` 的手动兜底流程**

整节删掉，换成三四行：CI 的 `release.yml` 是唯一的发版路径；手工构建的包没有更新器制品，永远无法推到更新通道；`release.yml` 不可用时修它或等它，不手工发版。其他文档里指向这一节的链接改掉。

## 3. 验证

```bash
node scripts/check-docs-links.mjs
node scripts/check-supervisor-sop-drift.mjs
node scripts/check-version-consistency.mjs
node scripts/check-ga-baseline-drift.mjs
git diff --check main..HEAD
git ls-files .scratch/main-chat/entry-layer-eval | grep -c "results.json"     # 应为 0
wc -l docs/project-status.md docs/design/conversation.md
```

中文新增行的全角标点：写个小脚本扫自己新增的行，输出贴进回报。

## 4. 别动什么

- `docs/agent-api/`、`docs/ipc-protocol.md`、`docs/design/onboarding-and-cards.md`、`docs/design/overlays-and-settings.md`（别的票在改，或在等裁决）。
- `core/src/managed_prompt.rs` 与任何代码；`docs/managed-ga-runtime/galley-assistant-manual/`（随包）。
- `docs/devlog/` 的条目；`docs/archive/` 里已有的文件。
- README 的截图、图片、安装步骤、系统要求。
- `.scratch` 里其他目录的去留（没有裁决）。
- 不改写 git 历史。

## 5. 回报格式

按 `docs/agents/dispatch.md`，外加 B12、B13、E27 三组的 diff 要点。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 读 diff；合入前把主工作树里的 `results.json` 备份到仓库外、合入后放回（合入一个「移出索引」的提交会把主工作树里的文件删掉） | B12、B13、E27 的文字 |

## Comments
