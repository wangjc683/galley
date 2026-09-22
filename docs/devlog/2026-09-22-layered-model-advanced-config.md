# 模型高级配置分层：默认 ⊕ 预设 ⊕ 模型覆盖

日期：2026-09-22

## 来源

社区反馈：「那些模型高级配置最好放出来统一管理，每个模型设置一遍太费
时间。」JC 转述，要求先探讨形式再动手。

## 现状对表

先读代码再发言：

- 数据模型已是两层（Provider：协议 / Base URL / Key；Model：模型名 /
  显示名 / `advancedOptions`），但高级配置只挂在 Model 上，
  `managed_models.advanced_options` 存的是**整份快照**：新建时把 Provider
  预设整份拷进去，每次编辑整份写回，运行时 `cfg.update(advanced)` 平铺进
  GA。Provider 表没有配置列。
- 面板字段按「它是谁的属性」分：`max_retries` / `read_timeout` /
  `max_retry_after` / `stream` / `trim_keep_prefix` 是端点或全局性质；
  `api_mode` / `thinking_type` / `fake_cc_system_prompt` 是协议方言；只有
  `reasoning_effort` 真正按模型。除推理强度外几乎全是端点属性，却要在每个
  模型上各填一遍——配了一个要 `read_timeout=300、stream=false` 的中转，
  下面 8 个模型就得进 8 次编辑器。
- 快照设计的第二个代价：预设升级不生效。`DEFAULT_CONTEXT_WIN` 从 30000
  提到 90000 时老条目是冻结副本（027 / 029 两次 SQL 回填就是这么来的）。

## 讨论路径与裁决（JC，2026-09-22）

讨论走了四轮，每轮都改了方向，记全：

1. **三种形式**：A 全局页（否：字段按协议分叉、中转和直连超时本来不同，
   撞 09-08 否掉全局推理强度的那堵墙）；**B 服务商层承接、模型只存偏离**
   （首轮推荐并被选中：Provider 就是端点对象，复用会话推理强度已发的
   「跟随 / 偏离」语法，顺带解决预设冻结）；C 「应用到本服务商全部模型」
   按钮（复制不是继承，只作廉价出口）。
2. **JC 提「每个模型面板里一个开关：开=调全局、关=调本模型」**。判为表单
   里的模式开关：用户必须记住状态，字段显示值与写入目标可能对不上，
   其他模型的覆盖不会跟着变；且它不决定数据模型（写到哪一层）。保留其
   好处（痛点处就是控件处）改成无状态动作：折叠头链接 + 事后「设为默认」。
   页签变体（「服务商默认 | 仅此模型」各显示各的记录）留作第二轮。
3. **JC 裁「全局可以成为所有服务商」**。重审 09-08 的否决：它否的是全局
   **唯一值**不是全局**默认值**，会话 pill 已证明跨协议可用公共子集。
   由此：全局只收协议无关键，方言键留模型层（炸点具体：Codex 必须
   `api_mode=responses`、Kimi 必须 `fake_cc_system_prompt=true`）；**去掉
   服务商层**，两层 = 全局 ⊕ 模型（三层后「这个值从哪来」对个人助手太重；
   服务商层的收益场景两层下也是两下操作；Core 更简单）。
4. **JC 裁推理强度撤回折叠面板并进全局**。09-08 提为一级字段是因为当时
   两层折叠之间没有别的入口；现在会话 pill 是日常入口、全局面板是「设一
   次」入口，模型层持久覆盖是少数路径。四个细节随之定下：全局档位只给
   低 / 中 / 高 / xhigh / max 加「由服务商决定」；**预设种子必须是独立的
   最底层**（否则设全局 medium，直连模型种的 high 仍赢，用户会问「怎么没
   生效」）；全局出厂留空（08-07 裁过兼容层可能拒收该字段，设了就是用户
   自己的选择）；模型层加 `null` 墓碑表示「不发送」。
5. **JC 追加 `max`**。查内核：`llmcore.py` Claude 路径把 `xhigh` 和 `max`
   都映射成 `output_config.effort: "max"`，警告忽略的只有 `none` /
   `minimal`。现有 GUI 注释「max 只有 OpenAI 认、Claude 到 xhigh 为止」从
   内置运行时第一版起就是错的，本次修正：全局、会话 pill、模型层 Claude
   列表三处一致加 `max`；tooltip 写明 Claude 上 xhigh = max。
6. **对齐六处实现细节**：数值哨兵规则（trim 0 / retry-after 60 删键）被
   偏离规则取代，只在全局层保留「等于出厂不写」；迁移里非界面键（
   `context_win` 等）必须进 preset 层否则「全部跟随默认」会把 `context_win`
   清回 30000；全局存 `prefs` 表一个 JSON 键；文案「默认（跟随服务商）」
   与「跟随默认」打架，改三态；「设为所有模型的默认」只搬全局收得下的键；
   运行中会话不热更默认配置、服务商 URL 改动后 preset 层不刷新两条记
   deferred。

## 落地

```text
effective = preset_options ⊕ defaults ⊕ advanced_overrides ⊕ session(reasoning_effort)
```

