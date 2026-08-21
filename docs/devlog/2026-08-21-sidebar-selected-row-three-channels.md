# Sidebar 选中行：一个通道不够，以及 light 那条零明度差的 bug

日期：2026-08-21
状态：已实现并经 JC 真机变体对比裁决（「明显更喜欢压深 + 抬升质感 + 开淡化」）；
同日续裁 dark 填充取值，见末节「续：能不能和用户消息带统一」
相关：`gui/src/styles/globals.css`（`--shadow-selected` 双主题 token +
light `.chrome-hover-scope` 的 `--color-selected` 覆写）·
`SidebarSessionRow.tsx` · `Sidebar.tsx` ·
`docs/design/layout-and-chrome.md` §sidebar row ·
`docs/design/foundations.md` §2.1 · 兑现并移除 [deferred](./deferred.md)
的「Sidebar selected 行明度持平」

## Context

JC：「sidebar 选中 session 的样式，目前是会有一个背景色，但整个选中的质感还是
偏弱，被选中的应该更出挑，让用户更容易一眼扫过就看到。」

`deferred.md` 里挂着一条 2026-08-07 的条目，启动信号写的是「dogfood 中觉得
选中行『你在这里』不够醒目——出现即证据」。**信号原样命中。** 同一条目还记着
JC 当天真机确认「selected 现状效果 OK」——十四天后改口，改口本身就是数据。

## 诊断：不是不够亮，是没有形状

把行上所有可用的视觉通道列出来，问题就摆在那儿：

| 通道 | 谁在用 |
|---|---|
| **底色填充** | **selected** · hover · warning · error · actionsOpen · isEditing —— **六个状态挤在同一条** |
| 左侧 rail | running（呼吸）· waiting · error |
| 状态图标 | 所有状态 |
| 标题字重 | running / unread / pending / error → semibold |
| subline | running（brand 色）· 各状态文案 |
| **形状**（圆角 / 边距） | 空 |
| **抬升**（shadow） | 空 |
| **边框 / ring** | 空 |
| **标题颜色** | 空（恒为 `text-ink`） |

**选中态只有一条信号，而且选的是全行最拥挤的那条。** running 有四条（呼吸导轨、
图标、semibold、brand subline），blocking 有色相不同的填充 + rail + 图标三方
一致。「你在这里」这个最基础的导航锚点，表达手段最单薄——且与 hover **同类
物质**，只是浓度不同。

所以「质感偏弱」的准确说法是**没有属于自己的通道**，不是不够响。在拥挤通道里
继续加响度，只会让选中读成「更用力的 hover」。

### Light 那一半是真 bug

| | chrome | hover | selected |
|---|---|---|---|
| Light | L\* 94.12 | 90.31（**−3.81**） | 94.14（**+0.01**） |
| Dark | L\* 9.97 | 17.82（+7.85） | 23.48（+13.51） |

Light 下选中行的明度抬升是 **0.01——完全为零**，全靠杏色相撑；而 hover 反向
变暗 3.81。**鼠标划过一行比选中一行更显眼，方向还相反。** 这正是 08-07 那条
deferred 预言的状态。

JC 的分主题实感与数据吻合：「light 和 dark 都弱，不过 dark 相对问题小一点，
只是缺一点质感」——dark 的填充已经清出 ΔL\* 13.5，缺的确实只是第二条通道。

## 变体切换器（临时脚手架，已拆）

三条独立维度，各自可循环切换，写进 `<html data-sel-*>` 由一段临时 CSS 消费：

1. **填充**（仅 light）：现状 / 提亮 `#fff5dc` / 压深 `#e7d8c0`
2. **质感**：无 / 抬升（投影）/ 形状（贴满栏宽 + 直角）
3. **淡化**：关 / 开（未选中标题降 `ink-soft`）

搭之前先算清了一条**不对称约束**，否则测试会白做：light 往亮走只有约 2.6 点
空间（chrome 已在 L\* 94.12，杏色再亮就褪成白），往暗走有约 9 点且能同时提高
彩度。所以两个方向不是对等选项。

测法按「先定填充 → 再定质感 → 最后叠淡化」的顺序，避免 18 种组合把眼睛搞钝；
并特意走两个场景：切走再切回（选中态的主职）、多个 running 行同屏（唯一会四条
信号打架的场景）。

**JC 裁决：压深 + 抬升 + 开淡化。**「形状」变体落选。

## 落地

### 选中态自此占三条通道

