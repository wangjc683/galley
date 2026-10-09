# 01 宪法 Rule 2 修订与 PRD 远程叙事改写：措辞稿

Type: task
Status: done（JC 2026-10-09 接受；宪法 `0d59f9a7`，PRD 与 architecture `18f7fe51`，live 文档过时引用随后一提交清理；archive 与 devlog 不动）

依据：[iOS PRD](../PRD.md) 裁决 1、19、21；[移动端产品定义](../../mobile-product/PRD.md)。
原则：只改与远程叙事相关的句子，每处给「现文 → 拟文」，不整节重写；宪法用英文（`CLAUDE.md` 全文英文），PRD 用中文。

## 1. `CLAUDE.md` Rule 2

现文：

> ### 2. Localhost Only
> Galley Core listens only on AF_UNIX socket / Windows named pipe. It does not open TCP, expose HTTP, or hold remote auth tokens.
> Remote use cases belong to the external Supervisor transport layer, such as an IM bot, SSH, or another agent frontend.
> Any proposal to add HTTP server, token auth, remote login, or TLS must first change this constitution.

拟文：

> ### 2. Core Never Listens On The Network
>
> Galley Core accepts local control only on an AF_UNIX socket / Windows named
> pipe. It does not open a TCP listener, expose HTTP, or hold remote login
> tokens.
>
> Remote access exists only through Galley's own remote module (since
> 2026-10-09, see [iOS client](./.scratch/ios-client/PRD.md)): it runs inside
> the Core process, connects outward from the desktop to a relay, is
> end-to-end encrypted, and talks only to devices the user paired on the
> desktop. The relay sees ciphertext and routing metadata, stores no user
> data, and cannot issue commands. The desktop is the only place Core runs;
> a phone is a presenter of the desktop's state, never a second authority.
>
> IM bots, SSH, and other agent frontends remain supported transports; they
> are no longer the only remote path.
>
> Any proposal to add a TCP / HTTP listener on Core, a relay that can read
> plaintext, or a login that is not device pairing must first change this
> constitution.

对应 JC 10-09 的中文原则：「Core 永不监听网络；远程访问只经过由桌面向外连接、端到端加密、设备配对的远程模块，中转只能看到密文。」
拟文多加了三句，请看是否接受：中转「不存用户数据、发不出命令」；「手机是桌面状态的呈现端，不是第二个权威」（护住 Rule 5）；
IM / SSH「仍支持，不再是唯一路径」（裁决 19、21）。

## 2. `docs/PRD.md`

### §1 一句话定位

现文：「它有两个对等的前端：GUI……CLI——给 **Supervisor Agent**（外部 agent……）远程操作整个 session team」

拟文：

> 它有三个前端，共享同一个 Galley Core：
> - **Galley GUI**——人在桌前看进度、写指令
> - **Galley 手机端**（规划中，iOS 原生）——人在外面时的入口；电脑是助理的工作台，手机是人所在的地方
> - **Galley CLI**——给其他 Agent 与本机自动化操作整个 session team

去掉「远程操作」与「Supervisor Agent」的加粗主叙事（裁决 21「退」）；CLI 的契约地位不变（Rule 3）。

### §2 产品摘要

第 3 条现文：「手机上用户期待是"管理"而不是"工作"：更像总监 / 管家，而不是工作台」

拟文：

> 3. **手机上不是只管理**：现代人手机用得比电脑多；助理有一台可操作的电脑，含用户登录态的真实浏览器，手机上就能真正干活
>    （原「手机上是管理而不是工作」，2026-10-09 推翻，依据[移动端产品定义](../.scratch/mobile-product/PRD.md)）

「v0.1 解决了第 1 个……」一段的拟文：

> v0.1 Galley 解决了第 1 个（multi-session 桌面 GUI）；第 2 / 3 个的答案是 Galley 自己的手机端：桌面 Core 是手机的后端，
> 两端看到同一份状态；IM 渠道与 Agent 经 CLI 操作继续作为替代入口。
>
> Galley 自身永远是本地应用；远程传输由 Galley 自己的远程模块经端到端加密中转完成（宪法 Rule 2，2026-10 修订）。

删除原「桌面 / 远端 / 回桌面」三行与「远程传输不是 Galley 的责任」一句。

