# -*- coding: utf-8 -*-
from pathlib import Path
import json
from collections import Counter

try:
    from openpyxl import Workbook
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl", "-q"])
    from openpyxl import Workbook


def write_xlsx(path: Path, items: list) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "QA"
    ws.append(["id", "category", "question", "answer", "source", "source_id", "tags"])
    for it in items:
        ws.append(
            [
                it.get("id"),
                it.get("category"),
                it.get("question"),
                it.get("answer"),
                it.get("source"),
                it.get("source_id"),
                ",".join(it.get("tags") or []),
            ]
        )
    ws2 = wb.create_sheet("分类统计")
    ws2.append(["category", "count"])
    for k, v in sorted(Counter(it.get("category") for it in items).items(), key=lambda x: (-x[1], x[0] or "")):
        ws2.append([k, v])
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    print("wrote", path, "rows", len(items))


def main() -> None:
    root = Path(__file__).resolve().parent  # 知识库/
    pairs = [
        root / "养老政策" / "QA" / "广西养老政策_QA.json",
        root / "办事指引" / "QA" / "广西养老办事指引_QA.json",
    ]
    for jp in pairs:
        data = json.loads(jp.read_text(encoding="utf-8"))
        write_xlsx(jp.with_suffix(".xlsx"), data["items"])


if __name__ == "__main__":
    main()
