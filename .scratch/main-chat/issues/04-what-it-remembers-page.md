# 04（D）「它记得我什么」页面

Status: 撤销（2026-10-13 PRD 裁决 49：账本撤掉，「记忆」页随之由票 10 拆掉，问候只留第一段）。此前 04a–04c 已推送，04d 合入本地（`b9c5aa39`–`d8df038b`）

来源：主聊天 PRD 裁决 11、20、22、43–48（2026-10-09、10-12、10-13）。依赖 01。01 与 03 对外发版必须和本票同版。

## 目标

账本写的是对用户生活的推断（含情绪事件），用户必须能看、能删，并知道它是怎么来的；要不要让它读，由用户自己决定。

## 裁决（2026-10-12，JC「按建议推进」）

1. **放在哪**：设置里新开一页「记忆」，只在内置运行时出现；主聊天标题下拉菜单加一项「它记得我什么」直达这一页（裁决 43）。
2. **怎么展示**：挖掘提示词把产物格式钉死，页面按条目显示：标题、一行现状、来源（哪天、哪个对话），展开看原文，每条能删；解析失败退回只读原文（裁决 44）。
3. **删除语义**：删一条是确定的；同一件事以后会不会被重新记下，靠挖掘提示词遵守「别再记」清单（推断式，做不到完全确定）。
   确定式的出口是「不用于了解我」：对话或项目标上后，挖掘从来源上就不读它（票 01 的排除表，迁移 045）。先不做逐条编辑（裁决 45）。
4. **开关**：页面上的开关替代环境变量 `GALLEY_LEDGER_SINCE`。默认关；打开时选「从现在开始 / 也读以前的对话」，关掉时选「保留已记下的 / 一起清空」。
   不把开关藏在设置里：主聊天第一次有来有回之后，在主聊天里问一次（「从现在开始 / 也读以前的对话 / 先不要」），答过就不再问（裁决 46）。

已定规矩，不另裁：情绪事件单独一区、默认折叠、每条能删，写明它的用法（裁决 20：只为把事办好时引用，不单独评论情绪）；GA 全局记忆文件不大，显示原文、可以编辑。

## 拆片

04a（Core）与 04b（界面）并行做，接口以下文「接口」一节为准；合入后主会话在真机上做视觉切换器试用（主聊天里的询问两种形态 + 演示数据），JC 定了再拆切换器、写设计文档。

### 接口（Tauri 命令，不进 Agent API）

```ts
// 开关：Core prefs 键 `affairs_ledger`。没有这个键 = undecided（从没问过 / 没答过）。
type LedgerSwitch =
  | { state: "undecided" }
  | { state: "off" }
  | { state: "on"; since: string /* RFC3339 */; lookBack: boolean };

interface LedgerQuote { session?: string; at?: string /* "YYYY-MM-DD HH:MM" */; text: string }
interface LedgerEntry {          // 持续活动 / 已消失事项一条
  id: string;                    // "A001"
  title: string;
  status?: string;               // 「现状：」一行
  lastSeen?: string;             // 「最近：」YYYY-MM-DD
  sessions: string[];            // Galley 会话 id 或 im-渠道-日期
  quotes: LedgerQuote[];
  extra: string[];               // 其余「- 键：值」行，原样
}
interface LedgerEmotion {
  id: string;                    // "E001"
  title: string;
  at?: string;
  sessions: string[];
  tags: string[];
  quotes: LedgerQuote[];
  related?: string;              // 关联活动 id
  extra: string[];
}
type Parsed<T> = { kind: "absent" } | ({ kind: "parsed" } & T) | { kind: "raw"; text: string };

interface MemoryOverview {
  ledger: {
    switch: LedgerSwitch;
    running: boolean;
    lastRun?: { startedAt: string; outcome: "running" | "succeeded" | "failed" | "empty"; turns: number; detail?: string };
    nextRunAt?: string;          // RFC3339；开着时下一次到点的时间
    activities: Parsed<{ ongoing: LedgerEntry[]; ended: LedgerEntry[]; other?: string }>; // other：认不出的段落，原样
    emotions: Parsed<{ entries: LedgerEmotion[]; other?: string }>;
    forgotten: { id: string; kind: "activity" | "emotion"; title: string; deletedAt: string }[];
    exclusions: { target: { kind: "session" | "project"; id: string }; createdAt: string; title: string | null }[];
  };
  globalMemory: { name: "global_mem.txt" | "global_mem_insight.txt"; exists: boolean; content: string; revision: string }[];
}
```

