# UI Polish 马拉松：六轮全域界面细节打磨

日期：2026-08-04
范围：Sidebar / Approval Card、Command Palette、更早 + 已归档 Dialog、
定时任务、提示词、header 一族、Conversation + Composer、Settings 全域
产出：`docs/design/polish-checklist.md`（新增的持久规则层）+ 六个 commit
（`eb711e94` → `60205465`）

## 起点与方法论

JC 拿来 [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better)
（一个界面细节 agent skill）问是否有用。评估结论：**内容有价值但不能整包
照搬**——它与 Galley 已有规范有正面冲突（hover 过渡、字面量时长、stagger
入场、scale(0.96) 按压都与 foundations §2.5/§2.7 相抵）。于是采取
「摘录翻译 + 否决记档」路线：

1. 把可采纳的规则翻成 Galley token 语言写成 `polish-checklist.md`
   （P1–P11），冲突条目进「已否决」表防止未来 agent 重新引入；
2. 逐面 audit：产出 findings → JC 逐条裁决 → 落地 → commit；
3. 后三轮（Conversation / Composer / Settings，约 15k 行）改用
   并行子代理按清单筛查候选、主线逐条人工核实的模式——误报率低
   （清单里的白名单和已否决表是关键，喂给子代理后基本不出噪音）。

**没装那个 skill 本体**：它的 review 模式会按自己的 19 条硬标准输出，
压过 Galley 规范。清单是审查镜头，foundations 永远优先。

## 关键裁决（含被否方案）

- **F1 · 键盘 focus ring 暂缓**：`Button`/`IconButton` primitive 缺
  `focus-visible` ring（globals.css 全局剥掉了 outline）。裁决：Galley
  本阶段不面向键盘用户，纯键盘可达性不修；修法（两行）记在清单里。
- **I1 · 0.5px 按压判负**：2026-06-10 devlog 引入的
  `active:translate-y-[0.5px]` 轻按压档（8 处）与 §2.5「整数像素」条文
  冲突。判整数规则胜：非整数倍 DPI 下 0.5px 取整不可预测，且这些控件的
  popover-open 态本就落位 1px。文档与既往决策打架时，谁的技术论证硬谁赢。
- **J7 / K2 · deliberate off-scale 先例**：`composer-submit-ack` 0.36s
  与 `runtime-mode-highlight` 0.9s 两个精调一次性确认动画保留字面量——
  token 制防的是随手字面量，不磨掉精调例外；但每个例外都要记档 +
  「下不为例需同等论证」。K2 顺手修了 keyframe 硬编码浅色品牌色的
  dark 主题 bug（改 `color-mix` 随主题）。
- **G8 · 弹层入场统一选了动**：Dialog 家族原本瞬现（可辩护的原生惯例），
  裁决为全家族统一 `galley-pop-in`（120ms `--ease-pop`）——分三批收齐：
  17 处居中 Dialog → 12 处漏网菜单/popover → ImagePreviewDialog 全屏
  lightbox 唯一除外。
- **transition-colors 家族清零**（第六轮）：focus/状态驱动的补
  `duration-(--motion-fast) ease-firm`，hover 驱动的删 transition 改瞬现。
  这是隐式字面量（Tailwind 默认 150ms）的系统性清理，约 18 处。

## 反复出现的违规模式（数据）

六轮下来命中率最高的四类，未来写新组件时注意：

1. **菜单项圆角不同心**（六批、约 20 处）：`rounded-md + p-1` 容器配
   `rounded-sm` 项——正确值恰是现成的 `rounded-callout`（12−4=8）；
2. **hover 带过渡**（palette cursor、定时任务行按钮、问题导航点、
   单选圈等）——§2.5 红线,但存量代码里持续出现;
3. **实时变化的数字缺 `tabular-nums`**(约 15 处);
4. **token 制之前的存量字面量**(palette CSS、runtime 高亮等 2026-07-16
   之前的代码)。

另有两个「只升不降」的按压破缺(MessageUser 图片瓦片 hover 抬升无下沉、
审批 select 无下拉箭头)属于真 UX bug 级别的收获。

## 技术备忘

- 保留 hover 意图延迟但去掉渐显的正确写法是 `duration-0`(delay 依附于
  transition,删 transition 会连 delay 一起删——UserQuestionRail)。
- Tailwind v4 的 translate 工具走 CSS `translate` 属性,与 keyframe 的
  `transform` 独立合成,给居中定位的 Dialog 加 `galley-pop-in` 不会打架。
- BSD sed 的 BRE 不支持 `\|`,批量改 class 用 `-E`。

## 遗留

- 键盘可达性(F1 档,含 button focus-visible ring 两行修复 + PromptCard
  div 化 + 各处 focus-visible ring 透明度不一致)——等有键盘用户诉求。
- 清单「待观察」:PatchView 每行独立横向滚动条(Windows 上验证)、
  `--shadow-composer-stop-pulse` 名不副实可改名。
- 约 436 处 `text-[Npx]` 字面量按既有「touch 时迁移」政策继续。
