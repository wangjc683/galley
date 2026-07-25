# 深色下"主对话区字体太亮"：font-smoothing 覆盖限定浅色

日期：2026-07-25
状态：已实现并经 JC 真机验收（"现在效果就 OK"），随本条目 commit
相关：`gui/src/components/conversation/MarkdownView.tsx` ·
`gui/src/styles/globals.css` · `docs/design/foundations.md` §2.2 ·
承接同日 [降暖一档](./2026-07-25-dark-theme-dewarm-pass.md)

## Context

降暖一档验收之后，JC 反馈：**"现在主对话区，有时感觉字体太亮"**，并问能不能
用[抬画布](./deferred.md)解决。

"主对话区" + "有时"这两个限定词是决定性的线索——**颜色解释不了它们**。
`--color-ink` 是常量，全 app 一样，也不会时有时无。但代码里恰好有一条同时满足
这两个条件的规则：`MarkdownView.tsx` 在内容含 CJK 时，把 prose 容器的
`-webkit-font-smoothing` 从全局的 `antialiased` 覆盖成 `auto`。

- **作用范围** = agent 正文 / narration / thinking，正好就是主对话区的阅读面。
  用户消息不走 `MarkdownView`，所以不受影响 → 解释"主对话区"。
- **触发条件** = 内容含 CJK（函数名叫 `cjkDominant`，实际是"含任意汉字 / 假名 /
  谚文即为真"）。中文回答必中，纯英文 / 纯代码回答不中 → 解释"有时"。
- **该覆盖从未分过主题**，而立它的 dogfood（2026-06-20）全部在浅色下做。

机制：`auto` 在 macOS 上**不是**次像素抗锯齿（Mojave 已移除次像素渲染），它走
的是系统 font smoothing 的**笔画膨胀**。膨胀对深字压浅底影响轻微，对**亮字压
暗底**会与光学晕染叠加——于是深色下 agent 正文又粗又胀，读作"太亮"。

## Decisions

- **给覆盖补主题条件，浅色行为一字不改。** inline style 里的
  `WebkitFontSmoothing` 换成 `data-cjk-prose` 标记，规则移入 globals.css：

  ```css
  html:not([data-theme="dark"]) [data-cjk-prose] {
    -webkit-font-smoothing: auto;
  }
  ```

- **写 `:not([data-theme="dark"])` 而非 `[data-theme="light"]`**：
  `applyResolvedTheme()` 在 React effect 里设属性，首帧尚无 `data-theme`。默认
  落回浅色行为，保证首帧与改动前完全一致。
- **规则放 CSS、不在 `MarkdownView` 里订阅主题 store**：该组件在流式渲染热路径
  上（每个 throttled chunk 都重渲，其 `memo` 就是为此存在），加一个 store 订阅
  不划算；主题作用域切换交给浏览器零成本。
- **不动任何颜色。** 验收结果是仅此一条就够了——原计划的"降 ink 明度"没有执行。

## Rejected alternatives

1. **抬画布（`--color-app` L 19.3 → ~25，Ghostty 式）**——JC 最初的提议。它
   **一点没降字的绝对亮度**（仍 80.42%），只是抬高背景参照；而且是全局手段，
   为治对话区的局部症状会顺带改掉侧栏 / Settings / 所有面板。更要命的是它解释
   不了"主对话区"和"有时"。另外实测发现它也不是"顺手加 2 点"：`surface` 就在
   L 21.6，app 抬到 21.3 直接撞上去——**抬画布必须整条阶梯一起抬**，是独立改
   动。仍留在 [deferred.md](./deferred.md)。
2. **降 ink 明度往 Notion dark 靠**（JC 提议，本轮实际未执行）——分析做完了，
   数值留档备用。Notion dark 坐标：底 `#191919`（L 21.3 / C 0），正文 = 白
   @81% 合成 `#d3d3d3`（L 86.7 / C 0），对比 **11.74:1**；我们是 L 93.0 /
   14.95:1。候选阶梯（只动 L）：

   | ink L | hex | 屏幕亮度 | 对比 |
   |---|---|---|---|
   | 93.0（现状） | `#ece7e1` | 80.42% | 14.95:1 |
   | 91.0 | `#e5e0da` | 75.03% | 14.00:1 |
   | 89.0 | `#dfdad4` | 70.58% | 13.23:1 |
   | 87.0 | `#d8d3cd` | 65.60% | 12.35:1 |

   **顺序判断是关键**：若先降亮度，笔画膨胀仍在，只会得到"又暗又糊"，而且降完
   再修平滑就会过头变"太暗"。所以先修渲染、再看还要不要降——验收证明不用降。
   若将来重启此项，注意**三档不能等幅降**：`ink-muted` 现为 5.33:1，再降 6 点
   到 4.17:1 就跌破 WCAG AA 正文线（4.5:1），而它承载 timestamp / hint /
   placeholder。JC 已定：真要降就**降全局** token，不为对话区新增专用墨色
   （避免多一条"为什么对话区和别处不一样"的分叉）。
3. **直接删掉 `auto` 覆盖**——2026-06-20 已经试过并被否（浅色下 agent 正文太薄
   太虚，dogfood 反馈后加回）。本次是**限定作用域**，不是回退。

## Open questions / Next

- Windows 侧未验证。WebView2 没有 macOS 的 font smoothing 笔画膨胀，理论上
  `auto` 与 `antialiased` 的差别小得多，深色限定应是无害的；但下次 Win11 smoke
  时值得顺带扫一眼深色下的中文正文。
- 降暖一档遗留的四项仍然开着，见
  [该 entry 的 Next 段](./2026-07-25-dark-theme-dewarm-pass.md)：`brand-tint`
  用户消息块、代码块的 `github-dark`、语义色明度不齐、发光 keyframe 硬编码
  light 品牌色（纯 bug）。
