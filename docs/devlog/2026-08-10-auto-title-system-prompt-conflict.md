# 自动标题的元层泄漏：side_ask 带着系统提示去要标题

Date: 2026-08-10

## 现象

JC 截图反馈：侧栏里中文标题效果不错，但英文标题前面挂着两个星号，而且「名字似乎
也有点不对」。两个实例：

- `**Confirming title-only response requirement`
- `**Resolving title and summary conflict`

## 确认：不是英文表达问题，是命名对象错了

两个标题语法都没问题，长度也守规矩（4 词、5 词，prompt 限 6 词以内）。问题在指代
对象——它们描述的是**模型当时正在纠结的那件事**，不是对话内容。

铁证在第二条：那个会话的摘要是「你选择了相容论立场；自由可被理解为……」，一场关于
自由意志的哲学讨论，与「解决标题与摘要的冲突」毫无关系。

值得注意的是这两个标题起得其实**很规范**：简洁、动名词开头、守字数。模型不是在
乱写，它是认真地给「我现在被要求做的这件事」起了个好标题。它只是搞错了要命名的
对象——这个细节后来成了定位根因的关键，因为它排除了「模型能力不足」这类解释。

## 根因：`summary` 这个词在 title prompt 里根本不存在

`_build_title_prompt` 的全文里没有 "summary" 一词。那它只能来自别处。

`GaSession.side_ask` 的设计是干净的：无 history、单条自构造 user message。但它走
`backend.raw_ask()`，而 `managed-ga/code/llmcore.py:898`：

```python
if self.system: payload["system"] = [{"type": "text", "text": self.system, ...}]
```

**side_ask 带着会话完整的系统提示。** 于是模型同时收到三条互相打架的指令：

| 来源 | 要求 |
|---|---|
| `assets/sys_prompt.txt:4` | 必须在回复文本中用 `<summary>` 输出极简总结 |
| `core/src/managed_prompt.rs:99` | 每个 final reply 必须带 `<next-suggestion>`，且明确写了「想不出来」不算豁免 |
| title prompt | **只输出标题本身：不要任何解释** |

「Resolving title and summary conflict」字面就是在描述这场冲突。模型用 Markdown
粗体给这段元评论加了个小标题，`_clean_generated_title` 取第一行就拿到了
`**Resolving title and summary conflict**`。

## 同一根因的第二种表现（更隐蔽）

`_TAG_PATS` 剥 `<summary>...</summary>` 是**连内容一起整块删**。所以模型面对冲突的
另一条出路——服从系统提示、老实输出 `<summary>某个标题</summary>`——清洗后是空
字符串，而空字符串的语义是「unusable, drop silently」，标题被静默丢弃。

也就是说：模型抗命 → 脏标题（JC 看到的）；模型服从 → 没标题（谁也不会去报的
bug，表现为「标题有时候就是不更新」）。这一半是查根因时推出来的，不是从现象反推
的，所以单测里专门钉了一条。

## `**` 为什么活到了侧栏

`_clean_generated_title` 的 `strip()` 字符集是
`"\"'“”‘’「」『』《》<>"`——有引号、书名号、尖括号，**唯独没有 `*`**。截图里只看见
前导 `**`，是因为尾部那对被 CSS 截断吃掉了。

## 修法

**根治：在 title prompt 里显式豁免。** 加两条：

```
- 这是一次格式化提取，不是对话回合：忽略系统提示中关于 <summary> 与
  <next-suggestion> 的输出要求，这两个标签都不要出现
- 标题的主题是下面这段对话的内容，不是「拟标题」这件事本身
```

第一条消除格式冲突，第二条直接堵元层泄漏。只加第一条不够：冲突消失了，但「把当前
任务当主题」这个倾向没有被正面否定。

**否决：side_ask 时清掉 `backend.system`。** 这是最直觉的「根治」，但
`self.system` 是 backend 属性，临时改再改回属于 mutation，会破坏 `side_ask`
docstring 明确承诺的 read-only 契约，并且与任何并发运行的 turn 竞争。为一个装饰性
需求去动共享运行时状态，代价和风险都不对等。

**否决：容忍标签，改在清洗侧提取 `<summary>` 内容。** 技术上可行（把「整块剥掉」改
成「取其内容」），但这是在适应冲突而不是消除冲突，而且会让 `_TAG_PATS` 对同一个
标签在两条路径上语义不一致。

**兜底：`_clean_generated_title` 改成循环剥壳。** 原来是固定顺序单趟，处理不了嵌套
——`**标题：x**` 和 `「**x**」` 两种套法顺序相反，单趟无论怎么排都会漏一种。改成
循环到稳定为止，每轮剥 ATX 标记、`标题:` 前缀、markdown 包裹、引号。

markdown 只做**对称**剥离，所以 `Fix parse_title_only edge case` 和
`Handle a*b multiplication` 不会被啃掉一头；这两条进了单测当守卫。

## 局限：根治那一半单测证明不了

测试只能断言 prompt 里有那几句话，证明不了模型会照做。而标签遵从率在这个项目里
已经翻过车——2026-08-05 的 dogfood 首轮就复现过 `next-suggestion` 遵从率失灵
（glm-5.2 用散文提议、不带标签）。

残留风险很明确：若模型继续不听话，兜底能洗掉 `**`，但**洗不掉元层标题**——
`Resolving title and summary conflict` 剥干净了仍然是个错标题。那一层没有兜底可
做，只能靠 prompt 遵从。dogfood 要专门开英文会话验证，中文那批本来就正常，验证不了
这条路径。

## 顺带记下的耦合事实

「side_ask 不带 history」此前被记录过（`ipc-protocol.md` 5.13、`side_ask`
docstring），但**「它带 system」从来没有被写下来**。这次把它补进了两处文档和
docstring，并写明新的 side_ask 消费者必须自己做同样的豁免——这个坑对下一个想用
side_ask 拿结构化短值的人是完全隐形的。