| 命令 | 参数 | 返回 / 错误 |
|---|---|---|
| `get_ledger_switch` | — | `LedgerSwitch`（主聊天询问用，轻量） |
| `get_memory_overview` | — | `MemoryOverview` |
| `set_ledger_switch` | `{ action: "enable", lookBack: boolean }` 或 `{ action: "disable", clear: boolean }` | 新的 `LedgerSwitch` |
| `delete_ledger_entry` | `{ id }` | `()`；整理进行中 `ledger_busy`，找不到 `not_found` |
| `unforget_ledger_entry` | `{ id }` | `()` |
| `write_global_memory` | `{ name, content, revision }` | 新 `revision`；磁盘上已被改过 `changed_on_disk` |
| `set_ledger_excluded` / `list_ledger_exclusions` / `run_ledger_now` | 已有 | 不变（`run_ledger_now` 改读 prefs） |

- 外置运行时：以上新命令一律返回错误 `managed_only`，什么都不读不写。
- 事件 `memory-changed`（无载荷）：开关变化、整理开始与结束、删除、移出、写全局记忆之后发，页面收到就重新取 overview。
- 错误字符串就是上面的标识（`ledger_busy` 等），界面按标识出文案。

### 04a Core（ready-for-agent）

**开关进 prefs，实时生效**

- 读 Core prefs `affairs_ledger`：`{"on": true, "since": "<RFC3339>", "lookBack": bool}` 或 `{"on": false}`；没有这个键是 undecided。
  去掉环境变量 `GALLEY_LEDGER_SINCE` 这条路（`core/src/ledger/config.rs`、`mod.rs:163/205`、`commands/ledger.rs:40`、`runner_commands.rs:419`、`im_supervisor/manager.rs:207`）。
  评测 harness（`core/examples/ledger_eval_prepare.rs`）照旧直接构造配置。
- 起点从「日期」改成「时刻」：「从现在开始」= 打开那一刻（今天早些时候的测试消息不进账本）；「也读以前的对话」= 不设下限（`since` 记成 Unix 纪元，`lookBack: true`）。
  再次打开时位置照旧：`from = max(已处理位置, since)`，所以关掉保留后「从现在开始」跳过空档、「也读以前的对话」补读空档；清空过就从头读。
- 每日任务不再只在启动时按环境变量决定挂不挂：常驻，每个 tick 读 prefs，关着就什么都不做。启动时的 IM 归档（`archive_before_prune`）同样读 prefs。
- 03a 的段首注入（主聊天状态块）与 IM 状态块的事项清单跟这个开关走。IM 渠道照 03a 的已知缺口，重启渠道才换。
- 打开且 `lookBack` 时，一分钟内开始第一次整理（不等第二天 04:00）；「从现在开始」没有可读的，照常等到点。

**分批读（「也读以前的对话」才真正用得上）**

- 每次整理最多读 60,000 字的用户原话（常量，Core 测试覆盖）。超出就按时间截在某条消息之前：GUI 消息到截点、IM 归档到截点前最后一行，位置只推进到截点；
  这次成功且还有没读的，10 分钟后再跑一次，直到读完；失败照旧等第二天（不在失败里烧钱）。
  分批会把跨截点的会话拆开，接受这个偏差（模型每次都先读已有产物）。JC 本机 GUI 历史一共 327 条、9,133 字，用不上分批；别的用户的历史可能大得多。

**关掉**

- 「保留」：只把 prefs 改成 off，文件都留着；注入随之停。
- 「清空」：删掉整个 `memory/history_insight/`（产物、短清单、`galley/` 里的状态、IM 归档、别再记清单）。排除表在库里，不动。
- 正在整理时关掉：先停掉这次整理（算失败、位置不动），等它退出后再处理保留 / 清空；这次整理的收尾不能把刚清空的文件又写出来。

