# Galley 文案 austerity 准则

> 这份文档定义 Galley 用户可见文案的**声音**：一种受后期维特根斯坦影响的
> 克制、朴素、操作性的语气。它是 [copy-language-guidelines](./copy-language-guidelines.md)
> 的姊妹文档。
>
> - 本文档管**怎么说**（声音、长度、克制、删字）。
> - `copy-language-guidelines.md` 管**说什么词**（术语边界、Agent vs AI、
>   中文版英文词清单、双层 tab、语言偏好）。
> - 两者冲突时，术语规则优先（术语是契约，声音是风格）。

## 北极星

Galley 的文案像维特根斯坦的《哲学研究》：句子短，没有废字，不寒暄，不
表演，不说教。气质从**删字**里来，不从**加漂亮的词**里来。

维特根斯坦不只是这样写作——他设计的 Kundmanngasse 住宅以近乎严苛的无装饰
著称。无装饰不是冷漠，是把每一处都收拾到只剩必要。Galley 的文案追同一个
东西。

这不是"更文艺"。文艺、精致、端着，恰恰是要避免的——那是维氏说的"语言在
度假"（PI §38），引擎空转。我们要的是冷、准、省。

## 一条不可越过的红线

**清楚 > 简洁 > 气质。** 三者冲突时永远清楚优先。

功能键、错误、审批文案首先要让用户一眼知道**按下去会发生什么**。austerity
是"删到只剩必要"，不是"删到看不懂"。把一个按钮缩成谜语，不是维氏，是失败。

哲学藏在**结构和克制**里，绝不在按钮上贴维特根斯坦。UI 表层永远说人话；
德文、引文、显眼的哲学只属于题词位（empty-state epigraph），不进功能文案。

## 准则

### 1. 能删就删

删掉上下文已经说清的词。输入框已经在对话里，placeholder 不必再说"这个
对话"。

- `继续这个对话…` → `继续…`
- `Continue this conversation...` → `Continue…`
- `历史会话恢复超时` → `恢复超时`
- `Restoring the conversation timed out` → `Restoring timed out`

### 2. 用法即意义（PI §43）

标签说清动作做什么，不用装饰性动词。词的意义是它在使用中的位置，不是它
读起来多漂亮。

- 好：`是的，我知道在做什么`（说的是用户此刻的真实处境）
- 坏：任何"让思绪继续展开"式的表演

### 3. 描述，不说教（PI §66 "别想，去看"）

错误和空状态陈述事实加下一步，不渲染情绪，不寒暄，不道歉腔。删掉修辞性
反问。

- `不知道哪儿出问题了？跑一次完整体检 —— 重新探测 Python 解释器、检查 GA
  路径和必要文件。`
  → `重新探测 Python、检查 GA 路径与必要文件。`
- `首次发送失败，通常是 API key 或配置问题。`
  → `首次发送失败。通常是 API Key 或配置问题。`

### 4. 克制标点与营销腔

- 不用 `!`。
- 不用最高级、不用 "seamlessly / powerful / effortless / 强大 / 极致"。
- em-dash、破折号、省略号都按需，不当语气词撒。
- 中文用全角标点；英文用半角。
- 句子能断成两个短句，就不要用从句堆成一个长句。

（这条与 `copy-language-guidelines.md` 的"避免 SaaS marketing 腔"一致，
这里写死为硬规则。）

### 5. 沉默作为伦理（Tractatus 7）

Galley 的"绝不做"是它的人格核心，保留并打磨成最干净的形态。这类句子是
产品立场，不是免责声明，不要写成法律腔。

- 保留并提纯：`Galley 不会修改你的 GenericAgent。删除 Galley 后仍可独立
  运行。`

不必说的就不说——这本身就是这条准则的应用：不要为了"显得周到"而补一句
多余的解释。

### 6. 一个声音

中文像中文，英文像英文（继承 guidelines），但**各自内部**必须是同一个人
在说话。同一概念的按钮动词和操作后状态用同一套词（已有的审批白名单规则
就是范例）。音色不统一比单句不够好更伤气质。

## austerity 的边界（什么时候不删）

austere 不等于 cryptic。以下场景**保留必要的解释句**：

- **首启 onboarding 的教学正文**：第一次接触的用户需要被带一程，这里可以
  有完整句子。题词位冷峻，教学位可以多说一句。
- **错误的"下一步"**：陈述可以短，但要保留可执行的下一步（"检查 mykey.py"
  这类），不能为了短把出路删了。
- **高风险确认**（自动执行、永久删除）：清楚压倒一切，宁可多一句也要让
  后果无歧义。

## 调子：B（冷峻）

已确认走 **B 方向**：比现有中文 source 更冷、更省、更不寒暄，接近碑刻。
主体提纯到 austere；题词/空状态这类"重音位"允许最接近冷峻；onboarding
教学位和高风险确认按上面的边界保留温度与清楚。

## 既定约定（dogfood 过程中确认，全程贯彻）

这些是文案 review 过程中拍板的具体规则，写死以免后续批次反复纠结：

1. **保留"请"。** 中文报错 / 提示里的"请"作为克制的礼貌保留，**不做全局
   删除**。austerity 体现在删冗词，不体现在去掉基本礼貌。单句精简时若"请"
   恰好冗余可去，但不为 austere 而专门清洗"请"字。
2. **自动执行（原 YOLO）状态统一说"已开启"。** 不混用"已启用 / 模式已开启"。
3. **`API Key` 作字段名统一英文。** 字段标签用 `API Key`（与英文、与
   `显示 API Key` 等一致），不写"模型密钥"；正文叙述里可用「密钥」。
4. **中文用户可见文案用「对话」，不用 `session(s)`。** `session` 仅在
   Settings → Agent 的 supervisor / SOP / CLI 术语语境保留（继承
   `copy-language-guidelines.md`）。

## 落地流程（分批、可逆、逐批过目）

不一次性盲改整个 i18n（2000+ 行、双语、核心表面）。按 UI 区域分批：

1. 每批给出中英对照 before/after。
2. Owner 逐条 y / n / 微调。
3. 通过的批次写进 i18n，跑 `pnpm --dir gui typecheck` + `pnpm --dir gui lint`。
4. 全部批次后整体 dogfood。

建议批次顺序（从重音、低风险，到高频、高风险）：

1. Composer + 全局控件（Send / Stop / Back / Dismiss）
2. Empty state + Onboarding welcome
3. Errors + Toasts
4. Approval
5. Settings 各页
6. Sidebar + TopBar + Command Palette

每批改完，用 dogfood 校准调子，再进下一批。头一两批通常会让 B 的"冷到
什么程度"变得更具体。

## 与既有文档的关系

- 气质定位（文库不是作者、四个承重面、拒绝清单）：见
  [气质总纲](./temperament.md)。本准则是其「语言」承重面的执行规范。
- 排印（怎么排）：见 [typography-principles](./typography-principles.md)。
- 术语、Agent/AI、中文版英文词、语言偏好：见
  [copy-language-guidelines](./copy-language-guidelines.md)。
- 英文逐区域草稿：见 [english-copy-draft](./archive/english-copy-draft.md)。本准则
  通过后，英文改写在该草稿基础上按 B 方向再收紧。
- 题词 / Composer 三寄存器的哲学落点：见
  [2026-06-03 devlog](./devlog/2026-06-03-philosophical-voice-and-austerity-copy.md)。
