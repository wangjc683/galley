# Dialog 关闭按钮统一：DialogCloseButton 双变体 + Settings 安全区渐隐

日期：2026-08-07。起因：JC 发现各 Dialog 右上角关闭按钮样式不统一，
提出盘点现状再探讨。两轮讨论 + 一轮真机 A/B 后定案：抽共享
`DialogCloseButton`（inline / floating 双变体），floating 走软化样式，
Settings 版面为 X 让位（安全区 + 滚动渐隐）。

## 现状诊断（为什么会走样）

盘点 18 个 Radix Dialog 文件，隐性主线其实高度一致，分歧集中在特例：

- **内容型**（Earlier / Archived / Create/Edit Project / Scheduled /
  Tutorial / PromptManager）：右上角 ghost X，6 处手抄同一段代码。
- **确认型**（ConfirmActionDialog 一族 / FirstClose / YoloIntro）：
  无 X，footer Cancel + Esc；`ConfirmActionDialog` primitive 保证了
  这一族整齐。
- **两个特例**：Settings（secondary 边框凸起 + absolute + 专属
  aria 文案）、ImagePreview（secondary/md/17/bold + tooltip）。

根因：A 族没有共享承载，每个新 Dialog 手抄五行 `Dialog.Close +
IconButton + X`，抄的时候各自走样。约定本身没写进 design doc。

## 裁决（四点，JC 逐条拍板）

1. **抽象粒度：DialogCloseButton 中间方案**。只抽关闭按钮进 `ui/`，
   否 DialogShell（7 个内容型 Dialog 骨架差异太大——尺寸三个量级、
   header 各有私货、关闭策略不同，强抽壳会长出一堆 props 且被绕开；
   "关闭按钮是唯一真正同构的部分，骨架恰恰是各不相同的部分"）；
   否"只改齐样式不抽组件"（下一个新 Dialog 仍靠手抄，会再走样）。
2. **ImagePreview 归入 floating，保留 `size="md"`（32px）为记录在案
   的唯一例外**（沉浸式全出血面，28px 目标太小）；weight 从 bold 收敛
   到 thin。
3. **tooltip 统一关**：X 含义自明，tooltip 是噪音。
4. **"确认型不放 X"写进 design doc**：给 confirm 加 X 会制造第二条
   模糊的取消路径。

顺带清理：session-browser shell 挂在 `Dialog.Close` 上的冗余
`onClick={onClose}`（所有 Root 都接了 `onOpenChange`）连同
`SessionBrowserHeader.onClose` prop 一起删除，关闭只走 Radix 单一
路径；i18n 删除 `settings.close` / `conversation.closeImagePreview`
两个重复文案 key，aria 统一 `common.close`。

## 真机 A/B：floating 样式（secondary vs 软化）

dev 实测后 JC 指出 inline（裸 ghost）与 floating（secondary 边框凸起）
视觉距离拉太开。A/B 切换器（左下角常驻 pill，沿用滚动按钮那轮的形态；
Radix modal 置 body `pointer-events:none`，pill 需内联
`pointerEvents:"auto"` 才能在弹窗开着时点击）对比：

- A：现状 secondary + `bg-elevated/95`；
- B：软化 ghost + `bg-elevated/80` + backdrop-blur。

JC 单看按钮选 B，但截图指出 Settings 里软化 X 与右对齐分段控件在右上
角**静止即重叠**，且它是 Settings 唯一逃生口（backdrop 点击被有意
封掉）。诊断翻转：**问题不在按钮皮肤，在角落是争议领土**——Settings
是全应用唯一"X 浮在右对齐可交互内容上"的面；A 档能见是靠边框硬扛
重叠，皮肤方案解不了结构问题。

三个方案：①安全区 + 滚动渐隐（版面让位，无可见结构）；②细 sticky
header 条（否：一条永久可见线 + 44px + 推翻 Settings 无 header 裁决）；
③ Discord 式内容限宽 + 专用退出沟槽（否：为一个按钮改整个版式）。
JC 认可 ①，二次真机确认后定案 B + ①。

## 定案

- `ui/dialog-close-button.tsx`：inline（ghost）/ floating（ghost +
  半透明垫 + blur）双变体；14/thin，md 例外；无 tooltip；
  `common.close`；新 Dialog 不许手拼。
- Settings 右栏：`pt-12` 安全区 + 顶部 48px 同色渐变层（
  `--color-app` → 透明，静止隐形、滚动时内容先淡出——渐变色与面板
  底色相同故无需滚动监听；渐隐语法与 `ui/scroll-fade.tsx` 同源）。
- 规则落 docs/design/overlays-and-settings.md「Dialog 关闭按钮」节。
- A/B 切换器与两个临时文件已按惯例拆除。
