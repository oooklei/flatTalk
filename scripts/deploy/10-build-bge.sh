#!/bin/bash
# 构建 gxy-bge（torch CPU + BGE-M3，镜像较大）与 gxy-local-kb
set -u
cd /mnt/llgj/apps/gxy || exit 1
DC=docker-compose

echo "=== 构建 gxy-bge（torch CPU，预计较慢）==="
$DC build gxy-bge 2>&1 | tail -18

echo ""
echo "=== 构建 gxy-local-kb ==="
$DC build gxy-local-kb 2>&1 | tail -12

echo ""
echo "=== 启动 gxy-bge（首启需下载 BGE-M3 模型 ~2.2GB）==="
$DC up -d gxy-bge 2>&1 | tail -4

echo ""
echo "=== 等待 BGE 就绪（最多 8 分钟）==="
for i in $(seq 1 48); do
  if curl -fsS --max-time 3 http://127.0.0.1:9987/health >/dev/null 2>&1; then
    echo "BGE 直连就绪 $((i*10))s"; break
  fi
  # 端口未映射到宿主机，改从容器内探测
  if docker exec gxy-bge sh -c 'curl -fsS --max-time 2 http://127.0.0.1:9987/health' >/dev/null 2>&1; then
    echo "BGE 容器内就绪 $((i*10))s"; break
  fi
  sleep 10
done

echo ""
echo "=== BGE 状态 ==="
docker inspect gxy-bge --format 'state={{.State.Status}} health={{.State.Health.Status}}' 2>&1
docker exec gxy-bge sh -c 'curl -s --max-time 5 http://127.0.0.1:9987/health' 2>&1 | head -c 300

echo ""
echo ""
echo "=== BGE embedding 实测 ==="
docker exec gxy-bge sh -c 'curl -s --max-time 60 -X POST http://127.0.0.1:9987/v1/embeddings -H "Content-Type: application/json" -d "{\"model\":\"bge-m3\",\"input\":[\"养老服务\"]}"' 2>&1 | head -c 200

echo ""
echo ""
echo "=== BGE 日志 ==="
docker logs gxy-bge --tail 15 2>&1

echo ""
echo "=== 镜像体积 ==="
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E '^gxy-' 
