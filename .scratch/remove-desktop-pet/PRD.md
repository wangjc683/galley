# 删掉桌面宠物

Status: ready-for-agent

## 裁决

1. **删掉桌面宠物的入口与整条集成；上游的宠物文件不动、不打补丁；「重新注入工具」这次不动**（JC 2026-10-23：「桌面宠物这个好像也打不开了，不过我在考虑这个跟我们气质完全不搭的，从上游来的东西，是不是干脆完全删去，不要了？我们探讨一下，听听你的独立判断。」主会话查实它两头都断了，独立判断推荐 A 删；JC：「按你推荐推进，删掉桌面宠物」）：
    1. **事实：两头都断了**。
       - 内置运行时里从来没打开过：macOS 上上游宠物用 PyObjC 画窗口（`managed-ga/code/frontends/desktop_pet_v2.pyw:259` 起 `from Cocoa import …`），内置 Python 不带 PyObjC（本机 bundle 里 `import Cocoa` 报 `ModuleNotFoundError`）；Windows 上它用 tkinter，打包脚本在所有平台删了 `tkinter`（`scripts/bundle-python.sh:104`）。进程一起来就退出，输出丢进 `DEVNULL`；桥不查进程还在不在就发「已附着」（`runner/workbench_bridge.py` 的 `_handle_attach_pet`），侧栏照样挂小猫徽标写「桌面宠物附着中」，屏幕上什么都没有。内置运行时 2026-05-24 上线起就这样。
       - 打得开也收不到：外置 GA 下用户自己的 Python 装了 PyObjC 时能打开，但 2026-08-10 升级上游基线（`4ca23215`）时上游把宠物的 HTTP 端口（41983）拆了，换成本地 hub 总线（`_connect_hub`：「no server, no port, one bus peer」），Galley 每一步往 41983 推的进展全部落空。
       - 没人用：GitHub issue 里搜「pet / 宠物」0 条；两头断了五个月，JC 今天才发现。
    2. **判断**：Galley 有自己会动的脸（主聊天 PRD 裁决 114、117–119），裁决 119 第 6 条「同一时刻只有一张脸在演，规则没有例外」；宠物是第二个角色、另一种画风（像素精灵、走跑冲刺动画），是 foundations §2.7 默认删掉的环境噪动；它原本那点情绪价值已由助理的脸接住。修好要把 PyObjC 打进内置 Python（体积、签名公证）、Windows 放回 tkinter、改接上游 hub 总线（新的读写上游内部协议的耦合点），代价与价值不成比例。只藏入口会留下两头都断的死代码，违背「Less harness」。
    3. **范围**：不在 CLI 与 Agent API 里，不涉及 schemaVersion。删 runner ↔ Core 的 `attach_pet` / `detach_pet` 两条命令与 `pet_attached` / `pet_detached` 两条事件、Core 的透传、GUI 的标题菜单项、会话行的小猫徽标、相关状态、IPC 处理与文案，以及协议与设计文档里的段落；写一条 devlog。
    4. **不动**：上游的 `desktop_pet_v2.pyw`、皮肤与说明留在 `managed-ga/code` 里（那是上游代码，删它要多一个补丁，违背「补丁最少」）；外置模式用户想玩可以自己运行上游脚本，Galley 只是不再提供入口；外置用户的 GA 文件本来就没碰过。同一个菜单里也是从上游搬来的「重新注入工具」这次不审。
    5. **两种运行时**：外置、内置都拿掉入口，行为一样。

## 票

| 票 | 内容 | 依赖 |
|---|---|---|
| [01](./issues/01-remove-desktop-pet.md) | 删掉桌面宠物：runner、Core、GUI、文档 | 主聊天票 91 合入（同改文案与标题菜单一带） |
