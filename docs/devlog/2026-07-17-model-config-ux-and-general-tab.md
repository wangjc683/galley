# 模型配置 UX 三连 + Settings General tab / 开机自启

> 2026-07-17 · commits `6b360e6` → `70bd61e`（4 个 commit）

一个 session 里从「换预填模型 ID」的小请求滚出四轮体验打磨：模型预设刷新 →
Onboarding 配置降门槛五连 → Settings Models tab 行操作收敛 → 开机自启 +
General tab 落地。每轮都是「排查 → 讨论拍板 → 实现 → 真机验收 → commit」。

## 1. 模型预设刷新（`6b360e6`）

全部预设渠道的默认 / 预填模型换到 2026-07 前沿：OpenAI `gpt-5.6-sol`、
Anthropic `claude-opus-4-8`、ChatGPT/Codex `gpt-5.6-sol`、MiniMax `MiniMax-M3`、
Kimi `k3`（Kimi for Coding 端点上 K3 的 ID 就是裸 `k3`；`kimi-for-coding`
对应旧 K2.7）、OpenRouter `anthropic/claude-opus-4.8`。第三方 ID 均经
官方文档 / 联网核实，不凭训练记忆猜。

**Open**：Kimi `k3` 需 Moderato 及以上套餐、reasoning effort 暂只支持
`max`——低套餐用户新建时可能踩坑，若有反馈考虑 model 回退 `kimi-for-coding`
只在 placeholder 提示 `k3`。

## 2. Onboarding 模型配置降门槛（`c59b73c`）

设计原则：理想路径 = 选渠道 + 粘贴 Key，其余交给预设与自动探测。

- **预填模型为值**（不是 placeholder）——灰字占位被误读为已填，「开始」
  按钮灰着用户不知道为什么。SiliconFlow 有意留空：聚合平台无明显推荐，
  交给自动拉取。
- **模型列表静默自动拉取**：Key + 地址齐 → 800ms 防抖拉取 → 空模型框自动
  选中推荐模型；指纹去重防循环重试；失败静默（手动按钮保留为显式路径）。
- **`获取 API Key ↗` 链接**：preset 新增 `apiKeyUrl`，8 渠道配控制台页；
  小米 MiMo 无可靠来源留空（UI 自动不显示）。
- **Codex 设备码自动轮询**：打开登录页即开始轮询，授权完成自动进入；
  「完成登录」降级为出错重试。
- **渠道选择卡片化**：下拉 → 2 列平铺卡片（新 `ManagedModelProviderCardGrid`），
  补齐全部渠道双语描述（此前只有 3 个）。Settings 端保留 popover picker。

**Rejected**：API Key 前缀自动识别渠道（`sk-ant-` → Anthropic）——magic
过头易误判，且与卡片化重复。

## 3. Settings Models tab 行操作收敛（`b237d51`）

- 「我的模型」每行最多 6 个 hover 图标按钮（测试/设默认/编辑/移除/↑/↓），
  行间数量不一致、icon-only 语义弱、「编辑」与点击行为纯冗余。改版：
  **行首 radio 圆点**承担设默认（实心=默认，点击即设），右侧收敛为
  `↑ ↓ ⋯` 三个常驻控件，测试/移除进 `⋯` 菜单（与服务商卡片同语法），
  编辑 = 点行。三个方案（radio / 全收菜单 / 只删冗余）以 ASCII 预览
  给 JC 选，radio 胜出——设默认是最高频操作，不能藏进菜单。
- **服务商卡片展开自动拉取**模型列表（每卡片每会话一次；跳过 Codex、
  缺 Key、有缓存），自动路径不弹手动添加草稿（防清掉用户正在编辑的
  草稿）；header 上零模型时的重复「读取模型列表」按钮删除。
- **修上一轮引入的错链 bug**：编辑已有 provider 时按协议归到通用预设，
  DeepSeek provider 的「获取 API Key」错指 Anthropic 控制台。修法
  `managedModelProviderPresetForRecord` 按 apiBase 反查原始 preset
  （复用 `advancedOptionsForManagedModelProvider` 的匹配语义）；链接
  加显示条件：仅当 apiBase 仍指向预设官方地址。

## 4. 开机自启 + General tab（`70bd61e`）

- `tauri-plugin-autostart`：macOS LaunchAgent（无权限弹窗）/ Windows
  HKCU Run 键（无需管理员，NSIS currentUser 更新路径稳定）。默认关。
- **OS 为唯一事实源**：开关实时读 `isEnabled()`，不入 prefs——系统侧
  移除登录项零漂移，无对账逻辑。
- **静默自启**：登录项带 `--autostart`，setup 检测到则不显示主窗口直进
  Background Mode。为不闪帧，主窗口改为 `visible: false` 创建 + setup
  显式 show（普通启动）——**这是对每次启动路径的侵入**，show 路径回归 =
  隐形窗口，已在 desktop-runtime.md 写成不变量。无托盘平台兜底强制显示。
- **General tab**（侧边栏第一位）：统一 `PreferenceRow` 行语法，
  外观与语言（主题 / 对话字号 / 语言,SegmentedControl 三段）+ 启动
  （自启开关）。语言 / 主题从 sidebar 底部菜单毕业至此（入口唯一），
  字号加权威入口（topbar 快捷保留,双入口同步）。
- **Rejected**：Runtime tab 改名「通用」（JC 提议,劝退——Runtime 是引擎
  配置身份,与桌面偏好心智不同）；AppleScript 登录项（首次触发
  System Events 自动化权限弹窗,拒绝后功能失效难恢复）；对话宽度进
  General（Settings 模态遮住对话区,切宽度盲调 = 死控件;入口维持
  topbar + macOS 菜单栏）；启动形态子开关（固定静默,少一个选项）。

## Open items

- Windows 真机冒烟未跑：注册表键 / 注销重登静默自启 / Task Manager 禁用
  后 `isEnabled()` 是否如实报告（auto-launch v0.5 声称读 StartupApproved，
  待验证），见 windows-build-checklist.md 新增 General 节。
- `ThemePreferenceMenu` sidebar 变体与 `LanguagePreferenceMenu` sidebar
  变体已无调用方（前者只剩 topbar、后者只剩 onboarding compact），死代码
  待清理轮删除。
- MiniMax / 智谱的取 Key 控制台 URL 建议真机点一遍确认未失效。
