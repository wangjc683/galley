"""ljqCtrlBg: concise background window control in client pixels.

Never activates a window, moves the cursor, or injects global input.  Posted
mouse/key messages are best-effort; always verify visible effects by screenshot.
"""
from __future__ import annotations
import ctypes, time
from typing import Any, NamedTuple, Optional, Sequence, Union
import win32con, win32gui, win32ui
from PIL import Image, ImageChops
try:
    ctypes.windll.user32.SetProcessDPIAware()
except Exception: pass

HwndLike = Union[int, str]
SMTO_SAFE = win32con.SMTO_BLOCK | win32con.SMTO_ABORTIFHUNG
CWP_SKIP = win32con.CWP_SKIPINVISIBLE | win32con.CWP_SKIPDISABLED | win32con.CWP_SKIPTRANSPARENT
MOUSE = {"left": (win32con.WM_LBUTTONDOWN, win32con.WM_LBUTTONUP, win32con.MK_LBUTTON),
         "right": (win32con.WM_RBUTTONDOWN, win32con.WM_RBUTTONUP, win32con.MK_RBUTTON),
         "middle": (win32con.WM_MBUTTONDOWN, win32con.WM_MBUTTONUP, win32con.MK_MBUTTON)}
KEYS = {"backspace": 8, "tab": 9, "enter": 13, "return": 13, "shift": 16, "ctrl": 17, "control": 17,
        "alt": 18, "esc": 27, "escape": 27, "space": 32, "pageup": 33, "pagedown": 34, "end": 35,
        "home": 36, "left": 37, "up": 38, "right": 39, "down": 40, "delete": 46, "del": 46}

class CaptureResult(NamedTuple):
    image: Image.Image
    hwnd: int
    backend: str
    client_origin: tuple[int, int]
    client_size: tuple[int, int]
    size = property(lambda self: self.image.size)
    origin_screen_phys = property(lambda self: self.client_origin)
    client_size_phys = property(lambda self: self.client_size)

def ListWindows(visible_only: bool = True) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    def each(hwnd: int, _: Any) -> bool:
        title, vis = win32gui.GetWindowText(hwnd), win32gui.IsWindowVisible(hwnd); rect = tuple(map(int, win32gui.GetWindowRect(hwnd)))
        if (vis or not visible_only) and (title or not visible_only):
            rows.append({"hwnd": int(hwnd), "title": title, "class": win32gui.GetClassName(hwnd), "rect": rect, "visible": bool(vis)})
        return True
    win32gui.EnumWindows(each, None); return rows

def FindWindow(name: str, exact: bool = False, class_name: Optional[str] = None, visible_only: bool = True) -> int:
    needle = str(name).lower()
    for row in ListWindows(visible_only):
        title = row["title"] or ""; ok = (title == name) if exact else (needle in title.lower())
        if ok and (class_name is None or row["class"] == class_name): return int(row["hwnd"])
    raise RuntimeError(f"window not found: {name!r}")

def ResolveHwnd(hwnd_or_name: HwndLike) -> int:
    hwnd = int(hwnd_or_name) if isinstance(hwnd_or_name, int) else FindWindow(str(hwnd_or_name))
    if not win32gui.IsWindow(hwnd): raise RuntimeError(f"invalid hwnd: {hwnd!r}")
    return hwnd

def GetWRect(hwnd_or_name: HwndLike) -> tuple[int, int, int, int]:
    return tuple(map(int, win32gui.GetWindowRect(ResolveHwnd(hwnd_or_name))))

def ClientSize(hwnd_or_name: HwndLike) -> tuple[int, int]:
    l, t, r, b = win32gui.GetClientRect(ResolveHwnd(hwnd_or_name)); return int(r - l), int(b - t)

def ClientOrigin(hwnd_or_name: HwndLike) -> tuple[int, int]:
    return tuple(map(int, win32gui.ClientToScreen(ResolveHwnd(hwnd_or_name), (0, 0))))

def ClientRectScreen(hwnd_or_name: HwndLike) -> tuple[int, int, int, int]:
    x, y = ClientOrigin(hwnd_or_name); w, h = ClientSize(hwnd_or_name); return x, y, x + w, y + h

def ScreenToClient(hwnd_or_name: HwndLike, x: int, y: int) -> tuple[int, int]:
    return tuple(map(int, win32gui.ScreenToClient(ResolveHwnd(hwnd_or_name), (int(x), int(y)))))

def ClientToScreen(hwnd_or_name: HwndLike, x: int, y: int) -> tuple[int, int]:
    return tuple(map(int, win32gui.ClientToScreen(ResolveHwnd(hwnd_or_name), (int(x), int(y)))))

