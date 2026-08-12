# markdown 纵向节奏挂上字号档位：一个基数 + 倍数派生

日期：2026-08-12
关联：`MarkdownView.tsx`（`PROSE_BASE`）、`conversation-font-size.ts`、
`globals.css`、[design/conversation.md](../design/conversation.md)「纵向节奏」

## 起因

同一轮 [waku 对照](./2026-08-12-inline-code-warm-ink.md)里记下的第二条：
waku 的 markdown 节奏全挂在一个 `block_gap` 上（blockquote 1.0× / 列表项间
0.5× / 项内块 0.6×），Galley 是十几处硬编码 `my-3` / `my-3.5` / `mt-5 mb-3`。

原本只当作「不好调」的工程整洁问题。核实后发现**它现在就有偏差**。

## 实际的缺陷

会话字号是三档运行时 token，字号**和行高**都跟着变：

| 档 | body-size | leading | 行盒高 |
|---|---|---|---|
| small | 13.5px | 1.65 | 22.3px |
| standard | 15px | 1.70 | 25.5px |
| large | 16.5px | 1.75 | 28.9px |

但 `PROSE_BASE` 里每个纵向间距都是固定 px（`[&_p]:my-3` = 12px，三档不变）。
段间距除以行盒高：

```
small 0.54    standard 0.47    large 0.42
```

**用户调大字号——他要的是更松——文档的相对分离度反而掉 23%。**方向和意图
正好相反。平时不易察觉，因为很少有人来回切三档比对。

这是 2026-07-05「块代码硬编码 13px，用户调大字号时代码不跟随」那个教训的
**第二层**：那次修的是尺寸不跟随，这次是间距不跟随。同一个类，只是间距比
字号更隐蔽——字号不跟随一眼能看出来，间距不跟随只表现为"比例感有点怪"。

## 方案

一个基数 `--conversation-block-gap` 随档位注入（10.5 / 12 / 13.5px，
按 standard 档的 0.47 反推并取整），其余全部写成它的倍数。

裁决点是**保留 Galley 现有的间距区分，还是像 waku 一样压成纯倍数**。
JC 定「保留三档区分」。理由：代码块 / 表格比正文多喘一口是有意义的
（它们是嵌入的另一种介质），压平会丢信息。

顺带一个发现：现有的 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 八个值，除以 12
恰好是 1/3、1/2、2/3、5/6、1、7/6、4/3、5/3 —— **本来就是一个以 12 为基数
的六分族**，只是从没被参数化过。所以这次改动不动任何视觉值，纯粹是把既有
阶梯挂到基数上。

## 落地

- `conversation-font-size.ts`：三档各加 `--conversation-block-gap`
- `MarkdownView.tsx`：`PROSE_BASE` 的 p / h1-h4 / ul / ol / li / 嵌套列表 /
  pre / blockquote / hr，以及 `COMPONENTS.table` 的容器，全部换成
  `calc(var(--conversation-block-gap)*N)`；倍数阶梯以表格形式写在
  `PROSE_BASE` 上方注释
- `globals.css`：`:root` 加 12px 兜底

**兜底不是可选的**：`MarkdownView` 也渲染在注入档位变量的根之外
（`TutorialModal`）。变量缺失时 `font-size:var(...)` 只是回退到继承、看着
还行，但 `margin:calc(var(...)*N)` 会 invalid at computed-value time →
margin 归零 → 整个文档糊成一坨。这两种降级行为的差别值得记住。

倍数写成字面量而非 JS 拼接：Tailwind 扫源码文本找 class 候选，模板字符串
拼出来的 arbitrary property 不会被生成。改这块时别图省事抽函数。

## 验证

typecheck / lint / 316 测试全过；另跑一次 `pnpm --dir gui build` 并在产物
CSS 里核对 `margin-block:calc(var(--conversation-block-gap) * …)` 等规则
确实被 emit（arbitrary property + 任意变体的组合值得确认一次，别只信
typecheck）。