1. **底色**——chrome 层专属覆写（见下）
2. **抬升**——`--shadow-selected`，全行唯一一个投影
3. **减法聚焦**——选中行标题保持 `ink`，其余行降到 `ink-soft`

有意不用的两条：**左 rail** 属 running/waiting/error，且**选中行常常同时就是
running 行**，这是本轮最硬的约束，它直接让「左侧实心条」这个最经典的解法变贵；
**标题字重**属 running/unread。

### 填充走 scope 覆写，不动全局

`bg-selected` 全仓 **8 处在 sidebar 之外**（dialogs、button active 态、
composer），它们坐在 app / elevated 上，不该跟着变深。所以沿用 08-07 建立的
`.chrome-hover-scope` 机制给 light 覆写 `--color-selected: #e7d8c0`，与 dark
已有的覆写对称。副作用是正向的：`SidebarQuickActions` 与
`SidebarProjectReview` 里的 `bg-selected` 同样坐在 chrome 上、同样有零明度差
的毛病，一并被治好——这正是 08-07 选 scope 方案而非新增 token 时列的好处。

`#e7d8c0`：ΔL\* **−7.17** vs chrome、**−3.36** vs hover，彩度 ×1.3 保住杏色
不退成暖灰。与 hover 同向但越过它。

### 落地值

`--color-selected`（light，仅 sidebar 内）`#f8edda → #e7d8c0` ·
`--shadow-selected` 新增双主题 token ·
选中行 `bg-selected` → `bg-selected shadow-[var(--shadow-selected)]` ·
标题 `text-ink` → `active ? text-ink : text-ink-soft`

## 撞见一个既有 bug（未修，已记台账）

给 `--shadow-selected` 建 token 后核对产物，发现 **Tailwind v4 为 `@theme` 里的
`--shadow-*` 生成 utility 时会把值内联**，不生成 `var()` 引用：

```css
.shadow-card{--tw-shadow:0 1px 2px var(--tw-shadow-color,#1f1b170a)}
```

写死的是 light 的 `rgba(31,27,23,0.04)`。于是 `html[data-theme="dark"]` 块里
那一整批 `--shadow-*` 重定义，**对所有直写 utility 的调用点完全不生效**——
dark 下拿到的是 light 的淡暖黑（4%）而不是设计意图的纯黑（18%–42%）。

实测影响面：**52 处直写受影响**（dialog / card / menu / tooltip 为主），
**36 处用 `shadow-[var(--shadow-*)]` 写法不受影响**（button、composer、
MessageUser 等）。后者的分布本身是线索——07-16 native-feel 那轮显然已经踩过
这个坑，只是没留下文字。

本轮**只保证自己不踩**：选中行的阴影写成 `shadow-[var(--shadow-selected)]`
而非 `shadow-selected`，并在注释里写明原因。全量修复超出「sidebar 选中行」的
范围，且改完 dark 阴影会**第一次真正生效**、观感必然变重（当年调 dark 阴影值
时很可能就是照着「看不见」调的），需要独立一轮连带复核——已记入
[deferred](./deferred.md)。

## 未动但已标注的观察项

- **减法聚焦对 unread / running 行一视同仁**：未选中行的标题一律降到
  `ink-soft`，包括未读行和运行中的行。字重未动（semibold 仍在），rail /
  图标 / subline 也都还在，所以 triage 信号没有被拿走；但「未读」这一档的
  标题确实比以前淡了。真机裁决时未必正好有未读行同屏，**若日后觉得未读的
  可扫性变弱，这是第一嫌疑**，解法是给 unread 开一个颜色例外，而不是撤掉
  减法聚焦。
- 阴影会被 sidebar 滚动容器裁掉左右各 6px 以外的部分（行有 `mx-1.5`，容器
  `overflow-y-auto` 隐含 `overflow-x` 非 visible）。真机看到的就是裁剪后的
  效果，裁决基于它，不作处理。

## 方法教训

**先数通道，再调数值。** 第一直觉是「选中色不够响，调深一点」，但通道清单
一列出来就看得见：底色那条被六个状态共用，在里面加响度是在一个已经吵的房间里
喊得更大声。真正的解法是给它一条没人用的通道——而「哪条通道空着」是可以客观
列举的，不需要靠审美直觉。

**用户的分主题实感能直接指向病灶层级。** JC 说「light 和 dark 都弱，dark 相对
问题小、只是缺一点质感」，这句话精确对应了两层病因：light 是明度 bug（ΔL\*
0.01），dark 是通道单一。如果只问「够不够醒目」，就得不到这个拆分。

