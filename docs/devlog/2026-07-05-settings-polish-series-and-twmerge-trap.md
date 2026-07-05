# Settings 打磨系列 + tailwind-merge 字号陷阱

日期：2026-07-05（系列跨 07-05 全天，含 Runtime / Channels / Models /
Browser Control / 轻 Tab / Earlier·Archived dialogs 六轮）

## 结果

Settings 八个 Tab 和两个历史 dialog 过完同一套权重纪律，规则全部沉淀进
`docs/design/overlays-and-settings.md` §9（含新增 Browser Control 小节）
和 `layout-and-chrome.md` §4.1。本条目只记决策的「为什么」和被否方案；
现行规则以设计文档为准。

系列中反复出现、最终定成规则的三个模式：

1. **眉标越级**：页面级 uppercase `SettingsSectionLabel` 出现在折叠区 /
   编辑器 / 卡片内部，层级塌平。四个 Tab 各中一次（Runtime 展开区、
   Channels 凭据表单、Models 的 `SettingsInput` 基元、Agent 高级折叠
   区）——第三次出现时定位到基元层根修（SettingsInput），第四次只是应用。
   教训：同一违例出现两次就该找共同根源，而不是继续逐点修。
2. **primary = 当前可执行的下一步**：Channels 轮立规（保存凭证/启动服务
   互斥），随后反向应用到 Models（添加服务商仅在零配置时 primary）和
   Browser Control（未连接时测试连接是全 Tab 唯一 primary）。
3. **动作锚定**：推进状态的动作住在它作用的对象里；裸按钮行只放维护动
   作。Browser Control 的 dialog 底部 action bar 残留是反例教材。

## tailwind-merge 陷阱（本日最重要的工程发现）

**症状**：Channels 的「未接入」badge 迁移到 `text-ui-tertiary` 后渲染成
16px（浏览器默认），比 13px 卡片标题还大；后续「降字号」的修复
（→ `ui-micro`）毫无效果。

**根因**：`cn()` = clsx + twMerge。tailwind-merge 不认识自定义
`--text-ui-*` 主题 token，按默认启发式把未知 `text-*` 类归入**文字颜色
组**；同一次 `cn()` 里后出现的 `text-success` / `text-ink` 与它「同组冲
突」，字号类被**静默删除**——声明根本没进 DOM。裸 `className` 字符串不
经过 merge，所以并排的卡片标题一直正常，掩盖了问题。

**定位方法**：对用户截图做像素测量——badge 字高 ≈ 标题的 1.21 倍，与截
图缩放无关地反推出 ≈16px；同元素上 `h-5` 生效而字号不生效 → 「类被选择
性删除」→ 直查 `cn()` 实现。教训：迁移「看起来等价」的类时，症状不响应
修复本身就是最强信号——说明改动根本没到达渲染层。

**修复**：`extendTailwindMerge` 注册 7 个 `text-ui-*` 进 font-size 组、
4 个 `leading-*` 进 leading 组（`lib/utils.ts`），全局自愈所有既有受害
点（Models 行标题等）；`globals.css` token 区加注「新增 token 必须同步
utils.ts 配置」。同时把 badge 回滚到原始 11.5px/h-6 规格——此前的降档是
对着坏渲染做的盲修，不是对真实设计的判断。

## 被否的方案（按轮）

- **Runtime**：激进 IA 重构（切换动作从两张卡收拢成真正二选一）被搁置，
  以「手风琴头常驻正在使用 badge」满足状态可见性——改信息架构的收益不足
  以配平改动面。
- **Channels**：三张卡 StatusBadge 与 Runtime badge 语法统一被否——连接
  状态是 Channels 卡的核心信息，值得更重一档（有意分叉，已入文档）。
- **Models**：`我的模型` 副标题按「header 不放常驻说明」删除被否——顺序
  = 切换菜单顺序、第一个 = 默认是不可推断的核心语义（例外已入文档）。
- **Browser Control**：保守方案（保留底部 action bar 只调 primary/尺寸）
  被否——dialog 的 action-bar 语义在 Settings 页不成立。
- **Earlier/Archived**：清空归档的双层确认并入共享 `ConfirmActionDialog`
  被否——acknowledgement checkbox 门就是它的设计。

## 组件沉淀

系列产出的共享基元：`SettingsFieldLabel`（settings-ui）、
`ConfirmActionDialog`（im/ → components/ui/，Channels 四弹窗 + Archived
两删除确认共用）、`ChannelErrorBlock` / `OwnerBinding`（im/）、
`session-browser-ui` + `session-browser`（两历史 dialog 的共享 chrome）。
`text-[Npx]` 硬编码在 Settings 与两 dialog 面内清零；留存字面量均有出
处（About 衬线 colophon、YOLO 14px、dialog 标题 15/16/18px 档、侧栏双层
tab 标签）。EarlierDialog 月份分组头由硬编码英文改为
`Intl.DateTimeFormat` + 应用语言。
