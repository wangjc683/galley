# 04: 📎「引用文件…」picker 入口

Status: done（2026-07-29 实现完成；typecheck/lint/vitest 全过。📎 在支持
图片的运行时变为两项菜单（添加图片 / 引用文件…），在 external 运行时
退化为单击直达引用文件对话框（且按钮不再隐藏——路径引用全运行时可用）。
经「引用文件…」选中的任何文件（含图片）一律作路径引用——菜单项已显式
承载意图，不按扩展名改道。手工验收并入 JC dogfood。）
Blocked by: 03

## 范围

- 📎 附件按钮（`ComposerAttachButton.tsx`）从单一"选图片"扩展为菜单：
  现有"图片"入口不动，新增「引用文件…」。
- 「引用文件…」经 `@tauri-apps/plugin-dialog`（已在依赖）打开原生
  文件选择器（multiple），返回路径走 03 的同一段占位符插入逻辑。
- v1 picker 只选文件；**文件夹引用走拖放**（原生对话框难以同时多选
  文件+目录，不为此做两个入口，需求出现再加「引用文件夹…」）。
- 文案遵循 `docs/copy-language-guidelines.md`；i18n key 补齐。

## 验证

- 手工：picker 选单/多文件 → 占位符 → 发送展开正确；取消对话框无副作用。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`。
