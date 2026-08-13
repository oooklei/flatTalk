"""修改tencent-asr容器的app.py，添加OCR端点"""
import re

with open("/app/app.py", "r", encoding="utf-8") as f:
    content = f.read()

# 添加OCR import
if "tencent_ocr" not in content:
    content = content.replace(
        "from tencent_asr import asr_engine, asr_region, transcribe_sentence",
        "from tencent_asr import asr_engine, asr_region, transcribe_sentence\nfrom tencent_ocr import recognize_text\nfrom ocr_schemas import OcrRequest, OcrResponse",
        1
    )
    print("[+] Added OCR imports")

# 添加OCR端点
OCR_CODE = '''
@app.post("/api/v1/ocr/general", response_model=OcrResponse)
async def ocr_general(request: OcrRequest) -> OcrResponse:
    """通用印刷体OCR识别"""
    import time as _time
    req_id = f"ocr_{int(_time.time()*1000)}"
    image_b64 = request.image_base64.strip()
    if not image_b64 and request.image_url.strip():
        try:
            import urllib.request as _urllib_req
            import base64 as _b64
            with _urllib_req.urlopen(request.image_url.strip(), timeout=10) as resp:
                image_b64 = _b64.b64encode(resp.read()).decode()
        except Exception as e:
            return OcrResponse(status="failed", error_code="DOWNLOAD_FAILED",
                             error_message=f"download image failed: {e}", request_id=req_id)
    result = recognize_text(image_b64)
    return OcrResponse(
        status=result["status"],
        text=result["text"],
        error_code=result["error_code"],
        error_message=result["error_message"],
        request_id=req_id,
    )

'''

if "/api/v1/ocr/general" not in content:
    content = content.replace(
        '@app.get("/test", response_class=HTMLResponse)',
        OCR_CODE + '@app.get("/test", response_class=HTMLResponse)',
        1
    )
    print("[+] Added OCR endpoint")

with open("/app/app.py", "w", encoding="utf-8") as f:
    f.write(content)
print("[+] app.py updated")