**把格式钉死（挖掘提示词，`core/src/ledger/batch.rs` `task_prompt`）**

用下面的格式代替 SOP 的「格式自定」。编号从现有最大号往后排，删过的号不复用。

`activities.md`：

```
# 活动知识层

## 持续活动

### A001｜杭州半程马拉松备赛
- 现状：9 月 27 日长距离 18 公里，离半马还有八周。
- 最近：2026-09-27
- 会话：`s-0907-run`、`im-feishu-2026-09-21`
- 频次：4 会话 / 5 消息
- 原文（`s-0927-run`，2026-09-27 07:00）：“今天长距离 18 公里，配速 6 分 15，比计划快。”
- （其余说明写成「- 键：值」行，可选）

## 已消失事项

### A002｜中秋活动页设计与上线
- 现状：9 月 16 日上线，首日点击率 4.2%。（写怎么结束的）
- 最近：……（同上）
```

`emotional_events.md`：

```
# 情绪事件

## E001｜手术等待超预期时的明显焦急
- 时间：2026-09-10 15:40
- 会话：`s-0910-surgery`
- 标签：焦急、不安
- 原文：“手术还没出来，已经三个多小时了……”
- 关联活动：A006
```

- 「现状」一句话，不超过 60 字；「最近」是最近一次证据的日期。
- 不写口径、批次说明、证据边界之类的段落：整理过程写在最后的回复里。模型照写了也不丢：解析器把认不出的段落原样放进 `other`，页面照样给用户看。
- 03a 的短清单（第 7 步）每行带编号：`- A001｜……`。Core 注入前去掉编号（没带编号的行照收），40 字上限不含编号，1536 字节上限按去掉后的算。

**别再记清单**

- 文件 `history_insight/galley/forgotten.json`（Galley 的，模型只读）：`[{id, kind, title, deletedAt}]`。
- 每次整理把清单写进任务提示词：「用户删掉过下面这些条目，表示不想被记住。不要重建它们，也不要把同一件事写进别的条目或情绪事件」，每条一行「编号｜标题」。
- 页面上「移出」只把这件事从清单里拿掉（以后可以再记），删掉的内容不恢复。

**删除一条（确定式）**

- 从 `activities.md` / `emotional_events.md` 里删掉这条的整块（到下一个同级或上级标题为止），文件其余部分逐字不动；短清单里同编号那一行一起删；标题记进别再记清单。
- 整理进行中返回 `ledger_busy`（与整理共用 `RUN_LOCK`，不排队）。
- 写文件用临时文件 + 改名。

**解析**

- 只认上面的格式：`## 持续活动` / `## 已消失事项` 下的 `### A\d+｜标题`，情绪文件里的 `## E\d+｜标题`；条目里的 `- 键：值` 行按键名归位，「原文（`会话`，时间）：“…”」拆成 `LedgerQuote`。
- 文件存在、非空却一条都认不出，就是 `raw`（页面只读显示原文）；认出一部分时，其余放 `other`。
- 解析器与删除共用同一套块边界，单测覆盖：评测产物（`/var/folders/.../galley-ledger-eval-sanafxuv/` 那份 17KB 的是格式钉死之前的，拿来当「认不全」的样本）、钉死格式的样本、空文件、只有标题。

**GA 全局记忆**

- 读写内置状态 `memory/global_mem.txt`、`memory/global_mem_insight.txt`。`revision` 是内容哈希；写的时候对不上就 `changed_on_disk`（助理可能刚写过）。临时文件 + 改名。
- 核对运行时升级与种子不会覆盖这两个文件（Rule 1）；会覆盖就是 bug，回报。

**排除表的标题**：overview 里给每条排除带上会话 / 项目标题（会话已归档也要有；已删的行随级联删除，不会出现）。

**验收**

- `cargo test --workspace`、`cargo check`；外置运行时每个新命令都是 `managed_only`、不建任何文件（测试）。
- 用钉死格式重跑一次评测（真模型，`run_eval.py run`，默认三次挖掘）：三次产物都能被解析器认全（`other` 为空或只剩少量），删一条后下一次挖掘没有重建它（在评测里加一步：第二次挖掘前删一条持续活动，看第三次）。检查器改用解析器的结构认区域。回报产物样例与检查结果。
- 文档：`docs/managed-ga-runtime/`（`prompt-composition.md`、`code-state-and-patches.md`）、`docs/ga-baseline.md:1015` 里的环境变量说法改成 prefs；`core/src/ledger/` 模块注释同步。

