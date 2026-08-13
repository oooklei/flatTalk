#!/usr/bin/env python3
"""独立模板渲染测试 — 旅居路线 + 周边资源。
直接用模板自带默认数据渲染每个模板（不经过对话路由/场景识别）。

Python 版，替代 render-all-templates.mjs。
输出：src/public/template-render-test.html（独立测试页面，含iframe预览）
用法: python scripts/render-all-templates.py
"""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent

GROUPS = [
    {"name": "旅居路线", "skill": "travel_route", "dir": ROOT / "src" / "skills" / "travel_route" / "templates" / "html", "color": "#FF7826"},
    {"name": "周边资源", "skill": "find_service", "dir": ROOT / "src" / "skills" / "find_service" / "templates" / "html", "color": "#1FA97E"},
]

DEPRECATED = {"sojourn_route"}
GHOST_TEMPLATES = {"find_service": ["worker_profile", "org_profile", "order_status", "order_preview"]}


def detect_features(html_str):
    return {
        "hasSvg": bool(re.search(r"<svg[\s>]|viewBox|static_svg|data:image/svg", html_str or "", re.IGNORECASE)),
        "hasImg": bool(re.search(r"<img[\s>]|data-spot-img|background-image|url\(['\"]?/|url\(['\"]?data:", html_str or "", re.IGNORECASE)),
        "hasMap": bool(re.search(r"TMap|map\.qq\.com|tencent|腾讯地图", html_str or "", re.IGNORECASE)),
        "hasEmoji": bool(re.search(r"[\U0001F300-\U0001F9FF]|[\u2600-\u27BF]|[\u2190-\u21FF]", html_str or "")),
        "hasGradient": bool(re.search(r"linear-gradient|radial-gradient", html_str or "", re.IGNORECASE)),
        "size": len(html_str or ""),
        "unresolvedVars": len(re.findall(r"\{\{[^}]+\}\}", html_str or "")),
    }


def check_fields(html_str, required, default_data):
    results = {}
    for f in required:
        has_placeholder = f"{{{{{f}}}}}" in html_str or f"{{{{{{{f}}}}}}}" in html_str
        has_default = bool(default_data and default_data.get(f) is not None and default_data.get(f) != "" and not (isinstance(default_data.get(f), list) and len(default_data.get(f)) == 0))
        results[f] = {"filled": not has_placeholder, "hasDefault": has_default}
    return results


def render_one(client, group, template):
    """渲染单个模板，返回 (html, method, reason, error, matched_id)。"""
    use_preview = group["skill"] == "travel_route"
    try:
        if use_preview:
            result = client.render_preview(dir=str(group["dir"]), template_id=template["id"])
            return result.get("html", ""), "preview", "原页渲染", "", template["id"]
        result = client.render_card(
            dir=str(group["dir"]),
            json_data={"template_id": template["id"], "data": template.get("defaultData") or {}},
        )
        pages = result.get("pages") or []
        return (pages[0] if pages else ""), "renderCard", result.get("reason", ""), "", result.get("templateId", template["id"])
    except FlatTalkError as e:
        return "", "preview" if use_preview else "renderCard", "", str(e), template["id"]