### §3 产品定位

现文：「**Local-first**：所有数据在用户机器，远程传输由 Supervisor 在外部完成」
拟文：「**Local-first**：所有数据与积累在用户机器；远程访问经 Galley 自己的端到端加密中转，中转不存数据」

现文：「**agent-friendly platform**：Supervisor Agent 通过公开 CLI 契约面控制整个 team」
拟文：「**agent-friendly platform**：其他 Agent 通过公开 CLI 契约面操作整个 team」

### §4.2 Localhost only

整节替换为：

> ### 4.2 Core 永不监听网络（2026-10 修订，原「Localhost only」）
>
> **Galley Core 永远只在 AF_UNIX / named pipe 上接受本地控制，不开 TCP 监听，不持有远程登录 token。**
>
> 远程访问只经过 Galley 自己的远程模块：它在 Core 进程内、由桌面向外连接到中转、端到端加密、只与用户在桌面上配对过的设备通话。
> 中转只看到密文与路由元数据，不存用户数据，也发不出命令。
>
> ```
> ┌──────────────────────┐   端到端加密   ┌──────────────────────┐   桌面向外连接   ┌──────────────────────┐
> │ 手机（已配对设备）    │ ◄───────────► │ 中转（只见密文）      │ ◄────────────── │ 桌面 Galley Core      │
> │ 呈现桌面的状态        │               │ 无状态、不存数据      │                 │ 远程模块在进程内      │
> └──────────────────────┘               └──────────────────────┘                 └──────────────────────┘
> ```
>
> IM 渠道、SSH 等外部传输继续支持，不再是唯一远程路径。
>
> 收益：安全模型 = 设备配对 + 端到端加密，中转不在信任链里；桌面不开端口，局域网与公网都扫不到；「积累在你自己的电脑上」照旧，中转不存任何数据。
> 修订叙事见 [2026-10-09 devlog](./devlog/2026-10-09-ios-client-and-main-chat-direction.md)。

### §5 目标用户

「V1.0 优先服务」拟加第一条：「把 Galley 当个人助理、经常在手机上和它沟通的内置内核用户（2026-10-09 起优先）」。
「不优先服务」拟删「不写代码 / 不用 IM agent 的用户」一条（与个人助理定位冲突）。这一条是产品主张的变动，JC 2026-10-09 已认可。

### §6.2 Non-goals

现文：「**远程认证 / token 系统**：永远 localhost only（宪法 Rule 2）」
拟文：「**远程登录 / token 系统**：不做；远程只有设备配对（宪法 Rule 2）」

现文：「**Web / mobile / remote 前端**：仍未做」
拟文：「**Web 前端**：不做。手机端已立项（[iOS 客户端](../.scratch/ios-client/PRD.md)）」

### §21 Future direction

「Web view / mobile thin client（直接跟 Galley Core 通信，不需要 Supervisor 中转）」→「手机端已立项，见 §6.2」；
「远程访问层（如果证据上需要，但仍坚持 localhost only 是默认）」→ 删除（已决定，Rule 2）。

## 3. `docs/architecture.md` Localhost Only

现文：「It does not expose a TCP server, HTTP API, token auth, OAuth flow, or remote login. Remote workflows belong to the user's trusted Supervisor Agent or IM transport; Galley stays local.」

拟文：

> It does not expose a TCP server, HTTP API, token auth, OAuth flow, or remote
> login. Remote access goes through Core's own remote module, which connects
> outward to an end-to-end encrypted relay and talks only to paired devices
> (constitution Rule 2, revised 2026-10). IM transports and agent frontends
> remain supported. The section title stays "Localhost Only" until the remote
> module lands; then it becomes "Core Never Listens On The Network".

## 4. 不在本票

- `README.md` 第 66 行 IM 渠道文案与第 43 行 Supervisor 叙事：随手机端发版时改，不提前宣传。
- `docs/project-status.md`：发版相关，不动。
- 设置 Agent 页「复制 Supervisor SOP」改名：deferred。

## 落地顺序

1. JC 过目本稿，逐条「接受 / 改」。
2. 宪法 `CLAUDE.md` 单独一个提交；PRD 与 architecture 一个提交。
3. devlog 记一条「Rule 2 修订落地」。
