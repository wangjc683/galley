# 删掉桌面宠物与重新注入工具：标题菜单里两个从上游搬来的项

Date: 2026-10-23
Status: 已实施（分支 `remove-pet-and-reinject`，代码与文档分开提交），静态门禁全绿；待合入 main；unreleased
Related: [PRD](../../.scratch/remove-desktop-pet/PRD.md)、
[票 01](../../.scratch/remove-desktop-pet/issues/01-remove-desktop-pet.md)、
[IPC 协议 §4.13–4.15、§5.10–5.12](../ipc-protocol.md)、
[layout-and-chrome「标题菜单里的查找与重置」](../design/layout-and-chrome.md)、
[GA 基线 Contract Surface 第 9、10 条](../ga-baseline.md)、
[05-13 两项搬进来](./2026-05-13-galley-rename-and-features-marathon.md)、
[05-14 宠物的侧栏徽标与隐式迁移](./2026-05-14-conversation-streaming-and-btw-marathon.md)、
[08-10 上游拆掉宠物的端口](./2026-08-10-ga-upstream-upgrade-d8d90ee-to-308153b.md)

## 起因

JC 10-23 发现桌面宠物打不开，觉得这个从上游来的东西跟 Galley 的气质完全不搭，问要不要整条删。主会话查实它两头都断了，独立判断推荐删（PRD 裁决 1）。接着 JC 问同一个标题菜单里的「重新注入工具」，查实它也已经坏了、引擎自己兜住了，推荐一并删、并进同一张票（裁决 2）。两项都是 05-13 从上游 `stapp.py` 搬来的。

## 为什么删桌面宠物（裁决 1）

- **两头都断了**。内置运行时里从没打开过：macOS 上上游宠物用 PyObjC 画窗口，内置 Python 不带 PyObjC；Windows 上它用 tkinter，打包脚本在所有平台删了 tkinter（`scripts/bundle-python.sh`）。进程一起来就退出，输出丢进 `DEVNULL`，桥不查进程还在不在就发「已附着」，侧栏挂着小猫徽标，屏幕上什么都没有，内置运行时 05-24 上线起就这样。外置 GA 下用户自己的 Python 装了 PyObjC 时能打开，但 08-10 升级上游基线时上游把宠物的 HTTP 端口（41983）拆了、换成本地 hub 总线，Galley 每一步推的进展全部落空。GitHub issue 里搜「pet / 宠物」0 条。
- **判断**：Galley 有自己会动的脸（主聊天 PRD 裁决 114、117–119），「同一时刻只有一张脸在演」；宠物是第二个角色、另一种画风，是 [foundations §2.7](../design/foundations.md) 默认删掉的环境噪动。修好要把 PyObjC 打进内置 Python、Windows 放回 tkinter、改接上游 hub 总线（新的读写上游内部协议的耦合点），代价与价值不成比例；只藏入口会留下两头都断的死代码，违背「Less harness」。

## 为什么删重新注入工具（裁决 2）

- **它已经坏了**。按钮做三件事：读上游的 `assets/tool_usable_history.json`、清 GA 的 `last_tools`、把文件内容追加进 `backend.history`。内置代码 06-23（`3676fedd`）起就没有这个文件，点了只报「GA asset not found」；外置看用户 GA 的版本，新版同样没有。坏了四个月没人发现。
- **上游换了做法，引擎也会自动做**：上游新前端 `stapp2.py` 的按钮只清 `last_tools`。GA 的文本协议在五种情况下自动重发完整工具说明：每 10 轮、调了不存在的工具、工具调用 JSON 解析失败、累计历史超过约 9000 token、切换模型；原生工具调用的模型每次请求都带工具定义。按钮原本防的「长会话里忘了工具」，引擎已经兜住。
- **少一个耦合点**：它是 `docs/ga-baseline.md` 登记的第 10 个耦合点（连带第 9 条 `last_tools`），每次升级基线都要审。
- **没选**：改成上游 `stapp2` 的做法、只清 `last_tools`（与引擎五条自动规则重复，用户判断不了何时该点，点了也看不出差别）；不动（留一个点了就报错的按钮）。

## 删了什么

- **wire**：`attach_pet`、`detach_pet`、`reinject_tools` 三条命令与 `pet_attached`、`pet_detached`、`tools_reinjected` 三条事件，runner、Core、GUI 镜像三边同删；漂移门禁对齐在 15 个事件、8 条命令（原 18、11）。不在 CLI 与 Agent API 里，不涉及 schemaVersion。协议文档里两段的编号保留，写一行删除说明，照 10-05 审批的写法。
- **runner**：桥的三个处理函数、宠物子进程句柄、`shutdown` 与主循环退出时的宠物清理；看门狗退出前的清理钩子也删了——`_PARENT_LOSS_CLEANUP` 是 07-03 为孤儿宠物加的，只服务宠物，`runner/_watchdog.py` 的 `cleanup` 参数随之没有调用方，一起删。`GaSession` 删 `extend_history`、`clear_last_tools`，以及删完后再无调用方的 `history()`、`unregister_turn_hook()`；GA 集成缝不再碰 `last_tools`。
- **Core**：`core/src/ipc.rs` 的三个事件变体、三个命令变体、对应结构体与测试 `attach_pet_wire_uses_port_not_variant`；`generate_title` 的「None 必须省略」测试留着，说明改成不引用它。
- **GUI**：标题菜单两项与它们的图标、侧栏会话行的小猫徽标、`petAttachedSessionId` 与 `pendingPetMigrationTo` 两份状态、重置主对话时清宠物绑定的两步、IPC 处理里三个分支与它们的提示、中英文案各 10 个键。
- **文档**：IPC 协议、layout-and-chrome 的菜单条目与示意、侧栏徽标那条；ga-baseline 第 9、10 条标为 2026-10-23 退役（编号保留，后面的条目引用不错位），宠物脚本与 `tool_usable_history.json` 那两句标明不再启动、不再读；补丁清单 `0020` 的说明去掉宠物；`CONTEXT.md` 的 GA 集成缝一段；Galley Native RFC 1 的事件清单。

## 留着的

- **上游代码不动**：`managed-ga/code/` 里的 `frontends/desktop_pet_v2.pyw`、皮肤、`DESKTOP_PET_README.md`，`stapp.py`、`stapp2.py`、`ga_cli` 里上游自己的宠物与重新注入用法。删它们要多一个补丁，违背「补丁最少」。
- **外置用户可以自己运行上游宠物脚本**，Galley 只是不再提供入口；外置用户的 GA 文件本来就没碰过。
- 旧 devlog 不改，那是历史。

## 删后的标题菜单

两种运行时一样（外置运行时没有主对话）：

```
主对话                     普通会话
查找聊天记录…      ⌘F      查找聊天记录…      ⌘F
──────────                 重命名
重置主对话…
```

分隔线改成只跟着「重置主对话…」出现，普通会话的菜单里不再有分隔线。
