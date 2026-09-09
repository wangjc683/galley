# 定位调整：门面从「团队编排」切到「轻 harness 的本地个人助手」

**日期**：2026-09-09
**范围**：README（中英）hero 与开篇、AGENTS.md Product Shape、PRD 一句话定位、GitHub description；不改代码

## 背景

README 自 2026-07-20（v0.3.4）起没有实质修改，中间发了 15 个版本。JC 借 README 全面 review 的机会重想一句话介绍，方向是：

> 轻量级的个人本地全能助手，Token 消耗少，轻 harness 更依靠模型本身的能力，在这个模型飞速发展的时代战未来。

## 决策

**门面主叙事从「把多个 Agent 编成一支团队」切到「轻 harness 的本地个人全能助手」；团队编排降为第二层，不删。**

- 英文 tagline：**Less harness. More model.**（JC 定，与设计理念一致）
- 中文主句：**跑在你电脑上的全能助手。极简 harness，把舞台留给模型，在模型飞速进化的时代押注未来。**（JC 原句首个逗号改句号；中间一拍原为「靠模型本身的能力」，JC 对「干活」不满意，同日从四个候选里定了「把舞台留给模型」——否决的「不替模型思考」更锋利，但比喻版对普通用户零门槛，且与「Less harness. More model.」同为立场句）
- 中文版 hero 的粗体行也用英文 slogan，两语共用一个品牌口号；JC 的中文句作副标。
- 「harness」在中文里保留原词：中文技术圈已通用，主句不出现、副标出现的折中不必要（JC 裁决）。
- 「Token 消耗少」不进主句，带论文数字进 Highlights：GenericAgent 论文 Lifelong AgentBench 上 GA 222k 输入 token、100% 准确率，对比 Claude Code 800k / OpenClaw 1.43M，README 写成「3–6× fewer input tokens than leading agents」，不在我们的文案里点名对手。
- 团队故事放在「What Is Galley」第二段：「一个助手不够用时，Galley 就是一支团队」。Highlights 两组卡片顺序不变（先助手后团队），此前只是 hero 没跟上。

## 为什么切

1. 「团队编排」回答的是「你怎么造的」，「个人助手」回答的是「我为什么装你」。绝大部分用户先要后者。
2. 2026 年重 harness、几十个 skill、Token 烧得快的桌面 Agent 已是用户抱怨的靶子；「轻、省、靠模型」是一个一听就懂的反向立场，且有 GA 论文背书。
3. 「押注未来」是论点不是口号：脚手架越少，模型升级时要报废的东西越少。这条论证链完整，值得写进 README。

## 边界

- 「轻」指 Agent 循环 / harness 轻，不指应用体积；Galley 本身是 Rust Core + Tauri。README 开篇段落把这层说清（「Its harness is deliberately thin: the engine keeps the tool set minimal and the context dense」）。
- Token 主张是可测主张。Galley 自己没有对比数据，所以数字归功于引擎并链接论文；不在 slogan 里承诺。
- 宪法「Product Shape」只改了第一句，Rule 1–6 不动；CLI 契约、Supervisor、Goal 的产品身份不变。

## 同步改动

- `README.md` / `README.zh-CN.md`：hero、What Is Galley 开篇两段、Token 效率卡
- `AGENTS.md`：Product Shape 首句
- `docs/PRD.md`：顶部加 2026-09-09 定位更新注、§1 一句话定位
- GitHub repo description（`gh repo edit`）

## 同日追加：事实修正与 Highlights 三张新卡

JC 裁决后同日落地：

- Channels 两处补齐 Telegram / Discord；Quick Start 模型预设按 `managed-model-presets.ts` 改成 9 个名字 + Ollama 无 Key。
- Highlights 新增三张卡：「任意模型，包括本地的」「阅读面板」进第一组（助手），「定时任务」进第二组（团队）。
- 为保持两组各 6 张（2 列表格无空格），**「GUI + CLI 双原生」卡合并进第二组的引言句**——那句话本来就在说同一件事，Supervisor 节和 Under the Hood 也各讲了一遍，信息无损。若 JC 想保留该卡，恢复即可，代价一行。

## 同日追加：结构调整

JC 裁决「都做」后同日落地，中英同步：

- **agent-api 链接**：CLI 示例末尾从 2026-07-04 起只剩转发页的 `docs/agent-api.md` 改指 `docs/agent-api/README.md`，链接文字改为「Agent API docs」。
- **目录砍掉**：10 条 Contents 整块删除，GitHub 自带 outline；hero 快捷链接补一个 Screenshots。
- **截图前移**：Screenshots 从倒数第三节提到 Highlights 之后、Quick Start 之前。取舍：Quick Start 再往下一屏，但截图从「几乎没人看到」变成主路径的一部分；hero 的快捷链接直达 Quick Start 补偿这一屏。
- **Under the Hood 折叠**：标题和引言句留在外面，六条设计选择折进 `<details>`，与 CLI 示例、架构图的折叠方式一致。工程读者展开即得，普通用户一眼掠过。
- **zh 版小标题中文化**：亮点 / 快速开始 / Supervisor 与 Channels / 架构 / 工程笔记 / 为什么叫 Galley / 截图 / 许可证；hero 快捷链接同步中文，锚点改为中文标题锚。「Supervisor」「Channels」保留，因为应用内 Settings 标签就是这两个词。

## 未决

截图 2026-07-03 未重拍（需要 JC 真机拍 en + zh 两套）、repo topics，另行处理。
