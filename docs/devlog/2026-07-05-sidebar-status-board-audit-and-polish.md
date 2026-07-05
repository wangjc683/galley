# Sidebar 状态板审计与三层打磨 + 两项交互决策

- **Date**: 2026-07-05
- **Status**: 已落地（commits `86e5284` / `e33ca8e` / `b67df12` + 本次文档 commit）
- **Related**: [layout-and-chrome.md](../design/layout-and-chrome.md) §4.1–4.2 多处回写；`gui/src/hooks/useDayStamp.ts`（新）

## Context

对话区打磨后 JC 指定 sidebar 为下一轮。两个审计 agent 分读会话列表层（SessionRow / RowMenu / Timeline）与外壳层（Sidebar / Header / QuickActions / ProjectReview / Footer），主线程核实最重结论。关键修正一处 agent 结论：`completed` 状态并非不可达——CLI/Supervisor 面会写入（`cli/src/session.rs`），但 GUI 本地运行永远结算为 `idle`；规范里的「spinner→check 翻面」对本地会话从未发生，本地「完成」信号 = 状态行前缀 + 未读实心填充。

## Decisions

1. **三信号优先级统一**：rail / icon / 状态行必须同序（error > ask > approval > running/goal-running > unread > idle）。此前 icon 把 ask 排在 error 前,同一行三个信号讲两种话——triage 面的本职失守。已入规范为硬规则。
2. **cancelled 不得声称完成**：新增 `已中止 · {summary}` 状态行,与 Prohibit 图标一致。
3. **归档运行中的会话需确认**（JC 决策）：running 或 goal-master 时弹 alertdialog；文案如实说明「归档不停止运行,但会从侧栏消失、看不到后续进展」。已结算会话保持一键归档。warning 而非 error 语气——可逆操作,风险是失去视线不是丢数据。
4. **鼠标优先是产品决策**（JC 决策）：键盘可达性明确不在范围,写入 layout-and-chrome.md 防止后续审计反复上报;若翻案应整体设计,不做零星 tabIndex 修补。
5. **时间桶跨午夜自动重算**：新 `useDayStamp` hook（定时到下个本地午夜再触发）进 Sidebar 与 Project Review 的 groupSessions memo deps——常开监控台此前过午夜后「今天」滞留昨天的会话,直到无关变动才刷新。
6. **注意力 pop 仅在状态迁移时播放**：挂载(启动/从 Project Review 返回)不 pop——全列齐射「看这里」不是信息。实现要点:渲染期 previous-key latch;post-mount 翻 flag 的方案不可行(晚一帧加动画类照样播)。
7. **pointerdown 即切换保留**（Slack/Finder 同款即时感）,但抑制后续 click 的 500ms 计时窗改为自再武装的 ref 标记(长按 >500ms 曾二次触发)。
8. **编辑中禁右键菜单**:右击行边距会 blur-commit 重命名(本身是设计行为),再在其上弹菜单是双重歧义。
9. 杂项统一:row 菜单与 MainHeader 会话菜单同语域(`galley-pop-in`/200px/13px);`⋯` 触发区 20px 顶对齐→28px 垂直居中;单行 row 垂直居中;状态行获得与标题一致的截断 native-title 例外;编辑态去掉外层 ring;Header 字标/徽标补 `data-tauri-drag-region`(不冒泡),runtime 圆点 `shrink-0`;项目入口不再换字(tint+FolderOpen+tooltip 表达激活,按规范);项目抽屉展开后 scroll-into-view;120ms 动效基线补齐;Plus 字重统一;空装机隐藏归档 footer(但有归档数据时必须保留——唯一入口);「编辑项目」图标 FolderOpen→Pencil。

## Rejected alternatives

- **post-mount armed flag 抑制挂载 pop**:晚一帧把动画类加到已挂载元素上动画照样播放;必须用渲染期 previous-key 比较。
- **click 激活替代 pointerdown**(经典"拖离取消"语义):导航列表的即时切换体感更重要,Slack/Finder 先例;只修计时窗缺陷。
- **空状态无条件隐藏归档 footer**(组件注释的原契约):用户归档掉全部会话时 footer 是回到数据的唯一路径,改为「无会话且无归档」才隐藏。
- **给 sidebar 补键盘可达性**:JC 定为鼠标优先,整体不做。

## Open questions

- Header 在 960px × 14% 极窄宽度下 external-ready 徽标 + SOP 按钮可能拥挤(审计 UNCERTAIN 项),等 JC 真机验收观察。
- Project Review 的 `reviewNowMs` 在长开模式下的 7 天分组漂移(App 传入,打开时捕获)——dayStamp 只修了时间桶;若 dogfood 发现项目分组也滞留,同法接入。

## Next

- JC 真机验收(重点:归档运行中会话的确认框、错误+ask 并存行的三信号一致、启动时不再齐射 pop、跨午夜分桶、窄宽 header)。
