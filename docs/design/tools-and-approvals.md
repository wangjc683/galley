# Tool Callout

> Galley 设计系统 · 原 DESIGN.md §4.5–§4.7（2026-07-04 拆分）：Tool Event Callout 状态映射、`file_patch` diff 视图、审批与 Inspector 的退役记录。

### 4.5 Tool Event Callout

#### 双层形态：settled pill / attention block（2026-06 分层，2026-07-05 回写）

工具事件按注意力需求分两种形态，**不按工具名分**（曾按 file_patch 等
"审计价值" 保留 block，结果 settled turn 里 pill 与 block 混排、视觉
跳动，已否）：

- **inline pill**（`InlineToolPill`）：所有已结算成功的工具。单行、
  **一个左簇**：Phosphor 图标（13px）+ 中文友好名（主标签）+ 单行 arg
  预览（路径类从头部截断、保留文件名尾部）+ caret 紧跟其后。点击展开
  完整 args / result，**展开体首行是 mono GA 工具名**。字号走
  `--conversation-tool-label-size` / `-tool-mono-size`，随三档字号缩放。
  - **比 step summary 低一级**（2026-09-16）：summary 是一步的叙述
    （step-size 档、ink-soft），pill 是叙述下的证据——标签降到与 mono
    同档（标准档 11px）、整行 ink-muted，hover 升 ink。此前两行同字号
    同墨量而 pill 元素更多，八步 live run 里证据压过叙述。
  - **mono 工具名进展开体、caret 贴标签**（同日，两步走）：原「左散文区 /
    右审计区」布局里 mono 名常驻右缘，多步 run 中是重复度最高的元素、
    形成第二列抢眼；先改 hover 显示（JC 裁），结果 caret 孤零零停在列
    右缘、与它披露的标签隔着整列，且 hover 才出现的元素对触控板 / 键盘
    不可靠。终裁：审计元数据放在审计发生的地方（展开体首行），静止行
    没有任何时隐时现的元素；**披露 caret 贴着它所属的文字**，与
    RunFoldHeader、TurnMarker 同一条规则。
  - **浏览器步骤的预览是网站**（2026-10-04）：GA 的 `web_scan` /
    `web_execute_js` 没有任何参数指向网页（`web_scan` 只有 `tabs_only` /
    `switch_tab_id` / `text_only`，此前读 `query` / `url` 的分支从没命中），
    网站在**结果**里，由 `gui/src/lib/browser-site.ts` 读出：
    - `web_scan`：`页面标题 · 主机名`，如「读取网页 · 豆瓣电影 Top 250 ·
      movie.douban.com」。扫描当场读的就是这一页，标题新鲜。
    - `web_execute_js`：**只给主机名**。结果只带 `tab_id`，按同一会话里
      最近一次标签页列表对回网站；标题来自上一次扫描，页内跳转就过期
      （JC 的数据里下一次扫描换了标题的占 38%，换了主机名的 17%，多数是
      执行跳转的那一步本身——它确实跑在旧页上）。扩展的开标签页命令
      （`{"cmd": "tabs", "method": "create"}`）显示新开的那个站。
    - 只列标签页、没读页面的步骤（`tabs_only` 扫描、扩展的标签页列表命令）
      显示「N 个标签页」。
    - 对不上就**什么都不加**，不猜：之前没见过标签页列表、标签页已不在最新
      列表里、扫描的当前标签页已失效、结果被截断、`cdp` / `batch` 这类自带
      目标标签页的扩展命令。
    - 主机名去掉端口和开头的 `www.`；标题只是地址（无 `<title>` 的页面）
      时不重复显示。行宽不够时**标题先吃省略号，主机名保留**——「哪个网站」
      是主机名回答的，标题只是更好读的页名。两段都留在预览的 ink-muted，
      hover 时只有标签提墨，与其他工具预览一致。
    - 只进 inline pill：block 态里浏览器工具只有两种，GA 错误信封（无标签页
      信息）和旧转录里的 denied（无结果）。
- **block callout**（`BlockToolCallout`）：一切需要注意力的状态
  （failed / running，以及旧转录里的 denied）。左 3px 状态竖条 +
  1px 边框 + 8px 圆角（`rounded-callout`）；failed 额外带
  4% 状态色 tint（早期"不用 background tint"的规则在 dogfood 后放宽：
  暖米白底上仅靠竖条不足以传达"停下来看这里"）。head：状态位 +
  mono 工具名 + status pill + elapsed（`tabular-nums`）+ `CaretDown`。

#### 6 状态映射与数据流现实（2026-07-05；2026-08-11 增 failed-historical；2026-10-05 删 waiting_approval）

