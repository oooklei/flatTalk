#!/bin/bash
# 核查远程 flatTalk 目录完整性（build context 只传 200KB 疑似源码缺失）
cd /mnt/llgj/apps/gxy/flatTalk || exit 1

echo "=== 总文件数与体积 ==="
find . -type f | wc -l
du -sh .

echo ""
echo "=== src 结构 ==="
ls -1 src/ 2>&1 | head -20
echo "src 下文件数: $(find src -type f | wc -l)"

echo ""
echo "=== 关键入口 ==="
for f in package.json src/server.js src/app.js Dockerfile .env.deploy; do
  if [ -f "$f" ]; then echo "  OK   $f ($(stat -c%s "$f") B)"; else echo "  MISS $f"; fi
done

echo ""
echo "=== skills 与模板 ==="
echo "skills: $(ls -1 src/skills 2>/dev/null | wc -l)"
echo "manifest: $(find src/skills -name '*.manifest.json' 2>/dev/null | wc -l)"
echo "html: $(find src/skills -name '*.html' -not -name '*.preview.html' 2>/dev/null | wc -l)"

echo ""
echo "=== .dockerignore 全文 ==="
cat .dockerignore 2>&1

echo ""
echo "=== local-kb ==="
ls -1 local-kb/ 2>&1
