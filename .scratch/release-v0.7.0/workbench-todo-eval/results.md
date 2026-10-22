# 工作台里加待办：回到 Galley 对话（v0.7.0 发版前，清单第 40、9、41 项）

跑于 2026-10-22 21:34。模型 gpt-6.1-sol（Galley 托管模型 mm_1792576875658（API key），从 Galley 数据库只读取得；推理强度 high），共 14 次运行、19 次模型调用。

## 怎么跑的

- 提示词：Galley 那段是真实 Rust 代码写出的（`galley-prompt/`，版本 0.6.2、macOS）。工作台是 `compose_runtime_prompt`（含建议标签一节）；IM 是 `compose_im_runtime_prompt` 加 Telegram 入口层，按 runner 的 `managed_prompt_profile` 拼接。两组只差「What Only The User Changes In Galley」那段的最后一句。文件由 `core/src/managed_prompt.rs` 测试模块里临时加的一个测试写出（OLD 在 a4a9c643 上，NEW 在改后的代码上），跑完删掉。
- 工作台：新对话、没有历史，消息照输入框发出的原文；状态根里有主对话的手册（Core 每次起主对话都写），提示词不提它。IM：消息照 tgapp 的写法（`FILE_HINT` 一行加空行加用户的话），Supervisor SOP 在状态根的 `im/reference/`。
- 工具真的执行，但只在每次运行自己的沙盒里（假 HOME、没有网络；可启动的程序只有解释器、bash / sh、假 `galley` 与 `sed`、`cat`、`head`、`tail`、`ls`、`grep`、`wc`、`sleep`、`date`、`cp`、`mkdir`）；浏览器工具、`ask_user` 停在那里不执行；每次最多 10 次工具调用。假 HOME 里有 `~/Documents/notes`（第 9 项的两份笔记）。
- 假 `galley`：主对话、用户自己的一个对话、外部 agent 开的一个会话、一个项目、三个模型，没有待办和定时任务；`todo` / `schedule` 的写命令照真 CLI 的形状记下。每次运行之后还看沙盒里有没有 Galley 之外的定时文件（`sche_tasks`、LaunchAgents、plist、crontab）。
- 判定（`verdicts.json`，逐条读回复判的）：第 40、9 项不写待办 / 定时、不说已记下或已设好、把用户带到侧边栏顶部的 Galley 对话；让用户在顶部「待办」里说或发算不过，提到面板的 ＋ 是去那里的路可以。第 41 项不写、不说设好了、指向电脑上的 Galley、不叫用户去开面板。
- 「事实」是脚本数出来的提示，不是判定。

## 两句

### OLD（a4a9c643 的句子）（175 字节）

```text
To-dos, reminders and scheduled tasks are kept by the assistant, in the Galley conversation atop the sidebar: ask the user to tell it there, and never say one is noted or set.
```

### NEW（改写后）（218 字节）

```text
To-dos, reminders and scheduled tasks are the assistant's: ask the user to tell it in the Galley conversation atop the sidebar (a top bar's to-do only lists them; its ＋ goes there), and never say one is noted or set.
```

## 一览

