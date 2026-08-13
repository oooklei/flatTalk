#!/usr/bin/env python3
"""扫描工作区，检查是否残留指向旧项目路径的引用。

Python 版，替代 validate-no-source-links.js。
用法: python scripts/validate-no-source-links.py
"""
import json
import os
import sys
from pathlib import Path

LEGACY_PROJECT = "guixiaoyang-chat-system"
SCAN_TARGETS = ["src", "scripts", "tests", "docs", "package.json", "README.md", ".env.example", ".env"]
ALLOWLIST = {".env.example", "src/config/env.js", "scripts/copy-source-assets.js", "scripts/validate-no-source-links.py", "scripts/validate-no-source-links.js"}
FORBIDDEN_REFERENCES = [
    f"D:\\GuiCare\\{LEGACY_PROJECT}",
    f"D:/GuiCare/{LEGACY_PROJECT}",
    f"../{LEGACY_PROJECT}",
    f"..\\{LEGACY_PROJECT}",
    "FLATTALK_SOURCE_ROOT",
    "sourceRoot",
    "source_root",
]
SKIP_DIRS = {"node_modules", ".git", "__pycache__"}


def collect_files(root: Path, target: str, files: list):
    p = root / target
    if not p.exists():
        return
    if p.is_file():
        files.append(target.replace("\\", "/"))
        return
    if not p.is_dir():
        return
    for entry in sorted(p.rglob("*")):
        if any(part in SKIP_DIRS for part in entry.parts):
            continue
        if entry.is_file():
            rel = str(entry.relative_to(root)).replace("\\", "/")
            files.append(rel)


def scan_workspace(root_dir: str = None) -> dict:
    root = Path(root_dir or os.getcwd())
    files = []
    for target in SCAN_TARGETS:
        collect_files(root, target, files)

    violations = []
    for rel in sorted(set(files)):
        if rel in ALLOWLIST:
            continue
        abs_path = root / rel
        try:
            content = abs_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for forbidden in FORBIDDEN_REFERENCES:
            if forbidden in content:
                violations.append({"file": rel, "forbidden": forbidden})

    return {"checked": len(files), "violations": violations}


def main():
    result = scan_workspace()
    if result["violations"]:
        print(json.dumps({"ok": False, "error": f"Forbidden source references found: {json.dumps(result['violations'])}"}, indent=2))
        sys.exit(1)
    print(json.dumps({"ok": True, "checked": result["checked"]}, indent=2))


if __name__ == "__main__":
    main()
