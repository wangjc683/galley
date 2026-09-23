# 折叠头行内分层：数字提墨、气味段降档、改文件排最前

Date: 2026-09-23
Status: implemented; variant switcher live-tested on JC's desktop the same day,
files + v2 picked; switcher removed; static gates green; unreleased
Related: [conversation design §TurnMarker](../design/conversation.md),
[run fold PRD §3](../../.scratch/conversation-run-fold/PRD.md),
[09-16 步号淡一档与参考件对表](./2026-09-16-step-marker-recede-and-reference-audit.md),
[08-06 run fold](./2026-08-06-conversation-run-fold.md)

## 起因

JC 截图「› 9 步 · 用时 2 分 27 秒 | 执行网页脚本 ×5 · 读取网页 ×3」：整行
比较平，所有信息在同一视觉层级，问能否按用户体验和真实需求再优化。

## 先对齐的旧裁决（不重提）

- 09-16 真机 A/B：结构段整段 ink-soft + medium（「把手比列表深」）被否，
  08-06「安静眉头」维持。
- 08-06 第四轮：「用时」防「2 步 · 16 秒」误读成「2 分 16 秒」；时钟图标、
  耗时前置当场否。
- 08-06 第三轮：整行 ink-muted，affordance 靠行首三角 + 悬停，不靠静息墨重。

所以这次的层级只能靠「压后半段」或「只动数字」，不能整段加深。

## 数据（08-01 起 96 个多步 run）

- 步数中位 5、p90 14；用时中位 77 秒、p90 4.7 分——两个数真在变，是一眼
  能读出这段多大的信息。
- 气味段：`{执行网页脚本, 读取网页}` 22、`{运行代码}` 19、`{执行网页脚本}` 11，
  三种签名占 54%，大多只在说「上网了 / 跑代码了」；中位 14 字，>40 字的
  只 7 个，截断不是问题。
- 少而有意义的信号：改文件 11 个（11%），提问 3 个；按次数降序时改文件
  常落在队尾（10 / 11 个 run 的位置会因「改文件优先」而变化）。
- 选项里否掉的：气味段降透明度（ink-muted 70% 对 `#faf9f8` 粗算约 2.3:1，
  12px 字不可读）。

JC 自述用法：主要看时长，步数扫一眼，工具调用正常不细看。

## 切换器（dev-only，已拆）

两轴：层级 v0 现状 / v1 气味段降到 `--conversation-tool-label-size`、竖线
两侧 12px、`×N` 等宽 / v2 = v1 + 只有数字 ink-soft；气味 full 现状 /
files 改文件排前 / signals 只留改文件、提问、拒绝（泛工具名全拿掉）。

我的推荐一路是 v1，files 我判为最弱（「调整一段你不读的文字的顺序没意义」），
建议实测只比 full 与 signals。

## 裁决（JC 真机）：files + v2

- **v2 ≠ 09-16 被否方案**：那次是整段加深并加粗，把手压过列表；这次字重
  不变、「步 / 用时 / 分 / 秒」仍 muted，只有数字提一档，行仍是安静眉头，
  视线在数字上有落点——对上 JC「看时长、扫步数」的用法。日后别把它当成
  09-16 的翻案或再往「整段加深」推。
- **files 胜 signals，我的论证漏了一层**：我只算了「读不读」。JC 真机上
  files + v2 最舒服；我事后的理解是气味段不被逐字读、而被当纹理扫（「上网
  那种 / 跑代码那种」），signals 拿掉纹理行就空了，files 保住纹理又让稀有
  的改文件落在竖线后第一位（这条是我的解读，不是 JC 的陈述）。
- 数字 span 自带墨色，行级 `hover:text-ink` 继承不到——用具名 `group/fold`
  跟随悬停提墨（同日 TurnMarker 死样式的同一教训）。
- 拒绝徽标随气味段一起降到 11px，保留 warning 色——颜色已够醒目。
- live 变体「已完成 N 步」同样适用。

不做：「修改文件」再提 ink-soft（一行的强调名额留给数字，位置已是强调；
无启动信号，不进 deferred）。

## 验收时看的三处

1. live run：静止的「已完成 N 步」数字比思考行的跳动计时（ink-muted）深，
   是否抢活体信号的注意力。
2. 深色：ink-soft 与 ink-muted 差距更大（`#c6bdb2` / `#92897d`），数字
   是否跳过头。
3. 大字号档 + 窄窗：12px / 11px 基线是否仍齐。

纯前端渲染，内置 / 外置两种运行时模式零差异。
