# ljqCtrl 使用与坐标转换 SOP

> **must call update working ckp**：`一律使用物理坐标｜禁pyautogui｜操作前先激活窗口`

## 0. API 快速参考 (Signatures)
- `ljqCtrl.dpi_scale`: float (缩放系数 = 逻辑宽度 / 物理宽度)
- `ljqCtrl.Click(x, y=None)`: 模拟点击。支持 `Click((x, y))` 或 `Click(x, y)`
- `ljqCtrl.Press(cmd, staytime=0)`: 模拟按键。如 `Press('ctrl+c')`
- `ljqCtrl.FindBlock(fn, wrect=None, threshold=0.8)`: 找图。返回 `((center_x, center_y), is_found)`
- `ljqCtrl.GrabWindow(hwnd_or_name)`: 前台截图(先Activate), 传hwnd(int)或窗口标题子串(str), 返回PIL Image
- `ljqCtrl.GrabWindowBg(hwnd_or_name, timeout=5)`: WGC后台截图(Win10+)
- `ljqCtrl.MouseDClick(staytime=0.05)`: 鼠标双击
- 可先阅读computer_use.md

## 1. 环境载入
import ljqCtrl

> **macOS**: 用 `import macljqCtrl as ljqCtrl`（Quartz 键鼠与进程内截图）。依赖 `pyobjc-framework-Quartz`/`-Cocoa`；首次用前 `ljqCtrl.check_permissions()` 检查辅助功能/录屏授权。

## 2. 核心：High-DPI 物理坐标换算
`ljqCtrl` 的 `Click/MoveTo` 接口接收的是**物理像素坐标**。
当使用 `pygetwindow` 等其他工具获取窗口位置（逻辑坐标）时，必须除以缩放系数。

- **换算公式**：`物理坐标 = 逻辑坐标 / ljqCtrl.dpi_scale`

## 3. 截图bbox → 屏幕物理坐标（核心公式）
```python
# ui_detect获取的都是物理坐标
# ClientToScreen拿客户区原点(逻辑) → 除dpi_scale得物理偏移
cx, cy = win32gui.ClientToScreen(hwnd, (0, 0))
ox, oy = int(cx / ljqCtrl.dpi_scale), int(cy / ljqCtrl.dpi_scale)
ljqCtrl.Click(ox + (bbox[0]+bbox[2])//2, oy + (bbox[1]+bbox[3])//2)
```
禁止全屏ImageGrab（必须针对窗口），所有逻辑坐标都要转物理。

**macOS (`macljqCtrl`)**：截图用进程内 Quartz；Python 已授权不代表 `screencapture` 子进程可用。`NSBundle.mainBundle().bundlePath()` 定位当前执行应用。区域图内点用 `CropToScreen(bbox, px, py)` 转屏幕物理坐标；dpi_scale 基于主屏，混合DPI多屏未验收。

## 4. 避坑指南
- **⚠️ 一律使用物理坐标**：传给 ljqCtrl.Click/SetCursorPos 的坐标必须是物理坐标（=截图像素坐标）。禁止传入逻辑坐标。
- **物理验证**：模拟操作前必须确保窗口已通过 `activate()` 置于前台。
- **坐标对齐**: 物理坐标 = 截图坐标；ljqCtrl 自动处理 DPI 换算，禁止手动重复计算。
- **⚠️ 窗口坐标转换陷阱**：使用 `win32gui.GetWindowRect(hwnd)` 获取的矩形包含标题栏和边框，而截图内容是客户区。点击截图内元素时，必须用 `win32gui.ClientToScreen(hwnd, (0, 0))` 获取客户区原点的屏幕坐标，再加上截图内坐标。禁止直接用 GetWindowRect 左上角 + 截图坐标。**同理禁止 `DwmGetWindowAttribute(hwnd, 9, ...)` 取窗口矩形替代 ClientToScreen，它也包含标题栏/阴影。**
- **点击验收**：局部diff=0或AXClick=False未必失败；看控件值/焦点/截图，勿盲重试。
- **⚠️ win32 DPI 坐标陷阱**：未调用 `SetProcessDPIAware()` 时，`GetWindowRect/ClientToScreen/GetClientRect` 等拿到的窗口/客户区坐标通常是**逻辑坐标**，必须进行换算！
- **文本输入**：先聚焦输入框。Windows 无 TypeText/SendKeys，用 `pyperclip.copy('文本'); ljqCtrl.Press('ctrl+v')`；macOS 用 `ljqCtrl.TypeText('文本')`。

## 5. macOS：优先 AX 控件定位，不可用再走图像识别
> **首选封装**：`AXElements(pid或bundle_id或app名)` 返回控件树及物理坐标；`AXFind(...,enabled_only=True)` 过滤可用控件；`AXClick(node)` 优先 AXPress，失败回退坐标点击。
AX 封装不可用时，可用 `osascript` / System Events 的 `entire contents` 枚举**所有窗口**，按 role/description 定位后执行 `AXPress`。
- **关键坑**：弹窗/详情卡常是**独立子窗口**，`front window` 只返回主窗（如红绿灯按钮）。必须 `every window` 遍历 + `entire contents`，否则找不到目标控件。
- 控件常自带语义化 `description`/`identifier`（如 `xxx_button_more`），按 description 精确匹配比坐标稳定，枚举一次记下目标标识即可复用。
- **坐标换算**：原生 AX 返回逻辑坐标，须除以 `dpi_scale`；`AXElements/AXFind` 已返回物理坐标，勿重复缩放。`AXPress` 无需坐标；失效时重新定位，再用物理坐标 `Click`。
- **失焦陷阱**：点击坐标若落在窗口边界外，会点到背后别的 app 导致目标失焦。osascript `tell application "<App>" to activate` 比 ljqCtrl 的 ActivateApp 更可靠，激活后用 `frontmost` 确认。