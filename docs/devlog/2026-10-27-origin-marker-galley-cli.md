# 来源标记不再叫 Supervisor：Galley 与 Galley CLI

日期：2026-10-27
关联：[工作台对话 PRD](../../.scratch/workbench-conversation/PRD.md) 裁决 8，票 [03](../../.scratch/workbench-conversation/issues/03-origin-marker-two-kinds.md)；推翻 [Supervisor provenance](./2026-05-21-supervisor-provenance-delegation-dogfood.md) 决策 4「普通 CLI 消息不标」

## 起因

JC：「目前通过 galley cli 新建的消息，都会带图标……比如现在显示 Supervisor，其实对于用户并不友好，是不是直接用『galley cli』呢？」

## 核对

- 前提要校正：只有带 `--supervisor=<标签>` 的（`via=supervisor`）才有图标，不带标签的 `via=cli` 两处都不画（05-21 决策 4：人也用 CLI）。
- 两处说法不一：侧栏「Supervisor 创建」；消息上方的提示写死英文 `"Supervisor"`，读屏却是「Supervisor 添加的消息」。
- 本机库里 `Supervisor` 底下实际是几类人：Galley 自己（`galley-im/wechat`、`galley-im/telegram`，助理在子任务里答题打回用的 `galley-assistant`）、外部 Agent（`codex-supervisor/v1` 18 条、`claude-code`、`feishu-supervisor/v1`）、JC 自己与测试标签。工作台对话 PRD 早有一句「发话的一方要标明是谁」，一个词把这几类人混在一起，什么也没区分出来。

## 过程

1. 主会话先给了三案，推荐 C：按发话方分四类（Galley 助理、聊天软件、外部 Agent 带原标签、不带标签的命令行）。JC：「C 有点太复杂了，为了普通用户友好，我现在更倾向于 B……给用户看就简洁一点就显示『galley CLI』，当然可以在用户看不到的地方保留更多信息」。
2. 主会话同意 B，只留一个例外：Galley 自己经 CLI 写的不标 CLI。理由是普通用户不接外部 Agent，他们能看到这个标记的场合几乎都是 Galley 自己做的事：在微信里让它开的对话写「Galley CLI」，没碰过命令行的人读不懂；子任务里第一条说明是房子，助理后来那句若是插头，同一个发话方会出现两个图标。「看不到的地方」本来就有：标签一直存在 `messages.supervisor`、`sessions.created_by_supervisor` 与 CLI JSON 的 `origin` 里。
3. 文案初稿是「Galley 发来的」「Galley 派来的」。JC：「『Galley 发来的』有点奇怪，用户会觉得我本来就是在 Galley 软件里面，不如都统一为『Galley 创建』？」主会话同意并把说明一起改：「X 发来的」是软件通知的句式（「微信团队发来的」）；子任务里那句是写给子任务的，「发来」还把收件人说成了你。「Galley」作发话方的名字不变，内置运行时里它就是助理的名字（侧栏卡片、「回到 Galley」）。
4. 执行代理交回一处：定时任务开的对话，第一条消息会读「Galley CLI」，侧栏同一个对话却是时钟。定时任务是 Core 直接走 `session.new`（`core/src/scheduler.rs:878`），不经过 CLI，主会话定为消息也画时钟「定时任务创建」。

## 结果

判断在 `gui/src/lib/origin-marker.ts` 一处，侧栏与消息共用：

| 来源 | 图标 | 提示 |
|---|---|---|
| 标签 `galley-scheduler`（先判，不看 `via`） | `Clock` | 定时任务创建 |
| 标签 `galley-assistant` 或 `galley-im/` 开头 | `House` | Galley 创建（子任务说明同一句） |
| 其余 `via=supervisor`，以及 `via=cli`（带不带标签） | `PlugsConnected` | Galley CLI |

`via=cli` 的消息也总有时间。原标签界面上一律不显示。只改 GUI、设计文档、文案规范与两份 README；Core、CLI、Agent API 不动。外置运行时只会出现「Galley CLI」这一类。JC 真机验收通过。

## 没选

- **C 按发话方分四类**：JC 嫌复杂。
- **纯 B**（Galley 自己写的也标「Galley CLI」）：理由见过程第 2 条。
- **只换词**（统一「Agent 发来的」）：Galley 自己写的也被叫成 Agent，还是不准。
- **提示里带原标签**（「Agent 发来的 · claude-code」）：随 C 一起没选；05-21 否掉的是常显标记上带 `@jc`，这次连提示里也不带。

## 代价

标签是调用方自报的：外部 Agent 自称 `galley-assistant` 会被画成 Galley。这在本机可信边界内，和以前一样不防。
