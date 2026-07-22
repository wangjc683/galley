# 网络代理设置(managed 引擎)

Status: needs-triage
日期:2026-07-21
来源:Runtime tab 打磨讨论(JC + agent)

## 问题

桌面应用从 Dock / Finder / 开机自启启动时不继承 shell 环境变量,用户在
终端配好的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`,Galley 引擎进程
(bridge 子进程里的 LLM API 调用)拿不到。症状:"终端里 curl 得通 API,
Galley 里连不上"。国内直连 OpenAI / Anthropic 的用户几乎必然撞上。

现状核实(2026-07-21):代码里没有任何 proxy 相关配置
(`grep -ri proxy core/src runner` 无命中)。Models 的自定义 Base URL
(中转站)只能部分缓解,不覆盖直连 + 代理的用户。

## 方向(待触发后细化)

- 问题域属于 Settings → Runtime(引擎的网络环境),UI 大概率一个输入框
  (代理 URL)+ 可能的 bypass 列表;
- 实现是 bridge spawn 时注入 env(managed 模式;attach 模式下用户自己的
  GA 环境不该被 Galley 改写——Rule 1 边界,需要想清楚 attach 是否适用);
- 待定形态:HTTP / SOCKS 支持范围;全局 vs per-provider;是否读系统代理。

## 触发条件

第一个"应用里连不上 API、终端能连"类用户反馈。在那之前不做——现在做
是在猜需求形态。
