# 2026-07-07 · Managed runtime prompt 打磨：封闭世界作者事实 + 会话启动状态块

> 起因是一次真实幻觉事故：dogfood 中问「Galley 是谁开发的」，模型把
> prompt 里的 `JC Wang` + GitHub handle `wangjc683` 反推成了一个不存在的
> 中文全名「王建成」。诊断出通用规律——**prompt 给了部分事实，模型就会
> 补全剩下的部分**；现有防幻觉条款只覆盖「当前元数据」，没覆盖传记事实。
> 本 session 产物：`core/src/managed_prompt.rs` 重构 +
> `docs/managed-ga-runtime/prompt-composition.md` 重写（准入标准、排除
> 字段台账、条款出处 ledger、dogfood 回归清单）。

## 决策一：作者事实改封闭世界，「神秘」接替简历

- About section 删掉「philosophy background / Wittgenstein」简历行——它对
  用户提问帮助小，反而邀请模型继续丰富作者形象（扩大幻觉面）。
- 作者写法定为 `JC Wang (GitHub: wangjc683) — a somewhat mysterious
  figure`，并声明除名字和项目主页外一无所知（任何语言的全名、生平、
  位置都没有），被追问就直说不知道。
- 关键设计：「神秘」不是趣味装饰，它和封闭世界约束天然互补——给了模型
  一个**叙事上自洽的理由**说「不知道」，比干巴巴的禁令更不容易被绕过。

## 决策二：术语级规则只收一条

评估过把 copy-language 规则（「对话」不用 session 等）放进 runtime
prompt——理由是 runtime prompt 是壳影响「95% 模型写的文字」的唯一杠杆。
Owner 拍板只收产品名一条（写 `Galley`，不做全大写 wordmark），其余不强行
约束。气质红线维持：runtime prompt 不是 persona 层（temperament.md 的
「文库不是作者」定位）。

## 决策三：会话启动状态块（把推诿改成有据可答）

旧条款教模型「不知道版本就让用户查 Settings」——但 Core 明明知道。新增
`compose_runtime_prompt(app_version)`：静态规则末尾拼一个 `## Galley
State` 块（版本 / 平台 / engine 声明），spawn 时由 Core 组装，仍走
`GALLEY_RUNTIME_PROMPT_TEXT` 单一 env seam，runner 零改动。

字段准入四规则（全过才进）：用户会问且答错代价高 / Core 在 spawn 时可靠
知道 / **会话生命周期内不变**（过期状态被自信答出比「不知道」更糟）/
可随每次 API 请求外发无敏感信息。据此排除：当前模型名（`galley llm set`
中途可换）、已连接渠道（Settings 随时开关）、update channel、GUI 语言、
session id、日期（GA core prompt 已注入 `Today:`）。

`prompt_hash()` 只算静态部分——状态块是数据不是行为，版本号变不算 prompt
代际；`galley-runtime-v1` 不升代。

## 静态条款三条准入标准（写进 prompt-composition.md）

会被问到或用到 / 无法从工具或注入状态可靠获得 / 答错代价高。条款应事故
驱动，新条款必须在 ledger 补一行出处。配套七问 dogfood 回归清单——no
telemetry，人工过清单是唯一的 prompt 回归网。

## 体量基线

打磨后 runtime prompt 层实测约 900 token（tiktoken o200k 897 /
cl100k 912；Claude 系估 950–1050）。三大头：Past Galley Conversations
约 45%（两套平台命令占大半）、Browser Control 约 20%、About + State 约
30%。已识别未做的优化：有 Platform 字段后 CLI 命令可只发当前平台那套
（省约 100 token），留给将来模板化时顺手做，现在不值得为它引入复杂度。

## Rejected / Deferred

- **Rejected：注入当前模型名 / 已连接渠道**——中途可变，注入即过期。
- **Rejected：完整 copy-language 规则进 prompt**——只收产品名一条。
- **Rejected：runner 侧 `extra_env_names` 多变量拼接**——Core 端拼好更
  简单，少一个跨进程约定。
- **Deferred：按平台裁剪 CLI 命令段**——等 prompt 模板化需求坐实。
