#!/bin/bash
# 重建 gxy-lis 与 gxy-tag（基础镜像已改为裸名走 daemon 加速器）
set -u
cd /mnt/llgj/apps/gxy || exit 1
DC=docker-compose

echo "=== 构建 gxy-lis ==="
$DC build gxy-lis 2>&1 | tail -12

echo ""
echo "=== 构建 gxy-tag ==="
$DC build gxy-tag 2>&1 | tail -12

echo ""
echo "=== 启动两者 ==="
$DC up -d gxy-lis gxy-tag 2>&1 | tail -6

echo ""
echo "=== 等待就绪（120s）==="
for i in $(seq 1 24); do
  lis=$(curl -fsS --max-time 2 http://127.0.0.1:8100/health >/dev/null 2>&1 && echo ok || echo no)
  tag=$(curl -fsS --max-time 2 http://127.0.0.1:8011/api/v1/health >/dev/null 2>&1 && echo ok || echo no)
  if [ "$lis" = ok ] && [ "$tag" = ok ]; then echo "both ready at $((i*5))s"; break; fi
  sleep 5
done
echo "lis=$lis tag=$tag"

echo ""
echo "=== 容器状态 ==="
docker ps --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "=== LIS /health ==="
curl -s --max-time 8 http://127.0.0.1:8100/health

echo ""
echo ""
echo "=== TAG /api/v1/health ==="
curl -s --max-time 8 http://127.0.0.1:8011/api/v1/health

echo ""
echo ""
echo "=== TAG 登录 ==="
curl -s --max-time 10 -X POST http://127.0.0.1:8011/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | head -c 350

echo ""
echo ""
echo "=== 表数与关键数据复核（init_db 是否破坏数据）==="
docker exec flattalk-postgres psql -U tag_system -d tag_system -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
for t in user_center_user entity_tag tag_definition mobile_workorder; do
  n=$(docker exec flattalk-postgres psql -U tag_system -d tag_system -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo ERR)
  printf "  %-24s %s\n" "$t" "$n"
done

echo ""
echo "=== gxy-tag 日志尾部 ==="
docker logs gxy-tag --tail 12 2>&1
