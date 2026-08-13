#!/usr/bin/env python3
"""核查模板 iframe 隔离判定：
- 活地图模板应该 iframe 隔离
- 纯展示模板应该内联
- 检查误判（FALSE_POSITIVE / FALSE_NEGATIVE）

Python 版，替代 audit-template-iframe-gate.mjs。
用法: python scripts/audit-template-iframe-gate.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path.cwd()
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


def detect_raw_signals(html_str):
    patterns = {
        "data_map_mode": r"data-map-mode",
        "data_static_svg": r"data-static-svg",
        "data_layout_map": r'data-layout=["\']map["\']',
        "nearby_map": r'data-template=["\']nearby_map',
        "mapCanvas": r'id=["\']mapCanvas["\']',
        "nb_map": r'class=["\'][^"\']*\bnb-map\b',
        "route_card": r'class=["\'][^"\']*\broute-card\b',
        "svg_map_section": r'class=["\'][^"\']*\bsvg-map-section\b',
        "svgMapContainer": r'id=["\']svgMapContainer["\']',
        "script_src_map": r'<script[^>]+src=["\']https?://[^"\']*map',
        "map_qq_gljs": r"map\.qq\.com/api/gljs",
        "new_TMap": r"new\s+TMap\.Map\b",
        "TMap_any": r"TMap\.",
        "map_qq_any": r"map\.qq\.com",
        "static_svg_mustache": r"\{\{\{?\s*static_svg",
    }
    return {k: bool(re.search(p, html_str or "", re.IGNORECASE)) for k, p in patterns.items()}


def load_sample_data(html_path):
    sample_path = html_path.with_suffix(".sample.json")
    if not sample_path.exists():
        return {}
    try:
        raw = json.loads(sample_path.read_text(encoding="utf-8"))
        return raw.get("data") if isinstance(raw.get("data"), dict) else raw
    except (json.JSONDecodeError, OSError):
        return {}


def main():
    client = FlatTalkClient()

    files = []
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir():
            continue
        walk_html_files(skill_dir / "templates" / "html", files)

    report = []
    for file_path in files:
        rel = str(file_path.relative_to(ROOT)).replace("\\", "/")
        parts = rel.split("/")
        skill = parts[2] if len(parts) > 2 else ""
        template_id = file_path.stem
        raw_html = file_path.read_text(encoding="utf-8")
        raw_signals = detect_raw_signals(raw_html)
        raw_hits = [k for k, v in raw_signals.items() if v]
        raw_likely_map = len(raw_hits) > 0

        page_html = ""
        render_error = ""
        after_render_needs = None
        fallback_iframe = None
        fallback_has_visible_text = None

        try:
            card = client.render_card(
                dir=str(file_path.parent),
                json_data={"template_id": template_id, "data": load_sample_data(file_path)},
            )
            pages = card.get("pages") or []
            page_html = pages[0] if pages else ""

            iso_result = client.card_needs_iframe_isolation(html=page_html)
            after_render_needs = iso_result.get("needs_isolation")

            fb_result = client.build_html_fallback(page_html=page_html)
            fallback_html = fb_result.get("html", "")
            fallback_iframe = "gxy-template-card-frame" in fallback_html
            visible = re.sub(r"<script[\s\S]*?</script>", "", fallback_html, flags=re.IGNORECASE)
            visible = re.sub(r"<style[\s\S]*?</style>", "", visible, flags=re.IGNORECASE)
            visible = re.sub(r"<textarea[\s\S]*?</textarea>", "", visible, flags=re.IGNORECASE)
            visible = re.sub(r"<[^>]+>", " ", visible)
            visible = re.sub(r"\s+", " ", visible).strip()
            fallback_has_visible_text = len(visible) >= 8
        except FlatTalkError as e:
            render_error = str(e)

        expect_iframe = raw_likely_map
        mismatch = None
        if after_render_needs is not None and after_render_needs != expect_iframe:
            mismatch = "FALSE_POSITIVE_IFRAME" if (after_render_needs and not expect_iframe) else "FALSE_NEGATIVE_INLINE"

        report.append({
            "skill": skill, "templateId": template_id, "rel": rel,
            "rawHits": raw_hits, "rawLikelyMap": raw_likely_map,
            "afterRenderNeeds": after_render_needs, "fallbackIframe": fallback_iframe,
            "fallbackHasVisibleText": fallback_has_visible_text,
            "mismatch": mismatch, "renderError": render_error or None,
        })

    false_positives = [r for r in report if r["mismatch"] == "FALSE_POSITIVE_IFRAME"]
    false_negatives = [r for r in report if r["mismatch"] == "FALSE_NEGATIVE_INLINE"]
    plain_blank = [r for r in report if not r["rawLikelyMap"] and r["fallbackIframe"] is False and r["fallbackHasVisibleText"] is False and not r["renderError"]]
    map_blank = [r for r in report if r["rawLikelyMap"] and r["fallbackIframe"] is True and r["fallbackHasVisibleText"] is False and not r["renderError"]]
    render_fails = [r for r in report if r["renderError"]]

    summary = {
        "total": len(report),
        "rawMapish": sum(1 for r in report if r["rawLikelyMap"]),
        "rawPlain": sum(1 for r in report if not r["rawLikelyMap"]),
        "falsePositives": len(false_positives),
        "falseNegatives": len(false_negatives),
        "plainBlank": len(plain_blank),
        "mapBlankSuspect": len(map_blank),
        "renderFails": len(render_fails),
    }
    output = {
        "summary": summary,
        "falsePositives": false_positives,
        "falseNegatives": false_negatives,
        "plainBlank": plain_blank,
        "mapBlankSuspect": map_blank[:20],
        "renderFails": render_fails,
        "plainStillIframe": [r for r in report if not r["rawLikelyMap"] and r["fallbackIframe"] is True],
        "mapStillInline": [r for r in report if r["rawLikelyMap"] and r["fallbackIframe"] is False],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

    out_file = OUT_DIR / "template-iframe-audit.json"
    out_file.write_text(json.dumps({"summary": summary, "report": report}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out_file}")


if __name__ == "__main__":
    main()
