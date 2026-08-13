#!/bin/bash
# 构建 gxy-flattalk 主服务。不启动（依赖 local-kb 健康），只验证镜像可构建。
set -u
cd /mnt/llgj/apps/gxy || exit 1
DC=docker-compose

echo "=== .dockerignore 检查（避免把 node_modules 塞进 context）==="
cat flatTalk/.dockerignore 2>/dev/null | head -20 || echo "(无 .dockerignore)"

echo ""
echo "=== 构建 gxy-flattalk ==="
$DC build gxy-flattalk 2>&1 | tail -25

echo ""
echo "=== 镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E '^gxy-flattalk'
