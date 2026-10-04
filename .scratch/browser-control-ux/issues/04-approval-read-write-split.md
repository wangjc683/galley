# 04 调研：逐步审批下 `web_execute_js` 按读／写区分（`no_monitor`）是否可行

Status: resolved
Type: research

## 问题

「逐步审批」的默认审批工具是 `code_run` / `file_write` / `file_patch` /
`start_long_term_update`（`runner/handlers.py:55-63`，GUI 镜像在
`gui/src/stores/defaults.ts:56-65`）。`web_execute_js` 能在用户的登录态浏览器里
点按钮、提交表单，却不在其中；而模式说明写的是「高风险操作先问你」
（`composer.approvalMode.approvalDescription`，`zh.ts@HEAD:432`）。整个工具进
列表会很吵。设想：只拦没设 `no_monitor` 的调用（GA 的工具说明要求「仅在纯读取
信息时设置，页面操作时不要设置」，`managed-ga/code/assets/tools_schema_cn.json:51`）。
这条路是否可行，产品该怎么做。

## 结论

1. **`no_monitor` 方案（下文 C）不推荐。** 这个开关回答的是「要不要回传 DOM
   变化」，不是「这一步危险不危险」：
   - 它会拦下 366／622 次调用（59%），其中 274 次是导航（打开页面、搜索），
     58 次是纯读取，真正的交互／写操作只有 31 次（8.5%）。
   - 它放过 34 次交互／写里的 3 次（读里夹点击的脚本照样设了开关）。
   - 用不用这个开关取决于模型：`deepseek-flash` 0%，`glm-5.2` 4%，
     `claude-opus-4-8` 79%。同一类任务换个模型，噪音能差一个数量级。
   - 开关是模型自报的，网页里的提示注入可以让模型把它设上；审批卡上的
     「加入白名单」又是按整个工具放行，一点就把读／写区分作废。
2. **推荐：现在做 A（诚实文案），同时单开一张 bug 票修「审批设置页是摆设」
   （§2.3）；D 暂缓，满足启动信号（§5）再做。** D 指 Galley 自己按脚本内容判定，
   配专用审批卡（网站／动作／代码），按站点放行。在同一份数据上 D 只问 34 次，
   56 个会话里 45 个一次都不问，单会话最多 8 次。如果 JC 想现在就动手，做 D，
   不做 C。
3. **附带发现（比本题更急）：** 设置 → 审批里「需要审批的工具」的勾选不生效，
   「项目／全局白名单」列表显示的是占位数据，审批卡上「加入白名单」只在当前
   会话的 bridge 进程内存里生效，项目与全局在 runner 里没有区别，bridge 一重启
   就丢。证据见 §2.3。

**待 JC 裁决：**

- ① A 的文案落在哪两处、怎么说（§4 A 给了草案）。
- ② 「审批设置是摆设」是否单开票、何时修。
- ③ D 进 `deferred.md` 的启动信号是否认可（§5）。

## 1. 数据

### 1.1 口径

- 数据源：`sqlite3 -readonly ~/Library/Application Support/app.galley/workbench.db`。
  `messages.tool_calls` 是 `{toolName, args}` 数组，`messages.tool_results`
  按下标一一对应（622 次调用全部对得上）。时间跨度 2026-05-15 到 2026-09-28。
- `web_execute_js` 共 622 次，56 个会话：内置 49 个会话 591 次，外置 7 个会话
  31 次。
- 这 56 个会话的 `sessions.approval_mode` 全部为空，即跟随默认；`prefs.yolo_mode`
  为 `true`，默认是自动执行。全库 0 次出现 `User denied this tool call`。也就是说，
  本机数据里没有一次真实审批，下文的「拦／放」都是假设规则后的回放。
- 模型归属用的是会话当前的 `llm_display_name`（消息行没有逐条模型字段），
  会话中途换过模型的会被算到最后那个模型名下，按模型的数字只作量级参考。

### 1.2 `no_monitor` 分布与空 `script`