### 04b 界面（ready-for-agent）

动手前读 `docs/design/overlays-and-settings.md`（设置页）、`docs/design/conversation.md`（空状态 765–788、Composer 537–539）、`docs/copy-language-guidelines.md`，撞到禁令就停下回报，不要自己绕。

**设置 →「记忆」一页**（`gui/src/components/screens/settings/`，只在内置运行时出现；标签位置放「模型」之后，理由写进注释）

自上而下：

1. **开关一行**「从对话里了解我」+ 一句来源与去向：每天读一遍你在桌面和 IM 私聊里说的话（不读助理的回复），交给当前默认模型整理一次，所以会再经过一次模型服务商；
   记下的内容只在这台电脑上，换模型也带得走。开着时下面一行状态：起点（「从 10 月 12 日 14:30 开始」或「从最早的对话开始」）、上次整理（时间、结果）、下次整理时间；正在整理时显示「正在整理」。
   - 打开：选「从现在开始 / 也读以前的对话」（后者注明第一次整理要读完以前的对话，用量会大一些）。
   - 关掉：选「保留已记下的 / 一起清空」（清空注明：已记下的内容和别再记清单都删除；标为「不用于了解我」的对话仍然不读）。
2. **正在进行的事**（持续活动）：按「最近」倒序。每条：标题、现状、「最近提到：9 月 27 日 · 4 个对话」；展开看原文与其余说明，来源里的 Galley 会话可点（打开那个对话，已归档的也能开），IM 来源显示成「飞书 · 9 月 21 日」。每条一个删除（确认一次：删掉后以后整理也不会再记这件事）。
3. **已经结束的事**（已消失事项）：同上，默认折叠。
4. **情绪时刻**（情绪事件）：默认折叠；区首一句用法（只为把事办好时引用，不会单独评论你的情绪）；每条能删。
5. **不再记的事**（别再记清单）：默认折叠；每条「移出」。注明为了不再记，Galley 留着这件事的标题。
6. **不用于了解我的对话**：列出排除的对话与项目，每条「恢复」。
7. **助理的长期记忆**（GA 全局记忆两份文件）：原文、可编辑、显式保存；`changed_on_disk` 时提示重新载入。注明这部分是助理在对话里自己记的，不受上面的开关控制。
- 解析失败（`raw`）的区域只读显示原文；`other` 有内容时在该区域末尾给「其他内容」只读原文。
- 开关是 undecided / off 而且文件都不在时，2–6 区不出现，只留开关与第 7 区。
- 整理进行中删除按钮禁用并说明原因（`ledger_busy`）。
- 收到 `memory-changed` 重新取 overview。

**入口**

- 主聊天标题菜单（`gui/src/components/layout/header/SessionTitleMenu.tsx`）加「它记得我什么」→ 打开设置并定位到「记忆」。
- 其他内置会话的标题菜单加「不用于了解我」（勾选态）；项目的菜单加同一项。只在内置且开关开着时出现。主聊天的标题菜单不放这一项。
  标上时提示一句：以后不再读这个对话；已经记下的到「记忆」页删。

**主聊天里问一次**（裁决 46）

- 条件：内置运行时、开关 undecided、主聊天里已经有至少一轮完成的问答。空的主聊天不问（空状态 austerity，`conversation.md:784–788`）。
- 三个选择：「从现在开始」「也读以前的对话」「先不要」；「先不要」= `disable`（不清空），之后不再问。文案说清读什么、经过谁、存在哪、在哪关。不进模型上下文。
- 两种形态做成临时切换器（常驻可点 pill，portal + `pointer-events:auto`）：
  - **A 输入框上方一条**（最克制）：一行说明 + 三个按钮，贴在 Composer 上方。
  - **B 时间线末尾一张卡片**（裁决 10 的卡片形态）：跟在最后一条回复后面。
