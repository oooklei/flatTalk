#!/bin/bash
# 全量构建并启动 5 个 gxy 服务，逐个等待就绪
set -u
cd /mnt/llgj/apps/gxy || exit 1
DC=docker-compose

echo "=== 配置校验 ==="
$DC config --quiet && echo "config OK" || { echo "CONFIG FAIL"; exit 1; }

echo ""
echo "=== 构建全部（缺失的会补建）==="
$DC build 2>&1 | grep -E 'ERROR|error|naming to|DONE.*naming|Successfully' | tail -20

echo ""
echo "=== 镜像清单 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E '^gxy-'

echo ""
echo "=== 分层启动：先基础服务 ==="
$DC up -d gxy-lis gxy-tag gxy-bge 2>&1 | tail -8

echo ""
echo "=== 等 LIS + TAG（90s）==="
for i in $(seq 1 18); do
  l=$(curl -fsS --max-time 2 http://127.0.0.1:8100/health >/dev/null 2>&1 && echo 1 || echo 0)
  t=$(curl -fsS --max-time 2 http://127.0.0.1:8011/api/v1/health >/dev/null 2>&1 && echo 1 || echo 0)
  [ "$l" = 1 ] && [ "$t" = 1 ] && { echo "LIS+TAG ready $((i*5))s"; break; }
  sleep 5
done

echo ""
echo "=== 等 BGE 模型加载（最多 10 分钟）==="
for i in $(seq 1 60); do
  if docker exec gxy-bge curl -fsS --max-time 3 http://127.0.0.1:9987/health >/dev/null 2>&1; then
    echo "BGE ready $((i*10))s"; break
  fi
  st=$(docker inspect gxy-bge --format '{{.State.Status}}' 2>/dev/null || echo gone)
  [ "$st" != running ] && { echo "BGE 异常退出: $st"; docker logs gxy-bge --tail 20 2>&1; break; }
  sleep 10
done

echo ""
echo "=== 启动 local-kb 与 flattalk ==="
$DC up -d gxy-local-kb 2>&1 | tail -4
sleep 20
$DC up -d gxy-flattalk 2>&1 | tail -4

echo ""
echo "=== 等 flatTalk（120s）==="
for i in $(seq 1 24); do
  if curl -fsS --max-time 3 http://127.0.0.1:5301/api/health >/dev/null 2>&1; then
    echo "flatTalk ready $((i*5))s"; break
  fi
  sleep 5
done

echo ""
echo "=== 全部容器状态 ==="
docker ps -a --filter name=gxy- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

echo ""
echo "=== 健康探测汇总 ==="
printf "LIS       : "; curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 5 http://127.0.0.1:8100/health
printf "TAG       : "; curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 5 http://127.0.0.1:8011/api/v1/health
printf "LOCAL-KB  : "; curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 5 http://127.0.0.1:9016/health
printf "FLATTALK  : "; curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 8 http://127.0.0.1:5301/api/health
printf "BGE(内网) : "; docker exec gxy-bge curl -s -o /dev/null -w 'http=%{http_code}\n' --max-time 5 http://127.0.0.1:9987/health 2>&1

echo ""
echo "=== 失败服务的日志 ==="
for c in gxy-lis gxy-tag gxy-bge gxy-local-kb gxy-flattalk; do
  st=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo missing)
  if [ "$st" != running ]; then
    echo "--- $c ($st) ---"
    docker logs "$c" --tail 15 2>&1
  fi
done

echo ""
echo "=== 内存 ==="
free -h | head -2
