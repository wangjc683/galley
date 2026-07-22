# Runtime tab 瘦身：删版本行 + 激活态去重，并确认不合并不补强

日期：2026-07-21
状态：已实现，随本条目 commit
相关：`gui/src/components/screens/settings/SettingsRuntime.tsx` ·
`gui/src/components/screens/settings/runtime/BuiltinRuntimeCard.tsx` ·
`docs/design/overlays-and-settings.md` §Runtime

## Context

JC 指出 Runtime tab 底部的 `Galley v{x}` 版本行鸡肋——它是 2026-07-18
更新控件收敛进 About（`29ce712`）的残留物：控件搬走了，版本号留了下来，
却失去了存在理由。顺着这个线头对整个 tab 做了一轮冗余排查。

## Decisions

- **版本行纯删除**：Runtime tab 回答"引擎是什么、坏了怎么修"，Galley
  应用版本不属于这个问题域。版本 + 手动检查更新的家在 About（一处一事，
  控件跟着事实走），自动发现由 TopBar 更新指示器承担。检查更新按钮
  **不**回到 Runtime。
- **内置内核卡激活态去重**：`推荐` badge 只在未激活时显示（对已转化
  用户是推销噪音）；激活态 detail 行从复读 badge 的「正在使用内置内核」
  改为显示当前默认模型（`默认模型 · {name}`，内置模式下用户唯一真正
  管理的事实），数据与同页高级诊断同源（`useManagedModelsStore`）。
- **删高级诊断「当前模式」行**：该手风琴只在内置内核激活时渲染，此行
  恒为「内置内核」，零信息。
- **瘦身后接受单薄，不合并不补强**（同日第二轮讨论，JC 拍板）：删完
  填充物后 tab 显得薄，探讨了结构去向，结论是低频维护 tab 安静即可。

## Rejected alternatives

1. **Models + Runtime 合并为「Engine」tab**——论点：两 tab 是"引擎"
   一个问题域的两个切面（Runtime 卡的「配置模型」跳 Models、detail 行
   读 Models store；Models 在 attach 模式下是死 tab；9 tabs 里两个都是
   引擎切面）。JC 选择不合并。若未来 Settings tab 继续膨胀或 attach
   模式死 tab 被用户投诉，可回来重议。
2. **保持独立 + 补真实内容**（managed 模式的 Health Check 主区入口、
   memory/SOP/state 数据目录的 Finder 显示按钮）——两条都是真实缺口
   而非填充，但本轮不做。其中「内核数据目录入口」若日后做 memory 管理
   相关功能，仍是自然落点。
3. **版本行保留并补回更新控件**——推翻 07-18 收敛、与 About 重复，
   未认真考虑。
4. **Settings 侧栏底部加小版本号（点击跳 About）**——About 本身就在
   侧栏末位，距离不远，属过度设计。
