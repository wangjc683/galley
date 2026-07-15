# Topbar Update Indicator

Status: ready-for-agent

## Problem

更新状态目前只在 Settings（About / Runtime）里可见。用户不进 Settings 就不知道
有新版本、不知道新版已经下载就绪，也没有随手可点的"重启升级"入口。ready toast
是一次性的：划掉之后唯一入口又回到 Settings。

## Decision (2026-07-14, JC + agent 讨论定稿)

在 MainHeader 的 `TopBarStatusCluster` 末位（最右、紧挨分隔线）新增一个
UpdateIndicator 徽章 + popover：

- **位置**：StatusCluster 末位，不放 UtilityCluster。理由：
  1. 两个 cluster 的语义契约——StatusCluster 是"有状态才渲染"的
     state-of-the-world badges；UtilityCluster 注释明确 "never gate on
     state"。更新徽章按语义属于前者。
  2. 不打乱常驻工具按钮（宽度/字号/主题/齿轮）的位置肌肉记忆。
  3. 排末位即隔分隔线与齿轮相邻，保留"更新↔设置"的空间联想；且前面几项是
     会话/工作域状态，更新是应用级，放边界合适。
- **显示状态**：`available` / `downloading` / `ready` 三态显示；`error` 不在
  顶栏出现（错误留给 toast + Settings）。`available` 必须显示，因为"有任务
  运行时自动下载会延后"期间状态会长时间停在 available。
- **视觉强度分档**：available/downloading 用安静的 neutral 徽章；ready 才用
  强调色（success）。
- **交互**：点击弹 popover（新版本号、当前版本、release notes 摘要），
  `ready` 时 popover 内放"重启并更新"按钮（复用 store `restart()`，自带
  运行中拒绝保护）；ready + 有任务运行时按钮 disabled 并显示
  `copy.updates.readyAfterTasks`。**不做**顶栏一键直接重启（误触成本高）。
- **Toast 共存**：v1 不动现有 ready toast。toast 管"刚就绪"的主动通知，
  徽章管事后随时可达。dogfood 后若嫌吵再撤 toast。
- **无进度条**：下载在 Rust `install_app_update` 内部一次完成，没有进度
  事件；v1 下载中显示不确定态转圈，不为此加 Rust 事件上报。
- **v1 不显示更新说明**（2026-07-15 补充）：更新通道 `latest.json` 的
  `notes` 字段默认只是 GitHub Release 页 URL（见
  `scripts/generate-tauri-update-manifest.mjs`，除非发布时传 `--notes`），
  渲染出来是一行裸链接文本。先把徽章 + 版本号 + 一键重启的闭环上线；
  等发布 SOP 产出真实说明文字后，再把 popover 简介加回来（纯增量）。

## Rejected

- 齿轮上加小蓝点（VS Code 式）：点击后仍要进 Settings 找更新，且无法承载
  popover 的一键重启。可作为将来补充，不是主入口。
- 放 UtilityCluster 齿轮旁：破坏该 cluster "unconditional" 的声明式约定，
  且徽章出现/消失时常驻按钮会位移。

## Implementation notes

- 新组件 `gui/src/components/layout/header/UpdateIndicator.tsx`，状态经
  App.tsx → MainHeader → StatusCluster props 传入（保持 MainHeader 纯
  presenter，不在头部组件里订阅 store）。
- `MainHeader.hasTopBarStatusItems` 门控需纳入更新可见态，否则"只有更新
  徽章"时整个 cluster 不渲染。
- 文案入 `copy.topbar.*`（zh/en 同步），复用 `copy.updates.restart` /
  `preparing` / `foundAfterTasks` / `readyAfterTasks`。
- 验证：typecheck + lint + dev 强置 `useAppUpdateStore` 状态过
  available / downloading / ready / ready+busy 四形态；最终视觉验收 JC 在
  真实 app 做。
