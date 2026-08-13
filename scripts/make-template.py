#!/usr/bin/env python3
"""模板制作 CLI：把原型 HTML（单文件 / 文件夹）转换为模板卡。

Python 版，替代 make-template.mjs。
用法:
  python scripts/make-template.py --skill meal_plan --in path/to/proto.html
  python scripts/make-template.py --skill common --in path/to/proto-dir --layout grid
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flattalk_client import FlatTalkClient, FlatTalkError

ROOT = Path.cwd()
SKILLS_DIR = ROOT / "src" / "skills"


def collect_html_files(input_path):
    fp = Path(input_path).resolve()
    if not fp.exists():
        return []
    if fp.is_dir():
        return [p for p in fp.rglob("*") if p.is_file() and p.suffix.lower() in (".html", ".htm")]
    return [fp]


def main():
    parser = argparse.ArgumentParser(description="模板制作 CLI")
    parser.add_argument("--skill", default="common", help="技能目录名")
    parser.add_argument("--layout", default="card", choices=["card", "grid", "vertical", "horizontal"])
    parser.add_argument("--description", default="", help="模板说明")
    parser.add_argument("--in", dest="inputs", nargs="+", required=True, help="输入 HTML 文件或目录")
    args = parser.parse_args()

    skill_dir = SKILLS_DIR / args.skill
    if not skill_dir.exists():
        print(f"技能目录不存在: {skill_dir}")
        sys.exit(1)
    html_dir = skill_dir / "templates" / "html"
    html_dir.mkdir(parents=True, exist_ok=True)

    files = []
    for inp in args.inputs:
        files.extend(collect_html_files(inp))
    if not files:
        print("未找到任何 HTML 文件")
        sys.exit(1)

    client = FlatTalkClient()
    used = set()

    for file_path in files:
        try:
            id_result = client.to_template_id(filename=str(file_path))
            template_id = id_result.get("template_id", file_path.stem)
        except FlatTalkError:
            template_id = file_path.stem

        final_id = template_id
        i = 2
        while final_id in used or (html_dir / f"{final_id}.html").exists():
            final_id = f"{template_id}_{i}"
            i += 1
        used.add(final_id)

        html_content = file_path.read_text(encoding="utf-8")
        try:
            result = client.make_template_from_html(
                html=html_content, template_id=final_id, layout=args.layout, description=args.description,
            )
            (html_dir / f"{final_id}.html").write_text(result.get("html", ""), encoding="utf-8")
            manifest = result.get("manifest", {})
            (html_dir / f"{final_id}.manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            fields = result.get("fields", [])
            print(f"✅ {final_id}  ({html_dir / f'{final_id}.html'})  字段: {len(fields)}")
        except FlatTalkError as e:
            print(f"❌ {final_id}  失败: {e}")

    print(f"\n完成：在技能 {args.skill} 下生成 {len(used)} 个模板。")


if __name__ == "__main__":
    main()