---

## 续：能不能和用户消息带统一（同日）

JC：「是不是可以让选中的背景色和主对话区里面用户消息的背景色统一，现在看
起来它们已经很接近了。」

### 先量化「很接近」

用 OKLab ΔE（经验阈值：<0.01 不可察觉、~0.02 勉强、>0.05 明显）：

| 比较 | ΔE |
|---|---|
| selected 与 brand-tint 本身的差距 | light **0.0263** / dark **0.0266** |
| 「把杏色家族色相归一」能改变多少 | light 0.009–0.010 / dark **0.0026** |
| 参照：本轮已裁决、JC 说「明显更喜欢」的压深 | **0.0622** |

**JC 的直觉准得很精确**：0.026 正好落在「勉强可察觉」档——不够远到读作两个
东西，不够近到读作一个东西，是最膈应的量级。

**同时否掉了我自己差点提出的方案。** 盘点发现 light 的杏沙家族色相是散的
（实色 `brand` / `brand-strong` / `code-ink` 死锚在 H 51 度，三个淡填充散在
62.6–81.5，跨 19 度），看着显然该收敛；但一算改变量只有 ΔE 0.0026–0.010。
**在 C≈0.03 的淡色上色相这个维度基本是废的**，归一了也看不见。教训：
**色相盘点看着离谱不等于视觉上有问题，先算 ΔE 再提方案。**（离群本身记为
体系债：`brand-soft` 是全局 token，哪天有场景需要更饱和的杏，离群就会显形。）

### Light 不能统一，dark 能——这是 chrome 翻转的直接推论

| | Δ vs chrome | Δ vs hover |
|---|---|---|
| dark selected 现值 `#44352a` | +13.51 | +5.66 |
| **dark 统一到 `#4d3b2b`** | **+16.42** | **+8.57** |
| light 统一后 `#f1dece` | −4.54 | **−0.73 ← 撞 hover** |

方向相反不是巧合：dark 的 chrome 现在比 app **亮**，而这些填充往亮走，所以
按 app 标定的 `brand-tint` 绝对明度更高，落到 chrome 上仍高过按 chrome 标定
的 selected；light 每个符号都相反，同一个值就掉到离 hover 只有 0.73 的地方，
选中与 hover 扫视不可分。

### 裁决：取同值，但不绑定

关键是把「统一」这个词捆着的两件事拆开：

- **视觉后果 ≠ 呼应感。** 两块颜色从不在同一视线焦点里并排出现（隔着全高
  ResizeSeparator，形态也完全不同：48px 整行填充 vs 行内 `box-decoration-clone`
  文字带）。所以「同色」这个性质在使用中感知不到，真实可感知的变化只有一条：
  **dark 选中行响 22%、且离 hover 更远。** 这条是好的，采纳。
- **概念后果才是「统一」的真正内容。** 结论是**不绑定**：语义不同（brand-tint
  =「这段话出自你」，一屏重复多次；selected =「你在这里」，全局唯一）必须能
  独立演化；写成 `var(--color-brand-tint)` 会让日后为主区调消息带**意外改掉
  sidebar 选中行**，正是 08-05→08-07 hover 失明那类共用 token 的次生灾害机制；
  而且 light 不绑 / dark 绑会让**规则本身**跨主题不一致，与刚定的「规则统一、
  数值随主题」（content 走极端、chrome 走中间调）相悖。

落地：dark `.chrome-hover-scope` 的 `--color-selected` `#44352a → #4d3b2b`，
作为独立标定值，注释写明「与 brand-tint 同值是标定重合，不是绑定」。

连带复核：`selected→line` 从 +3.31 拉到 **+6.22**（选中填充本就该比分隔线亮），
仍在 `line-strong` 之下 3.12（边框还压得住填充），主区侧零影响。

### 观察项

- **三信号叠加可能过头**：dark 现在是抬升 + 减法聚焦 + 更响的填充，只能真机
  判断。退回成本是一个 hex。
- **两主题的选中行响度更不对称了**（light −7.17 / dark +16.42，均相对各自
  chrome）。考虑到 JC 报告 light 弱得多，方向应该是对的，但记在这里。

### 方法教训（补）

**「统一」这个词会把视觉诉求和工程绑定捆在一起，必须拆开问。** 拆开后这次的
答案是「视觉上照做、工程上不绑」——如果不拆，无论答应还是拒绝都会错一半。
