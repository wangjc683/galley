# Desktop组件与源码部署

GA主仓拥有后端与整体分发，独立私有Desktop仓只构建桌面组件。两仓不使用子模块，也不互相复制源码。

## Desktop构建

在Desktop仓手动运行 **Build standalone Desktop components**，选择平台；也可使用 `desktop-component-*` 标签。

| 平台 | 组件产物 | 源码部署位置 |
| --- | --- | --- |
| Windows x64 | `GenericAgent.exe` | `frontends/GenericAgent.exe` |
| macOS ARM64 | `GenericAgent-Desktop-macOS-arm64.zip` | 解压为 `frontends/GenericAgent.app` |
| Linux x64 | `GenericAgent-Linux-x86_64.AppImage` | `frontends/GenericAgent.AppImage` |

UI由Tauri内嵌，不依赖 `frontends/desktop/static/`。组件不包含GA、Python或Python依赖。启动时配置已有GA根目录和Python解释器。

mac组件沿用ad-hoc签名，签名校验失败会中止构建；压缩解压后再次验签。它不是Developer ID签名或Apple公证，首次启动可能需要系统设置中手动允许。当前只构建Apple Silicon，不是Intel或Universal版。保持 `.app` 完整，不修改内部文件。

## 部署与发布

**主仓不配置CI；CI仅在Desktop仓构建桌面组件。**

1. 从Desktop Actions下载对应平台产物，核对SHA256和Desktop commit。
2. 将组件放到上表所列的源码部署路径。mac需完整解压 `.app`，不要修改内部文件。
3. 使用已有GA源码、Python环境与依赖启动桌面。
4. Windows发布沿用现有手工/VPS发布SOP；需要分发mac组件时，使用Desktop CI输出的已签名ZIP。

私有仓Actions下载需要认证，产物保留30天。长期分发使用现有二进制发布渠道，不把私有Actions下载页作为公开下载地址。

Desktop CI不打包GA或Python；主仓不承担自动组装、测试或发布任务。