| `no_monitor` | 次数 | 占比 |
|---|---|---|
| 未传 | 356 | 57.2% |
| `true`（含 5 次字符串 `"true"`，GA 的 `_arg` 视为真，`ga.py:219-227`） | 256 | 41.2% |
| `false` | 10 | 1.6% |

`script` 为空共 7 次（1.1%）。GA 这时会去回复正文里取最后一个 ```` ```javascript ````
代码块（`ga.py:376`、`ga.py:320-323`）。这段正文在 Galley 库里就是
`messages.content`：GUI 在 `turn_end` 时把 GA 原始 `responseContent` 原样写进去
（`gui/src/lib/ipc-handlers.ts:875`）。这 7 次的正文里都没有代码块，结果全是
`[Error] Script missing`，所以代码块路径在本机数据里成功 0 次。审批时 handler
手里有同一个 `response`，要取代码可以直接调 GA 自己的 `_extract_code_block`。

另有两个隐藏通道要记下：`script` 也可以是文件路径，GA 会读文件内容来执行
（`ga.py:378-380`，本机数据 0 次）；`script` 如果整段能解析成带 `cmd` 的 JSON，
就是扩展命令而不是 JS，包括 `cookies`、任意 `cdp` 命令、`batch`、`tabs`
开／切标签页、`management` 启停扩展、`contentSettings` 改站点权限
（`assets/tmwd_cdp_bridge/background.js:31-90`、`418-436`），记忆 SOP 会教模型
这么用（`state-seed/memory/tmwebdriver_sop.md:44-62`）。本机出现过的扩展命令有：
`tabs create` 125 次、`tabs` 列表 4 次、`tabs update` 2 次、`cdp
Input.dispatchMouseEvent` 2 次、`batch` 1 次、`cdp Runtime.evaluate` 1 次、
`management list` 1 次。

### 1.3 读／写分类规则（透明启发式）

正则作用在 `script` 原文上，命中即归类，优先级从上到下：

| 类别 | 规则（摘要） |
|---|---|
| 交互／写 | `.click(`、`dispatchEvent(`、`new …Event(`、`.submit(`、`requestSubmit(`、`.value =` / `.checked =` / `.selected =` / `selectedIndex =`、原生 setter `.set.call(`、`execCommand(`、CDP `Input.*`；`fetch`/XHR 的 `POST\|PUT\|DELETE\|PATCH`、`sendBeacon(`；`localStorage`/`sessionStorage` 写、`document.cookie =`、`clipboard.write`；`management` 的 `enable\|disable\|reload`、`contentSettings` |
| 导航 | `location.href =`、`window.location =`、`location.assign/replace/reload(`、`window.open(`、`history.*(`、扩展 `tabs` 的 `create\|switch\|update`、`chrome.tabs.create/update(`、CDP `Page.navigate/reload` |
| 本地 DOM 改动 | `innerHTML =` 等赋值、`appendChild(` 等、`setAttribute(`、`.remove()`、`.style.x =` |
| 只读 | 以上都不命中（滚动、`focus()` 也算在这里） |

「交互／写」才是审批真正要拦的；「导航」在 GA 的定义里属于「页面操作」，会让
页面变化，但大多是打开一个公开地址。

### 1.4 混淆矩阵（规则 C：未设 `no_monitor` 就拦）

| 启发式类别 | 拦（未传／`false`） | 放（`true`） | 合计 |
|---|---|---|---|
| 交互／写 | 31 | **3**（漏拦） | 34 |
| 导航 | 274 | 20 | 294 |
| 本地 DOM 改动 | 1 | 0 | 1 |
| 只读 | **58**（误拦） | 228 | 286 |
| 空 `script` | 2 | 5 | 7 |
| 合计 | 366 | 256 | 622 |

- **漏拦**：交互／写 34 次里漏 3 次（8.8%）；如果把导航也算「页面操作」，
  329 次里漏 23 次（7.0%）。
- **误拦**：只读 286 次里拦 58 次（20%）。从审批价值看，被拦的 366 次里有 335 次
  （91.5%）不是交互／写。
- **高风险子集**（人工逐条判定 34 次交互／写，挑出会改远端状态、或处在高风险
  上下文的）：8 次，分布在 5 个会话。具体是：聊天站填词并提交 3 次（2 个会话）、
  自托管面板 POST 接口 1 次、邮箱设置勾选并保存 2 次、内容平台后台按序号点操作
  图标与 CDP 坐标点击 2 次。这 8 次都没传 `no_monitor`，C 和 D 都会拦下。漏拦的
  3 次都是低风险操作（合成悬停事件、切换温度单位）。

### 1.5 每会话审批次数（56 个用过 `web_execute_js` 的会话）

| 方案 | 总次数 | 中位数 | P90 | 最多 | 零审批会话 |
|---|---|---|---|---|---|
| B 整个工具都问 | 622 | 6 | 25 | 92 | 0 |
| C `no_monitor` 切分 | 366 | 3.5 | 18 | 51 | 3 |
| C′ C 再豁免纯导航 | 92 | — | — | — | — |
| D 只问交互／写 | 34 | 0 | 2 | 8 | 45 |
| D + 每站首次放行后不再问 | ≤13 | 0 | 1 | 2 | 45 |

C′ 虽然只剩 92 次，但其中 58 次是只读，只读误拦这一块原样留着。

### 1.6 模型依赖（会话当前模型，量级参考）

| 模型 | 次数 | 设 `no_monitor` 比例 | 只读里设了的 |
|---|---|---|---|
| grok-4.7 | 258 | 46% | 112／125 |
| gpt-6-astra（含 NativeOAI） | 102 | 45% | 37／53 |
| glm-5.3-flash（含 NativeClaude） | 81 | 47% | 28／35 |
| glm-5.3 | 35 | 40% | 14／21 |
| glm-5.1（含 NativeClaudeSession） | 34 | 9% | 2／3 |
| glm-5.2 | 24 | 4% | 0／1 |
| gpt-5.5 | 19 | 63% | 12／12 |
| deepseek-flash | 18 | **0%** | **0／12** |
| gpt-5.6-sol | 15 | 47% | 6／6 |
| claude-opus-4-6-thinking | 14 | 29% | 4／5 |
| claude-opus-4-8 | 14 | 79% | 11／11 |

在 `deepseek-flash` 下，C 会把每一次读取都拦下来。

### 1.7 错例（已去掉网址、个人数据和令牌）

**漏拦（C 放行，实际有交互）：**

1. 搜索结果页的天气卡片。同一段脚本先点「°C」切换按钮，再读数据，设了
   `no_monitor: true`：

   ```js
   const unitBtn = document.querySelector('<温度单位按钮>'); if (unitBtn) unitBtn.click();
   const days = [...document.querySelectorAll('<逐日预报>')].map(d => ({ … }));
   return { now, days };
   ```

2. 某内容平台的登录后台。脚本对草稿卡片派发 `mouseenter` / `mouseover` 合成
   事件，让隐藏的操作图标显形并取坐标，设了 `no_monitor: true`。这组图标里有
   「删除」。下一步就是 CDP 坐标点击（那一步没设开关，C 会拦）。

**误拦（C 拦下，实际只读）：**

1. `deepseek-flash` 读正文：
   `const t = document.body.innerText…; return { seg: t.slice(i, i + 2500) };`
   这个模型从不设开关。
2. `grok-4.7`：`location.href + "\n" + document.title + "\n\n" + document.body.innerText.slice(0, 6000)`，
   只读了 `location.href`，没有赋值。
3. 列标签页：`{"cmd":"tabs","method":"list"}`。
4. 导航（C 会拦 274 次）：`{"cmd":"tabs","method":"create","url":"<搜索地址>","active":true}`、
   `location.href = '<某文档站地址>'`。

**真阳性（C、D 都会拦，也确实该问）：**

1. 邮箱设置：依次点「设置」→「查看全部设置」→ 某个单选项 →「保存」，最后两步
   是真写入。
2. 自托管面板：`fetch('/api/v1/connections/<id>/test', { method: 'POST', … })`，
   带着用户的登录 Cookie 发写请求，结果里是 `"DOM变化量: 0"`。DOM 监控看不见
   网络写操作。
3. 内容平台后台：按序号 `links[1].click()` 点操作图标（同组里有「删除」），随后
   发 `batch` CDP `mousePressed/mouseReleased` 坐标点击。从审批卡上只能看到
   `x: 793.5, y: 191.4`，人看不出点的是哪个按钮。

### 1.8 启发式自身的局限

- D 的规则就是分类规则本身，所以在本机数据上 D 的召回率按构造是 100%，不能
  当成它真实表现的证据。做过的独立核验：①用更宽的词表（click、submit、
  dispatch、value、POST、Input.、cookie、storage 等）把 286 次只读扫了一遍，命中
  25 次，逐条看过，全是读取（例如 `outerHTML` 读、`textarea.value` 读）；②没设
  开关的只读 58 次里，结果显示「页面无变化」44 次，DOM 有变化 8 次（动态页面、
  滚动），执行失败 8 次；③34 次交互／写已逐条人工看过。
- 正则拦不住有意混淆的代码，比如 `el['cl' + 'ick']()`、`eval(atob(…))`。D 可以
  把 `eval(`、`new Function(`、`atob(` 这类不透明写法也列为「要问」，本机数据
  命中 0 次，不增加噪音。即便如此，D 也只是减速带，不是安全边界；C 更不是，
  因为开关本身就是模型自报的。
- D 不拦导航。经由网址参数外带数据（提示注入的典型做法）和有副作用的 GET，
  D 都管不到；C 名义上会拦导航，但每会话中位 3 次以上的导航审批会把用户推向
  「加入白名单」，实际效果一样。

## 2. 机制

### 2.1 审批在哪里决定

审批只在 runner 里决定，Core 和 GUI 不参与判定：

1. GA 循环调用 `WorkbenchHandler.dispatch(tool_name, args, response, …)`
   （`runner/handlers.py:216`）。
2. `needs_approval(tool_name)` 只看工具名，依次检查 YOLO → 是否在审批列表 →
   全局白名单 → 项目白名单（`handlers.py:195-214`）。
3. 需要审批时 `_request_approval` 发出 `tool_call_pending`，带完整 `args`、
   `argsPreview`、`riskLevel`（未登记的工具一律 `"medium"`），然后阻塞等待，最长
   600 秒，超时按拒绝处理（`runner/workbench_bridge.py:1766-1792`、`708`）。
4. Core 把事件按强类型 `ToolCallPendingEvent` 解析后转发给 GUI
   （`core/src/ipc.rs:153-166`、`core/src/runner_manager/process.rs:261`）。
5. GUI 在工具卡里渲染 `ApprovalForm`，用户点击后发 `approval_response`
   （`gui/src/hooks/useMessageSend.ts:157-196`）。
6. runner 收到 `resolve_pending`，回到 `dispatch` 执行决定（`handlers.py:236-258`）。

### 2.2 能不能看到参数

能。`dispatch` 拿得到 `args`，也拿得到 `response`（回复正文，空 `script` 时的
代码就在这里）。把签名扩成 `needs_approval(tool_name, args, response)` 只需几行，
测试在 `runner/tests/test_handlers.py`。所以 C 和 D 在技术上都能实现，区别在于
判定依据：C 信模型自报的开关，D 看脚本内容。

要给审批卡加字段（网站、动作类型）时注意：Core 是强类型解析，新字段要三处同步，
即 `runner/ipc.py:88-100`、`core/src/ipc.rs:153-166`、`gui/src/types/ipc.ts`，
外加 `docs/ipc-protocol.md`。这是 Core ↔ runner 线协议上的纯增量，不碰 Agent
API：CLI 只暴露 `waiting_approval` 状态，没有审批命令。

### 2.3 白名单与设置页：现状是摆设（附带发现）

- runner 永远用硬编码的 `DEFAULT_APPROVAL_TOOLS`：`_ConfiguredWorkbenchHandler`
  不传 `approval_tools`（`workbench_bridge.py:1232-1256`）；启动参数里没有相关项
  （`workbench_bridge.py:2456-2464`）；也没有下发「需要审批的工具」的 IPC 命令，
  `SetApprovalRulesCommand` 只带两份白名单（`runner/ipc.py:418-420`）。
- GUI 的 `approvalConfig` 只存在内存里（`gui/src/stores/prefs.ts:41`），setter 只改
  store（`prefs.ts:317-340`）。全仓除了类型定义（`gui/src/types/ipc.ts:441`），
  没有任何地方发 `set_approval_rules`。
- 后果：
  - 设置 → 审批 →「需要审批的工具」的勾选
    （`SettingsApproval.tsx:63-67`、`215-220`）不影响实际拦截。
  - 「项目白名单」显示的 `file_read`、`web_scan` 是 `defaults.ts:63` 的占位，这两个
    工具本来就不审批。
  - 审批卡上「加入白名单」写进的是 runner 本会话进程里的集合
    （`handlers.py:247-250`）。每个 bridge 进程各有一个 `SessionState`
    （`workbench_bridge.py:625-636`、`747`），「项目」与「全局」在 runner 里行为
    相同，bridge 重启即丢，设置页也看不到。
  - `approval_rules` 表建了（`core/migrations/001_init.sql:110-120`），0 行，没有
    代码读写。`docs/ipc-protocol.md:592` 与 §5.6 描述的同步机制没有实现。
- 对本题的含义：在设置页给 `web_execute_js` 加一个勾选框不会生效；走 B 得改 runner
  常量、`defaults.ts`、`SettingsApproval.tsx` 三处；不管 B、C 还是 D，「加入白名单」
  都只能按整个工具放行，除非改成按站点放行。

### 2.4 外置模式（Rule 1）约束

- 「子类化 `GenericAgentHandler` 做审批拦截」是 Rule 1 明列的允许接入点。handler
  子类在两种模式下都会装上（`workbench_bridge.py:814`），按参数判定仍在同一个
  `dispatch` 里，不越界。
- 空 `script` 时调 `self._extract_code_block(response, "javascript")`：这是只读调用
  GA 自己的方法，要作为耦合点写进文档。
- 实时查网站（D 需要）有两条只读路径：
  - 向 `127.0.0.1:18766/link` 发 `{"cmd":"get_all_sessions"}`（`TMWebDriver.py:93-97`）。
    这是 GA 自己的本机 HTTP，runner 只当客户端，不违反 Rule 2。
  - 读 `ga.driver.default_session_id`，拿到没写 `switch_tab_id` 时的隐含目标。
  - 两条路径都只读；不能调 `first_init_driver()`（`ga.py:194`），那样会在 GA 进程里
    起驱动。
- 内置与外置行为一致。内置模式下 master 是常驻浏览器桥（`450dbeb1`）；外置模式下
  master 是先起的那个 GA 会话，两者的 `/link` 接口相同。外置 GA 若是不支持
  `no_monitor` 的旧版本，C 会全拦；D 只看脚本文本，不受版本影响。

## 3. 审批卡 UX

### 3.1 今天如果拦下 `web_execute_js`，卡上显示什么

- 风险 pill「中风险」：`RISK_LEVELS` 里没有这个工具，取默认值
  （`workbench_bridge.py:1780`）。
- 动作句「将执行 web_execute_js」（`ApprovalForm.tsx:174` 的默认分支；
  `zh.ts@HEAD:1643`），说明「此工具需确认后才能执行」（`zh.ts@HEAD:1633`）。
- 参数走 `GenericArgsRenderer`（`approval-renderers.tsx:30`、`161-176`），每个键
  `JSON.stringify` 一遍：
  - 脚本变成一行带 `\n` 转义的 JSON 字符串。本机 46% 的脚本是多行的，长度中位
    144 字符，P90 523，最长 2428。
  - `switch_tab_id: "1267180894"` 是裸标签页 ID，人看不懂。
  - 不显示网站。
  - 代码在正文代码块里时，卡上什么代码都没有。
- 按钮：允许／拒绝／加入「项目」白名单／加入全局白名单。点白名单就是整个
  `web_execute_js` 在本会话免审。

### 3.2 应该显示什么（按决策速度排序）

1. **网站**：目标标签页的主机名，由 runner 在发 `tool_call_pending` 时实时查到。
   查不到时明说「网站未知」，不要留空：pill 的规则是「对不上就不加」，但审批面上
   缺信息本身就是信息。目标标签页已关闭时提示「会改在其他标签页执行」：master 会
   回退到最新的活动标签页（`TMWebDriver.py:207-218`），JS 不一定在声明的那一页上跑。
2. **动作类型**：从分类命中项生成，例如「点击」「填写」「提交」「发送写请求」
   「坐标点击（CDP）」「改浏览器设置／扩展」「读取 Cookie」。坐标点击要明说
   「无法预览点到的元素」，不建议 Galley 先注入探测脚本去查，那等于 Galley 自己在
   用户页面里执行代码。
3. **AI 自述**：这一步的摘要句（GA 的 `<summary>`，TurnMarker 已经在解析），
   标明是模型自己说的。内容平台那个例子里，摘要写的是「现在点击铅笔图标」，比
   坐标好懂得多。
4. **代码**：仿 `CodeRunRenderer`，等宽、多行、标「JS」。扩展命令按 JSON 美化；
   代码在正文代码块里时，由 runner 取出后一并带上。
5. **放行粒度**：「允许」「拒绝」「本会话在 {主机名} 不再询问」，替换掉按工具
   放行的白名单。
6. **批准后复查**：审批可能要等好几分钟，期间页面可能已经跳走。runner 在执行前
   再查一次网站，变了就重新询问。

### 3.3 `browser-site.ts` 能不能用于审批

不能直接用。`browserFactsFromResult`（`gui/src/lib/browser-site.ts:157`）从**结果**里
的 `tab_id` 认标签页，审批时工具还没跑，没有结果。如果改成「执行前用
`switch_tab_id` 对最近一次标签页列表」，本机数据是这样的：

- 只有 412／622（66%）次调用写了 `switch_tab_id`。其余 34% 用的是 GA 进程里的
  隐含默认标签页，GUI 看不到。
- 能从历史对出主机名的有 403 次（65%）。其中 164 次在上次列表之后，同一标签页
  已经发生过导航或点击，存在过期风险。
- 能核验的子集里（不导航的调用，且之后有扫描覆盖该标签页），128 次中有 7 次
  （5.5%）在下一次扫描时已经是另一个主机名。

对工具 pill 来说，偶尔不显示无伤大雅；审批卡显示**错**的网站比不显示更糟。所以
审批面上的网站要用 runner 实时查到的值，再配合批准后复查。`docs/design/tools-and-approvals.md:49-51`
已经把这一点「留给审批面单独裁决」，本节就是那份依据。

## 4. 方案对比

| 方案 | 做什么 | 成本 | 噪音（本机回放） | 保护 | 判断 |
|---|---|---|---|---|---|
| **A 保持现状 + 诚实文案** | 输入框旁的模式说明与设置 → 审批各补一句「浏览器操作不经审批」 | 2 处文案 × 中英，零风险 | 0 | 无，但不再许诺做不到的事 | **现在做** |
| **B 整个工具进默认列表** | 改 runner `DEFAULT_APPROVAL_TOOLS`、`RISK_LEVELS`，以及 `defaults.ts`、`SettingsApproval.tsx`、文案 | 小 | 622 次，中位 6／会话，P90 25，最多 92 | 名义上全覆盖；用户会点「加入白名单」，之后本会话全免 | 否决 |
| **C `no_monitor` 切分** | `needs_approval` 读 `args.no_monitor` | 小（约 10 行 + 测试） | 366 次，中位 3.5，P90 18，最多 51；75% 是导航 | 漏读里夹写的脚本；随模型浮动；可被注入翻转；白名单让切分作废 | 否决 |
| **D 按脚本内容判定 + 专用审批卡 + 按站点放行** | runner 分类模块；实时查网站与批准后复查；三处 IPC 增量字段；新 `ApprovalRenderer` 分支；按（工具，主机）放行；文案；测试 | 中（估 1～2 天）；前置是先修 §2.3 | 34 次，中位 0，P90 2，最多 8；45／56 个会话零审批；加按站点放行后 ≤13 | 覆盖本机全部 8 次高风险；不拦导航；能被混淆绕过 | **暂缓，给启动信号** |

A 的文案草案，终稿按文案规范与 GA 预算定：

- 模式说明（`composer.approvalMode.approvalDescription`）：
  「改文件、跑命令前先问你；浏览器操作不问」。
- 设置 → 审批（`settings.approval.rulesScopeHint` 下补一行）：
  「浏览器里的点击、填写和提交目前不经审批。」

另一个代理正在改 `zh.ts` / `en.ts`，A 要等那边落地后再动。

还考虑过「每个站点第一次操作时问一次」当作触发条件（不只是放行粒度），否决：
它会放过同一站点后面风险更高的操作。内容平台那个例子就是先点标题、再点图标，
都在同一个站点上。

## 5. 推荐与启动信号

**现在：**

- 做 A：兑现「说什么就是什么」，成本最低。
- 单开一张 bug 票：审批设置页是摆设（§2.3）。这比浏览器审批更直接地违背设置页
  的承诺，也是 D 的前置：规则下发不到 runner，加任何新规则都没有诚实的设置入口。

**D 暂缓。** 依据：产品默认是自动执行；本机 135 个会话全部跟随默认，历史上 0 次
拒绝。逐步审批的用户有多少、在乎什么，现在观测不到。如果 JC 裁「先不做」，按
惯例连同本文件链接进 `docs/devlog/deferred.md`。

**D 的启动信号，任一满足即重开：**

1. 有用户在逐步审批下用浏览器，并提出诉求或报告事故，比如社区反馈「浏览器点了
   我没想让它点的东西」。
2. §2.3 的设置票已经落地，规则真正下发到 runner。
3. 浏览器控制进入对外主打「登录态浏览器」的推广轮，比如 PRD 裁决 5 的商店上架
   重启。卖点越大，「逐步审批不管浏览器」越需要真正解决。
4. 出现提示注入类事件，即网页内容诱导模型去操作页面。

重开时先按附录重跑一遍数字。如果交互／写的占比明显上升，D 的噪音要重新估。

**C 的否决理由一句话：** 它用一个省时间的性能开关来做安全判断，噪音大，结果随
模型浮动，还可以被翻转。

## 附：复现方法

```sql
-- 只读打开
-- sqlite3 -readonly "$HOME/Library/Application Support/app.galley/workbench.db"
select m.id, m.session_id, m.turn_index, m.content, m.tool_calls, m.tool_results,
       s.llm_display_name, s.ga_runtime_kind, s.approval_mode
from messages m join sessions s on s.id = m.session_id
where m.tool_calls like '%web_execute_js%'
order by m.created_at;
```

用 Python 按下标配对 `tool_calls[i]` 与 `tool_results[i]`；`no_monitor` 按 GA 的
`_arg` 规则取真值；分类规则见 §1.3。效果信号从结果字符串里正则提取：
`"diff": "DOM变化量: N`、`页面无变化`、`"reloaded": true`、`"newTabs"`。GA 的
`smart_format` 保留头尾（`ga.py:291-294`），截断的结果也能匹配。主机名解析逻辑同
`buildBrowserSiteResolver`（`browser-site.ts:273`），另外记录每次调用「执行前」能
看到的标签页列表，以及该标签页在此后是否发生过导航或点击。调研脚本放在会话临时
目录，没有入库。
