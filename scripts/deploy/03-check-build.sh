#!/bin/bash
# 检查各项目构建材料是否齐备
cd /mnt/llgj/apps/gxy || exit 1

for d in LIS-System Tag-System flatTalk; do
  echo "=== $d ==="
  ls -1 "$d" 2>/dev/null | grep -Ei 'dockerfile|requirements|package\.json|pyproject|main\.py|server\.py' || echo "  (无构建文件)"
done

echo ""
echo "=== LIS-System requirements ==="
cat LIS-System/requirements.txt 2>/dev/null

echo ""
echo "=== Tag-System requirements ==="
cat Tag-System/requirements.txt 2>/dev/null

echo ""
echo "=== LIS 模型目录 ==="
du -sh LIS-System/models/ 2>/dev/null
find LIS-System/models -maxdepth 2 -type f | head -10

echo ""
echo "=== flatTalk package.json 关键字段 ==="
grep -E '"(name|main|type|start)"|"start":' flatTalk/package.json | head -8

echo ""
echo "=== 现有可复用中间件的网络与服务名 ==="
docker inspect flattalk-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
docker inspect flattalk-redis --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
echo "pg(pgvector):"
docker inspect pg --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'

echo ""
echo "=== flattalk-postgres 在网络内的别名 ==="
docker inspect flattalk-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}: {{$v.Aliases}}{{println}}{{end}}'
docker inspect flattalk-redis --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}: {{$v.Aliases}}{{println}}{{end}}'
