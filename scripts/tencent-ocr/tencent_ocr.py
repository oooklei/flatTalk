"""OCR模块 - 使用Tesseract本地引擎，apt安装速度快。

依赖: tesseract-ocr, tesseract-ocr-chi-sim (中文), pytesseract, Pillow
"""
from __future__ import annotations

import base64
import os
import tempfile
from typing import Any


def recognize_text(image_base64: str) -> dict[str, Any]:
    """使用Tesseract识别图片文字。

    image_base64: 纯base64字符串（不含data:前缀）
    """
    if not image_base64:
        return {"status": "failed", "text": "", "error_code": "EMPTY_IMAGE",
                "error_message": "image_base64 is empty", "raw_result": None}

    try:
        image_bytes = base64.b64decode(image_base64)
    except Exception as e:
        return {"status": "failed", "text": "", "error_code": "BASE64_DECODE_ERROR",
                "error_message": f"base64 decode failed: {e}", "raw_result": None}

    try:
        import pytesseract
        from PIL import Image
        import io
    except ImportError as e:
        return {"status": "failed", "text": "", "error_code": "DEPS_NOT_INSTALLED",
                "error_message": f"pytesseract or Pillow not installed: {e}",
                "raw_result": None}

    try:
        img = Image.open(io.BytesIO(image_bytes))
        # 同时识别中文和英文
        text = pytesseract.image_to_string(img, lang='chi_sim+eng')
    except Exception as e:
        err_msg = str(e)
        if "chi_sim" in err_msg and "not found" in err_msg.lower():
            # 中文语言包未安装，退回英文
            try:
                text = pytesseract.image_to_string(img, lang='eng')
            except Exception as e2:
                return {"status": "failed", "text": "", "error_code": "OCR_FAILED",
                        "error_message": f"OCR failed: {e2}", "raw_result": None}
        else:
            return {"status": "failed", "text": "", "error_code": "OCR_FAILED",
                    "error_message": f"OCR failed: {err_msg}", "raw_result": None}

    text = (text or "").strip()
    return {
        "status": "ok" if text else "failed",
        "text": text,
        "error_code": "" if text else "EMPTY_TEXT",
        "error_message": "" if text else "OCR returned empty text",
        "raw_result": None,
    }
