#!/bin/bash
# 确保中间件网络别名 + 停非必要服务 + 重建启动 gxy 四件套
# 本机 Docker 无 `docker compose` 插件，统一用独立二进制 docker-compose。
set -u
BASE=/mnt/llgj/apps/gxy
cd "$BASE" || exit 1
DC="${DC:-docker-compose}"

echo "=== 0. compose 工具 ==="
$DC version | head -3

echo ""
echo "=== 1. 网络别名（postgres/redis）==="
NET=flattalk_flattalk-network
docker network disconnect "$NET" flattalk-postgres 2>/dev/null || true
docker network connect --alias postgres "$NET" flattalk-postgres 2>&1 || echo "postgres alias ok/exists"
docker network disconnect "$NET" flattalk-redis 2>/dev/null || true
docker network connect --alias redis "$NET" flattalk-redis 2>&1 || echo "redis alias ok/exists"

echo ""
echo "=== 2. 停非必要服务腾资源 ==="
for c in mixocr-service flattalk-app flattalk2-app flattalk-dashboard; do
  docker stop "$c" 2>/dev/null && echo "stopped $c" || echo "$c already stopped"
done

echo ""
echo "=== 3. 停旧 gxy 容器（保留镜像）==="
$DC down --remove-orphans 2>&1 | tail -20

echo ""
echo "=== 4. compose config ==="
if $DC config >/tmp/gxy-compose-config.yml 2>/tmp/gxy-compose-config.err; then
  echo config_OK
else
  echo CONFIG_FAIL
  cat /tmp/gxy-compose-config.err
  exit 1
fi

echo ""
echo "=== 5. 构建 LIS + TAG（轻量）==="
$DC build gxy-lis gxy-tag 2>&1 | tee /tmp/gxy-build-lis-tag.log | grep -E 'ERROR|error:|naming to|Successfully tagged|DONE|BUILT|writing image' | tail -40

echo ""
echo "=== 6. 启动 LIS + TAG ==="
$DC up -d gxy-lis gxy-tag 2>&1 | tail -20

echo ""
echo "=== 7. 等 LIS/TAG 就绪 ==="
for i in $(seq 1 36); do
  l=$(curl -fsS --max-time 2 http://127.0.0.1:8100/health >/dev/null 2>&1 && echo 1 || echo 0)
  t=$(curl -fsS --max-time 2 http://127.0.0.1:8011/api/v1/health >/dev/null 2>&1 && echo 1 || echo 0)
  echo "t=$((i*5))s lis=$l tag=$t"
  [ "$l" = 1 ] && [ "$t" = 1 ] && break
  sleep 5
done
if [ "$t" != 1 ]; then
  echo "--- gxy-tag logs ---"
  docker logs gxy-tag --tail 50 2>&1
fi
if [ "$l" != 1 ]; then
  echo "--- gxy-lis logs ---"
  docker logs gxy-lis --tail 50 2>&1
fi

echo ""
echo "=== 8. 构建 BGE（若已有镜像则跳过重下）==="
if docker image inspect gxy-bge:latest >/dev/null 2>&1; then
  echo "gxy-bge:latest exists, skip rebuild"
else
  $DC build gxy-bge 2>&1 | tee /tmp/gxy-build-bge.log | grep -E 'ERROR|error:|naming to|Successfully tagged|DONE|writing image' | tail -20
fi

echo ""
echo "=== 9. 启动 BGE ==="
$DC up -d gxy-bge 2>&1 | tail -10
for i in $(seq 1 60); do
  if docker exec gxy-bge curl -fsS --max-time 3 http://127.0.0.1:9987/health >/dev/null 2>&1; then
    echo "BGE ready $((i*10))s"; break
  fi
  st=$(docker inspect gxy-bge --format '{{.State.Status}}' 2>/dev/null || echo gone)
  echo "bge wait $((i*10))s status=$st"
  [ "$st" != running ] && [ "$st" != restarting ] && { docker logs gxy-bge --tail 30; break; }
  sleep 10
done

echo ""
echo "=== 10. 构建 local-kb + flattalk ==="
$DC build gxy-local-kb gxy-flattalk 2>&1 | tee /tmp/gxy-build-ft.log | grep -E 'ERROR|error:|naming to|Successfully tagged|DONE|writing image|Built' | tail -50

echo ""
echo "=== 11. 启动 local-kb + flattalk ==="
$DC up -d gxy-local-kb gxy-flattalk 2>&1 | tail -20
for i in $(seq 1 48); do
  f=$(curl -fsS --max-time 3 http://127.0.0.1:5301/api/health >/dev/null 2>&1 && echo 1 || echo 0)
  k=$(curl -fsS --max-time 3 http://127.0.0.1:9016/health >/dev/null 2>&1 && echo 1 || echo 0)
  echo "t=$((i*5))s ft=$f kb=$k"
  [ "$f" = 1 ] && break
  sleep 5
done

echo ""
echo "=== 12. 最终状态 ==="
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
printf "LIS  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8100/health
printf "TAG  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:8011/api/v1/health
printf "KB   : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://127.0.0.1:9016/health
printf "FT   : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 http://127.0.0.1:5301/api/health

echo ""
echo "=== 失败日志 ==="
for c in gxy-lis gxy-tag gxy-bge gxy-local-kb gxy-flattalk; do
  st=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo missing)
  if [ "$st" != running ]; then
    echo "--- $c ($st) ---"
    docker logs "$c" --tail 60 2>&1
  fi
done