def ChildAt(hwnd_or_name: HwndLike, x: int, y: int, coords: str = "client", deep: bool = True) -> tuple[int, int, int]:
    if coords not in {"client", "screen"}: raise ValueError("coords must be 'client' or 'screen'")
    root = ResolveHwnd(hwnd_or_name); sx, sy = ClientToScreen(root, x, y) if coords == "client" else (int(x), int(y))
    hwnd = root
    while deep:
        cx, cy = win32gui.ScreenToClient(hwnd, (sx, sy))
        child = win32gui.ChildWindowFromPointEx(hwnd, (cx, cy), CWP_SKIP)
        if not child or child == hwnd: break
        hwnd = child
    cx, cy = win32gui.ScreenToClient(hwnd, (sx, sy)); return int(hwnd), int(cx), int(cy)

def _crop_client(hwnd: int, image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size: return image
    wx, wy, _, _ = win32gui.GetWindowRect(hwnd); ox, oy = ClientOrigin(hwnd); w, h = size; dx, dy = ox - wx, oy - wy
    if 0 <= dx and 0 <= dy and dx + w <= image.width and dy + h <= image.height: return image.crop((dx, dy, dx + w, dy + h))
    if image.width >= w and image.height >= h: return image.crop((0, 0, w, h))
    raise RuntimeError(f"capture frame {image.size} smaller than client area {size}")

def _grab_wgc(hwnd: int, size: tuple[int, int], timeout: float) -> Image.Image:
    from windows_capture import WindowsCapture  # type: ignore
    frames: list[Any] = []; errors: list[BaseException] = []
    cap = WindowsCapture(cursor_capture=False, draw_border=False, window_hwnd=hwnd)
    @cap.event
    def on_frame_arrived(frame: Any, control: Any) -> None:
        try: frames.append(frame.frame_buffer.copy())
        except BaseException as exc: errors.append(exc)
        finally:
            try: control.stop()
            except Exception: pass
    @cap.event
    def on_closed() -> None: pass
    control = cap.start_free_threaded(); end = time.monotonic() + float(timeout)
    while not frames and not errors and time.monotonic() < end: time.sleep(0.02)
    if not frames:
        try: control.stop()
        except Exception: pass
        if errors: raise RuntimeError("WGC callback failed") from errors[0]
        raise TimeoutError(f"WGC did not produce a frame within {timeout:.1f}s")
    arr = frames[0]
    if getattr(arr, "ndim", 0) != 3 or arr.shape[2] < 3: raise RuntimeError(f"bad WGC frame shape: {getattr(arr, 'shape', None)}")
    return _crop_client(hwnd, Image.fromarray(arr[:, :, :3][:, :, ::-1]).copy(), size)

def _grab_printwindow(hwnd: int, size: tuple[int, int]) -> tuple[Image.Image, bool]:
    w, h = size; hdc = win32gui.GetWindowDC(hwnd); src = win32ui.CreateDCFromHandle(hdc)
    mem = src.CreateCompatibleDC(); bmp = win32ui.CreateBitmap(); bmp.CreateCompatibleBitmap(src, w, h); old = mem.SelectObject(bmp)
    try:
        ok = bool(ctypes.windll.user32.PrintWindow(hwnd, mem.GetSafeHdc(), 1))
        info, bits = bmp.GetInfo(), bmp.GetBitmapBits(True)
        return Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), bits, "raw", "BGRX", 0, 1).copy(), ok
    finally:
        mem.SelectObject(old); win32gui.DeleteObject(bmp.GetHandle()); mem.DeleteDC(); src.DeleteDC(); win32gui.ReleaseDC(hwnd, hdc)

def GrabWindowBg(hwnd_or_name: HwndLike, backend: str = "auto", timeout: float = 3.0) -> CaptureResult:
    hwnd = ResolveHwnd(hwnd_or_name); size = ClientSize(hwnd); mode = backend.lower(); wgc_error = ""
    if min(size) <= 0: raise RuntimeError(f"empty client area for hwnd={hwnd}")
    if mode in {"auto", "wgc"}:
        try: return CaptureResult(_grab_wgc(hwnd, size, timeout), hwnd, "wgc", ClientOrigin(hwnd), size)
        except BaseException as exc:
            if mode == "wgc": raise
            wgc_error = f";wgc-error={type(exc).__name__}"
    if mode in {"auto", "printwindow", "pw"}:
        image, ok = _grab_printwindow(hwnd, size); label = "printwindow" if ok else "printwindow-best-effort"
        return CaptureResult(image, hwnd, label + wgc_error, ClientOrigin(hwnd), size)
    raise ValueError("backend must be 'auto', 'wgc', or 'printwindow'")

def GrabClientBg(hwnd_or_name: HwndLike, **kwargs: Any) -> Image.Image:
    return GrabWindowBg(hwnd_or_name, **kwargs).image

def _lparam(x: int, y: int) -> int: return (int(x) & 0xFFFF) | ((int(y) & 0xFFFF) << 16)

def _send(hwnd: int, msg: int, wp: int = 0, lp: int = 0, post: bool = True) -> None:
    if post: win32gui.PostMessage(hwnd, msg, int(wp), int(lp))
    else: win32gui.SendMessageTimeout(hwnd, msg, int(wp), int(lp), SMTO_SAFE, 1000)