- 切换器另带「演示数据」档：「记忆」页用评测产物（林晓那份）渲染，询问强制出现。演示数据只在开发构建里，放测试 fixture，不碰 Core 和真实文件。

**验收**

- `pnpm --dir gui typecheck`、`lint`、相关 vitest（页面在 undecided / off / on / raw / busy 下的渲染；询问的出现条件；外置运行时不出现标签与菜单项）。
- 新命令的 TS 类型与调用包装进 `gui/src/` 现有位置（同时核对 `gui/src/types/ipc.ts` 是否需要镜像）；中英文案都写。
- 旧文件只格式化自己的 hunk（gui 不是 prettier-clean）。
- 视觉由主会话合入后在真机上和 JC 过，界面代理不做最终视觉结论。

### 04c 默认开 + 主对话问候（ready-for-agent，裁决 47）

2026-10-12 JC 改裁：主对话下个版本才发布，升级和新装的用户是第一批；不让用户三选一，主对话里 AI 先说一句，告知默认开启并建议保持开启。
裁决 46 的询问与 A / B 切换器作废。

**Core**

- **主对话建出来的那一刻**（`get_or_create_main_chat` 走 `Created`，`core/src/db/main_chat.rs:59`；从归档恢复不算）：
  - 开关键 `affairs_ledger` 不存在时写成开、读全部历史（`{"on": true, "since": <Unix 纪元>, "lookBack": true}`）；已经存在（只有开发机）就不动。
  - 第一次整理排在建出之后的下一个 04:00，不立刻跑：现在已过 04:00 就是明天 04:00，没过就是今天 04:00（`run.rs` `due` 现在的规则是当天 04:00 后任意时刻都算到点，要改成这次不算）。
  - 写入问候：一条 AI 消息，固定文案（下文），按界面语言选中文或英文。界面语言由 GUI 调命令时传（命令加可选参数，只做加法）；不传用英文。
  - 问候只显示：不回放进模型上下文（Core 重启、runner 变冷后的历史回放都跳过它），不进事项账本（账本本来只读用户消息），不算一轮问答。用什么标记由你定（现有列或迁移；加迁移要补六处手写列表），回报理由。
- **主对话状态块**：账本开着时，主对话的段首状态块固定带一行说明（英文，和状态块其余部分一致）：账本开着、每天整理用户说过的话（含以前的对话，不含 AI 的回复）、用户在「设置 → 记忆」查看、删除或关掉。
  有没有事项清单都带；关着不带；IM 状态块不带。单独的字节上限与测试（参照 03a / 03b 的预算测试）。
  理由：问候不回放，升级当天还没有清单，不加这一行 AI 就不知道记忆开着。
- 页面上手动打开（`enable`）照 04a 不变；界面以后只传 `lookBack: true`。

**界面**

- 删掉主对话里的询问和临时切换器：`MemoryAsk.tsx`、`MemoryAskSwitcher.tsx`、`memory-ask-trial.ts`、`memory-demo-backend.ts`，以及 `MainView.tsx`、`App.tsx`、`SettingsMemory.tsx` 里的试验分支（拆法见 `memory-ask-trial.ts` 头注释）。
  `memory-entry.ts` 里只给询问用的函数一起删；fixture 留给测试。
- 「记忆」页的开关：打开直接打开（`lookBack: true`），不弹选择框；关掉仍弹「保留已记下的 / 一起清空」。说明文字加上「包括以前的对话」。
- 调 `get_or_create_main_chat` 时传界面语言。
- 问候按普通 AI 消息显示（不带运行折叠、步数、用时）。
- 设计文档：`docs/design/overlays-and-settings.md` 写「记忆」页（标签位置、七个区域、开关与对话框）；`docs/design/conversation.md` 写主对话的问候是空状态规则的例外（裁决 47）；设置标签列表若在别处有记载一并改。

**问候文案**（JC 2026-10-12 认可中文；英文由你译，回报给主会话过目）

