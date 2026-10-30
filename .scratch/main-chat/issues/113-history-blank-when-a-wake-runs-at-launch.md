# 113 启动时有实时动静，打开那个会话不再空白：历史照样从库里读回来

Status: ready-for-agent（2026-10-30 v0.7.4 草稿冒烟时 JC 撞上；主会话推荐「撤草稿、修好重打 v0.7.4」，JC：「按建议推进」）

来源：[v0.7.4 发布](../../../docs/devlog/2026-10-30-v0.7.4-release.md)。只改 GUI，不动 Core、CLI、Agent API、迁移。内置与外置运行时走同一段代码，两边一起修好。

## 发生了什么

- 10-30 JC 装上 v0.7.4 草稿（Intel），12:20:27 安装版 Core 启动；今天 08:51 的巡看没跑过，调度器同一天内补跑（`core/src/scheduler.rs:9`），12:20:34 就叫醒了主对话。
  它开了新段（第 270 轮），4 步，12:21:34 回 `<no-reply/>`。这一轮是静默的，按票 110 的规则对话里什么都不画。
- 窗口里主区整片空白：没有消息、没有滚动条、没有问候；侧栏的助理卡片写「Galley 12:21」，待办面板正常。
- 库完好：主对话 302 条消息都在，迁移 054 只记一次，没有新备份目录。JC ⌘Q 再打开（今天的巡看已跑过，不再补跑），历史全回来了。

## 原因（主会话读码，代理先核实）

- 打开一个会话时要不要从库里读历史，判的是内存里是不是 0 轮：`gui/src/stores/sessions/lifecycle-slice.ts:345–357` 的 `looksFresh`（注释说「`turns.length === 0` is a safe proxy for "fresh runtime"」）。
- 巡看在启动后 7 秒就开跑，它的实时事件在 GUI 打开主对话、读库之前就落进了 `byId[主对话]`；之后 `looksFresh` 为假，不读库。内存里只剩那一轮静默巡看，于是空白。
- `gui/src/stores/runtime/bridge-slice.ts:309–318` 的 `_attachLive` 写的就是这个竞态（「once live turns land in an empty transcript, activation no longer restores」），但它只防「重载时 run 已经开着」，没防「启动后才开跑」。
- 这段判断从 v0.4.0 就在（`b9a2ce49`）；主对话与巡看是 v0.7.0 起才有。以前没撞上：试用期里启动时那 3 次补跑都因为没东西可看被 Core 跳过了，今天是第一次在启动时真醒。

## 要做到

- 一个会话在这次启动里第一次被打开时，历史一定从库里读回来，不管内存里是不是已经有了先到的实时轮。判据换成「这次启动里读过库没有」一类的确定状态，不再用 0 轮当代理指标。
- 读库时把先到的实时内容并进来：已落库的不重复画，还没落库的（正在跑的那一步、打字气泡、待回答的提问）不丢。Core 每一步都落库，所以库里那一页已经含有先到的已完成步骤；怎么去重（`messageId`、`turn_index`）由代理按现有数据结构定，写进报告。
- 同样的竞态别处还有没有（`turns.length === 0` 当作「没读过」的地方，包括 `_attachLive`、分页 `earlier`、主对话的问候），一起查，能用同一个判据收拢就收拢；查到但不该在本票改的，写进报告交回。
- 不能丢的现有行为：切会话时的原子切换（不画一帧空白，`lifecycle-slice.ts:358–371`）；分页往前读（`loadEarlierTurns`）；重载时 run 开着的那条路；主对话的问候；`derivePendingAskUser`。

## 测试

- 新 vitest 先复现：实时轮（含一轮静默的叫醒轮）先落进空的 store，再打开那个会话 → 库里的历史在、实时轮在、没有重复。修之前这条要红，报告里写明。
- 再加两条：先到的是还在跑的一步（run 没结束）时打开；同一会话第二次打开不再读库（不多读、不闪）。
- 门禁：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui exec vitest run` 本机与 `TZ=UTC` 各一遍、`git diff --check`。

## 约束

- 只改 `gui/`。gui 不是 prettier-clean：新文件可整篇格式化，旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；工具函数别从组件文件导出。
- 静态渲染测试（`renderToStaticMarkup`）读不到 zustand 里塞的值，store 行为用 store 层测试测。
- 票面、提交、报告里别写本机绝对路径和 worktree 路径。

## 给 JC 的真机步骤（主会话先在 dev 里走）

1. 主会话在 dev 里复现：Core 重启后头几秒内用 CLI 手动跑一次巡看（`schedule run`，一定会醒），看主对话的历史还在不在。合入前后各走一次，合入前应当空白。
2. JC 装新草稿后启动：主对话照常有历史（若那天巡看在启动时补跑，正好再撞一次）。

## Comments
