# 23 新应用图标与助手头像

Status: ready-for-human（2026-10-15 合入 main，合并提交 `4fc4ed53`；等 JC 真机看头像与 Dock，发版时手动上传社交预览）

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

2026-10-15 实现（子代理，分支 `galley-icon-23`，基于 `3beee783`，未合入）：

提交：`dba700ef` 母图、两个脚本与生成的图标；`e332b667` 头像代码与测试；`75436b33` README 横幅与社交预览；`01eb93ee` 设计文档与 `core/icons/master/README.md`；本条记录随后单独提交。

**一、母图入库**

- 母图放 `core/icons/master/galley-icon.svg`（子目录名我定 `master`，即「母图」），与主会话给的文件逐字节相同。同目录两个裁切文件：`app-icon-rounded.svg`（Windows、Linux、商店磁贴）与 `app-icon-macos.svg`（macOS），都用 `<image href="galley-icon.svg">` 引用母图，不复制路径，改母图不用改它们。
- 描摹脚本 `scripts/trace-galley-icon.py`：算法、默认参数、输出格式照原脚本，只整理成函数、加用法检查；头部写了用途、`potracer` 的装法（一次性 venv，不进依赖清单）、用法，以及「改几何就让图片模型改位图再重描」。用 potracer 0.0.4 对源位图重跑，输出与母图逐字节相同。
- 生成脚本 `scripts/render-app-icons.py`（新，只要 Python 3 与 pnpm），见下。

**二、应用图标**

- **生成办法（我定：三个 SVG 各跑一次 `tauri icon`，再挑文件）**：先核实了现状的来历：用 tauri-cli 2.11.1 对旧的 `core/app-icon.png` 重跑 `tauri icon`，桌面 PNG、`icon.ico`、商店磁贴与现有文件逐字节相同，`icon.icns` 只差条目顺序（拆开后各成员逐字节相同），iOS / Android 不同（05-18 的旧图）。所以沿用 `tauri icon`，文件名、尺寸、ico 层数自然同今天，`tauri.conf.json` 不用改。`tauri icon` 接受 SVG，用自带的 resvg 按每个目标尺寸直接从矢量渲染（不是从 1024 缩），这就是「SVG 渲染成 PNG 用什么工具」的答案，生成应用图标不用 Chrome。分工：
  - `app-icon-rounded.svg` → `32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.ico`、9 个 `Square*Logo.png`、`StoreLogo.png`；
  - `app-icon-macos.svg` → `icon.icns`；
  - `galley-icon.svg`（母图）→ `ios/`、`android/` 整个替换。
  `tauri icon` 每次写出的 icns 条目顺序不同（重跑就有二进制差异），脚本按条目类型重排写回，连跑两次逐字节相同。
- **macOS 圆角方形（我定的近似法）**：Figma 的 corner smoothing 60%（Figma 滑杆上标作 iOS 的那档，算法同开源的 figma-squircle）：每个角沿边走 1.6 倍半径，两段三次贝塞尔夹一段圆弧，起点与直边相切、曲率从 0 起。尺寸照苹果模板：1024 画布里 824 居中、四周 100，圆角半径 185.4。投影：黑 50%、向下 12、模糊 28（按 CSS 的惯例折成高斯标准差 14），用 `feDropShadow`。网格与投影参数的出处是 Apple 开发者论坛对苹果模板的转述（developer.apple.com/forums/thread/670578），苹果没有公开数值的文档，写进了 `core/icons/master/README.md`。对照：Chrome 的 icns 压在同一条红线上，形状与大小一致（总览图第 4 张）。
- **Windows / Linux 要不要留边（我定：不留，照今天）**：量了现状：旧图标左右贴边、上下各约 3.5px（AI 出的图不是正方），圆角是圆弧，拟合半径 235.8 / 1024（23.0%，残差均方根 0.23px）。新图照这个比例：画满画布，`rx` 235.5（23%）。不留边的理由：苹果网格的留边与投影是 macOS 自己的规范（系统不给 Mac 应用加形状）；Windows 的任务栏、开始菜单、安装包图标惯例是画满方框，留出 10% 会在任务栏里比别的应用小一圈，等于把 Dock 的问题反过来；Linux 各桌面不一（GNOME 有自己的网格，KDE 等画满），不确定就照今天。
- **iOS**：母图铺满方形、不带圆角（iOS 自己切），不透明。**Android**：照 `tauri icon` 的默认：`ic_launcher.png` 由 tauri 加 8.33% 边距与圆角，`ic_launcher_round.png` 裁圆（图形在中心圆内，切不到），`ic_launcher_foreground.png` 是整张母图；两个 xml 与今天相同（背景色 `#fff`，前景不透明，看不到）。
- **托盘图标**两张没动，`tauri.conf.json` 没动。另外发现：Linux 的托盘用的就是 `icons/32x32.png`（`core/src/tray.rs:193`），所以 Linux 托盘会跟着变成新图标；macOS、Windows 的托盘是那两张单独的图，不变。
- **删了 `core/app-icon.png`（票面没写，我定）**：它是 05-22 那张木纹图标的 1024 源图，没有任何地方引用，却放在 `tauri icon` 不带参数时的默认输入路径上；留着的话，有人照习惯跑一次 `tauri icon` 就会把旧图标整套生成回来。删掉后不带参数会直接报找不到文件，生成方法看 README。要留就从 `dba700ef^` 恢复。