> 你好。以后有什么事，直接在这里跟我说就行，不用再想是开新对话还是接着哪个旧的。
>
> 为了接得上你在忙的事，我会整理你在 Galley 和聊天软件私聊里说过的话（包括以前的对话，不含我的回复），记下你在忙什么、到了哪一步，也会记下让你着急或开心的时刻，只用来把事办好。第一次整理在今晚，之后每天一次；整理要多调用模型，记下的内容只存在这台电脑上。
>
> 建议保持开启。想看我记了什么、删掉某一条或者关掉，点上面的「主对话」→「它记得我什么」。

**验收**

- Core：建出主对话时开关与第一次整理时间（04:00 前后两种）、已存在开关不动、从归档恢复不写问候、问候不回放、状态块那一行的有无与字节上限、外置运行时什么都不做。
- 界面：询问与切换器的代码与测试都删干净（`grep -rn "MemoryAsk\|memory-ask-trial\|memoryDemo" gui/src` 为空），开关不弹选择框、关掉弹对话框，问候显示。
- `cargo test --workspace`、六个门禁脚本、`pnpm --dir gui typecheck`、`lint`、vitest、`git diff --check`。

### 04d 「记忆」页简化为三区（ready-for-agent，裁决 48）

2026-10-13 JC：七个区域对用户心智负担太重。四点 JC 逐条选定（PRD 裁决 48）：情绪挂到所属的事下面；「不用于了解我」整个去掉（含对话与项目菜单的勾）；「不再记的事」整个去掉；进行中与已结束合成一区。
页面只剩三区：开关 /「记下的事」/ AI 的长期记忆。这三样都没发过版（v0.6.2 不含迁移 045），不做旧格式迁移，只清掉开发机上的残留。

**Core**

- **产物格式**：情绪不再是单独的文件，写进它所属事项的块里，一行一条（可多条）：
  `- 情绪（`会话标识`，YYYY-MM-DD HH:MM）：焦急、不安——“用户原话”`
  整理任务（`core/src/ledger/batch.rs` `task_prompt`）第 7 步改成只有 `activities.md` 一个文件，加上这一行的格式；写明对应不到任何事项的情绪不记（情绪只为把事办好时引用，对应不上就用不上），SOP 里「标什么、不标什么」的情绪标准照旧；明确不写 `emotional_events.md`。
  第 8 步「用户删掉过……」整段删掉，最后一步编号前移。任务仍要在 2000 字内（现有测试）。
- **解析**（`entries.rs`）：事项块认出情绪行，放进 `LedgerEntry` 的新字段（会话、时间、标签、原话，加上整行原文供删除定位）；`emotional_events.md` 的解析、`LedgerEmotion`、overview 的 `emotions` 字段删掉。认不出的情绪行照现有规则落进 `extra`。
- **删除**：`delete_ledger_entry { id }` 照旧删整块，情绪行随块一起删，短清单那一行照旧连带删。新加一个删单条情绪的命令，按「事项 id + 那一行的原文」定位，不按序号（防止行挪位删错）；找不到返回 `not_found`，整理进行中返回 `ledger_busy`，删完发 `memory-changed`。外置运行时返回 `managed_only`。
- **去掉「不再记的事」**：`forgotten.rs`、`galley/forgotten.json` 的读写、`unforget_ledger_entry` 命令、overview 的 `forgotten` 字段、任务里的清单。删除就只是删除。
- **去掉「不用于了解我」**：新迁移删 `ledger_exclusions` 表（045 已在开发机上跑过，tauri-plugin-sql 校验已跑迁移的校验和，不能改 045 或删文件）。加迁移要补六处手写迁移列表（`grep -rn "MIG_0" core/tests cli/tests -l`：core/tests 四处、cli/tests 两处）。
  还要删 `sources.rs` / `db/ledger.rs` 里的排除条件与读写、`set_ledger_excluded` / `list_ledger_exclusions` 命令、overview 的 `exclusions` 字段、`LedgerTarget` 等只为它存在的类型。这些命令都不在 CLI / Agent API 里（已核对）。
- **残留清理**：Core 启动时（账本的启动路径里）发现 `history_insight/emotional_events.md` 或 `history_insight/galley/forgotten.json` 就删掉。这两样都没发过版，只有开发机和评测目录有；留着就是用户看不到也删不掉的记录，违背 Rule 4 补句。外置运行时不碰。
- **回滚**（`rollback.rs`）只剩 `activities.md` 与 `ongoing_affairs.md`。「清空」不变（删整个目录）。
- `ledger/mod.rs` 等模块头注释里的文件树和职责同步改。

