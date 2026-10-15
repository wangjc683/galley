# 应用图标的母图

扁平版的木头机器人 G（[主聊天 PRD](../../../.scratch/main-chat/PRD.md) 裁决 70，票 23）。`core/icons/` 下的应用图标、助手头像（`gui/src/assets/galley-icon.svg`）与 README 的图标都从这里出，不要手改生成的文件。托盘图标（`tray-template.png`、`tray-windows.png`）是另画的单色简化版，不从这里出。

## 三个文件

- `galley-icon.svg`：母图。1024 视框（内部坐标 4096），铺满方形、无圆角、无透明边，图形在中心圆内（离中心最远约 0.81 个半径），所以裁成圆角方形或圆都不切到图形。三层：底 `#fcdba9`、墨 `#291a11` 的整体轮廓、木 `#f9c071`。路径是 `scripts/trace-galley-icon.py` 从位图描出来的，不要手改；三个颜色是常量，可以直接改。
- `app-icon-rounded.svg`：Windows、Linux 与商店磁贴用。母图裁成画满画布的圆角方形，圆弧圆角，半径取边长的 23%（换下的旧图标量得 235.8 / 1024）。
- `app-icon-macos.svg`：macOS（`icon.icns`）用，按苹果的 macOS 图标网格：1024 画布里 824 的圆角方形居中，四周各留 100；圆角半径 185.4，连续曲率，用 Figma 的 corner smoothing 60% 近似（Figma 滑杆上标作 iOS 的那一档；算法同开源的 figma-squircle：每个角沿边走 1.6 倍半径，两段三次贝塞尔夹一段圆弧，起点与直边相切、曲率从 0 起）；投影黑 50%、向下 12、模糊 28（高斯标准差 14）。网格与投影参数取自 Apple 开发者论坛对苹果模板的转述（developer.apple.com/forums/thread/670578）。

两个裁切文件用 `<image href="galley-icon.svg">` 引用母图，改母图后不用改它们。

## 重新生成

```sh
pnpm --dir gui install              # 一次即可，提供 Tauri CLI
scripts/render-app-icons.py         # 应用图标、头像资源、README 图标
scripts/render-readme-assets.py     # README 横幅与社交预览图（要无头 Chrome）
```

`render-app-icons.py` 把三个 SVG 各交给 `tauri icon` 跑一次（Tauri CLI 自带 resvg，按每个目标尺寸直接从矢量渲染），只挑各自该出的文件：

| 输入 | 产物 |
|---|---|
| `app-icon-rounded.svg` | `32x32.png`、`64x64.png`、`128x128.png`、`128x128@2x.png`、`icon.png`、`icon.ico`、`Square*Logo.png`、`StoreLogo.png`；`docs/assets/galley-icon.png`（即 256 的 `128x128@2x.png`） |
| `app-icon-macos.svg` | `icon.icns`（条目按类型排序，重跑不产生差异） |
| `galley-icon.svg` | `ios/`、`android/` 整个替换：iOS 铺满方形、不带圆角（系统自己切）；Android 照 Tauri 的默认生成 |

它还把母图原样复制到 `gui/src/assets/galley-icon.svg`（头像，`AssistantAvatar.test.tsx` 检查两者逐字节相同）。文件名、尺寸与 `tauri.conf.json` 的图标列表都同 Tauri 的默认输出，列表不用改。GitHub 仓库设置里的社交预览图没有 API，发版时手动上传 `docs/assets/social-preview.png`。

## 改几何

不手改路径：让图片模型改扁平位图，再重描：

```sh
python3 -m venv /tmp/trace-venv
/tmp/trace-venv/bin/pip install pillow numpy potracer
/tmp/trace-venv/bin/python scripts/trace-galley-icon.py 新位图.png core/icons/master/galley-icon.svg
```

然后照上面重新生成。脚本头部写了描摹的做法与参数。