def ClickBg(hwnd_or_name: HwndLike, x: int, y: int, button: str = "left", coords: str = "client", target_child: bool = True, post: bool = True, interval: float = 0.03, check: bool = True, r: int = 80, wait: float = 0.5) -> bool:
    root = ResolveHwnd(hwnd_or_name); wins0 = {w["hwnd"]: (w["title"], w["class"]) for w in ListWindows(False)} if check else {}; cap1 = GrabWindowBg(root) if check else None
    if button.lower() not in MOUSE: raise ValueError(f"unsupported button: {button!r}")
    if target_child: hwnd, cx, cy = ChildAt(root, x, y, coords)
    else: hwnd, cx, cy = root, *(ScreenToClient(root, x, y) if coords == "screen" else (int(x), int(y)))
    down, up, mk = MOUSE[button.lower()]; lp = _lparam(cx, cy); _send(hwnd, win32con.WM_MOUSEMOVE, 0, lp, post); _send(hwnd, down, mk, lp, post)
    if interval: time.sleep(float(interval))
    _send(hwnd, up, 0, lp, post)
    if check:
        time.sleep(float(wait)); wins1 = {w["hwnd"]: (w["title"], w["class"]) for w in ListWindows(False)}; new = {k: v for k, v in wins1.items() if k not in wins0}; gone = {k: v for k, v in wins0.items() if k not in wins1}; bbox = None
        if win32gui.IsWindow(root): cap2 = GrabWindowBg(root); im1 = cap1.image.crop((max(0, x-r), max(0, y-r), min(cap1.size[0], x+r), min(cap1.size[1], y+r))); im2 = cap2.image.crop((max(0, x-r), max(0, y-r), min(cap2.size[0], x+r), min(cap2.size[1], y+r))); bbox = ImageChops.difference(im1, im2).getbbox()
        print(f"[ClickBg check] changed={bool(bbox)} bbox={bbox} new={new} gone={gone}")
    return True

def Click(hwnd_or_name: HwndLike, x: int, y: int, **kwargs: Any) -> bool: return ClickBg(hwnd_or_name, x, y, **kwargs)

def _vk(key: Union[str, int]) -> int:
    if isinstance(key, int): return int(key)
    s = str(key).strip(); low = s.lower()
    if low in KEYS: return int(KEYS[low])
    if low.startswith("f") and low[1:].isdigit() and 1 <= int(low[1:]) <= 24: return win32con.VK_F1 + int(low[1:]) - 1
    if len(s) == 1: return int(ctypes.windll.user32.VkKeyScanW(ord(s)) & 0xFF)
    raise ValueError(f"unknown key: {key!r}")

def _key_lparam(vk: int, up: bool = False) -> int:
    lp = 1 | (int(ctypes.windll.user32.MapVirtualKeyW(int(vk), 0)) << 16)
    return lp | ((1 << 30) | (1 << 31) if up else 0)

def PressBg(hwnd_or_name: HwndLike, key: Union[str, int], modifiers: Optional[Sequence[Union[str, int]]] = None, post: bool = True, interval: float = 0.02) -> bool:
    hwnd = ResolveHwnd(hwnd_or_name)
    if isinstance(key, str) and "+" in key and modifiers is None:
        parts = [p.strip() for p in key.split("+") if p.strip()]; mods, main = [_vk(p) for p in parts[:-1]], _vk(parts[-1])
    else: mods, main = [_vk(m) for m in (modifiers or [])], _vk(key)
    for vk in [*mods, main]: _send(hwnd, win32con.WM_KEYDOWN, vk, _key_lparam(vk), post)
    if interval: time.sleep(float(interval))
    for vk in [main, *reversed(mods)]: _send(hwnd, win32con.WM_KEYUP, vk, _key_lparam(vk, True), post)
    return True

def Press(hwnd_or_name: HwndLike, key: Union[str, int], **kwargs: Any) -> bool: return PressBg(hwnd_or_name, key, **kwargs)

def TypeTextBg(hwnd_or_name: HwndLike, text: str, interval: float = 0.0, post: bool = True) -> bool:
    hwnd = ResolveHwnd(hwnd_or_name)
    for ch in str(text):
        _send(hwnd, win32con.WM_CHAR, ord(ch), 1, post)
        if interval: time.sleep(float(interval))
    return True

def SetTextBg(hwnd_or_name: HwndLike, text: str) -> bool:
    win32gui.SendMessage(ResolveHwnd(hwnd_or_name), win32con.WM_SETTEXT, 0, str(text)); return True

def GetTextBg(hwnd_or_name: HwndLike) -> str: return win32gui.GetWindowText(ResolveHwnd(hwnd_or_name))

if __name__ == "__main__": print(f"ljqCtrlBg ready; windows={len(ListWindows())}")
