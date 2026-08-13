#!/bin/bash
# 构建 gxy-tag 并启动。Dockerfile 启动时会自动跑 scripts/init_db.py 建表。
set -u
cd /mnt/llgj/apps/gxy || exit 1
DC=docker-compose

echo "=== Dockerfile COPY *.xlsx 兼容处理 ==="
# 打包时排除了 xlsx，COPY *.xlsx 会导致构建失败；补一个占位文件
if ! ls Tag-System/*.xlsx >/dev/null 2>&1; then
  : > Tag-System/_placeholder.xlsx
  echo "已创建占位 xlsx"
else
  echo "已有 xlsx，跳过"
fi

echo ""
echo "=== 构建 gxy-tag ==="
$DC build gxy-tag 2>&1 | tail -22

echo ""
echo "=== 启动 gxy-tag ==="
$DC up -d gxy-tag 2>&1 | tail -5

echo ""
echo "=== 等待启动（60s）==="
for i in $(seq 1 12); do
  st=$(docker inspect gxy-tag --format '{{.State.Status}}' 2>/dev/null || echo none)
  if [ "$st" = "running" ]; then
    if curl -fsS --max-time 3 http://127.0.0.1:8011/api/v1/health >/dev/null 2>&1; then
      echo "API 就绪 $((i*5))s"; break
    fi
  fi
  sleep 5
done
docker inspect gxy-tag --format 'state={{.State.Status}} health={{.State.Health.Status}}' 2>&1

echo ""
echo "=== /api/v1/health ==="
curl -s --max-time 8 http://127.0.0.1:8011/api/v1/health || echo CURL_FAIL

echo ""
echo ""
echo "=== 建表后 DB 表数（init_db.py 是否新增表）==="
docker exec flattalk-postgres psql -U tag_system -d tag_system -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"

echo ""
echo "=== 关键业务表行数复核（数据是否被 init_db 清掉）==="
for t in user_center_user entity_tag tag_definition mobile_workorder; do
  n=$(docker exec flattalk-postgres psql -U tag_system -d tag_system -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo ERR)
  printf "  %-24s %s\n" "$t" "$n"
done

echo ""
echo "=== 登录实测（拿 token）==="
curl -s --max-time 10 -X POST http://127.0.0.1:8011/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | head -c 400

echo ""
echo ""
echo "=== 最近日志 ==="
docker logs gxy-tag --tail 20 2>&1
