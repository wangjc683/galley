# PRD: live run 的两行窗口（固定大小的状态面板）

Status: ready-for-human
Date: 2026-09-16
来源: JC 提议（「每一步完成就折，自始至终只显示一个」），agent 修正为两行窗口
关联: [devlog](../../docs/devlog/2026-09-16-live-run-window.md) ·
[run fold PRD](../conversation-run-fold/PRD.md) §2 ·
[步号淡一档 devlog](../../docs/devlog/2026-09-16-step-marker-recede-and-reference-audit.md) 后记九

## 问题

多步 run 在 live 期间是一张越长越长的清单。三次在同一套排版上挤像素
（08-23 A 刀、09-16 数值刀、09-16 单行合并刀）都以「密而不省、阅读变差」
收场。结论：密度与阅读体验在一套静态排版里无解，按状态分流。

## 定案

live 区不再是清单，是一块**固定大小的状态面板**：

```
▸ 已完成 3 步 · 读取网页 ×2 · 执行网页脚本      ← live 头（RunFoldHeader live 变体）
│ 04 已跳转搜索沿途景点，读取结果提取顺路玩法。   ← 上一步，53px 阅读形态原样
│    ⌁ 执行网页脚本 ⌄
│ ·· 思考中 · 6.9 秒                             ← 进行中行（MainView）
```

1. **窗口 = 上一步落定的 step + 进行中行。** 只留进行中一行会让 summary
   永远读不到（它在 turn_end 才产生）。
2. **头是 RunFoldHeader 的 live 变体**：文案「已完成 N 步」、不带用时
   （思考行步时钟 + HUD run 时钟已够两只表）、气味段 / 提问 / 拒绝同
   settled。第一步折进去时（第 2 步完成）才出现；单步 run 不受影响。
3. **完成即折**：头原位换成 settled 头，窗口收走两行。
4. **live 展开是 opt-in**：点头展开已折的步，之后完成的步继续追加；完成时
   保持展开（尊重 foldOverrides）。
5. **注意力态原样进面板**：审批卡替换思考行、ask_user 气泡在尾、流式正文
   面板下方全宽。
6. **rail 贯通**：头 caret 中心 → 窗口 → 思考行。MainView 的 in-flight 区
   从第 2 步起 `railFrom="header"` 向上补 10px。
7. **中止全展**：无最终答案的 run 永不折；`agentRunning` / `askUserPending`
   皆否时窗口撤掉，整个 run 平铺。
8. **范围**：只对 `foldEligible` 的 run（用户发起、非 Goal、无 system
   turn）。Goal run 留第二步。
9. **不新增寄存器**：无新颜色 / 字号 / 动效 token。

## 实现

- `run-groups.ts`：`foldEligible`（run 形状半边），`foldable = complete && foldEligible`。
- `Conversation.tsx`：`agentRunning` prop；`liveGroup` = 最后一组 && 未完成
  && eligible && (running || askUserPending)；成员分三种 owner：
  `sectionOwner`（折进 live 头）/ `windowOwner`（最后一个 agent turn 及其后）/
  `regionOwner`（不可折 run 平铺）。装配段三种 kind：fold / flat / window。
  keep-expanded 指针与 rAF 释放已删（完成即折由 `folded = override ?? true`
  直接得到）。
- 窗口包在 ExpandSection 里（key `window-<opener>`），间距归属由它承担：
  marker 的 `mt-*` 经 `data-role="step-marker"` 归零；无头 `mt-6`、折叠头
  `-mt-2.5` + region `pt-2.5`（头的 mb-2.5 抵消后以 padding 在 overflow 盒
  内重发，rail 才能穿过间隙不被裁）、展开头 `mt-0` + `pt-2.5`；关闭态
  `mt-0`。与 RunFoldSection 的 `-mt-5.5` 同一套编排。
- **完成瞬间的收合**（settling）：run 完成的那一次渲染里，Conversation 用
  guarded setState-in-render 把 `settlingOpener` 指向它，保持 live 结构一次
  sweep（窗口 ExpandSection `open=false` 收合、头当场换 settled 文案、最终
  答案平铺在下、closing turn 不进窗口），300ms 后清掉切换到 settled 结构——
  此时折叠段本就是关的，画面不再动。用户 live 展开过（override）或 run 未
  完成（中止）不走 settling。
- `RunFoldHeader` `live` prop；i18n `foldStepsLive`。
- `MainView`：传 `agentRunning={isRunning}`；in-flight 与审批区 `inRunRail`。

## 已知、待真机验

- 完成瞬间的收合：窗口两行 240ms sweep 收进头，同时头换成「N 步 · 用时」；
  看头文案的瞬换与窗口的渐收是否读作一个动作。
- 快步连发时窗口内容替换频率高，ExpandSection 可打断，但观感待看。
- 两步 run 的 live 头只在最后一刻出现即变 settled 头，是否闪。
- 760 列宽下 live 头气味段截断与 tooltip。

## 第二步（等本票验收）

- 进行中行显示工具级状态（需 bridge 工具级 live 事件，Phase 2 协议）。
- Goal run 进面板。
