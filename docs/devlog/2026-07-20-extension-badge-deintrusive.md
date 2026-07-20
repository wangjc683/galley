# 浏览器插件去侵入化：移除页内徽标 + Galley 品牌化 + 真实连接状态

日期：2026-07-20
参与：JC + Claude
产出：补丁 `0015-managed-extension-galley-branding.patch`

## 问题

managed GA 自带的 `tmwd_cdp_bridge` 插件（上游资产）在每个 http(s) 页面右下角
注入常驻绿色徽标 `ljq_driver: 已连接`：

1. **语义失真**：显示条件只是"插件注入了"，与 GA 是否可达、是否有会话在控制
   浏览器完全无关。
2. **真实遮挡**：`z-index:99999` + `cursor:pointer`，会挡住并吞掉右下角元素
   （客服浮窗 / cookie 弹条高发位）的点击；agent 自己按坐标点击也可能被截胡
   （快照被 `simphtml.py` 的 `ignoreIds` 过滤，agent 看不见它）。
3. **品牌违规**：用户可见面暴露 `ljq_driver` / `TMWD CDP Bridge` 上游内部命名，
   违反 copy-language-guidelines。

附带发现：插件 popup 是 cookie 查看器，**点开图标即自动把当前站点全部 cookie
复制到剪贴板**——对普通用户观感比徽标更差。

## 决策

**完全移除页内注入**。能力可见性由三层既有/新增信号承担：

- 扩展工具栏图标 badge（本次新增）：`ON` 仅在 WS 真正连上本机 driver 时点亮
  ——第一次让"已连接"变成真话；
- Chrome 原生调试横幅：agent 通过 debugger 接管时浏览器自己会提示；
- Galley GUI TopBar 浏览器控制入口（已有，确定性 probe）。

popup 改为状态面板（连接状态 + 可操作标签页数，经新增的扩展内部命令
`bridge_status` 查询），cookie 复制保留但移到显式按钮后面，取消打开即复制。
显示名改为 "Galley Browser Bridge"，图标用 Galley app 同款 G 标
（16/32/48/128，取自 `core/icons/`，补丁以 git binary hunk 携带）。

JC 首装验收后追加的两个修正：

- **空闲态文案**：未连接时显示"未连接"会让用户以为装失败了——实际语义是
  "插件就绪，Galley 引擎没在跑"。改为「待命（Galley 未运行）」，标签页行
  追加"— 插件工作正常"暗示。连接状态与标签页数是两个独立事实（后者只证明
  插件本身工作），popup 同时展示两者正是为了区分"插件坏了"和"引擎没跑"。
- **图标**：上游 manifest 原本没有 `icons` 字段，工具栏是无名灰色占位——
  与 Galley 品牌名不匹配，badge 状态也没有可识别的落点。图标保持静态、
  状态只走 badge（MV3 `setIcon` 切换有闪烁和 SW 生命周期问题，被否）。

**保持不动**（外置 GA 兼容 + 引用面稳定）：文件夹名 `tmwd_cdp_bridge`、WS
端口/消息协议、DOM 标记 `__ljq_3abd77`、`simphtml.py` 的 `ignoreIds`
（徽标删除后空转，无害；外置 GA 的 simphtml 也带同款过滤）。

## 外置 GA 兼容分析（本次讨论的核心结论）

插件对 GA 侧只发 `ext_ready` / `tabs_update` / `ack` / `result` / `error` /
`ping`——全部是上游原有消息类型；0006 与本次 0015 改的都是"时机与 UI"，不是
协议。插件连的是 `ws://127.0.0.1:18765`，谁监听谁用，不区分内置/外置 GA。
因此外置 GA 用户装咖喱这份插件可以正常使用，且顺带获得去侵入化；同一浏览器
不要同时装两份（会抢端口和 `chrome.debugger`）。兼容基准是 pinned 上游
baseline 同代版本；上游若日后改桥接协议，用户换回自己 GA 带的插件即可。

## 被否方案

- **改名 + 缩小但保留常驻页内徽标**：三个问题一个都没解决，只是不显眼。
- **仅活跃控制时显示页内小提示**：需要 background 向所有标签页广播活跃态，
  补丁面积大；Chrome 原生调试横幅已覆盖"被控时提示"，收益不成比例。
- **Galley 另发一份插件给外置 GA 用户（copy-first）**：协议同源已天然通用，
  单独分发反而引入版本错位风险。
- **本次向上游提去侵入化 PR**：暂缓（JC 拍板）。上游合并同等能力后按补丁
  纪律删除 0015。

## 后续

- 已装用户升级 managed 运行时后需在扩展页「重新加载插件」；GUI 既有
  `重新加载插件` 修复入口覆盖。
- 长期可在 Galley GUI 状态区呈现"浏览器控制可用性"，作为产品级答案（未排期）。
