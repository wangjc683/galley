# 03 GUI：composer 解锁 + 队列区 + 动作槽变体

Status: ready-for-human
Blocked by: 01

## 内容

1. composer 解锁：running / stopping 不再锁输入与提交；发送路径改走
   Core 统一入口（运行中自动入队）。`isStopping` 只约束停止按钮自身；
   停止期间输入区轻提示「正在停止，你的消息将在停止后自动发出」。
2. 队列区：composer 上方 chips（PRD 定案 3），每条带「插队 /
   删除」；订阅 `session-queue:changed`（仿 useSchedulerSignals 的
   常量 + hook 模式）新建 store 切片。「编辑」= 删除 + 文本回填
   composer。崩溃兜底：队列保留时队首提供「立即发送」（定案 4）。
3. 动作槽三变体 + 常驻切换器 pill（JC 真机实测惯例）：
   a) 有草稿时槽变发送、Stop 退旁侧小钮；b) 槽保持 Stop、Enter
   排队；c) 双钮并排。测完拆切换器，裁决进 devlog。

## 验证

- vitest：store 切片、发送路由（空闲直发 / 运行中入队）、事件应用。
- `pnpm --dir gui typecheck` / `lint`；变体裁决与最终验收 JC 真机做。
