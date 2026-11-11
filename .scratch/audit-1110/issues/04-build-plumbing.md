# 04 构建管道：Windows 安装前钩子、CI 的 sidecar 脚本、format 脚本

Status: needs-dogfood（2026-11-11 v0.7.8 的发版 CI 一次过：三个平台都用 `.mjs` 备好 sidecar，去掉 Setup Python 之后构建照常；只剩 JC 的 Windows 真机验安装前钩子，W1 这一版没做）

来源：2026-11-10 全仓审计，[PRD](../PRD.md) 裁决 A4、C18、C19（JC：「按建议推进」）。

先读 `docs/agents/dispatch.md`、`docs/release-update-sop.md`、`docs/windows-build-checklist.md`。本票不编译 Rust。

## 1. 改哪些文件

- A4：`core/installer/nsis-hooks.nsh`，`docs/windows-build-checklist.md` 里对应的检查项
- C18：`.github/workflows/check.yml`、`.github/workflows/release.yml`、`scripts/prepare-cli-sidecar.sh`（删）、`scripts/prepare-cli-sidecar.mjs` 的头注释、提到 `.sh` 的活文档
- C19：根 `package.json`、`gui/package.json`、`gui/README.md`

## 2. 怎么改

一组一个提交。

**A4 安装前钩子**

钩子用 PowerShell 找安装目录下名叫 `Galley.exe` 的进程来结束。`core/tauri.conf.json` 没设 `mainBinaryName`，主程序是 `galley-core.exe`；CLI 的二进制叫 `galley`，而 PowerShell 的 `-eq` 不分大小写，所以现在被结束的是 CLI。改成同时匹配 `galley-core.exe` 与 `galley.exe`（都限定在安装目录下），安装目录下 `python` 里的 `python.exe` 那一条保持不变。在 Windows 检查清单里加一条：安装器升级时主程序与 CLI 都被结束、升级后两者版本一致。本机验不了，回报里写明。

**C18 CI 统一用 `.mjs`**

`scripts/prepare-cli-sidecar.mjs` 的头注释说它是来替换 `.sh` 的，两份逻辑逐行对应；dev 启动（`core/tauri.conf.json` 的 `beforeDevCommand`）已经在用 `.mjs`。
- `check.yml` 与 `release.yml` 里调用 `./scripts/prepare-cli-sidecar.sh …` 的步骤改成 `node scripts/prepare-cli-sidecar.mjs …`，参数原样。那两个 job 里如果没有 Node，补一步 `actions/setup-node`，版本与本仓库其他 job 用的一致。
- 删 `scripts/prepare-cli-sidecar.sh`；`.mjs` 头注释里「两份保持同步直到 CI 切换」的话删掉；活文档与脚本注释里提到 `.sh` 的地方改掉（`grep -rn "prepare-cli-sidecar.sh"`，不动 `docs/devlog/` 与 `docs/archive/`）。
- `release.yml` 里的「Setup Python」步骤：先确认没有后续步骤用到宿主 Python（`bundle-python.sh` 用自己下载的解释器装依赖），确认后删；有任何一步用到就保留并写进回报。
- 装了 `actionlint` 就跑一遍；没装就写明没跑。

**C19 format 脚本**

根 `package.json` 的 `format` 与 `gui/package.json` 的 `format` 都是对整个 `gui/src` 跑 `prettier --write`，而 `docs/agents/dispatch.md` 规定既有文件只格式化自己的 hunk。两个脚本都删。`gui/README.md` 的门禁清单里去掉它、补上 `pnpm test`，并写一句格式化单个文件的做法：`pnpm --dir gui exec prettier --write <file>`。其他活文档里教人跑 `pnpm format` 的地方一并改掉。

## 3. 验证

```bash
node scripts/prepare-cli-sidecar.mjs --profile debug     # 本机能跑通（会编 CLI，属于本票唯一的 cargo 调用）
node scripts/check-docs-links.mjs
pnpm --dir gui typecheck
git diff --check main..HEAD
grep -rn "prepare-cli-sidecar.sh\|pnpm format\|gui format" . --include="*.md" --include="*.yml" --include="*.json" --include="*.mjs" --include="*.sh" | grep -v "docs/devlog\|docs/archive\|node_modules\|\.scratch"
```

最后一条应当没有输出（`.scratch` 里旧票提到的不改）。

## 4. 别动什么

- workflow 里其余步骤、缓存键、矩阵、密钥名；CI 里重复的 `cargo check` / `tsc`（没有裁决）。
- `bundle-python.sh`、`build-managed-ga.sh`（票 07 管）。
- `gui/.prettierrc.json`、eslint 配置。
- `core/tauri.conf.json`。

## 5. 回报格式

按 `docs/agents/dispatch.md`。

## 6. 真机步骤

| 主会话代验 | JC 验 |
|---|---|
| 推送后看 `check.yml` 三个平台的 Core job 用 `.mjs` 通过 | Windows 真机：下次发版的 W1 里，装着旧版并开着应用时运行新安装器，应用被关掉、装完后 `where.exe galley` 指向的 CLI 与应用同版本 |
| 手动触发一次 `release.yml` 的 dry-run，确认到构建产物为止都通过 | |

## Comments

**2026-11-10 合入（主会话）**

- 本机没装 `actionlint`，也没在本票里跑 `.mjs`；`check.yml` 的 Core job 补了一步 `setup-node`。
- 删掉 Setup Python 的依据是读完了它之后的每一步，没有 CI 运行作实证，要靠 dry-run。
- 钩子现在会在复制文件前结束主程序；应用内更新时会不会打断更新后的重启，只有 Windows 真机能确认（检查清单里加了一条）。
- 票外：`release.yml` 里一条注释与 `docs/release-workflow.md` 里一句话仍说「bash-only repo scripts」，已过时，没改。
