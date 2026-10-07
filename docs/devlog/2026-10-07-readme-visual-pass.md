# README 版式打磨：banner、单列亮点、去掉表格当卡片、手机可读

**日期**：2026-10-07
**范围**：`README.md` / `README.zh-CN.md` 版式、`docs/assets/` 三张新图、`scripts/render-readme-assets.py`、
`.gitattributes`、仓库 topics 与主页链接；截图与图注不动

## 背景

同日文字刷新（[devlog](./2026-10-07-readme-refresh.md)）之后，JC 提出：开源项目的 README 某种程度上就是项目主页，
排版和视觉还有没有打磨空间。Galley 没有官网（仓库主页链接指向仓库自己），README 承担主页职能。

## 诊断（无头浏览器截 github.com 实际渲染：桌面 1280 浅 / 深、手机 390）

- **首屏像文档**：logo 加一级标题，GitHub 给一级标题加下划线；4 个徽章黄 / 橙 / 蓝 / 灰与品牌无关；hero 截图在
  约 744px 宽下 UI 文字只有四五个像素。
- **双横线**：9 个 `---` 紧挨二级标题自带的下划线。
- **表格当卡片**：`| | |` 空表头在表顶渲染成空白条；斑马纹让卡片一灰一白；单元格垂直居中，左右标题错位；
  12 张卡每张 4–6 行，约一屏半纯文字。
- **手机最糟**：两列表格每行三四个词，亮点区约 2500px；Quick Start 在约 6200px 处；导览图每张约 150px 宽。
- **截图区**：370px 宽、6 张轮廓相同；深色模式下是 6 块浅色图块。
- **仓库门面**：没有 topics；主页链接指向自己；没设分享预览图（分享出去是 GitHub 自动卡片）；语言条
  Python 37% 来自 `managed-ga/code` 的 33MB 上游代码。

参考了 LobeHub、Cherry Studio、Jan、goose、Zed、GenericAgent 上游的 README 首屏：有官网的（Zed、goose）极简，
没官网的靠 banner、演示动图和大截图承担主页职能。Galley 属于后者，但气质用自己的（Newsreader 斜体字标、纸色与杏色）。

GitHub 的能力边界：不能写 CSS，只有图片（`<picture>` 按深浅色切换）、`<details>`、少量 HTML 属性
（`valign` / `width` 保留）、Mermaid、`> [!NOTE]`、上传后能内联播放的 mp4。

## 决策（JC 在本地预览页看过后「都按推荐推进」）

分三层，做第一层加第二层的大部分，第三层随截图重拍暂缓：

1. **第一层：纯版式**。去掉 9 个 `---`；亮点区两组表格改单列清单（加粗标题加一句话）；删「For Humans /
   For Agents / Ready」三列表（与 hero、亮点重复）；Quick Start 三列步骤表改编号列表；导览网格换成无表头的
   HTML 表格，图片与图注原样（斑马纹是 GitHub 样式，去不掉）；架构图字符画换 Mermaid。
2. **Banner 选 A（竖排）**：图标、Newsreader 斜体 500 字标、杏色短线、标语。否决 B（图标与字标横排在
   纸色卡片里）：深色模式下暖黑卡片压在 GitHub 冷黑页面上看得出接缝。Banner 不放 UI，不随界面改版过时。
3. **徽章**收成 release / platform / license 三个，墨色标签加杏色值（`flat-square`）。删 stars：与页面右上角
   GitHub 自带的 Star 数重复。否决灰标签加浅杏值：深色页面上浅杏值块太亮。
4. **Mermaid 默认展开**：页面下半截全是文字，这张图是唯一的视觉。保留 GitHub 默认主题（浅色淡紫）：指定主题
   会丢掉自动切换深浅色。
5. **生成脚本进仓库**：`scripts/render-readme-assets.py` 重出 banner 两张和分享预览图，与预览时的版本逐像素一致；
   只在标语、图标或品牌色变化时需要重跑。
6. **仓库元数据**：`.gitattributes` 把 `managed-ga/code` 与 `state-seed` 标成 vendored，语言条预计变成
   TypeScript 约 51%、Rust 约 32%、Python 约 14%；topics 加 `ai-assistant` `ai-agent` `llm` `desktop-app` `tauri`
   `rust` `local-first` `agent-orchestration` `computer-use`，不加 `genericagent`（About 栏的 GA 预算，见
   [copy-language-guidelines](../copy-language-guidelines.md)）；主页链接清空。分享预览图 GitHub 没有 API，
   由 JC 在仓库 Settings 里上传 `docs/assets/social-preview.png`。
7. **第三层暂缓**：导览从小图网格改大图或局部特写、深色版截图、20–40 秒真实任务演示视频，都依赖重拍，并入
   [deferred「README 截图第三版」](./deferred.md)。

## 效果（预览实测）

- 手机整页 9323px → 8070px，亮点区成为正常阅读的清单。
- 桌面整页 6847px → 6898px：亮点区省下的高度被展开的架构图（约 650px）占回去。

## 本地预览的做法与坑

JC 要求视觉改动先本地看。做法：`gh api -X POST markdown` 渲染 README，套 `github-markdown-css`，
无头 Chrome 截桌面 920 宽浅 / 深与手机 390 宽，变体并排成一页对比。踩到的坑：

- 渲染模式要用 `markdown`（仓库文件的规则），`gfm` 是评论区规则，会把单个换行渲染成硬换行。
- 接口把 `<picture>` 里的 `<img>` 包进 `<a>`，浏览器因此不认深色 `<source>`；github.com 实际页面不会这样，
  预览时要拆掉这层 `<a>`。
- 接口会剥掉 `file://` 图片地址，变体图要放在预览根目录下用相对路径引用。
- 接口不渲染 Mermaid，只给代码块；预览页用本地 mermaid.js 补渲染，github.com 上的实际样子推送后再核对。
  推送后确实翻了一次：github.com 的 Mermaid 渲染器把节点文字按约 120px 宽强行折行（「Galley Core · Rust」
  「Galley-managed GA」被拆碎），本地 mermaid 11 不会。修法是每行压到约 15 个字符以内、用 `<br/>` 手动分行。

## 同日追加：banner 改为不透明卡片

JC 指出透明底 banner 在不支持深浅切换的深色页面上，字标可能几乎看不见。模拟后确认两个方向都会失败：
深色页面退回默认的浅色图时，深色字标叠在深色背景上；浅色页面却选中深色图时（渲染器跟随系统外观、页面本身
是浅色），浅色字标叠在白底上。github.com 的 `<picture>` 按账号主题还是系统外观切换，官方文档与更新日志都没写，
下发的 HTML 也只是原样的 `prefers-color-scheme`，所以修法不押在判断正确上：

- 两张图各自带不透明圆角卡片，底色取 GitHub 默认主题的页面色（浅 `#ffffff`、深 `#0d1117`）。GitHub 默认
  浅 / 深主题下与透明版看不出差别；任何判断错或不支持切换的地方，显示的都是自带背景、字标可读的卡片。
- 代价：GitHub「dark dimmed」等非默认深色主题下能看到一张略深的卡片边缘。
- 否决「单张透明图、字标改中间调杏色」：两种背景都可读，但字标不再是应用里的墨色。

## 未验证

- GitHub 手机 App 内的渲染。
- 语言条要等 GitHub 重新统计后才更新。