**界面**

- **三区**：开关 /「记下的事」/ AI 的长期记忆。删掉「情绪时刻」「不再记的事」「不用于了解我的对话」三区及其文案。
- **记下的事**：进行中的按「最近」倒序；末尾一行「已经结束的 N 件」，点开才显示已结束的（行样式按设计文档定，回报你的做法）。解析失败照旧退回只读原文，标题仍是「记下的事」。开着但还没有内容时一句空状态。
- **情绪**：在事项展开后显示，一行一条：日期、标签、原话；每条能删（确认框沿用现有的删除确认形态）。
  情绪的用法说明（「只在把事办好需要时引用，不会单独评论你的情绪」）在有情绪显示的地方出现一次，位置你定、回报。
- **删除确认**：删一件事的说明改成「「X」会从记录里删掉。以后再聊到这件事，可能会再记下。」，这件事带情绪时加一句情绪会一起删。英文同步。
- **关掉对话框**：「一起清空」的说明只说已记下的内容会删除（去掉「不再记的事」和「不用于了解我」两句）。
- **菜单**：对话标题菜单与侧栏项目菜单里的「不用于了解我」勾选项、它的提示与出错文案全部删掉（`SessionTitleMenu.tsx`、`SidebarProjectGroup.tsx`、`MainHeader*.tsx`、`gui/src/lib/memory-exclusion.ts`、`memory.ts` 里的封装）。主对话标题菜单的「它记得我什么」保留。
- `gui/src/types/ipc.ts` 镜像同步（`check-ipc-protocol-drift` 门禁）。演示 fixture（`memory-overview.fixture.ts`）改成新形状：林晓那份里的情绪挂到对应事项下，对应不到的去掉。

**文档**

- `docs/design/overlays-and-settings.md`「记忆」页改成三区；标题菜单、项目菜单的设计文档若写了「不用于了解我」一并删。
- 描述现行行为的地方都要改：grep 中英文 `不用于了解我`、`exclusion`、`forgotten`、`不再记`、`emotional_events`、`情绪时刻`、`Not used to`，范围是 `docs/`、`CONTEXT.md`、模块注释。devlog、已完成的票、PRD 历史裁决不改。

**评测**

- 改了整理提示词，要用真模型重跑（`.scratch/main-chat/ledger-eval/run_eval.py run`，三次挖掘，做法见票 01 Comments 与 04a 回报）。检查器同步改：
  - 产物只有 `activities.md` 与短清单，没有 `emotional_events.md`；
  - 每条情绪行都在某个事项块里，并且能被解析器认出；
  - 去掉「删后不重建」那一项。
- 回报：情绪行样例与条数，并和上一轮评测的情绪事件条数对比（对应不上而没记的大概有几条、是什么）。

**验收**

- `grep -rn "ledger_exclusions\|unforget\|forgotten\|emotional_events\|notUsedToLearn\|LedgerEmotion" core/src gui/src cli/src` 只剩迁移文件与启动残留清理两处。
- `cargo test --manifest-path core/Cargo.toml --workspace`，并在 `TZ=UTC` 下再跑一遍。
- `pnpm --dir gui exec vitest run`，本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各跑一遍；`pnpm --dir gui typecheck`、`lint`。
- 六个门禁脚本，`git diff --check`。
- 格式化：core 只用 `rustfmt` 格式化自己动过的文件，gui 只格式化自己的 hunk（两边都不是整仓 clean）。

## 宪法 Rule 4 补句（2026-10-12 JC 定措辞；与本票同版落地）

来源：票 01 落地核对（见 01 的 Comments）：读日志、不进库与 08-13 解释一致，但 IM 归档是 Core 为账本写的、比日志活得久的副本，08-13 的字面盖不住。
2026-10-12 JC：其余几件按建议推进；改宪法照 Rule 2 的先例，措辞先给 JC 过目（主会话的做法，不是 JC 的原话）。同日 JC 认可下面的措辞，原样接在 `AGENTS.md` Rule 4 的 08-13 解释之后。
其中「用户能在 Galley 里查看和删除」要等本票做完才成立，所以随本票同版改宪法，不提前。2026-10-12 随裁决 47 改括号里那段（JC 认可），下面是现行措辞：

