# 01: Spike — dragDropEnabled 翻转可行性验证

Status: done（2026-07-29 JC 裁决选 A：接受文本拖拽损失 + toast 缓解，技术路线不变，见 Answer 末尾）
Type: research

## 问题

整个技术路线建立在一个未验证的假设上：`core/tauri.conf.json` 的
`dragDropEnabled` 翻成 `true` 后，Tauri 原生 `onDragDropEvent` 接管的
**只是文件拖放**，纯文本 / URL 拖拽（如从浏览器拖一段选中文字进 textarea）
仍走 webview 默认行为。如果原生事件把所有拖拽都吞掉，方案要重估。

## 做法

在本地 `pnpm --dir gui tauri dev` 下临时翻转配置，验证三件事：

1. 从 Finder 拖文件：`getCurrentWebview().onDragDropEvent()` 触发，payload
   含真实绝对路径与窗口坐标。
2. 拖纯文本 / 浏览器 URL 进 composer：textarea 默认插入行为不受影响。
3. HTML5 `onDrop` 确认收不到 `dataTransfer.files`（预期失效，佐证 02 的
   迁移必要性）。

macOS 验证即可；Windows 差异留给 05 的 smoke 轮。spike 代码不合入，
配置翻转正式落地在 02。

## 产出

结论与平台行为记录追加到本文件 `## Answer`。若第 2 点翻车，
Status 转 needs-info 并回到 PRD 重估技术路线。

## Answer（2026-07-29，源码级验证，未跑真机）

验证方式变更：agent 无法执行真实鼠标拖拽，改为直接审读本仓库
`core/Cargo.lock` 锁定版本的依赖源码（cargo registry 本地缓存），
这比黑盒 dev 实验更权威。真机行为复核并入 02 的验收。

### 三个问题的答案

1. **文件拖放能拿到路径**：✅。`onDragDropEvent` payload 含绝对路径数组
   与窗口物理坐标（`tauri-runtime-wry-2.11.1/src/lib.rs:4861-4895`）。

2. **文本/URL 拖拽不受影响**：❌ **翻车，且两平台一致**。机制链条：
   - macOS（wry 0.55.1 `src/wkwebview/drag_drop.rs`）：wry 子类化
     WKWebView 的 NSDraggingDestination 方法，handler 返回 `true` 则
     不调 `super`，webview 收不到任何拖拽；且拦截的是**所有**拖拽，
     文本拖拽只是 `paths` 为空。
   - Tauri 的 handler **无条件返回 `true`**（`tauri-runtime-wry`
     lib.rs:4894），不区分 `paths` 是否为空，无任何配置可改。
   - Windows（wry `src/webview2/drag_drop.rs:69-70`）：直接
     `RevokeDragDrop` 掉 WebView2 自身的 drop target 换成 wry 的
     `IDropTarget`，DOM 同样收不到一切外部拖拽。
   - 结论：`dragDropEnabled: true` 后，拖文本/URL 进 textarea 会被
     静默吞掉（原生事件收到一个 `paths: []` 的 Drop，拖拽内容本身
     拿不到——`DragDropEvent` 只携带路径）。
   - 上游为长期已知限制，无修复迹象：tauri#2014、#14373、#8581。

3. **HTML5 drop 失效**：✅ 确认（问题 2 的同一机制）。现状 image drop
   能工作的原因也已定位：`dragDropEnabled: false` 时 tauri 不装 handler，
   wry 缺省 handler 为 `|_| false`（`src/wkwebview/mod.rs:304-306`）→
   调 super → HTML5 生效。

### 损失面评估

全 GUI 检索：HTML5 DnD 的唯一消费者就是 Composer 的图片 drop（02 本来
就要迁移）。其余 "draggable" 命中全是窗口拖动区域（`startDragging`
机制，不受影响）。即翻转配置的净损失 = **「拖文本/URL 进输入框」这一个
交互**（今天可用，翻转后静默失效）。

### 技术路线选项（待 JC 裁决）

- **A（建议）：接受损失，照原计划推进。**理由：文本拖入聊天输入框是
  低频交互（复制粘贴是主流路径）；换来的是整个 feature。缓解措施：
  收到 `paths: []` 的 Drop 时弹轻量 toast「不支持拖入文本，请复制粘贴」，
  把静默失效变成有解释的失效。
- **B：macOS 拖拽 pasteboard 兜底（不建议 v1）**：Drop 且 paths 为空时
  从 Rust 读 `NSPasteboard(.drag)` 提取文本、注入 composer。可行但
  引入平台特化 hack，Windows 无对等物。记为 backlog 备选。
- **C：放弃拖放，只做 picker 入口**：损失 headline 交互，不建议。

### 裁决（2026-07-29，JC）

选 **A**。明确接受的体验损失（已向 JC 完整陈述）：① 从外部应用拖
文本/URL 进输入框失效；② 输入框内部拖动选中文字挪位置失效。两者
替代路径均为复制粘贴。缓解：空路径 Drop 时弹 toast「不支持拖入文本，
请复制粘贴」。toast 实现并入 02。
