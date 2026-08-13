#!/bin/bash
# 统一修正三个 Dockerfile 的基础镜像：
#   用裸镜像名走 daemon.json 已配的 5 个加速器（tuna/163/ustc/1ms/1panel），
#   不用 docker.xuanyuan.me（429 限流）。
#   python 统一 3.11-slim，先本地预拉一次供三个构建复用。
set -u
cd /mnt/llgj/apps/gxy || exit 1

echo "=== 预拉 python:3.11-slim（走 daemon 加速器）==="
if docker image inspect python:3.11-slim >/dev/null 2>&1; then
  echo "已存在，跳过"
else
  docker pull python:3.11-slim 2>&1 | tail -5
fi

echo ""
echo "=== 预拉 node:20-alpine ==="
docker image inspect node:20-alpine >/dev/null 2>&1 && echo "已存在" || docker pull node:20-alpine 2>&1 | tail -3

echo ""
echo "=== 改写 Dockerfile 基础镜像为裸名 ==="
for f in LIS-System/Dockerfile Tag-System/Dockerfile flatTalk/local-kb/Dockerfile flatTalk/local-kb/Dockerfile.bge flatTalk/Dockerfile; do
  [ -f "$f" ] || continue
  before=$(grep -c 'docker.xuanyuan.me' "$f" || true)
  sed -i 's|docker\.xuanyuan\.me/library/||g' "$f"
  # Tag-System 用 3.12，统一降到已缓存的 3.11
  sed -i 's|python:3\.12-slim-bookworm|python:3.11-slim|g' "$f"
  after=$(grep -c 'docker.xuanyuan.me' "$f" || true)
  echo "  $f: xuanyuan $before -> $after   base=$(grep -m1 '^FROM' "$f")"
done

echo ""
echo "=== 确认 FROM 行 ==="
grep -H '^FROM' LIS-System/Dockerfile Tag-System/Dockerfile \
  flatTalk/local-kb/Dockerfile flatTalk/local-kb/Dockerfile.bge flatTalk/Dockerfile 2>&1
