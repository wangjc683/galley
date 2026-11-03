"""
本地 OCR 工具
- OCR引擎: macOS默认Apple Vision（pyobjc-framework-Vision）；其他平台rapidocr-onnxruntime
- 输出兼容text/lines/details；bbox为输入图左上原点四角像素，enhance后自动缩回
- macOS截图走macljqCtrl（需要录屏权限）；图片文件OCR不需要录屏权限
- 坑(rapid): result[i][2] conf 是 str 不是 float
- 坑(rapid): 无文字时 result 返回 None 而非空列表
- 坑: enhance 放大+高对比度处理，对清晰文字有害，默认关闭
- 坑(远程桌面): ImageGrab/mss 在 RDP 断开后截图全黑，用 ocr_window(hwnd) 代替
"""
import re
import sys
import os
from io import BytesIO
from PIL import ImageGrab, Image, ImageEnhance, ImageOps

_LANG = 'zh-Hans-CN'
_rapid_engine = None

def _get_rapid():
    global _rapid_engine
    if _rapid_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _rapid_engine = RapidOCR()
    return _rapid_engine

def _preprocess(img, scale=3, contrast=3.0):
    img = ImageEnhance.Contrast(img).enhance(contrast)
    img = img.resize((img.width * scale, img.height * scale))
    return img

def _strip_cjk_spaces(t):
    return re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', t)

def _ocr_rapid(img):
    import numpy as np
    engine = _get_rapid()
    arr = np.array(img)
    result, elapse = engine(arr)
    if not result:
        return {'text': '', 'lines': [], 'details': []}
    lines = [r[1] for r in result]
    details = [{'bbox': r[0], 'text': r[1], 'conf': float(r[2])} for r in result]
    text = _strip_cjk_spaces('\n'.join(lines))
    return {'text': text, 'lines': [_strip_cjk_spaces(l) for l in lines], 'details': details}

def _ocr_apple(img, lang):
    import objc
    import Vision
    import Quartz
    from Foundation import NSData
    aliases = {'zh-Hans-CN': 'zh-Hans', 'zh-CN': 'zh-Hans', 'en': 'en-US'}
    languages = list(lang) if isinstance(lang, (list, tuple)) else [lang or 'zh-Hans']
    languages = [aliases.get(l, l) for l in languages]
    if 'en-US' not in languages:
        languages.append('en-US')
    with objc.autorelease_pool():
        buf = BytesIO()
        img.save(buf, format='PNG')
        raw = buf.getvalue()
        data = NSData.dataWithBytes_length_(raw, len(raw))
        source = Quartz.CGImageSourceCreateWithData(data, None)
        cg = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(languages)
        request.setUsesLanguageCorrection_(True)
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, {})
        ok, error = handler.performRequests_error_([request], None)
        if not ok:
            raise RuntimeError(f'Apple Vision OCR failed: {error}')
        details = []
        w, h = img.size
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if not candidates:
                continue
            candidate = candidates[0]
            box = observation.boundingBox()
            # Apple: normalized bottom-left -> image pixel top-left, rapid-compatible quad.
            x1 = max(0, min(w, box.origin.x * w))
            y1 = max(0, min(h, (1 - box.origin.y - box.size.height) * h))
            x2 = max(0, min(w, (box.origin.x + box.size.width) * w))
            y2 = max(0, min(h, (1 - box.origin.y) * h))
            details.append({'bbox': [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
                            'text': _strip_cjk_spaces(str(candidate.string())),
                            'conf': float(candidate.confidence())})
        lines = [d['text'] for d in details]
        return {'text': '\n'.join(lines), 'lines': lines, 'details': details}


def ocr_image(image_input, lang=_LANG, enhance=False, engine=None):
    """PIL/path -> {text, lines, details}; bbox为输入图左上原点像素四角。
    engine=None: macOS Apple Vision，其他平台rapid；可指定apple/vision/rapid。
    lang支持语言字符串或列表（Apple后端）；enhance默认关闭。
    """
    if isinstance(image_input, (str, os.PathLike)):
        with Image.open(image_input) as source:
            image_input = ImageOps.exif_transpose(source).convert('RGB')
    elif isinstance(image_input, Image.Image):
        image_input = ImageOps.exif_transpose(image_input).convert('RGB')
    else:
        raise TypeError('image_input must be a path or PIL Image')
    original_size = image_input.size
    if enhance:
        image_input = _preprocess(image_input)
    engine = engine or ('apple' if sys.platform == 'darwin' else 'rapid')
    if engine in ('apple', 'vision'):
        if sys.platform != 'darwin':
            raise RuntimeError('Apple Vision requires macOS')
        result = _ocr_apple(image_input, lang)
    elif engine == 'rapid':
        result = _ocr_rapid(image_input)
    else:
        raise ValueError('engine must be apple, vision, rapid or None')
    if enhance:
        sx, sy = original_size[0] / image_input.width, original_size[1] / image_input.height
        for detail in result['details']:
            detail['bbox'] = [[float(x) * sx, float(y) * sy] for x, y in detail['bbox']]
    return result

def ocr_screen(bbox=None, lang=_LANG, enhance=False, engine=None):
    """
    截取屏幕区域并 OCR
    :param bbox: 必填(x1, y1, x2, y2)物理像素坐标，不允许全屏
    :return: dict，bbox相对截图左上角
    """
    if bbox is None or len(bbox) != 4 or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        raise ValueError('Provide a valid region bbox=(left, top, right, bottom)')
    if sys.platform == 'darwin':
        import macljqCtrl as ctrl
        img = ctrl.GrabScreen(bbox)
    else:
        # Preserve the existing non-macOS region-capture implementation.
        img = ImageGrab.grab(bbox=bbox)
    return ocr_image(img, lang, enhance, engine)

def ocr_window(hwnd, lang=_LANG, enhance=False, engine=None):
    """
    截取窗口并 OCR (macOS: macljqCtrl；Windows: PrintWindow支持远程桌面断开)
    :param hwnd: macOS窗口ID或Windows窗口句柄(int)
    :return: dict，bbox相对窗口截图左上角
    """
    if sys.platform == 'darwin':
        import macljqCtrl as ctrl
        return ocr_image(ctrl.GrabWindow(hwnd), lang, enhance, engine)
    import win32gui, win32ui
    from ctypes import windll
    l, t, r, b = win32gui.GetWindowRect(hwnd)
    w, h = r - l, b - t
    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()
    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, w, h)
    saveDC.SelectObject(saveBitMap)
    windll.user32.PrintWindow(hwnd, saveDC.GetSafeHdc(), 3)
    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)
    img = Image.frombuffer('RGB', (bmpinfo['bmWidth'], bmpinfo['bmHeight']), bmpstr, 'raw', 'BGRX', 0, 1)
    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)
    return ocr_image(img, lang, enhance, engine)

if __name__ == "__main__":
    r = ocr_screen((0, 0, 400, 100))
    print(f"识别结果: {r['text']}")
    for line in r['lines']:
        print(f"  行: {line}")
    if 'details' in r:
        for d in r['details']:
            print(f"  [{d['conf']:.3f}] {d['text']}")