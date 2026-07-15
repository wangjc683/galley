# GenericAgent Desktop 测试 TODO

## 目标

目前打算采用 git action 构建发布版，本轮测试主要关注三个结果：

1. 测试者优先验证已有 Release 产物是否能在目标系统运行。
2. 若 Release 产物不可用，再记录失败原因，并考虑本地构建或调整 GitHub Action 构建方法。
3. Release 产物能启动后，再做核心功能兼容性测试。

---

## 系统覆盖

重点测试 Windows 和 Linux；

| 优先级 | 系统 | 架构/版本 | 测试员 | 状态 | 备注 |
|---|---|---|---|---|---|
| P0 | Windows 11 | x64 | 无 | 开发过程中已测试 | 当前最优先 Windows 环境 |
| P0 | Windows 10 | x64 | 杨航 | TODO | 常见 Windows 环境 |
| P0 | Ubuntu 24.04 LTS | x64 | 张景铭 | TODO | 当前常见 Linux LTS |
| P0 | Ubuntu 22.04 LTS | x64 | 张景铭 | TODO | 仍然常见的 Linux LTS |
| P1 | Debian 12 | x64 | 曹兮 | TODO | 可选，覆盖 Debian 系 |
| Owner | macOS | Apple Silicon 或 Intel | 杨航 | TODO |  |


---

## 每个系统需要完成的任务

### 任务 1：下载并验证已有 Release 产物

测试员优先使用已有 Release，不要求先在本机生成程序壳。

当前测试 Release：

```text
https://github.com/dd3xp/GenericAgent_Desktop/releases/tag/desktop-windows-test-3-1
```

当前资产命名：

```text
GenericAgent-Desktop-Windows.exe
GenericAgent-Desktop-Linux.AppImage
SHA256SUMS.txt
```

测试步骤：

1. 下载对应系统的 Release 产物和 `SHA256SUMS.txt`；
2. 启动环境配置脚本
3. 运行程序壳；
4. 记录是否能打开主界面、是否能连上本地 bridge/后端；

环境配置脚本 Windows 可参考：

```powershell
# 在仓库根目录执行
.\frontends\desktop\packaging\scripts\windows\install_windows.ps1
```

环境配置脚本 Linux 可参考：

```bash
chmod +x frontends/desktop/packaging/scripts/linux/install_linux.sh
./frontends/desktop/packaging/scripts/linux/install_linux.sh --mode PrepareOnly
chmod +x GenericAgent-Desktop-Linux.AppImage
./GenericAgent-Desktop-Linux.AppImage
```

说明：Linux 脚本 `frontends/desktop/packaging/scripts/linux/install_linux.sh` 目前作为参考实现使用，已在 Ubuntu 24.04.4 LTS x64 上做过初步试用，但仍需按清单做完整验证。脚本核心做法是准备运行环境，并写入用户级桌面配置（如 `~/.ga_desktop_settings.json`），让程序壳能找到 `project_dir`、`python_path` 和 bridge 脚本。

### 任务 2：Release 不可用时的升级路径

如果 Release 产物在目标系统不可用：
1. 如果只是目标机缺少运行环境，优先修正环境配置脚本；
2. 如果 Release 产物本身不兼容，尝试在目标系统本地构建；
3. 如果本地构建可行，再考虑修改 GitHub Action 的 Linux/Windows 构建方法，让 CI 产物与本地成功产物保持一致。

### 任务 3：核心功能兼容性测试

Release 产物可以启动并连上后端后，再根据 `frontends/desktop/packaging/CHECKLIST.md` 测试不同平台下的界面和核心功能兼容性。

---