- **Core**：新模块 `managed_model_layers.rs` 是权威（六个可全局键、五档
  公共子集、合并函数、`null` 墓碑、默认值校验）。`managed_models` 加
  `preset_options` 列，`advanced_options` 改义为覆盖；`prefs.
  managed_model_defaults` 存全局。`ManagedModelRecord` 新增 `presetOptions`
  / `advancedOverrides`，`advancedOptions` 保持「生效值」语义，runner /
  探测 / pill 零改动。新命令 `get_managed_model_defaults` /
  `set_managed_model_defaults`（写后重生成 managed-models.json）。
  `save_managed_model` 的两层都是「省略即保留」：GUI 子代理审出「只翻默认
  标记的保存会清空覆盖」，改成与 preset 层对称。Agent API 不吐这些字段，
  schema 不动。外置 GA 零变化。
- **迁移 042**（纯 SQL，json1 的 `->` 保住布尔 / 数字类型）：preset 列 =
  整份旧快照；覆盖 = 六个分层键里**不等于出厂值**的那些（等于出厂的留
  在 preset 里已经生效，写成覆盖会让没动过的用户看到「N 项覆盖」并遮住
  以后的全局值），再剔除一方直连的种子 `high`（Codex 为 `high` /
  `medium`，Core 只认这三个 URL 字面量）；所有对象行都带且值一致的键上提
  到全局并从各行删除（推理强度只认五档）；已有 `managed_model_defaults`
  时不上提。不变量「逐行生效值不变」由 `db_writes_test.rs` 用真实读路径
  断言。六处手写迁移列表全部补上。
- **GUI**（Opus 子代理按契约实现，Fable 验收）：纯逻辑进
  `lib/managed-model-layers.ts`（Core 镜像 + 偏离规则 + 上提 + 徽标取值）；
  `AdvancedModelOptions.tsx` 拆成 `ModelAdvancedOptionsPanel`（模型编辑器
  折叠：推理强度三态行在最前、五个分层字段、协议方言字段；头部「跟随默
  认 / N 项覆盖」；继承值墨色淡一档；底部「全部跟随默认」+「设为所有模型
  的默认」）和 `ModelDefaultsPanel`（Settings → 模型 页尾新节「默认高级
  配置」，点击即存，数字框失焦 / 回车才提交）。新建服务商表单撤掉推理强
  度字段。行徽标只在模型层（覆盖或预设）有值时显示。验收时补了一处：
  模型层基线把出厂值垫在最底，否则把显示出来的回退值原样敲回去会留下一
  条覆盖。

## 追加裁决：档位名全小写（同日）

真机验收后 JC 提出对话框选择器已是小写、其余地方该不该统一。核出四类
出现位置三种写法：Composer pill 小写（09-22 为「grok-4.7 high」一句话
定的）、设置里的选择 chip 与 tooltip 首字母大写、模型面板「跟随默认
（high）」原始小写（当天新做出来的不一致）、行徽标 CSS 强制大写等宽
（09-08 为和 Provider chip 区分）。裁决全部小写，行徽标也改：这些词是
`reasoning_effort` 的字面量，`xhigh` 才是真实 token；徽标和 pill 本是同
一个值的两枚状态 chip，此前一大一小。落地只改两个 locale 的七个字符串、
徽标去掉 `uppercase` 与字距、删掉无人调用的 `effortChipLabel`（其注释里
「MED 徽标字形」早已不存在）。翻车点：11px 下两枚灰 chip 靠等宽字体单独
区分，糊了只允许徽标一处回退大写作唯一例外（设计文档已写明）。

## 追加裁决二：删掉「我的模型」行的推理强度徽标（同日）

JC 看真机截图：Provider chip 与强度 chip 同一灰盒、每行都挂、一行三个
盒子太满。先给的方案是「Provider 去容器 + 强度只在偏离默认时显示」，JC
反问既然对话框已有 pill，行上这个是不是可以直接去掉。同意并且更干净：
09-08 加它的理由（同模型不同强度两条条目）当天已否；分层后强度是可继
承配置不是身份；pill 显示生效值加会话覆盖、行徽标只能显示模型层自己的
值，留着就是两个真相。代价是没法扫列表看哪个模型单独改过，兜底是编辑
器折叠头「N 项覆盖」，与上午「行上不加覆盖标记」裁决一致。删掉行徽标、
`modelReasoningEffortTier` / `modelLayerReasoningEffort` 及测试；上一节
为徽标做的小写改动随之只剩 locale 与 pill 部分。Provider chip 真机看过后 JC 裁改
成淡墨文字：紧跟模型名、「·」相连、无容器，盒子只留给「默认」。

## 被否 / 搁置

- 服务商层（B）：JC 裁全局后去掉，三层太重。不进 deferred。
- 面板内模式开关：表单里的模式切换，见上文裁决 2。不进 deferred。
- 页签变体「服务商默认 | 仅此模型」：留作第二轮，见 deferred。
- 预设升级刷新 preset 层：seam 已留（列在），见 deferred。

## 验证

`cargo test --workspace`（含 cli）、`pnpm --dir gui typecheck` / `lint` /
`test`（490，全小写裁决后）、`git diff --check` 全部通过；rustfmt 只格式化本次触碰的
文件。真机视觉验收留给 JC：页尾折叠头一行「N 项已自定义」是否挤、模型
面板继承值淡一档在真机上分不分得清、「设为所有模型的默认」两个按钮并
排是否太满。
