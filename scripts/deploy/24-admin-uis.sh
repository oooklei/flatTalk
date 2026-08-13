#!/bin/bash
# 重建 Tag（内嵌管理台）+ local-kb（/admin 管理页）
set -u
BASE=/mnt/llgj/apps/gxy
cd "$BASE" || exit 1
DC=docker-compose

echo "=== compose config ==="
$DC config >/tmp/gxy-compose-config.yml 2>/tmp/gxy-compose-config.err && echo config_OK || { cat /tmp/gxy-compose-config.err; exit 1; }

echo ""
echo "=== stop optional old gxy-tag-ui ==="
docker rm -f gxy-tag-ui 2>/dev/null || true

echo ""
echo "=== build gxy-tag + gxy-local-kb ==="
$DC build gxy-tag gxy-local-kb 2>&1 | tee /tmp/gxy-build-admin2.log | tail -100

echo ""
echo "=== up ==="
$DC up -d gxy-tag gxy-local-kb 2>&1 | tail -20

for i in $(seq 1 48); do
  t=$(curl -fsS --max-time 3 http://127.0.0.1:8011/api/v1/health >/dev/null 2>&1 && echo 1 || echo 0)
  u=$(curl -fsS --max-time 3 http://127.0.0.1:8011/admin/ui/ >/dev/null 2>&1 && echo 1 || echo 0)
  k=$(curl -fsS --max-time 3 http://127.0.0.1:9016/health >/dev/null 2>&1 && echo 1 || echo 0)
  a=$(curl -fsS --max-time 3 -o /tmp/kb-admin.html -w '%{http_code}' http://127.0.0.1:9016/admin/ 2>/dev/null || echo 000)
  echo "t=$((i*5))s tag=$t tagui=$u kb=$k kbadmin=$a"
  [ "$t" = 1 ] && [ "$u" = 1 ] && [ "$k" = 1 ] && [ "$a" = "200" ] && break
  sleep 5
done

echo ""
printf "TAG API : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8011/api/v1/health
printf "TAG UI  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8011/admin/ui/
printf "KB      : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:9016/health
printf "KB admin: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:9016/admin/
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

for c in gxy-tag gxy-local-kb; do
  st=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo missing)
  if [ "$st" != running ]; then
    echo "--- $c ($st) ---"
    docker logs "$c" --tail 50 2>&1
  fi
done
