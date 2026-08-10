# 社区 issue 分批落地与 Settings 打磨（通知音 / 反馈通路 / 运动修复）

日期：2026-08-09 ~ 2026-08-10

## 背景

同一位 Windows 重度用户（v0.4.4 托管运行时，会话数 60+）一天内提了五个
GitHub issue（#14–#18），质量很高。triage 结论：#16/#17/#18 同属「通知通
道只做了一半」主题，打包成一批；#15 反馈通路拆层推进；#14 否决。落地过程
中顺带修掉了三处 Settings 的入场运动缺陷。

## 通知音（#17 修复 + #16 一期 + #18 一期，commit 674302b4）

- **静音根因**：`sendNotification` 未传 `sound` 字段——Windows toast 生成
  `<audio silent="true"/>`，macOS banner 同样默认无声。不是 Windows 特有。
- **三音调而非五 kind**：`SystemNotifyKind` 有五种，但用户靠听觉分辨的是
  **结局**（done / needsYou / alert），不是事件源。映射表见
  `notify.ts` 的 `KIND_TONE`；goal 失败共用 `goalEnd` kind 但用 tone
  override 发警示音。
- **省略 sound 即静音**：新 pref `notify_sound` 关闭时不传 sound 字段，
  恰好还原两平台的原生静默行为——开关的关位就是修复前的现状。
- **UA 嗅探而非引入 plugin-os**：认错平台的后果只是退回静音现状，为三个
  字符串加一个插件依赖不值。
- #18 一期：approval 通知正文补上会话名（replyDone/askUser 早已带）。
- 未验证项：Windows 真机实际发声，留给下次 Windows smoke。

## health `ga_path` 警级按运行时分流（commit 8c8af5a9）

托管运行时用户的 `gaPath` 未设置是常态配置，却一直收到
warn +「finish Onboarding to attach a GA install」——这次五个 issue 的环境
表全带着这条误导。改为查 `active_runtime_kind`：managed → ok，external →
保留 warn。查询失败按 managed 处理（与新库默认一致）。Agent API 数据级
修正，无 schema 影响。

## 反馈通路（#15 收缩版，commits 8c8af5a9 / f11b5888 / e1996510）

裁决过程记两笔反转，都有依据：

- **入口位置裁决（B+A+D，否 C）**：Settings 独立「报告问题」tab 为主承载
  （B）+ 系统惯例位（D：macOS Help 菜单改名 Report an Issue… 指向
  /new/choose、托盘新增同名项）。否掉主界面常驻按钮（C）：反馈是低频出站
  动作，配不上一级 chrome；Sidebar footer 语义纯净不该塞出站链接。原则：
  入口放在「想反馈时会去找」的路径上，不放在「不想反馈也天天看见」的地方。
- **About 区块的加了又删**：A 方案（About 内独立区块）落地后 JC 判断与紧
  邻的 Feedback tab 重复，删除（e1996510）。About 回归纯 colophon。教训：
  同一 Settings 侧栏内相邻两项互指是冗余，跨面（菜单/托盘 vs Settings）
  多入口才有价值。
- **环境卡形态：载荷预览而非 label-value 表**：与 Runtime → 高级诊断的
  双胞胎观感问题，靠拉开**语义角色**解决——Runtime 是装机诊断仪表盘
  （向内、含路径），Feedback 是出站载荷预览（向外、无路径）。monospace
  `<pre>` 逐字显示将被复制/预填的文本，「所见即所发」让隐私承诺可目视
  验证。载荷键名用稳定 ASCII（落进 GitHub issue 的文本不跟 UI 语言走）。
  健康检查未加载完就不进载荷（不复制占位符），detail 字段永久丢弃（含
  本机路径）。
- **预填机制**：GitHub issue forms 支持按字段 id 的 query 参数预填，
  dropdown 需与选项字符串逐字一致——`SettingsFeedback.tsx` 的
  `OS_OPTIONS`/`ENGINE_OPTIONS` 必须与 `.github/ISSUE_TEMPLATE/
  bug-report.yml` 同步维护。
- 配套：仓库新增 bug/feature 表单模板；`health_report` Tauri 命令薄封装
  Core `health()`，与 CLI 同一探针集。

## #14 Retry/Continue 否决

Continue：如无必要勿增实体，可用后续消息近似替代。Retry：设计已论证清楚
（路线 A：Core 删行 + bridge 重启 + 复用 history replay），但成本/收益暂
不划算——方案存入 [deferred](./deferred.md)。注意「打 retry 可近似替代」
只在轮次完成的场景成立；bridge 硬死场景 replay 会丢弃末尾无回复的 user
行，用户需重贴请求——这是将来重启此项的信号。

## Rail 左右侧裁决（不动，右侧）

用户问 Question Rail 该左该右。裁决维持右侧，三条独立理由记入
[conversation.md](../design/conversation.md) 的 Right Question Rail 节：
滚动条家族语义（位置比例型导航惯例在右）、单侧单层级（左侧已有 Sidebar，
避免双 rail）、注意力分区（左缘是回扫路径，右缘是可忽略仪器位）。唯一
真实代价是 Windows 常驻滚动条的拥挤风险，解法是调 inset 不是换边。

## Settings 入场运动三连修（commits 8d87c21f / 99e53634 / b82bcbfd）

同一类根因的三个变体——**从未加载的数据推导视觉状态，数据到达后翻转**：

1. **Channels 闪跳**：Feishu/Telegram 卡的默认展开从 null config/status
   推导出「未配置→展开」，fetch 落地后收回。修法：ready 门槛（双 fetch
   完成前不做自动展开推导）+ 模块级 status/config 缓存（重进首帧即正确）。
   「先折叠后展开是增量出现，先展开后收回是闪跳」。
2. **Models 服务商联动展开**：点开已有模型时 `expandProvider` 展开下方
   服务商卡——行内编辑器时代的残留（新增模型的编辑器仍在卡内，那三处
   展开保留）。顺带修掉 providers 列表的 loading 清屏（stale-while-
   revalidate：store 有数据就画，LoadingRow 仅真正首载）。
3. **软失败穿错误的衣服**：模型列表软失败（Anthropic-compatible 端点无
   /models、非 JSON 响应、列表 404）在文案层早被识别（映射成安抚文案）
   但状态层仍记 `error`，导致同一句话红框+info 双渲染。修法：新
   `modelListProbeFailureState` 把软失败归入与「列表真为空」相同的
   success/no-list 状态（复用既有形态，不发明第三种）；错误映射器删掉
   软分支，安抚文案从此不可能进错误框。404 是最端点特异的状态码，归软；
   401/403/429/5xx 与 model-test 的错误保持红色。

## 本次会话的方法论沉淀

Settings 各 tab 的入场运动缺陷是一个可复用的审查模式：凡「每次进入重新
fetch + 用 loading/null 推导视觉」的地方都值得按「已知状态先画、后台刷
新、增量出现优于回收」原则过一遍。
