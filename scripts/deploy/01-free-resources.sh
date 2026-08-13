#!/bin/bash
# 腾挪资源：停 mixocr（释放 12.9Gi）、停旧 flatTalk 两套、清理 exited 容器与构建缓存
set -u

echo "=== 停止前内存 ==="
free -h | head -2

echo ""
echo "=== 停 mixocr-service（OCR，与本次无关，可随时重启）==="
docker stop mixocr-service 2>&1 || echo "already stopped"

echo ""
echo "=== 停旧 flatTalk 两套（释放 5298/5299 端口）==="
for c in flattalk-app flattalk2-app flattalk-dashboard; do
  docker stop "$c" 2>&1 || echo "$c already stopped"
done

echo ""
echo "=== 保留的中间件（不动）==="
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'flattalk-postgres|flattalk-redis|^pg\b|pg-dash-proxy'

echo ""
echo "=== 清理 exited 容器 ==="
docker container prune -f 2>&1 | tail -2

echo ""
echo "=== 清理构建缓存 ==="
docker builder prune -f 2>&1 | tail -2

echo ""
echo "=== 清理悬空镜像 ==="
docker image prune -f 2>&1 | tail -2

echo ""
echo "=== 腾挪后内存 ==="
free -h | head -2

echo ""
echo "=== 腾挪后磁盘 ==="
docker system df

echo ""
echo "=== 端口复核 ==="
for p in 5298 5299 5300 8100 8011 8200 5432 6379; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then echo "$p OCCUPIED"; else echo "$p free"; fi
done

echo ""
echo "=== 仍在运行的容器 ==="
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
