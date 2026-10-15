# 23 新应用图标与助手头像

Status: ready-for-agent

来源：主聊天 PRD 裁决 70（2026-10-15，JC 定稿：「没问题了，推进」）。不依赖别的票。改图标资源、GUI 的头像与文档，不改 Core 的逻辑。

## 目标

应用图标换成扁平版的木头机器人 G（矢量母图由主会话提供）；侧栏助手卡片与顶栏身份行的头像改用同一个图标，裁成圆、加 1px 内描边；README 的横幅与社交预览图跟着换。

## 一、母图入库

- 矢量母图 `galley-icon.svg`（1024 视框，三层：底 `#fcdba9`、墨 `#291a11` 的整体轮廓、木 `#f9c071`）与它的描摹脚本由主会话提供，放进仓库。母图放在 `core/icons/` 下的一个子目录（名字你定，比如 `source/`），脚本放 `scripts/`。
- 脚本是从位图描出母图的工具（放大 4 倍、按三色分层、平滑、potrace 描摹）。它依赖 `potracer`（纯 Python 的 potrace 移植），不进仓库的依赖清单：脚本头部写清用途、安装方式与用法（以后改几何的路线：让图片模型改位图，再用它重描）。
- 母图不手改路径；颜色是三个常量，可以改。

## 二、应用图标

- **macOS（`icon.icns`）**：按苹果的 macOS 图标网格出图：1024 画布里 824 的圆角方形居中，四周留边，带投影；圆角方形的形状照苹果模板（连续曲率的圆角矩形，你定近似法，写进 Comments）。现在的图标画满画布，在 Dock 里比别的应用大一圈，这次一起改。
- **Windows（`icon.ico`）与 Linux / Tauri 列出的 PNG（`32x32.png`、`128x128.png`、`128x128@2x.png`、`icon.png` 等）**：照今天的处理（圆角方形画满画布，量一下现图标的圆角比例，照用），只是换成新图。要不要也按苹果网格留边，量一下现状后在 Comments 里给理由，不确定就照今天。
- **Windows 商店那组 `Square*Logo.png`、`StoreLogo.png`**：照今天的处理换新图。
- **`core/icons/ios`、`core/icons/android`**：现在是 05-18 `tauri icon` 生成的旧图（旧的排版盘铅字 G），05-22 换桌面图标时没跟着重生成。这次用新图重生成：iOS 铺满方形、不带圆角（系统自己切），Android 照 Tauri 的生成方式。
- 生成办法你定（`pnpm --dir gui tauri icon` 分两次跑、再挑出 icns，或别的），步骤写进 Comments 和 `core/icons` 子目录里的一份简短说明，让下次换图能照做。SVG 渲染成 PNG 用什么工具也写清。
- **托盘图标**（`tray-template.png`、`tray-windows.png`）不动。
- `tauri.conf.json` 的图标列表不变，除非生成方式要求。

## 三、助手头像

- `gui/src/components/layout/assistant/AssistantAvatar.tsx`：杏色圆盘与 Newsreader 斜体「G」换成新图标，裁成圆。两个尺寸照旧：顶栏 28px、侧栏卡片 40px。资源用 SVG（任何尺寸都锐利）还是导出的 PNG 你定，理由写进 Comments；资源放 `gui/src/assets/`。
- **描边**：1px 内描边（画在圆的内侧，不改变 28 / 40 的外尺寸）。浅色模式黑 12%，深色模式白 10%。做法你定（`box-shadow: inset`、伪元素或 SVG 里画），浅深两套跟着主题走，写进 Comments。
- **角标**（在跑、在问你、出错、未读）位置照旧：头像仍是圆，45° 点的算法不变；角标外圈照旧跟卡片底色。
- 头部注释改成正式说明：头像就是应用图标（裁决 70），为什么加描边；删掉「until it has a real likeness」一类的占位说法。
- 头像不可点、不可拖、不可选中，屏幕阅读器照旧忽略（`aria-hidden`）。

## 四、README 资源

- `docs/assets/galley-icon.png` 换成新图标，用 `scripts/render-readme-assets.py` 重新生成 `readme-banner.png`、`readme-banner-dark.png`、`social-preview.png`。横幅里的图标照今天的尺寸与位置。新旧横幅各截一张放进总览图。
- GitHub 仓库设置里的社交预览要 JC 发版时手动上传，写进 Comments 提醒。

## 五、文档

- `docs/design/layout-and-chrome.md`「助手卡片」「开着助手时是身份行」两处写头像的地方：改成应用图标裁圆加描边，理由引裁决 70。中英两种写法都 grep 一遍，看别的设计文档有没有写头像是「品牌色圆盘」「斜体 G」的地方。
- `core/icons` 子目录里的说明（见第二节）。
- 不写 devlog（主会话写），不改 PRD，不改各票的 Status 行。

## 不做

- 托盘图标；官网（另一个仓库）；GitHub 社交预览的上传（JC 手动）。
- 图标的几何或颜色再调整（母图定稿）。
- Core、库、CLI 的逻辑改动；外置运行时没有助手，只受应用图标影响。

## 验收

- 跑这几项：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`cargo check --manifest-path core/Cargo.toml --workspace`（图标文件会在编译期被读进二进制，要确认新文件能过）；`git diff --check`；全角标点自查（扫新增行）。gui 只格式化自己改的 hunk，新文件可以整篇格式化。
- **图标核对**：`iconutil -c iconset` 拆开 `icon.icns`，各尺寸的留边符合苹果网格（量 1024 那张的不透明区域边界）；`icon.ico` 里的尺寸齐全；各 PNG 尺寸与文件名同今天；与母图渲染逐像素对比（各尺寸缩放后的差别只在抗锯齿）。
- **测试**：头像渲染出图标图片、圆形、带描边；两个尺寸；角标照旧（已有的角标测试不挂）。
- **反向检查**：改坏几处，确认测试会挂；恢复后逐字节一致。例如：头像又画回圆盘与字母、描边没了、尺寸错了。
- **自查截图**（Chrome harness，可以复用会话草稿目录里 `s22/harness/` 的脚本，复制到新目录再改，不进仓库）：
  - 侧栏卡片：静止、在跑、在问你、出错、未读、选中，浅色与深色；
  - 顶栏身份行：静止与在跑，浅色与深色；
  - Dock 尺寸的 icns 预览（64 与 32），旁边放一个按苹果网格画的方块比大小；
  - README 横幅新旧对比；
  - 出总览图。截完把 harness 从工作树删掉。
- **逐像素**：工作台的会话、子任务、外置运行时的主区与侧栏会话行，与开工时的 main 一致；侧栏只有助手卡片的头像变。
- **JC 在 tauri dev 里走一遍**（合入时 Core 会因图标重编重启）：
  1. 看侧栏助手卡片与顶栏的头像，浅色与深色各看一次；
  2. 让助手跑一件事，看头像角上的在跑标记；
  3. 看 Dock 里的图标（dev 构建的 Dock 图标可能不更新，以打包后的为准，发版前用 `bundle` 产物看一次）；
  4. 看 README 横幅（GitHub 上要 push 后才看得到）。

## Comments