def generate_report(all_items):
    pass_n = sum(1 for r in all_items if r["status"] == "PASS")
    warn_n = sum(1 for r in all_items if r["status"] == "WARN")
    err_n = sum(1 for r in all_items if r["status"] == "ERROR")
    ghost_n = sum(1 for r in all_items if r["status"] == "GHOST")
    groups = sorted(set(r["group"] for r in all_items))

    body = ""
    for group in groups:
        items = [r for r in all_items if r["group"] == group]
        color = items[0]["color"] if items else "#333"
        body += f'<h2 style="border-color:{color}"><span class="dot" style="background:{color}"></span>{group} <small>({len(items)}个模板)</small></h2>\n<div class="card-grid">\n'
        for r in items:
            cls = r["status"].lower()
            f = r["features"]
            feat_icons = "".join([
                "🔷" if f["hasSvg"] else "⬜",
                "🖼" if f["hasImg"] else "⬜",
                "🗺" if f["hasMap"] else "⬜",
                "✨" if f["hasEmoji"] else "⬜",
            ])
            preview_btn = f'<button class="preview-btn" onclick="showPreview(\'{r["skill"]}__{r["id"]}\')" style="background:{color}">预览渲染</button>' if r["html"] else '<span class="no-preview">无法渲染</span>'
            body += f'<div class="card {cls}"><div class="card-head">{html.escape(r["id"])} <span class="feat">{feat_icons}</span></div><div class="meta">{r["method"]} {r.get("reason","")} {"ERR="+r["error"] if r.get("error") else ""}</div><div class="size">{f["size"]}B vars={f["unresolvedVars"]}</div>{preview_btn}</div>\n'
        body += "</div>\n"

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>模板渲染测试</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
h1 {{ color: #FF7826; }}
h2 {{ border-left: 4px solid #333; padding-left: 12px; margin-top: 30px; }}
.dot {{ display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }}
.card-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }}
.card {{ background: #fff; border-radius: 8px; padding: 12px; border: 1px solid #ddd; }}
.card.pass {{ border-color: #4CAF50; }}
.card.warn {{ border-color: #FF9800; }}
.card.error, .card.ghost {{ border-color: #f44336; }}
.card-head {{ font-weight: bold; font-size: 14px; }}
.meta {{ font-size: 12px; color: #666; margin: 4px 0; }}
.size {{ font-size: 11px; color: #999; }}
.preview-btn {{ color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-top: 8px; }}
.no-preview {{ font-size: 12px; color: #999; }}
</style>
</head>
<body>
<h1>模板渲染测试</h1>
<p>PASS={pass_n} WARN={warn_n} ERROR={err_n} GHOST={ghost_n} 总计={len(all_items)}</p>
{body}
<script>
function showPreview(name) {{
  var iframe = document.createElement('iframe');
  iframe.src = '_test_frames/' + name + '.html';
  iframe.style.cssText = 'position:fixed;top:5%;left:5%;width:90%;height:85%;border:1px solid #ccc;border-radius:8px;z-index:9999;background:#fff';
  iframe.onload = function() {{}};
  document.body.appendChild(iframe);
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '关闭';
  closeBtn.style.cssText = 'position:fixed;top:6%;right:6%;z-index:10000;padding:8px 16px;background:#f44336;color:#fff;border:none;border-radius:4px;cursor:pointer';
  closeBtn.onclick = function() {{ document.body.removeChild(iframe); document.body.removeChild(closeBtn); }};
  document.body.appendChild(closeBtn);
}}
</script>
</body>
</html>"""


def main():
    client = FlatTalkClient()
    all_items = []

    for group in GROUPS:
        print(f"\n=== {group['name']} ({group['skill']}) ===")
        try:
            templates = client.discover_templates(dir=str(group["dir"]))
        except FlatTalkError as e:
            print(f"  发现模板失败: {e}")
            continue

        for t in templates:
            tid = t.get("id", "")
            deprecated = tid in DEPRECATED
            tpl_html, method, reason, error, matched_id = render_one(client, group, t)
            features = detect_features(tpl_html)

            status = "PASS"
            if error:
                status = "ERROR"
            elif len(tpl_html) < 300:
                status = "WARN"
            elif features["unresolvedVars"] > 3:
                status = "WARN"

            item = {
                "group": group["name"],
                "skill": group["skill"],
                "color": group["color"],
                "id": tid,
                "file": t.get("file", ""),
                "deprecated": deprecated,
                "status": status,
                "method": method,
                "reason": reason,
                "matchedId": matched_id,
                "error": error,
                "features": features,
                "html": tpl_html,
            }
            all_items.append(item)

            tag = "🗑" if deprecated else ""
            print(f"  {status:5} {tid:28} {tag} html={features['size']:6}B svg={'✓' if features['hasSvg'] else '✗'} img={'✓' if features['hasImg'] else '✗'} map={'✓' if features['hasMap'] else '✗'} vars={features['unresolvedVars']}{' ERR='+error if error else ''}")

        # 幽灵模板
        ghosts = GHOST_TEMPLATES.get(group["skill"], [])
        for gid in ghosts:
            if not any(t.get("id") == gid for t in templates):
                all_items.append({
                    "group": group["name"], "skill": group["skill"], "color": group["color"],
                    "id": gid, "file": "(无HTML)", "deprecated": False, "status": "GHOST",
                    "method": "-", "reason": "manifest存在但无HTML文件", "matchedId": gid,
                    "error": "缺少HTML模板文件",
                    "features": {"hasSvg": False, "hasImg": False, "hasMap": False, "hasEmoji": False, "hasGradient": False, "size": 0, "unresolvedVars": 0},
                    "html": "",
                })
                print(f"  GHOST {gid:28} 缺少HTML文件")

    # 保存独立渲染文件
    frame_dir = ROOT / "src" / "public" / "_test_frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    for r in all_items:
        if r["html"]:
            (frame_dir / f"{r['skill']}__{r['id']}.html").write_text(r["html"], encoding="utf-8")

    # 生成测试页面
    report_html = generate_report(all_items)
    out_path = ROOT / "src" / "public" / "template-render-test.html"
    out_path.write_text(report_html, encoding="utf-8")

    pass_n = sum(1 for r in all_items if r["status"] == "PASS")
    warn_n = sum(1 for r in all_items if r["status"] == "WARN")
    err_n = sum(1 for r in all_items if r["status"] == "ERROR")
    ghost_n = sum(1 for r in all_items if r["status"] == "GHOST")
    print(f"\n=== 汇总 ===")
    print(f"总计 {len(all_items)} 个模板: PASS={pass_n} WARN={warn_n} ERROR={err_n} GHOST={ghost_n}")
    print(f"测试页面: {out_path}")


if __name__ == "__main__":
    main()
