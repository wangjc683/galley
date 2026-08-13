# 模型配置保存 toast 只查微信/飞书，Telegram-only 用户看不到「重启 Channels」

Status: done
日期：2026-08-13
来源：Discord 方案外审（Codex / gpt-5.6-sol）发现，agent 复核确认。

## 现象

`use-model-config-toast.ts` 的 `Promise.allSettled` 只查询
`wechat` / `feishu` 两个平台的启用状态。只启用 Telegram 的用户保存模型
配置后：toast 不带「重启 Channels」action、文案不含 channels 后缀、
4.2s 就自动消失——但 Telegram supervisor 此时确实在用旧模型配置跑
（staleness 机制本身正常，SettingsIM 里的警告条不受影响，缺的只是
保存瞬间的这个提示入口）。

推测成因：该 hook 写于飞书接入期，Telegram 接入（2026-07-05）时触点
清单漏了它——它是 channels 状态的「第四方消费者」，不在 SettingsIM /
useChannelsStatus 两个常规接线点里。

## 修复

同日已修：`allSettled` 列表补 `getImSupervisorStatus("telegram")`。

## 防复发

将来加任何新 channel（如 Discord），此文件必须进触点清单——
`.scratch/discord-channel/PRD.md` 的触点清单已补记。

## Comments

- 2026-08-13（agent）：一行修复随本 issue 同 commit 落地；
  `pnpm --dir gui typecheck` / `lint` 通过。
