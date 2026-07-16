# 2026-07-15 - 桌面工艺打磨轮：窗口记忆 + 菜单栏精修 + 加载布局稳定性（skeleton 否决）

## Date / Status / Related

- Date: 2026-07-15（一个 session）
- Status: shipped on main（`7ab254e`, `adfa20d`）；待 JC 真机 dogfood
- Related:
  - `core/src/lib.rs`（window-state 插件注册、macOS 菜单栏、`set_width_menu_state`）
  - `gui/src/stores/sessions.ts::activateSession` + `sessions.activate.test.ts`
  - `gui/src/components/conversation/MarkdownView.tsx`（高亮缓存 / 度量恒等 / 图片尺寸）
  - `docs/design/conversation.md`、`docs/desktop-runtime.md`（本轮决策已同步）

## Context

起点是 JC 的一个说不上来的感觉："Galley 作为桌面客户端，手感不如成熟大厂产品扎实，但说不出具体在哪。"按十个维度（选中/光标、焦点键盘、动效、加载态、状态持久化、原生集成、排版、组件状态、交互细节、渲染）对 GUI 做了一轮实证审计，结论反直觉：**静态工艺层（token 化动效、focus 纪律、按压模型、暗色全套）已高于独立产品平均水平**，不扎实感来自另外三类东西——具体缺口（窗口失忆、加载空白帧、Shiki 回流、图片 pop-in）、延迟方差（Tauri IPC + React 重渲染的时序抖动，技术栈地板）、长尾覆盖率（低于报 bug 阈值的微小异常频度）。本轮把"具体缺口"一类全部修掉。

## Decisions

- **窗口状态持久化**（`tauri-plugin-window-state`）：尺寸/位置/最大化/全屏跨启动记忆。
  排除 `VISIBLE`（后台模式关窗即隐藏，托盘退出时不得把"隐藏"存成下次启动态）与
  `DECORATIONS`（Windows 自定义 chrome 手动关原生装饰，插件不得用旧值覆盖）。
- **删除两个永久灰色菜单占位项**，理由不同但归宿相同：
  - `Toggle Sidebar`（Cmd+\）：被设计决策**否决**——sidebar 不可折叠是产品形态
    （多 session 即差异化，见 layout-and-chrome.md），"V0.2 接线"的注释已被后续
    决策作废，代码没跟着清。原位留了防御性注释防止未来 agent 加回来。
  - `Find`（Cmd+F）：功能**仍成立但无排期**——原设计是会话内 find-in-page
    （2026-05-15 menubar commit 里的 V0.2 承诺），其"找到那条消息"的一半职责已被
    Cmd+K 面板的 FTS5 全文搜索接管，"这个长转录里 X 在哪几处"的另一半仍空缺。
    删除理由：菜单项不是 backlog，从 v0.2 灰到 v0.3.2 的项对用户读作"坏了"而非
    "敬请期待"；功能落地时加回是零成本。
  - 共同原则：永久 disabled 的菜单项违背 macOS 语义（灰色 = 此刻此上下文不可用，
    不是"永不存在"），比没有更伤质感。
- **菜单栏补齐系统标准项**：app 菜单加 Services；View 加 Enter Full Screen；
  Window/Help 注册为 NSApp 系统菜单（Window 得到窗口列表 + 新系统平铺项；Help
  得到原生搜索框——AppKit 标题启发式匹配的是**本地化的** "Help" 一词，中文系统下
  静默失效，必须显式注册）。
- **Conversation Width 勾选态**：Compact/Wide 换 `CheckMenuItem`（radio 语义）。
  GUI 经新命令 `set_width_menu_state` 在 hydrate + 变更时向内镜像（照
  `set_close_hint_copy` 模式，GUI 仍是 pref 唯一 owner）；Rust 点击处理器同时立即
  翻转两个勾选（AppKit 只自动勾被点项，等 GUI 往返会有一瞬双勾）。
- **加载态议题重新表述**：审计初稿说"没有 skeleton 是弱点"，事实核查后修正——
  加载架构本已 local-first（会话内存缓存、乐观更新、spinner 只用于真慢的事，
  SQLite 路径零 spinner），真问题是三个布局不稳定源，逐一治本：
  1. **原子会话切换**：首访会话先等 SQLite 恢复进内存、再翻 `activeSessionId`，
     空白帧从渲染序列中消除。双守卫防过期翻转：activation epoch（连点）+ 指针
     快照（createSession/删除旁路直写）。写单测时抓到第一版守卫 `!== null` 对
     `undefined` 恒真的 bug——store 空值是 `undefined`，冷启动判断失效；已修并被
     5 个用例钉死。
  2. **Shiki 度量恒等 + LRU 缓存**：高度跳动根源不是"晚到"而是"折行不同"
     （主题 bold/italic 改变字形宽度）。`!important` 中和后高亮退化为纯着色，
     异步换入零回流；300 条模块级 LRU 让重挂载的代码块首帧即彩色。
  3. **图片尺寸预留**：首次解码记 natural 尺寸入模块缓存，后续渲染带
     width/height 属性，解码前预留最终盒子。

## Rejected

- **Skeleton loading**（本轮核心否决，勿翻案）：本地 SQLite 读几十毫秒，为不该
  被感知的等待做占位是把它制度化；聊天转录结构不可预测，灰条必然对不上真实内容
  （双重跳动，比空白帧更糟）；shimmer 是动效分类学（foundations.md §2.7）明确要
  删的 B 类环境动效。正确野心是让加载态不存在。
- **保留灰色占位项等 V0.2 接线**：见上，占位承诺已过期两个 minor 版本。
- **只靠 GUI 往返同步菜单勾选**：AppKit 自动勾选被点项会产生瞬时双勾/无勾帧。
- **`displayedSessionId` 双指针方案**（切换原子化的备选）：两个 source of truth，
  复杂度不值；延迟翻转 + 双守卫更简。

## Open

- **菜单栏本地化**：菜单硬编码英文而应用完整双语，zh 用户的"半原生感"来源之一。
  技术可行（`set_text` + 已有语言推送通道），需先按 copy-language-guidelines 定
  菜单中文术语，含 "Compact (760px)" 这类文案是否保留像素值。等 JC 裁决。
- **Cmd+K 缺菜单栏入口**：菜单栏也是快捷键的可发现性文档；加入口可顺带接住 Find
  删除后留下的发现性职责。等 JC 裁决。
- **会话内搜索（find-in-page）**：Find 删除后该需求仍空缺（面板搜索是跳转导向，
  无页内高亮/遍历）。排期时菜单项加回。
- 审计中发现但本轮未动：Windows 裸滚动条（已于 2026-07-16 关闭，见
  [Windows 滚动条打磨](./2026-07-16-windows-scrollbar-polish.md)）、~436 处遗留
  `text-[Npx]` 字面量（已有"触碰即迁移"策略）、延迟方差无量化基线（可考虑
  keypress-to-photon 采样）。
