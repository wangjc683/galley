# 02 上游跟踪 + Runtime 版本审计

Status: ready-for-agent

远程可做,无需实机(版本核对项除外)。

## 跟踪项

- [tauri#15625](https://github.com/tauri-apps/tauri/pull/15625):
  merged 与否、tauri 2.12 发布时间;其中「window-drag 焦点事件修复
  + raw tao window 事件转发」超出 unstable 范围,可能顺带利好标准
  窗口。发布后升级 core 依赖并实机回归。
- [wry#1755](https://github.com/tauri-apps/wry/pull/1755):被标
  ai-slop,大概率被 #15625 取代,低频看一眼即可。
- [tauri#15624](https://github.com/tauri-apps/tauri/issues/15624)
  失败模式 B 是否有 wry 侧独立修复(`WM_ACTIVATE` 处理)。

## 实机核对项(可并入 issue 01 同一次实机)

- WebView2 Runtime 版本:若在 v134 且 < 134.0.3124.68,先更新
  Edge/Runtime 再复测——若直接修好,H3 成立,调查终结。
- 关 DevTools 复测(DevTools 是独立 Chrome_WidgetWin 窗口,
  可能参与焦点路由)。
