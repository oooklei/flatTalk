#!/bin/bash
# 查本地已缓存的 python 基础镜像，供 Dockerfile 复用（避免拉取限流）
echo "=== 本地 python 镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -Ei 'python' | head -20

echo ""
echo "=== 本地 node 镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -Ei 'node' | head -10

echo ""
echo "=== gxy 已构建镜像 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -Ei '^gxy' | head

echo ""
echo "=== 可用的镜像加速器配置 ==="
cat /etc/docker/daemon.json 2>/dev/null || echo "(无 daemon.json)"
