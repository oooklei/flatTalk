#!/usr/bin/env python3
"""纯标准库OCR服务 - 调用宿主机tesseract二进制，端口8021"""
import base64
import io
import json
import os
import subprocess
import tempfile
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

TESSERACT_BIN = "/usr/bin/tesseract"


def ocr_image(image_bytes):
    """调用tesseract二进制识别图片文字"""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_in:
        tmp_in.write(image_bytes)
        tmp_in_path = tmp_in.name

    tmp_out_path = tmp_in_path + ".out"
    try:
        # 尝试中英文识别
        result = subprocess.run(
            [TESSERACT_BIN, tmp_in_path, tmp_out_path, "-l", "chi_sim+eng", "--psm", "3"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            # 退回英文
            result = subprocess.run(
                [TESSERACT_BIN, tmp_in_path, tmp_out_path, "-l", "eng", "--psm", "3"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                return "", f"tesseract error: {result.stderr[:200]}"

        # 读取输出
        out_file = tmp_out_path + ".txt"
        if os.path.exists(out_file):
            with open(out_file, "r", encoding="utf-8") as f:
                return f.read().strip(), ""
        return "", "no output file"
    except subprocess.TimeoutExpired:
        return "", "tesseract timeout"
    except Exception as e:
        return "", str(e)
    finally:
        for p in [tmp_in_path, tmp_out_path, tmp_out_path + ".txt"]:
            try:
                os.unlink(p)
            except OSError:
                pass


class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        path = self.path.split("?")[0]
        if path not in ("/ocr/general", "/api/v1/ocr/general"):
            self._json(404, {"status": "failed", "error_code": "NOT_FOUND"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
        except Exception as e:
            self._json(200, {"code": -1, "data": {}, "msg": f"请求解析失败: {e}"})
            return

        image_b64 = data.get("image_base64", "").strip()
        if not image_b64:
            self._json(200, {"code": -1, "data": {}, "msg": "image_base64 为空"})
            return

        try:
            img_bytes = base64.b64decode(image_b64)
        except Exception as e:
            self._json(200, {"code": -1, "data": {}, "msg": f"base64解码失败: {e}"})
            return

        t0 = time.time()
        text, err = ocr_image(img_bytes)
        elapsed = time.time() - t0
        text = (text or "").strip()

        # 响应格式与 app.js handleOcrNormalize 兼容：
        #   成功: {"code": 0, "data": {"text": "..."}, "msg": "success"}
        #   失败: {"code": -1, "data": {}, "msg": "错误描述"}
        if text:
            self._json(200, {
                "code": 0,
                "data": {"text": text},
                "msg": "success",
            })
        else:
            self._json(200, {
                "code": -1,
                "data": {},
                "msg": err or "OCR 未识别出文字",
            })
        print(f"OCR: {len(img_bytes)} bytes -> {len(text)} chars ({elapsed:.1f}s)")

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "engine": "tesseract", "version": "4.1.1"})
        else:
            self._json(200, {"status": "ok", "service": "ocr"})

    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print("OCR service (tesseract) starting on :8021")
    server = HTTPServer(("0.0.0.0", 8021), OCRHandler)
    server.serve_forever()