| 状态 | 形态 | 视觉 | 默认展开 |
|---|---|---|---|
| running | block | brand 竖条 + `CircleNotch` 旋转 + `LiveDots` + elapsed | 展开 |
| success-current | block | brand 竖条 + `CheckCircle` | 展开 |
| **success-historical** | **pill** | 安静单行，融入文档 | 折叠 |
| failed | block | 红竖条 + 4% tint + `X` | **强制展开** |
| failed-historical | block | 淡红竖条 + `X`（红），headline 领行 | 折叠（审计一击可达） |
| denied（仅旧转录） | block | muted 竖条 + `Prohibit` | 折叠（决定已知） |

**数据流现实**：`turn_end` / 历史恢复产出 `success-historical`、
`failed-historical` 与 `denied` 三种结算态。denied 只来自审批时代的
旧转录：GUI 解析 Galley 当年的拒绝载荷（`{"status": "denied"}`，解析方
`gui/src/lib/tool-outcome.ts`）；审批 2026-10-05 移除后不再产生，解析
留着只为渲染历史数据。failed-historical（2026-08-11，galley#22）识别 GA 工具的
错误信封 `{"status": "error", ...}` —— 与 denied 同级的精确匹配
coupling point，不是内容嗅探；headline（traceback 末行 / msg 首行）
走 callout 的 summary 槽位，解码后的错误体取代原始 JSON 预览。
**live `failed` 仍无生产者**；running / success-current 需要 bridge
增加工具级事件，留待 Phase 2 协议扩展（见 2026-07-05 devlog）。

#### 展开内容

- **args**：mono 等宽 key/value（无语法高亮——V0.1 范围），max 200px 滚动
- **result preview**：mono 等宽，max 200px 滚动；上游 500 字符截断，截断处
  显示 `…`（完整结果出口待 Phase 2 数据层支持）
- **file_patch 结算态**：`PatchView` split diff（见下节，480px 滚动窗）
  ——不再把 old/new content 当 JSON args 倾倒
- **denied**：不回显内部拒绝载荷（状态 chrome 已说明"已拒绝"）

#### `file_patch` diff 视图（`PatchView`）

原为审批卡的 `file_patch` 渲染器，审批退役后只服务结算态展开。

- 自研 PatchView（`diff` npm 包计算 line-level changes + Tailwind 渲染 split layout），无语法高亮
- 数据来源：`args.path` / `args.old_content` / `args.new_content`（GA `file_patch(path, old_content, new_content)` 签名）
- 视觉：
  - Header：path（mono）+ 文件 size delta（`+12 行 / −3 行`，走 copy 层
    本地化，12px muted）
  - Split layout（左旧右新）/ 行号显示
  - +/- 行用 success/error `--opacity-soft`（12%）tint 背景；空
    placeholder 行用 hover-tint 斜纹
  - max-height 480px，超出 scroll
  - 无独立折叠态（"header + View diff" 方案未实现；折叠语义由外层
    callout 承担）
- 为什么不用 `@pierre/diffs`：试过，其 Shiki backend 拉所有语言包进 bundle（+400 KB gzip）。line-level +/- 已足够。`@pierre/diffs` 留候选 —— 真需要 hover/highlight + scoped 语言时再切换

### 4.6 审批（已退役）

逐步审批已在 2026-10-05 整体移除：Approval Dock、`waiting_approval`
形态的 Approval Card（风险 pill、允许一次 / 拒绝 / 始终允许）、
`code_run` / `file_write` / `start_long_term_update` 的审批渲染器、
always-allow 白名单与审批模式切换一并删除。与上游 GenericAgent 一致，
工具调用一律直接执行。

退役原因：零使用（本机会话全部跟随默认、全局自动执行，从未出现拒绝）；
保护面窄（只拦四个工具，从不拦 `web_execute_js`），设置页的规则从未
生效；也违背「Less harness. More model.」。决策记录见
[2026-10-05 devlog](../devlog/2026-10-05-remove-approval.md)，原规格
见 git 历史。旧转录里的 denied 工具结果仍按 §4.5 渲染。

### 4.7 Inspector（已退役）

右侧 Inspector panel 已在 2026-05-12 退役，不再是当前布局基准。

退役原因不是"暂时没做"，而是信息归宿更清楚了：

| 旧 Inspector 信息 | 当前归宿 |
|---|---|
| Tool raw / args / stdout / result | 对应 Tool callout 内 inline 展开 |
| Pending approvals、Approval 历史与 always-allow 规则 | 无：审批已退役（§4.6） |
| Runtime / GA path / Python / LLM displayName | Sidebar runtime dot + Settings → Runtime |
| Message copy / save | Message Actions |

产品判断：右侧常驻面板让 Galley 读起来像 IDE，而不是本地 agent team orchestrator。把信息放回触发它的上下文，用户少一次"去右边找详情"的认知跳转，也释放了 conversation column 的阅读空间。

如果未来需要 Memory Inspector / file inspector，必须重新设计入口与信息架构，不复用旧右栏槽位。
