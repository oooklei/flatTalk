#!/bin/bash
# 构建 gxy-lis 镜像并启动，验证意图分拣可用
# 目标机 Docker 20.10.18 无 "docker compose" 子命令，用独立 docker-compose v2.22
set -u
cd /mnt/llgj/apps/gxy || exit 1

DC=docker-compose

echo "=== 配置校验 ==="
$DC config --quiet && echo "config OK"

echo ""
echo "=== 构建 gxy-lis ==="
$DC build gxy-lis 2>&1 | tail -25

echo ""
echo "=== 启动 gxy-lis ==="
$DC up -d gxy-lis 2>&1 | tail -5

echo ""
echo "=== 等待就绪（最多 90s）==="
for i in $(seq 1 18); do
  s=$(docker inspect gxy-lis --format '{{.State.Health.Status}}' 2>/dev/null || echo none)
  if [ "$s" = "healthy" ]; then echo "healthy after ${i}0s"; break; fi
  sleep 5
done
docker inspect gxy-lis --format 'state={{.State.Status}} health={{.State.Health.Status}}'

echo ""
echo "=== /health ==="
curl -s --max-time 10 http://127.0.0.1:8100/health || echo CURL_FAIL

echo ""
echo ""
echo "=== 意图分拣实测：单个服务推荐项 ==="
curl -s --max-time 15 -X POST http://127.0.0.1:8100/v1/sort \
  -H 'Content-Type: application/json' \
  -d '{"utterance":"单个服务推荐项","session_id":"probe-1"}' \
  | head -c 900

echo ""
echo ""
echo "=== 意图分拣实测：我想订一份低盐午餐 ==="
curl -s --max-time 15 -X POST http://127.0.0.1:8100/v1/sort \
  -H 'Content-Type: application/json' \
  -d '{"utterance":"我想订一份低盐午餐","session_id":"probe-2"}' \
  | head -c 700

echo ""
echo ""
echo "=== 编码器与打分器 ==="
curl -s --max-time 10 http://127.0.0.1:8100/ | head -c 500

echo ""
echo ""
echo "=== 最近日志 ==="
docker logs gxy-lis --tail 15 2>&1
