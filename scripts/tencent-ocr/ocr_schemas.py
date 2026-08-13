"""OCR请求模型（Pydantic）"""
from __future__ import annotations

from pydantic import BaseModel, Field


class OcrRequest(BaseModel):
    """通用OCR请求"""
    image_base64: str = Field(default="", description="纯base64编码的图片数据（不含data:前缀）")
    image_url: str = Field(default="", description="图片URL（与image_base64二选一）")


class OcrResponse(BaseModel):
    """OCR响应"""
    status: str = "ok"
    text: str = ""
    error_code: str = ""
    error_message: str = ""
    request_id: str = ""