**三、助手头像**

- `AssistantAvatar.tsx`：圆盘与斜体「G」换成 `<img>`（`@/assets/galley-icon.svg`），外层 `relative overflow-hidden rounded-full`，尺寸照旧 `size-7` / `size-10`。头部注释改成正式说明（头像就是应用图标、为什么同脸、一张母图两种裁切、为什么用 SVG、为什么加描边），删掉占位说法；角标注释里的「apricot disc」改成「icon's apricot ground」。角标的尺寸、位置、外圈一行没动。
- **资源用 SVG（我定）**：母图原样复制（28KB），任何尺寸、任何显示缩放（Retina 2x、Windows 125% / 150%）都由浏览器从矢量画；PNG 要按 28 / 40 × 1x / 2x / 3x 导一组，非整数缩放下还会发糊。资源与母图逐字节相同，生成脚本负责复制，测试负责检查。
- **描边（我定的做法）**：图片上面叠一个 `absolute inset-0 rounded-full` 的 span，`shadow-[inset_0_0_0_1px_var(--color-avatar-ring)]`。inset 阴影画在圆内侧、压在图上，不改盒子尺寸（`border` 会占尺寸，`ring` / `outline` 画在外面）；不在 SVG 里画，是因为 `<img>` 里的 SVG 读不到界面主题。新 token `--color-avatar-ring`：浅色 `rgba(0, 0, 0, 0.12)`，深色 `rgba(255, 255, 255, 0.1)`，在 `globals.css` 两处定义，跟 `data-theme` 走（Chrome 里量得计算值：浅色 `rgba(0, 0, 0, 0.12) 0px 0px 0px 1px inset`，深色 `rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset`）。L* 我重算了一遍：图标浅底 `#fcdba9` 是 89.0，浅色侧栏 chrome 94.1、悬停 90.3、选中 87.0，差 1–5（裁决里写 3–4），注释与文档用的是这组数。
- **不可点、不可拖、不可选中、读屏忽略**：外层 `aria-hidden`、`select-none` 照旧；`<img alt="" draggable={false}>`，图与描边层都 `pointer-events-none`（按下落到外层，冒泡到卡片 / 身份行按钮，按下即打开不受影响）。
- `SidebarAssistant.tsx` 只改一行注释（「the brand disc and its G」）。

**四、README 资源**

- `docs/assets/galley-icon.png` 换成新的圆角方形 256px（与 `core/icons/128x128@2x.png` 是同一个文件，生成脚本复制），用 `scripts/render-readme-assets.py` 重出两张横幅与社交预览。逐像素对比旧图：差异只在图标框内（横幅 2x 下 152 × 152，社交预览 168 × 168），图标的尺寸与位置不变。
- **提醒 JC**：GitHub 仓库 Settings → Social preview 要发版时手动上传 `docs/assets/social-preview.png`。

**五、文档**

- `layout-and-chrome.md`：「开着助手时是身份行」的 28px 头像、「助手卡片 · 构造」的 40px 头像改成应用图标裁圆加描边；卡片下新增一条「头像」（裁决 70 的理由、母图与两种裁切、SVG、描边与 L* 依据、不可点等）；「头像标记」里「嵌进圆盘的一角」改成「嵌进头像的一角」。
- `foundations.md`：浅色、深色两张 token 表各加 `--color-avatar-ring` 一行。
- `conversation.md`「助手的对话 · 不做」里「头像与形象」后补一句：形象已定为应用图标，对话里照旧不放头像。
- 中英文都 grep 过「品牌色圆盘」「斜体「G」」「圆盘」「disc」「italic」「likeness」「avatar」：设计文档与代码里没有别处写头像是圆盘或字母（`UserQuestionRail.tsx` 的「apricot disc」说的是问题轨的点，无关；devlog 是历史，不改）。
- `core/icons/master/README.md`：三个文件、两种裁切的参数、重新生成的两条命令与分工表、改几何的重描步骤。没写 devlog，没改 PRD 与各票 Status。

**图标核对**

