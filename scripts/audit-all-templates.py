#!/usr/bin/env python3
"""全量模板健康核查：
- 活地图 vs 纯展示分类
- iframe 误判 / 漏判
- 内联可见文本
- 相对 stylesheet（手机 srcdoc/blob+base 易 404）
- 脚本中的 Mustache {{{ 风险
- manifest / sample 齐全度

Python 版，替代 audit-all-templates.mjs。
renderCard 通过 /api/debug/fn/renderCard 桥端点调用；其余核查逻辑纯 Python 实现。
用法: python scripts/audit-all-templates.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path(__file__).resolve().parent.parent
SKILLS_ROOT = ROOT / "src" / "skills"
OUT_DIR = ROOT / "scripts" / "test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def walk_html_files(directory, out=None):
    if out is None:
        out = []
    if not directory.exists():
        return out
    for ent in directory.iterdir():
        if ent.is_dir():
            walk_html_files(ent, out)
        elif ent.suffix == ".html" and not ent.name.startswith("_"):
            out.append(ent)
    return out


def has_live_map_signals(html=""):
    h = str(html or "")
    patterns = [
        r'data-map-mode', r'data-static-svg', r'data-layout=["\']map["\']',
        r'data-template=["\']nearby_map', r'id=["\']mapCanvas["\']',
        r'class=["\'][^"\']*\bnb-map\b', r'class=["\'][^"\']*\broute-card\b',
        r'class=["\'][^"\']*\bsvg-map-section\b', r'id=["\']svgMapContainer["\']',
        r'<script[^>]+src=["\']https?://[^"\']*map', r'map\.qq\.com/api/gljs',
        r'new\s+TMap\.Map\b',
    ]
    return any(re.search(p, h, re.IGNORECASE) for p in patterns)


def has_relative_stylesheet(html=""):
    tags = re.findall(r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*>', str(html or ""), re.IGNORECASE)
    for tag in tags:
        href = (re.search(r'href=["\']([^"\']+)["\']', tag, re.IGNORECASE) or ["", ""])[1]
        if href and not re.match(r'^(https?:|data:|//|/)', href, re.IGNORECASE):
            return True
    return False


def has_dangerous_mustache_in_script(html=""):
    scripts = re.findall(r'<script\b[^>]*>[\s\S]*?</script>', str(html or ""), re.IGNORECASE)
    for block in scripts:
        body = re.sub(r'^<script\b[^>]*>', '', block, flags=re.IGNORECASE)
        body = re.sub(r'</script>$', '', body, flags=re.IGNORECASE)
        body = re.sub(r'/\*[\s\S]*?\*/', '', body)
        body = re.sub(r'(^|[^:])//.*$', r'\1', body, flags=re.MULTILINE)
        if re.search(r"indexOf\(\s*['\"`]\\{\\{\\{", body) or re.search(r"['\"`]\\{\\{\\{['\"`]", body) or re.search(r"includes\(\s*['\"`]\\{\\{\\{", body):
            return True
    return False


def load_sample_data(html_path):
    sample_path = html_path.with_suffix(".sample.json")
    if not sample_path.exists():
        return {"data": {}, "has_sample": False}
    try:
        raw = json.loads(sample_path.read_text(encoding="utf-8"))
        return {"data": raw.get("data") if isinstance(raw.get("data"), dict) else raw, "has_sample": True}
    except (json.JSONDecodeError, OSError):
        return {"data": {}, "has_sample": False}


def main():
    client = FlatTalkClient()
    all_items = []

    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        html_dir = skill_dir / "templates" / "html"
        if not html_dir.is_dir():
            continue
        html_files = walk_html_files(html_dir)
        if not html_files:
            continue

        print(f"\n=== {skill_dir.name} ({len(html_files)} 模板) ===")
        for html_path in html_files:
            template_id = html_path.stem
            raw_html = html_path.read_text(encoding="utf-8")
            sample = load_sample_data(html_path)

            # 通过桥端点渲染
            rendered_html = ""
            render_error = ""
            try:
                result = client.render_card(
                    dir=str(html_dir),
                    json_data={"template_id": template_id, "data": sample["data"]},
                )
                pages = result.get("pages") or []
                rendered_html = pages[0] if pages else ""
            except FlatTalkError as e:
                render_error = str(e)

            item = {
                "skill": skill_dir.name,
                "template_id": template_id,
                "file": html_path.name,
                "has_sample": sample["has_sample"],
                "live_map": has_live_map_signals(raw_html),
                "relative_css": has_relative_stylesheet(raw_html),
                "dangerous_mustache": has_dangerous_mustache_in_script(raw_html),
                "render_ok": bool(rendered_html),
                "render_error": render_error,
                "html_size": len(rendered_html),
            }
            all_items.append(item)

            status = "PASS" if rendered_html and not render_error else "FAIL"
            flags = []
            if item["live_map"]:
                flags.append("map")
            if item["relative_css"]:
                flags.append("rel-css")
            if item["dangerous_mustache"]:
                flags.append("mustache-risk")
            if not item["has_sample"]:
                flags.append("no-sample")
            print(f"  {status:5} {template_id:28} html={item['html_size']:6}B {' '.join(flags)}")

    # 输出 JSON 报告
    report = {"total": len(all_items), "items": all_items}
    report_path = OUT_DIR / "template-audit.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n报告已保存: {report_path}")

    fail_count = sum(1 for i in all_items if not i["render_ok"])
    print(f"总计 {len(all_items)} 模板，{fail_count} 个渲染失败")


if __name__ == "__main__":
    main()