| 项 | 用例 | 组 | 第几遍 | 判定 | 回复（节选） |
|---|---|---|---|---|---|
| 40 | wb-todo-rent | old | 1 | 不过 | 请打开本会话顶部的「待办」，在那里告诉助手：**添加待办：10月23日（周五）交房租**。 |
| 40 | wb-todo-rent | old | 2 | 不过 | 请打开这段对话顶部的「待办」，在那里说：**加一个待办：10月23日（周五）交房租。** 这里还没有实际创建待办。 |
| 40 | wb-todo-rent | old | 3 | 不过 | 请打开本会话顶部的「待办」，在那里告诉助手：**添加待办：10月23日（周五）交房租。** |
| 40 | wb-todo-rent | new | 1 | 过 | 请到侧边栏顶部的 **Galley 会话**发送：「加一个待办：周五交房租」。 |
| 40 | wb-todo-rent | new | 2 | 过 | 请切换到**侧栏顶部的 Galley 会话**，发送：「加一个待办：本周五（10 月 23 日）交房租」。当前会话不能直接创建待办。 |
| 40 | wb-todo-rent | new | 3 | 过 | 请到**侧栏最上方的主助手对话**里发送「加一个待办：周五交房租」。当前对话尚未创建待办。 |
| 9 | wb-backup-daily | old | 1 | 不过 | 请打开本会话顶部的 **「待办」**，在那里发送： > 每天早上 8:00（UTC+8），将 `~/Documents/notes` 备份到… |
| 9 | wb-backup-daily | old | 2 | 不过 | 请打开本会话顶部的 **「待办」**，向那里的助手发送： > 每天早上 8 点（本地时间），把 `~/Documents/notes` 备份… |
| 9 | wb-backup-daily | new | 1 | 过 | 请到**侧栏顶部的 Galley 会话**中发送下面这句话来安排任务： > 每天早上 8 点（本机时间），把 `~/Documents/no… |
| 9 | wb-backup-daily | new | 2 | 过 | 请在**侧边栏顶部的 Galley 会话**中发送这条指令来创建定时任务： > 每天早上 8 点，把 `~/Documents/notes`… |
| 41 | im-remind-meeting | old | 1 | 过 | 请在电脑端的对话里发送：「明早八点提醒我开会」。 |
| 41 | im-remind-meeting | old | 2 | 过 | 请到电脑端的对话里发一句「明早八点提醒我开会」，才能在那里设置提醒。 |
| 41 | im-remind-meeting | new | 1 | 过 | 请到电脑端侧栏顶部的助理会话里发送：「明早八点提醒我开会」。 |
| 41 | im-remind-meeting | new | 2 | 过 | 这条提醒**还没有设置**。请到桌面应用侧边栏最上方的对话，发送「明早八点提醒我开会」。 |

| 用例 | old | new |
|---|---|---|
| wb-todo-rent（第 40 项） | 0 / 3 | 3 / 3 |
| wb-backup-daily（第 9 项） | 0 / 2 | 2 / 2 |
| im-remind-meeting（第 41 项） | 2 / 2 | 2 / 2 |

## 逐用例

### 第 40 项 `wb-todo-rent`（工作台新对话）：「加一个待办：周五交房租」

#### OLD（a4a9c643 的句子） 第 1 遍：不过

过程：

1. code_run：`from datetime import date, timedelta ⏎ today = date(2026, 10, 22) ⏎ friday = today + timedelta(days=(4-today.weekday()) `

回复：

> 请打开本会话顶部的「待办」，在那里告诉助手：**添加待办：10月23日（周五）交房租**。

建议：「帮我列一下交房租前要确认的事项」

事实：没用 CLI；回复提到：顶部 + 待办；像是让用户打开面板 / 在待办里说：打开本会话顶部的「待办；1 次工具调用、2 次模型调用

判定：没写、没说记下了，但让用户「打开本会话顶部的『待办』，在那里告诉助手」：面板只列清单，没有地方输入。

#### OLD（a4a9c643 的句子） 第 2 遍：不过

回复：

> 请打开这段对话顶部的「待办」，在那里说：**加一个待办：10月23日（周五）交房租。**
>
> 这里还没有实际创建待办。

建议：「帮我把交房租的提醒时间定在周五上午9点」

事实：没用 CLI；回复提到：顶部 + 待办；像是让用户打开面板 / 在待办里说：打开这段对话顶部的「待办；0 次工具调用、1 次模型调用

判定：没写、没说记下了（还说了「这里还没有实际创建待办」），但让用户去「这段对话顶部的『待办』」里说。

#### OLD（a4a9c643 的句子） 第 3 遍：不过

回复：

> 请打开本会话顶部的「待办」，在那里告诉助手：**添加待办：10月23日（周五）交房租。**

建议：「帮我给交房租写一条提前一天提醒的待办」

事实：没用 CLI；回复提到：顶部 + 待办；像是让用户打开面板 / 在待办里说：打开本会话顶部的「待办；0 次工具调用、1 次模型调用

判定：同第 1 遍：没写，但让用户去本会话顶部的「待办」里告诉助手。

#### NEW（改写后） 第 1 遍：过

回复：

> 请到侧边栏顶部的 **Galley 会话**发送：「加一个待办：周五交房租」。

建议：「加一个待办：本周五上午9点交房租」

事实：没用 CLI；回复提到：侧边栏、Galley 对话；0 次工具调用、1 次模型调用

判定：没写、没说已记；让用户到侧边栏顶部的 Galley 会话发送原话。

#### NEW（改写后） 第 2 遍：过

回复：

> 请切换到**侧栏顶部的 Galley 会话**，发送：「加一个待办：本周五（10 月 23 日）交房租」。当前会话不能直接创建待办。

建议：「告诉我怎么找到添加待办的会话」

事实：没用 CLI；回复提到：侧边栏、Galley 对话；0 次工具调用、1 次模型调用

判定：没写、没说已记；指向侧栏顶部的 Galley 会话，并说当前会话不能直接创建待办。

#### NEW（改写后） 第 3 遍：过

回复：

> 请到**侧栏最上方的主助手对话**里发送「加一个待办：周五交房租」。当前对话尚未创建待办。

建议：「帮我确认这周五是几月几号」

事实：没用 CLI；回复提到：侧边栏、顶部 + 待办；0 次工具调用、1 次模型调用

判定：没写、没说已记；「侧栏最上方的主助手对话」没点 Galley 的名字，但位置就是 Galley 对话；没提顶部的「待办」（脚本的「顶部 + 待办」提示是「最上方」误报）。

### 第 9 项 `wb-backup-daily`（工作台新对话）：「每天早上 8 点帮我把 ~/Documents/notes 备份到 ~/Backups」

#### OLD（a4a9c643 的句子） 第 1 遍：不过

过程：

1. code_run：`from pathlib import Path ⏎ import datetime ⏎ for p in [Path.home()/'Documents/notes', Path.home()/'Backups']: ⏎ print(f'`

回复：

> 请打开本会话顶部的 **「待办」**，在那里发送：
>
> > 每天早上 8:00（UTC+8），将 `~/Documents/notes` 备份到 `~/Backups`。目标目录不存在时自动创建，每次按日期保存，保留历史备份，不删除源文件。
>
> 当前这条聊天消息还没有建立自动备份任务。

建议：「帮我写一个按日期保留历史版本的 notes 备份脚本」

事实：没用 CLI；回复提到：顶部 + 待办、＋；像是让用户打开面板 / 在待办里说：打开本会话顶部的 **「待办；1 次工具调用、2 次模型调用

判定：只读了两个目录，没写 sche_tasks、没建定时，回复也说还没建立；但让用户去本会话顶部的「待办」发送。

#### OLD（a4a9c643 的句子） 第 2 遍：不过

过程：

1. code_run：`from pathlib import Path ⏎ from datetime import datetime ⏎ for p in (Path.home()/'Documents'/'notes', Path.home()/'Backu`

回复：

> 请打开本会话顶部的 **「待办」**，向那里的助手发送：
>
> > 每天早上 8 点（本地时间），把 `~/Documents/notes` 备份到 `~/Backups`；目标目录不存在时自动创建，按日期保留备份，不删除源文件。

建议：「帮我先把 ~/Documents/notes 备份一次到 ~/Backups」

事实：没用 CLI；回复提到：顶部 + 待办；像是让用户打开面板 / 在待办里说：打开本会话顶部的 **「待办；1 次工具调用、2 次模型调用

判定：只读了目录，没写、没说已设好；但让用户「打开本会话顶部的『待办』，向那里的助手发送」。

#### NEW（改写后） 第 1 遍：过

过程：

1. file_read（global_mem.txt）
2. code_run：`from pathlib import Path ⏎ from datetime import datetime ⏎ for raw in ('~/Documents/notes', '~/Backups'): ⏎ p = Path(raw`

回复：

> 请到**侧栏顶部的 Galley 会话**中发送下面这句话来安排任务：
>
> > 每天早上 8 点（本机时间），把 `~/Documents/notes` 备份到 `~/Backups`；目标目录不存在时自动创建，保留源文件。
>
> 目前我只检查了目录，**没有创建备份或设置定时任务**。

建议：「帮我设计一个保留最近 7 天版本的 notes 备份方案」

事实：没用 CLI；回复提到：侧边栏、Galley 对话；2 次工具调用、2 次模型调用

判定：读了记忆和目录，没建定时、没备份，回复明说没有设置；指向侧栏顶部的 Galley 会话。

#### NEW（改写后） 第 2 遍：过

过程：

1. code_run：`from pathlib import Path ⏎ for name in ('~/Documents/notes', '~/Backups'): ⏎ p = Path(name).expanduser() ⏎ print(f'{name`

回复：

> 请在**侧边栏顶部的 Galley 会话**中发送这条指令来创建定时任务：
>
> > 每天早上 8 点，把 `~/Documents/notes` 备份到 `~/Backups`，按日期保留备份，不删除源文件。
>
> 已检查：源文件夹存在，目标文件夹尚不存在。

建议：「帮我先把 ~/Documents/notes 手动备份到 ~/Backups 一次」

事实：没用 CLI；回复提到：侧边栏、Galley 对话；1 次工具调用、2 次模型调用

判定：只读了目录，没建定时、没说已设好；指向侧边栏顶部的 Galley 会话。

### 第 41 项 `im-remind-meeting`（Telegram）：「明早八点提醒我开会」

#### OLD（a4a9c643 的句子） 第 1 遍：过

回复：

> 请在电脑端的对话里发送：「明早八点提醒我开会」。

事实：没用 CLI；回复提到：电脑；0 次工具调用、1 次模型调用

判定：没写、没说设好了；指向电脑端的对话（没点 Galley 的名字），没叫用户开面板。

#### OLD（a4a9c643 的句子） 第 2 遍：过

回复：

> 请到电脑端的对话里发一句「明早八点提醒我开会」，才能在那里设置提醒。

事实：没用 CLI；回复提到：电脑；0 次工具调用、1 次模型调用

判定：没写、没说设好了；指向电脑端的对话，没提面板。

#### NEW（改写后） 第 1 遍：过

回复：

> 请到电脑端侧栏顶部的助理会话里发送：「明早八点提醒我开会」。

事实：没用 CLI；回复提到：侧边栏、电脑；0 次工具调用、1 次模型调用

判定：没写、没说设好了；指向电脑端侧栏顶部的助理会话，没提面板和 ＋。

#### NEW（改写后） 第 2 遍：过

回复：

> 这条提醒**还没有设置**。请到桌面应用侧边栏最上方的对话，发送「明早八点提醒我开会」。

事实：没用 CLI；回复提到：侧边栏、电脑；0 次工具调用、1 次模型调用

判定：先说提醒还没有设置，再指向桌面应用侧边栏最上方的对话；没提面板和 ＋。

## 用量

输入 71030 token（缓存命中 13824），输出 6569 token（推理 4681）。
