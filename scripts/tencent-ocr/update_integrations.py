"""更新integrations.json中的OCR配置"""
import json

path = "/app/aiyl/znt/flatTalk/data/integrations.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

for item in data.get("items", []):
    if item.get("key") == "ocr":
        item["base_url"] = "http://10.21.202.9:8020"
        item["test_path"] = "/api/v1/ocr/general"
        item["auth_type"] = "none"
        item["description"] = "腾讯云通用印刷体OCR（GeneralBasicOCR），部署在tencent-asr容器中"
        print(f"Updated OCR: {item['base_url']}{item['test_path']}")
        break

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("integrations.json updated")