> Interpretation (2026-10-12): the affairs ledger (managed runtime only; on by default, which the main chat's first message tells the user, and the user can turn it off) keeps the user's own words from IM channels — never the agent's replies — under the managed state root's `memory/history_insight/`, so the engine's memory layer can still learn from them after engine logs are pruned. It is the user's memory state, not Galley conversation storage: it never enters Galley's database, the user can see and delete it in Galley, and runtime upgrades never overwrite it.

## Comments

- 2026-10-12 主会话：JC 问开关是什么、为何要有。答：现在的开关是环境变量，普通用户设不了；账本每天把用户的话再交给模型服务商读一遍、推断生活与情绪、花用户的钱，用户没在对话里要求过；
  Rule 4 补句已承诺「用户打开才开」；PRD 裁决 15「做得便宜、能退」。真正要定的是默认状态：藏在设置里多数人永远不开，主聊天的「大脑」就空着，所以在主聊天里问一次。JC「按建议推进」。
- 主会话核对设计文档时发现：空的主聊天按空状态规则不能放提示（`conversation.md:784–788`），所以询问的条件定为「已经有一轮完成的问答」。
- 2026-10-12 合入回报（主会话）：
  - 04a 真模型评测（林晓语料，三次挖掘，内置解释器）`all checks passed`：钉死格式三次都认全（`other` 0 字）；第一次后删「日语 N3 备考」，后两周语料仍提到日语，两次都没重建、编号不复用。
    观察（不改提示词）：模型执行别再记偏严，把母亲那条原文里「背日语单词」半句也截掉了。
  - 合入前主会话追加两件（`a90a15d9`）：挖掘会话结算后从库里彻底删掉（成功、失败、被停止都删；清空与启动时清残留），否则任务提示词、账本内容、批次原文会留在库里，违背补句「never enters Galley's database」；
    整理失败或被停止时把三个产物文件回滚到开跑前，「失败 = 什么都没发生」。顺带修了共用删会话路径不删 `messages_fts` 索引行的旧 bug（对所有删会话生效）；以前删会话留下的旧索引行没清。
  - 已知缺口：关掉开关后，已经在跑的主聊天 runner 带着旧清单直到下一段或重新拉起，IM 渠道要重启；「清空」不动引擎日志与 `temp/user_prompt_*.md`（08-13 解释，引擎内部状态）。
  - 04b 与票面不一致处（真机可改）：界面叫「AI」不叫「助理」（文案规范）；2–6 区的隐藏条件多加「没有排除标记」；询问在主聊天在跑或等回答时不出现；已归档的来源点了先恢复再打开。
- 2026-10-12 用量（主会话，裁决 47「发版前量一次」）：引擎日志不记 token，从 04a 真模型评测的三次挖掘（`gpt-6-astra`）按「每次调用 = 系统提示 + 截至当时的全部历史」估：
  每次 11 次调用，输入累计 33–38 万字（大部分是重发的历史，可走缓存），输出约 1 万字，最后的历史 3–4 万字。批次是一周合成语料；真实用量随产物变大与回溯批次（最多 6 万字）上升。没说过话的日子不调用模型。
- 2026-10-13 04c 合入回报（主会话）：问候与开关和主对话行在同一事务里写入；问候用现有来源字段标记（`created_via = 'system'` + supervisor `galley-greeting`，`turn_index = -1`），不加迁移，回放跳过、进全文索引；
  第一次整理用开关里的可选字段 `notBefore`（下一个 04:00）挡住，读不懂按关处理，启动时的 IM 归档也等到它之后，所以用户在第一次整理前关掉就不留任何副本；页面手动打开不带它（照 04a 一分钟内开跑）。
  CLI 没有创建主对话的路径。CLI `session show` 把问候显示成 `turnIndex` 0 的 AI 消息（接口按 0 截底），显示瑕疵，没改接口。英文问候的菜单路径用英文界面的实际标签。开发机已有主对话，看不到问候，开关不被改。
