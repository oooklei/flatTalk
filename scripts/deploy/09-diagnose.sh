#!/bin/bash
# 诊断 gxy-tag 的 app.models 导入失败 + gxy-lis 健康检查未通过
set -u
cd /mnt/llgj/apps/gxy || exit 1

echo "=== 宿主机 Tag-System/app 结构 ==="
find Tag-System/app -type f -name '*.py' | sort

echo ""
echo "=== 是否缺 __init__.py ==="
for d in Tag-System/app Tag-System/app/models Tag-System/app/api Tag-System/app/core Tag-System/app/schemas; do
  if [ -f "$d/__init__.py" ]; then echo "  OK   $d/__init__.py"; else echo "  MISS $d/__init__.py"; fi
done

echo ""
echo "=== 容器内 app/models 实际内容 ==="
docker run --rm --entrypoint sh gxy-tag:latest -c 'ls -la /app/app/models/ 2>&1; echo "--- app 顶层 ---"; ls -la /app/app/ 2>&1' 2>&1 | head -30

echo ""
echo "=== init_db.py 期望的导入 ==="
sed -n '1,25p' Tag-System/scripts/init_db.py

echo ""
echo "=== models/__init__.py 内容（宿主机）==="
cat Tag-System/app/models/__init__.py 2>&1 | head -20

echo ""
echo "=== gxy-lis 健康检查诊断 ==="
docker inspect gxy-lis --format '{{json .State.Health}}' 2>&1 | head -c 600
echo ""
echo "--- 容器内自测 curl ---"
docker exec gxy-lis sh -c 'curl -fsS http://127.0.0.1:8100/health 2>&1 | head -c 300' 2>&1
echo ""
echo "--- 容器内是否有 curl ---"
docker exec gxy-lis sh -c 'which curl || echo NO_CURL' 2>&1
echo ""
echo "--- gxy-lis 日志 ---"
docker logs gxy-lis --tail 12 2>&1