- `iconutil -c iconset` 拆 `icon.icns`：10 个成员（16、16@2x、32、32@2x、128、128@2x、256、256@2x、512、512@2x），另有 tauri 照旧写的 `is32` / `il32` 旧格式条目。不透明区（alpha ≥ 250）边界（横纵相同）：1024 是 100–924，四周正好 100；512 是 50–462；256 是 25–231；128 是 13–115（网格 12.5）；64 是 7–57（网格 6.25）；32 是 4–29；16 是 2–14。投影在 1024 上横向到 62–962、纵向 74–974（向下偏 12）。
- `icon.ico`：16、24、32、48、64、256 六层，与今天相同。
- PNG 清单与今天逐一对上：文件集合相同（桌面 4 个加 `icon.png`、商店 10 个、iOS 18 个、Android 15 个 PNG 与 2 个 xml），每个 PNG 的像素尺寸与色彩模式（RGBA）都相同；两个 xml 逐字节不变；托盘两张不变。
- 与母图渲染逐像素对比：母图用 Chrome 渲染的 1024（主会话给的那张）按各文件的内容框缩放（圆角方形与 iOS 是整张，icns 是 824 / 1024 那块，Android 按 tauri 的边距），只比形状里面（去掉边缘 2px）。58 张光栅（桌面与商店 15、iOS 18、Android 15、icns 10）里差超过 8 级的像素全部落在母图的颜色边缘上（离开边缘的 0 个），即只差抗锯齿；resvg 与 Chrome 渲染同一张母图，在 1024 上也只在边缘有差（4116 个边缘像素，最大 103）。

**验证**

- `pnpm --dir gui typecheck`、`lint` 通过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 全量各一遍，都是 128 个文件、1257 条全过（`3beee783` 是 127 / 1249；新文件 `AssistantAvatar.test.tsx` 8 条）。
- `cargo check --manifest-path core/Cargo.toml --workspace` 通过（`generate_context!` 在编译期读 `icon.icns`、`32x32.png` 等，新文件能过）。
- `git diff --check` 与每个提交前的 `git diff --cached --check` 通过；文档链接检查（`scripts/check-docs-links.mjs`）通过。
- 全角扫描（扫新增行与新文件，CJK 紧邻半角 `,;:!?()` 就报，先用 8 个坏例子、6 个好例子自测）：2 处，都是 markdown 链接的 `)` 紧接中文书名号，不改。
- 测试：
  - `AssistantAvatar.test.tsx`（新）：画的是图标图片（`src` 指向 `galley-icon.svg`、`alt=""`），没有字母「G」、`bg-brand`、`font-serif`；圆形（`rounded-full overflow-hidden`），默认 28，28 与 40 两个尺寸；描边层在图后面（画在上面）、`absolute inset-0 rounded-full`、inset 1px 用 token，外层没有 border / ring / outline；token 浅色黑 12%、深色白 10%（读 `globals.css`）；`aria-hidden`、`select-none`、不可拖、不接指针；资源与母图逐字节相同；角标两个尺寸的大小、位置、外圈照旧，静止时没有角标。
  - `MainHeader.identity.test.tsx`：身份行里是 28 的图标头像（加两条断言）。侧栏卡片已有的 40px、角标各状态测试不动、照过。
- **反向检查**（逐个改坏，跑头像相关的 3 个测试文件共 38 条，再恢复）：画回圆盘与字母挂 4 条；删掉描边层挂 2 条；描边画到外面（去掉 inset）挂 1 条；28 / 40 对调挂 3 条；40 画成 36 挂 2 条；不裁圆（去掉 overflow-hidden）挂 1 条；图片可拖挂 1 条；深色描边改成 20% 挂 1 条；删掉浅色 token 挂 1 条；资源与母图不一致挂 1 条。每次恢复后 sha256 与改前相同，最后再跑 38 条全过。
- **逐像素**（Chrome harness，冻结时间、关动画，本分支对 `3beee783`）：
  - 1x、1480 × 920 共 22 对：外置运行时（静止、在跑、在问你，浅深）0 像素差；工作台会话（静止、在跑、在问你，浅深、英文）与子任务（同上）只差侧栏卡片的头像框（40 × 40），框外 0 像素；助手的对话（演示数据，浅深）只差卡片与顶栏两个头像框。
  - 2x 的 16 对卡片与身份行截图（静止、在跑、在问你、出错、未读、悬停、选中，顶栏静止与在跑，浅深）：同样只在头像框内有差，名字、时间、第二行、角标与卡片底色不变。
- 自查截图的总览图交给主会话（六张：卡片各状态、顶栏身份行、放大看描边、Dock 尺寸的 icns 对照 Chrome 与苹果网格、README 新旧、不变的对照）。harness 截完已从工作树删掉。

**给 JC 走查的补充**

- tauri dev 的 Dock 图标就取 `icon.icns`（tauri-codegen 2.6.1 `context.rs` 的 `app_icon`：macOS 的 dev 构建找配置里的 `.icns`），合入后 Core 重编译、重启 dev 就该是留边的新图；Dock 若还是旧图，多半是系统图标缓存，以 `bundle` 产物为准。
- Linux 托盘会跟着变（见上）。

**没做 / 与票面的出入**

- 删了 `core/app-icon.png`（票面没提，理由见上）。
- Android 前景层照 Tauri 默认是整张母图，没留自适应图标的安全区：安全区是中间 66.7%，图形横向占 15%–85%，四边约 2% 会被遮罩切到。Galley 不发 Android，没为它加第四个输入。
- 头像在图片解码前的一瞬只有描边圈，没加底色兜底：本地资源，截图里没看到闪；真机若见到，退路是外层加母图的底色。
