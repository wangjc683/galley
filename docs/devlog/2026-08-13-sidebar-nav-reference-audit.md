# Sidebar 导航参考审计：滑动高亮否决，取一枚徽章 pop

日期：2026-08-13
关联：`SidebarQuickActions.tsx`（定时徽章 pop）、
[foundations.md](../design/foundations.md)（hover 一律瞬时 / motion token
核心原则）、[layout-and-chrome.md](../design/layout-and-chrome.md)
（sidebar = 可一眼扫描的状态板）

## 背景

对照一段外部 SidebarNav 参考组件（Linear/Raycast 系：滑动 hover 高亮
胶囊、内联搜索框 + kbd 提示、计数徽章 pop、行 hover 显现 `+`、
`active:scale-0.96` 按压）审计 Galley sidebar 有无可借鉴处。结论：
**基本无可拿**，且这个结论本身值得留痕——参考的招牌技巧撞上的是一条
应该赢的规则。

## 滑动高亮胶囊：否决（不做真机重审）

参考的灵魂：单个绝对定位的高亮块用 `useLayoutEffect` 量位置、220ms
缓动在行间追随 hover/active。撞「hover 一律瞬时」（foundations，
2026-07-16，原生桌面惯例）。与 shimmer 案不同，这次规则该赢，不值得
像 shimmer 那样开变体实测：

1. 规则保护的是**响应性**——hover 反馈 220ms 才滑到，手感即「界面变
   慢」；Galley 是桌面应用追原生手感，滑动胶囊是 web 产品美学，取向
   差异正是规则存在的理由。
2. sidebar 是**外围监控面**（可一眼扫描的多 session 状态板），鼠标扫过
   长列表时胶囊一路追光标 = 在监控面上常驻环境动感，气质滑向 §2.7 要
   删的东西。
3. 工程：量尺寸方案与列表流失打架——session 行随活动重排、分桶变化、
   滚动容器；参考只有 5 个静态项。
4. 合法表亲「state 驱动的选中态滑动」（A 类）也否决：选中常跨桶、跨长
   距离、目标行可能刚重排，滑动要么怪异要么出屏；切 session 时主视图
   整体换内容，连续性由内容承担。

## 其余元素：已有等价或更精致

- 搜索行 kbd 提示：`⌘K`/`⌘N` hint 已在 QuickActions。
- 徽章 pop：参考的 `key={badge}` 重触发**首次挂载也会弹**（打开页面
  所有徽章齐弹）；Galley 的 `sidebar-state-pop` + `popEnabled` 挂载
  抑制闩早已解决这个参考没解决的缺陷。
- 工作区切换行 → SidebarHeader 领域；常驻搜索框 → palette 是既定
  裁决；hover 显现 `+` → 行 hover 菜单同款语法已有；`scale-0.96`
  按压 → Galley 按压语法是 translate-y 键程，不引入第二种物理。

## 采纳的一枚小件：定时徽章计数增加时 pop

`scheduledActionCount` 徽章（「有事要处理」警示位）原为静态：夜里
定时任务失败、计数 1→2 无声无息。复用 `sidebar-state-pop`：仅
**增加**时 pop（减少 = 用户刚处理掉一件，不是新闻），prev-count
初始化抑制挂载态（app 启动带着计数 2 不弹），keyed span 保证动画
恰在入场帧播放——三处纪律全部沿用 SidebarSessionRow 的闩习语，
语汇零新增。已知局限：变化发生时用户可能不在看屏幕，0.44s 一拍会
错过——徽章本身持续在场，pop 只是入场节拍，与 session 行哲学一致。
