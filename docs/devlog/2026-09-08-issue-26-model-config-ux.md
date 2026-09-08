# issue #26 审阅：模型配置的推理强度、排序与快速切换

日期：2026-09-08

## 来源

社区 issue [#26](https://github.com/wangjc683/galley/issues/26)（作者 yqarmy1，
Windows 10，Galley 0.4.11 内置内核）提三件事：① 添加服务商时直接选协议 /
推理强度 / fast；② 服务商列表拖拽排序、添加时勾「设为默认」；③ 输入框旁
一排切换控件（模型 / 推理强度 / fast）。作者的现状描述是「推理强度只能手改
`managed-models.json` 的 `advancedOptions.reasoning_effort`」。

## 现状对表

先读代码再发言，逐条对：

| 诉求 | 现状 | 判断 |
|---|---|---|
| 选协议 | 跟预设走；`custom-openai` / `custom-anthropic` 就是手动选协议 | 有，叫法不同 |
| 推理强度 | 有，在模型编辑器「高级配置」里，按协议分档 | 有，但**两层折叠**：探测列表一键「添加」不经编辑器；要点铅笔进编辑再展开面板 |
| fast | OpenAI `service_tier` 内核支持、GUI 未暴露；Claude fast（`speed`）内核没有 | 半有半无 |
| 排序 | 只有 ↑ ↓ 单步 | 缺长距离路径 |
| 设为默认 | 行首 radio 圆点一键置顶（默认 = 第一位） | 有，作者没认出来 |
| 添加时勾默认 | 首个模型自动默认；之后没有勾选项 | 圆点一键已覆盖 |
| Composer 切模型 | LLMPill + 命令面板，`set_llm` per-session | 有 |
| Composer 切推理强度 | 无控件；内核有 `/session.reasoning_effort=high`，Galley 输入框直通可用 | 缺控件 |
| 推理强度徽标 | 模型行已有 `Gauge` chip（仅显式设置时显示） | 有——审阅时我先说「没有」，读到行代码才发现，记一笔 |

真问题只有一个：能力在，入口埋太深。

## 裁决（JC，2026-09-08）

1. 推理强度**按模型提级**为编辑器一级字段，不做「全局强度」——档位表按协议
   不同（`none` / `minimal` 只 OpenAI 认，`max` 只 Claude 认），全局值要做映射，
   映射本身又成隐藏配置；多服务商场景恰恰需要贵的开 high、中转开 medium。
2. fast 先不做（进 deferred）。
3. 排序做**拖拽**。先前一轮判「等真实信号」，JC 基于「配了很多模型的用户靠
   上下移动费劲」的推断决定现在就做；顺序 = Composer 切换菜单顺序，所以前几
   位都有意义，↑ ↓ 在 20 个模型的列表里把一个从底部挪到第 2 位要点 18 下。
4. Composer 不进推理强度（进 deferred，把查明的内核路径记全）。
5. 添加时勾「设为默认」不做，圆点一键已覆盖。
6. Issue 回复等发版后再讨论。

## 落地

- `ReasoningEffortField`（`AdvancedModelOptions.tsx` 导出）放在编辑器显示名
  之后、`高级配置` 之前；存储仍是 `advancedOptions.reasoning_effort`，面板的
  「N 项已自定义」计数排除它，「恢复推荐值」不动它。
- 拖拽：dnd-kit（`@dnd-kit/core` / `sortable` / `utilities`，仓库首个拖拽排序
  依赖；不手搓原生 HTML5 DnD，WKWebView 上有坑）。行首 `DotsSixVertical` 把手，
  hover 显性化与箭头同权重，拖动态只做 `bg-elevated` + z-index，遵守「不抬升不
  加阴影」；PointerSensor 4px 激活距离防误触，KeyboardSensor 给键盘路径。
  ↑ ↓ 保留。控制器新增 `handleReorderConfiguredModels`，后端零改动——
  `reorderModels` 本来就收完整 id 列表。
- 圆点 tooltip 改为「设为默认（移到顶部）」，把等价关系写明。
- 设计文档 `overlays-and-settings.md` 两处同步。

## 真机验收后的两轮补刀（同日）

- **创建步骤漏了推理强度**：提级只做在 `ModelDraftEditor`，新增服务商的
  `ProviderEditor` 是另一个组件。补同一个 `ReasoningEffortField` 在模型选择
  之后、服务商名称之前；值本来就走 `form.advancedOptions` → `runProviderCommit`
  写进首个模型，预设 draft 同时是种子和推荐基线。Onboarding 有自己的界面，
  不受影响。
- **创建时只能选一个模型**：有意设计——那个模型同时是连接测试目标（探测
  指纹含模型名），保存后卡片自动展开、探测列表已缓存、每个模型一键添加，
  toast 明写"可以继续在这个 Provider 下添加模型"。多选要把 `form.model` 拆成
  「测试目标 + 勾选集合」、串行建 N 个模型，中等改动。JC 裁决先不做；待判
  的是他那一下是没注意到卡片里的列表（发现性）还是觉得应该创建时勾（流程）。
- **推理强度 chip 和 Provider chip 太像**：两者同容器同墨色，唯一区别是
  10px `Gauge` 图标，真机上读作灰点。定原则「Provider 是身份，推理强度是
  状态」，四条路（字形 / 去容器 / 描边 / 挪第二行）里 JC 直接选字形：容器
  不变、去图标、大写等宽枚举值 `HIGH`，`text-ui-micro` 的本职就是 uppercase
  chip。没开变体切换器，硬理由已足。

## 被否 / 搁置

- 全局推理强度：见裁决 1。
- 同模型不同强度存两条模型条目、用现成切换器切：JC 觉得把配置层的事推给
  用户。
- 「高级参数键值编辑区」：并入 deferred 的 `api_key_header` 条作第二信号；
  作者要的是策展字段，不是自由 KV。
- 「移到顶部」独立动作：核出 `handleSetDefaultModel` 就是置顶，重复。

## 验证

`pnpm --dir gui typecheck` / `lint` / `test`（357 通过）/ `build` 通过，
`git diff --check` 干净。真机视觉验收留给 JC（macOS + Windows 各过一眼拖拽）。
