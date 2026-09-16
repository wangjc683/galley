# 模型列表从独立区块改为模型输入框的候选项

> 2026-09-16 · 自动拉取加可见状态 + `ModelCombobox` 替换两个创建面的列表

## 问题

JC 反馈：填入 API 地址和 Key 后，「模型面板会自动展开」，UI 跳动，
不知道发生了什么的用户会困惑。

对表代码，07-17 那轮定的「Key + 地址齐 → 800ms 防抖静默自动拉取模型列表」
（[2026-07-17](./2026-07-17-model-config-ux-and-general-tab.md) §2）有意做成
静默：自动路径不碰 probe state，读取中无指示、成功无提示，列表回来那一刻
视图从「无」直接变「有」。两个创建面都中：

| 面 | 列表回来后冒出来的东西 | 有前置提示吗 |
|---|---|---|
| Onboarding 新建 | 一行 popover 按钮「选择要启用的模型」，紧接自动选模 → 自动测连接，状态又变一次 | 无 |
| Settings 新建 provider | 整段 `ModelSelectionList`：标题 + 筛选框 + 最高 220px 滚动列表 | 无 |
| Settings 展开已有卡片 | 最高 260px 列表 | 有：按钮转圈 + 「找到 N 个模型」 |

第三条是用户自己点展开触发的，且走手动按钮同一套状态，不在本轮范围。

加重因素：自动拉取不看模型框是否已填。选 DeepSeek 预设时模型已预填
`deepseek-chat`，用户不需要列表，粘贴 Key 后 Settings 端照样弹出 220px。
既没解释，用户也用不上。

问题拆成两个独立的因：**没有预告**（不知道发生了什么）和**体积大**（跳动
明显）。

## 方案与裁决

- **A · 自动路径走 probe state**：拉取开始置 loading（「读取模型列表」按钮
  转圈），成功置 success（「找到 N 个模型」），失败回 idle 保持静默——保住
  07-17「失败静默、手动按钮才是显式报错路径」的决定。零新增标记。
- **B · Settings 端列表默认折叠成一行摘要**：「已找到 N 个模型 ▸」，模型框
  为空时展开、已预填时折叠。
- **C · 列表并进模型输入框做 combobox**：输入框位置不动，尾部亮起 caret，
  列表回来只是让 caret 出现、下拉里有货。
- **D · 取消自动拉取**：推翻 07-17，SiliconFlow 这类无推荐模型的渠道得
  手动点一次。不推荐，把「不知道发生了什么」换成「不知道要做什么」。

B 和 C 真正的分歧不是「折不折叠」，而是**这份列表是什么东西**：B 把它当
独立区块再收起，C 把它当模型输入框的候选项，没有自己的位置。创建流程里
列表的唯一职责就是帮用户填「模型」这一个字段，C 让结构和职责一致。

对比 B 的残留：仍跳一行摘要；「预填就折叠」是启发式，以后要在 devlog 里
辩护；两个创建面继续分叉。C 的代价：caret 安静，可发现性靠 A 的状态文字
和空框时的 placeholder；焦点管理要拦住弹层抢焦点。基础设施核实全在：两个
输入框组件都有 `trailing` 插槽（API Key 的眼睛按钮在用），Onboarding 的
popover picker 本就存在。

**JC 裁决**：认「列表是模型字段的候选项，不是独立区块」→ C；「读取模型
列表」按钮留作显式刷新，不合并进 caret（少一个魔法）；A + C 两个面一次
做完，不分步。

## 落地

- `ModelCombobox`（`gui/src/components/managed-models/`）：render-prop 把
  `{value, onChange, onKeyDown, placeholder, trailing, reserveTrailing}` 交给
  宿主输入框，各面保留自己的输入框语法，组件只管 caret 和下拉。caret 点开 /
  ↓ 展开全表（query 清空，预填的模型不会把同类挡住），输入即筛选，Enter
  选中、Esc 关闭，焦点始终在输入框（`onOpenAutoFocus` 拦掉、行 `onMouseDown`
  preventDefault、点回输入框不算 outside）。空框时 placeholder 换成
  「已找到 N 个模型，可从右侧选择」。上限 80 行 + 提示，与旧列表同。
- 删除 `ManagedModelOptionPicker`（Onboarding）与 `ModelSelectionList`
  （Settings）；表单级 `providerFormModelFilter` 一并删除，筛选就是输入框
  文本，`rememberProviderModelOptions` 不再带 filter。
- 控制器自动拉取路径置 loading / success，catch 里仅当仍是本次 loading 才
  回 idle（stale 响应不动状态）。

副作用（接受）：Settings 端保存按钮在拉取的一两秒内灰一下（`canSaveProvider`
门禁 probeLoading）——拉取中不该保存。零模型成功时 Settings 端会显示
「连接成功，但没有返回模型列表」+ 手输提示，这是信息不是噪音。

## Rejected

- B（折叠摘要行）：见上，症状修补且引入启发式。
- 「读取模型列表」按钮合并进 caret：JC 否，保留显式刷新入口。
- 列表回来时自动弹开下拉：弹层虽不推布局，但在用户焦点别处时自己打开
  同样是「发生了什么」时刻，改用 placeholder + 状态文字做提示。

## 验证

`pnpm --dir gui typecheck` / `lint` / `test`（386 通过）/ `git diff --check`
全绿。真机验收（Onboarding 与 Settings 两面的 caret、键盘导航、焦点）
交 JC。
